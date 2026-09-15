package handlers

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"

	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

// validTriggerStrategies are the automatic deployment strategies a project rule
// may use. "manual" is intentionally absent: no rules means manual deployments.
var validTriggerStrategies = map[string]bool{
	"commit":  true,
	"branch":  true,
	"tag":     true,
	"release": true,
}

// triggerListResponse is the Strategy tab's payload: every rule plus the
// project-level webhook state shared by all of them.
type triggerListResponse struct {
	Triggers      []models.ProjectTrigger `json:"triggers"`
	Provider      string                  `json:"provider"`
	PublicBaseURL string                  `json:"public_base_url"`
	WebhookURL    string                  `json:"webhook_url"`
	Registered    bool                    `json:"registered"`
	WebhookError  string                  `json:"webhook_error"`
}

// projectProvider returns a project's source provider, defaulting to GitHub when
// unset for backward compatibility.
func projectProvider(project models.Project) string {
	if strings.TrimSpace(project.Provider) == "" {
		return "github"
	}
	return project.Provider
}

// isGitHubProject reports whether the project's repository is hosted on GitHub,
// the only provider with automatic webhook delivery wired up.
func isGitHubProject(project models.Project) bool {
	return projectProvider(project) == "github"
}

type triggerPayload struct {
	Strategy   string `json:"strategy"`
	Branch     string `json:"branch"`
	TagMode    string `json:"tag_mode"`
	TagPattern string `json:"tag_pattern"`
	PreRelease bool   `json:"pre_release"`
	Enabled    *bool  `json:"enabled"`
}

// ---- storage ----

func loadTriggers(projectID int64) ([]models.ProjectTrigger, error) {
	rows, err := db.DB.Query(
		`SELECT id, project_id, strategy, branch, tag_mode, tag_pattern, pre_release,
			enabled, created_at, updated_at
		 FROM project_triggers WHERE project_id = ? ORDER BY id ASC`, projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	triggers := []models.ProjectTrigger{}
	for rows.Next() {
		var t models.ProjectTrigger
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Strategy, &t.Branch, &t.TagMode,
			&t.TagPattern, &t.PreRelease, &t.Enabled, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		triggers = append(triggers, t)
	}
	return triggers, rows.Err()
}

func loadTriggerByID(projectID, triggerID int64) (models.ProjectTrigger, error) {
	var t models.ProjectTrigger
	err := db.DB.QueryRow(
		`SELECT id, project_id, strategy, branch, tag_mode, tag_pattern, pre_release,
			enabled, created_at, updated_at
		 FROM project_triggers WHERE id = ? AND project_id = ?`, triggerID, projectID,
	).Scan(&t.ID, &t.ProjectID, &t.Strategy, &t.Branch, &t.TagMode, &t.TagPattern,
		&t.PreRelease, &t.Enabled, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func loadProjectWebhook(projectID int64) (models.ProjectWebhook, error) {
	var w models.ProjectWebhook
	var id *int64
	err := db.DB.QueryRow(
		"SELECT project_id, webhook_id, webhook_secret FROM project_webhooks WHERE project_id = ?", projectID,
	).Scan(&w.ProjectID, &id, &w.WebhookSecret)
	w.WebhookID = id
	return w, err
}

// ensureProjectWebhookRow returns a project's webhook row, creating it if absent.
func ensureProjectWebhookRow(projectID int64) models.ProjectWebhook {
	if w, err := loadProjectWebhook(projectID); err == nil {
		return w
	}
	_, _ = db.DB.Exec("INSERT OR IGNORE INTO project_webhooks (project_id) VALUES (?)", projectID)
	w, _ := loadProjectWebhook(projectID)
	return w
}

// ---- HTTP handlers ----

// ProjectTriggersHandler lists and creates a project's deployment strategies.
func ProjectTriggersHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	project, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		base := publicBaseURL(claims.UserID)
		respondJSON(w, http.StatusOK, buildTriggerListResponse(project, base))
	case http.MethodPost:
		createTriggerHandler(w, r, claims.UserID, project)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ProjectTriggerItemHandler updates and deletes a single deployment strategy.
func ProjectTriggerItemHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	project, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}
	triggerID, ok := pathInt(r, "triggerId")
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid trigger ID")
		return
	}
	t, err := loadTriggerByID(project.ID, triggerID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Strategy not found")
		return
	}

	switch r.Method {
	case http.MethodPut:
		updateTriggerItemHandler(w, r, claims.UserID, project, t)
	case http.MethodDelete:
		deleteTriggerHandler(w, claims.UserID, project, t)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func createTriggerHandler(w http.ResponseWriter, r *http.Request, userID int64, project models.Project) {
	req, ok := decodeTriggerPayload(w, r, project)
	if !ok {
		return
	}
	if _, err := db.DB.Exec(
		`INSERT INTO project_triggers (project_id, strategy, branch, tag_mode, tag_pattern, pre_release, enabled)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		project.ID, req.Strategy, req.Branch, req.TagMode, req.TagPattern, boolToInt(req.PreRelease), boolToInt(enabledValue(req)),
	); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create strategy")
		return
	}
	respondTriggerList(w, http.StatusCreated, userID, project)
}

func updateTriggerItemHandler(w http.ResponseWriter, r *http.Request, userID int64, project models.Project, t models.ProjectTrigger) {
	req, ok := decodeTriggerPayload(w, r, project)
	if !ok {
		return
	}
	if _, err := db.DB.Exec(
		`UPDATE project_triggers SET strategy = ?, branch = ?, tag_mode = ?, tag_pattern = ?,
			pre_release = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ? AND project_id = ?`,
		req.Strategy, req.Branch, req.TagMode, req.TagPattern, boolToInt(req.PreRelease),
		boolToInt(enabledValue(req)), t.ID, project.ID,
	); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update strategy")
		return
	}
	respondTriggerList(w, http.StatusOK, userID, project)
}

func deleteTriggerHandler(w http.ResponseWriter, userID int64, project models.Project, t models.ProjectTrigger) {
	if _, err := db.DB.Exec("DELETE FROM project_triggers WHERE id = ? AND project_id = ?", t.ID, project.ID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete strategy")
		return
	}
	respondTriggerList(w, http.StatusOK, userID, project)
}

// decodeTriggerPayload parses and normalizes a create/update body, writing an
// error response and returning ok=false on failure.
func decodeTriggerPayload(w http.ResponseWriter, r *http.Request, project models.Project) (triggerPayload, bool) {
	var req triggerPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return req, false
	}
	req.Strategy = strings.TrimSpace(req.Strategy)
	if !validTriggerStrategies[req.Strategy] {
		respondError(w, http.StatusBadRequest, "strategy must be one of: commit, branch, tag, release")
		return req, false
	}
	if req.Branch == "" {
		req.Branch = project.Branch
	}
	if req.Branch == "" {
		req.Branch = "main"
	}
	if req.TagMode != "any" && req.TagMode != "pattern" {
		req.TagMode = "pattern"
	}
	if req.TagPattern == "" {
		req.TagPattern = "v*"
	}
	return req, true
}

func enabledValue(req triggerPayload) bool {
	if req.Enabled == nil {
		return true
	}
	return *req.Enabled
}

func respondTriggerList(w http.ResponseWriter, status int, userID int64, project models.Project) {
	base := publicBaseURL(userID)
	webhookErr := syncProjectWebhook(userID, project, base)
	resp := buildTriggerListResponse(project, base)
	resp.WebhookError = webhookErr
	respondJSON(w, status, resp)
}

func buildTriggerListResponse(project models.Project, base string) triggerListResponse {
	triggers, err := loadTriggers(project.ID)
	if err != nil || triggers == nil {
		triggers = []models.ProjectTrigger{}
	}
	resp := triggerListResponse{
		Triggers:      triggers,
		Provider:      projectProvider(project),
		PublicBaseURL: base,
	}
	// Only GitHub projects have webhook delivery wired up; other providers
	// (e.g. Gitea) must not surface or use the GitHub webhook endpoint.
	if isGitHubProject(project) {
		wh := ensureProjectWebhookRow(project.ID)
		if base != "" {
			resp.WebhookURL = webhookURL(base, project.ID)
		}
		resp.Registered = wh.WebhookID != nil && *wh.WebhookID > 0
	}
	return resp
}

// ---- webhook management ----

// syncProjectWebhook reconciles the single repository webhook with the project's
// current set of enabled rules, updates the legacy auto_deploy flag, and returns
// a non-fatal warning message (empty when everything is fine).
func syncProjectWebhook(userID int64, project models.Project, base string) string {
	triggers, _ := loadTriggers(project.ID)
	events := webhookEventsForTriggers(triggers)

	autoDeploy := len(events) > 0
	db.DB.Exec("UPDATE projects SET auto_deploy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", boolToInt(autoDeploy), project.ID)

	// Non-GitHub providers (e.g. Gitea) do not use the GitHub webhook. Their
	// provider-specific webhooks are not managed here, so leave GitHub untouched.
	if !isGitHubProject(project) {
		return ""
	}

	if !autoDeploy {
		removeProjectWebhook(userID, project)
		return ""
	}
	if base == "" {
		return "Set a public base URL in Settings → Integrations so GitHub can reach this server."
	}
	if err := ensureProjectWebhook(userID, project, base, events); err != nil {
		return err.Error()
	}
	return ""
}

// webhookEventsForTriggers returns the GitHub events needed to serve the enabled
// rules, in a stable order.
func webhookEventsForTriggers(triggers []models.ProjectTrigger) []string {
	set := map[string]bool{}
	for _, t := range triggers {
		if !t.Enabled {
			continue
		}
		switch t.Strategy {
		case "commit", "branch":
			set["push"] = true
		case "tag":
			set["push"] = true
			set["create"] = true
		case "release":
			set["release"] = true
		}
	}
	out := []string{}
	for _, e := range []string{"push", "create", "release"} {
		if set[e] {
			out = append(out, e)
		}
	}
	return out
}

// ensureProjectWebhook creates or updates the repository webhook so it points at
// this project's inbound endpoint with the current secret and event set.
func ensureProjectWebhook(userID int64, project models.Project, base string, events []string) error {
	if !isGitHubProject(project) {
		return nil
	}
	if project.Repository == "" {
		return fmt.Errorf("Link a repository before enabling automatic deployments")
	}
	token, err := githubToken(userID)
	if err != nil {
		return fmt.Errorf("Connect a GitHub integration before enabling automatic deployments")
	}

	hookURL := webhookURL(base, project.ID)
	wh := ensureProjectWebhookRow(project.ID)
	secret := wh.WebhookSecret
	if secret == "" {
		secret = randomSecret()
	}
	client := services.NewGitHubClient(token)

	if wh.WebhookID != nil && *wh.WebhookID > 0 {
		if err := client.UpdateWebhook(project.Repository, *wh.WebhookID, hookURL, secret, events); err == nil {
			db.DB.Exec("UPDATE project_webhooks SET webhook_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?", secret, project.ID)
			return nil
		}
		// The stored hook may have been deleted on GitHub — recreate it below.
	}

	id, err := client.CreateWebhook(project.Repository, hookURL, secret, events)
	if err != nil {
		return err
	}
	db.DB.Exec("UPDATE project_webhooks SET webhook_id = ?, webhook_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?", id, secret, project.ID)
	return nil
}

// removeProjectWebhook deletes the repository webhook and clears the stored
// id/secret. Best-effort: a GitHub outage must not block disabling triggers.
func removeProjectWebhook(userID int64, project models.Project) {
	if !isGitHubProject(project) {
		return
	}
	wh, err := loadProjectWebhook(project.ID)
	if err != nil || wh.WebhookID == nil || *wh.WebhookID == 0 {
		return
	}
	if token, err := githubToken(userID); err == nil {
		client := services.NewGitHubClient(token)
		_ = client.DeleteWebhook(project.Repository, *wh.WebhookID)
	}
	db.DB.Exec("UPDATE project_webhooks SET webhook_id = NULL, webhook_secret = '', updated_at = CURRENT_TIMESTAMP WHERE project_id = ?", project.ID)
}

// publicBaseURL reads the user's configured public base URL, if any.
func publicBaseURL(userID int64) string {
	var v string
	if err := db.DB.QueryRow(
		"SELECT value FROM settings WHERE user_id = ? AND key = 'public_base_url'", userID,
	).Scan(&v); err != nil {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(v), "/")
}

func webhookURL(base string, projectID int64) string {
	return fmt.Sprintf("%s/api/webhooks/github/%d", strings.TrimRight(base, "/"), projectID)
}

// ---- inbound GitHub webhook ----

type ghPushPayload struct {
	Ref        string `json:"ref"`
	After      string `json:"after"`
	Deleted    bool   `json:"deleted"`
	HeadCommit *struct {
		ID      string `json:"id"`
		Message string `json:"message"`
	} `json:"head_commit"`
	Pusher struct {
		Name string `json:"name"`
	} `json:"pusher"`
	Sender struct {
		Login string `json:"login"`
	} `json:"sender"`
}

type ghCreatePayload struct {
	Ref     string `json:"ref"`
	RefType string `json:"ref_type"`
	Sender  struct {
		Login string `json:"login"`
	} `json:"sender"`
}

type ghReleasePayload struct {
	Action  string `json:"action"`
	Release struct {
		TagName    string `json:"tag_name"`
		Name       string `json:"name"`
		Prerelease bool   `json:"prerelease"`
	} `json:"release"`
	Sender struct {
		Login string `json:"login"`
	} `json:"sender"`
}

type webhookMatch struct {
	Matched bool
	Reason  string
	Trigger string
	Branch  string
	Ref     string
	SHA     string
	Message string
	Author  string
}

// GitHubWebhookHandler receives GitHub webhook deliveries. It is unauthenticated
// by token but every request must carry a valid HMAC-SHA256 signature computed
// with the project's stored secret.
func GitHubWebhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	projectID, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	wh, err := loadProjectWebhook(projectID)
	if err != nil || wh.WebhookSecret == "" {
		respondError(w, http.StatusNotFound, "Webhook is not configured for this project")
		return
	}
	project, err := getProjectByID(projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}
	if !isGitHubProject(project) {
		respondError(w, http.StatusNotFound, "Webhook is not configured for this project")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		respondError(w, http.StatusBadRequest, "Failed to read payload")
		return
	}
	if !verifyWebhookSignature(wh.WebhookSecret, body, r.Header.Get("X-Hub-Signature-256")) {
		respondError(w, http.StatusUnauthorized, "Invalid webhook signature")
		return
	}

	event := r.Header.Get("X-GitHub-Event")
	if event == "ping" {
		logDeployEvent(projectID, "ping", "", "", true, "Webhook connected", "webhook", nil, nil)
		respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "message": "pong"})
		return
	}

	triggers, _ := loadTriggers(projectID)
	enabled := []models.ProjectTrigger{}
	for _, t := range triggers {
		if t.Enabled {
			enabled = append(enabled, t)
		}
	}
	if len(enabled) == 0 {
		logDeployEvent(projectID, event, "", "", false, "No automatic strategies are enabled for this project", "webhook", nil, nil)
		respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "matched": false})
		return
	}

	// Test the event against every enabled rule and deploy on the first match.
	var match webhookMatch
	var matchedTrigger *models.ProjectTrigger
	for i := range enabled {
		m := matchWebhookEvent(enabled[i], event, body)
		if m.Matched {
			match = m
			matchedTrigger = &enabled[i]
			break
		}
		if match.Reason == "" {
			match = m
		}
	}
	if matchedTrigger == nil {
		logDeployEvent(projectID, event, match.Ref, match.SHA, false, match.Reason, "webhook", nil, nil)
		respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "matched": false, "reason": match.Reason})
		return
	}

	deployment, err := startDeployment(project.UserID, project, match.Trigger, match.Branch, match.Message, match.Author)
	if err != nil {
		logDeployEvent(projectID, event, match.Ref, match.SHA, false, "Failed to start deployment: "+err.Error(), "webhook", nil, nil)
		respondError(w, http.StatusInternalServerError, "Failed to start deployment")
		return
	}
	logDeployEvent(projectID, event, match.Ref, match.SHA, true, match.Reason, "webhook", &matchedTrigger.ID, &deployment.ID)
	respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "matched": true, "deployment_id": deployment.ID})
}

func verifyWebhookSignature(secret string, body []byte, signature string) bool {
	if signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func matchWebhookEvent(t models.ProjectTrigger, event string, body []byte) webhookMatch {
	switch event {
	case "push":
		var p ghPushPayload
		if err := json.Unmarshal(body, &p); err != nil {
			return webhookMatch{Reason: "Could not parse push payload"}
		}
		if p.Deleted {
			return webhookMatch{Ref: p.Ref, Reason: "Branch or tag deletion ignored"}
		}
		sha := p.After
		msg := ""
		if p.HeadCommit != nil {
			msg = firstLine(p.HeadCommit.Message)
			if p.HeadCommit.ID != "" {
				sha = p.HeadCommit.ID
			}
		}
		author := p.Pusher.Name
		if author == "" {
			author = p.Sender.Login
		}

		switch t.Strategy {
		case "commit", "branch":
			if p.Ref != "refs/heads/"+t.Branch {
				return webhookMatch{Ref: shortRef(p.Ref), SHA: sha, Reason: fmt.Sprintf("Push to %s does not match watched branch %s", shortRef(p.Ref), t.Branch)}
			}
			return webhookMatch{Matched: true, Trigger: "commit", Branch: t.Branch, Ref: shortRef(p.Ref), SHA: sha, Message: msg, Author: author, Reason: fmt.Sprintf("Push to %s", t.Branch)}
		case "tag":
			if !strings.HasPrefix(p.Ref, "refs/tags/") {
				return webhookMatch{Ref: shortRef(p.Ref), SHA: sha, Reason: "Push is not a tag"}
			}
			tag := strings.TrimPrefix(p.Ref, "refs/tags/")
			if !matchTag(t, tag) {
				return webhookMatch{Ref: tag, SHA: sha, Reason: fmt.Sprintf("Tag %s does not match pattern %s", tag, t.TagPattern)}
			}
			return webhookMatch{Matched: true, Trigger: "tag", Branch: t.Branch, Ref: tag, SHA: sha, Message: "Tag " + tag, Author: author, Reason: fmt.Sprintf("Tag %s matched", tag)}
		default:
			return webhookMatch{Ref: shortRef(p.Ref), SHA: sha, Reason: "Strategy does not deploy on push"}
		}
	case "create":
		var p ghCreatePayload
		if err := json.Unmarshal(body, &p); err != nil {
			return webhookMatch{Reason: "Could not parse create payload"}
		}
		if p.RefType != "tag" {
			return webhookMatch{Ref: p.Ref, Reason: "Created ref is not a tag"}
		}
		if t.Strategy != "tag" {
			return webhookMatch{Ref: p.Ref, Reason: "Strategy does not deploy on tag creation"}
		}
		if !matchTag(t, p.Ref) {
			return webhookMatch{Ref: p.Ref, Reason: fmt.Sprintf("Tag %s does not match pattern %s", p.Ref, t.TagPattern)}
		}
		return webhookMatch{Matched: true, Trigger: "tag", Branch: t.Branch, Ref: p.Ref, Message: "Tag " + p.Ref, Author: p.Sender.Login, Reason: fmt.Sprintf("Tag %s created", p.Ref)}
	case "release":
		var p ghReleasePayload
		if err := json.Unmarshal(body, &p); err != nil {
			return webhookMatch{Reason: "Could not parse release payload"}
		}
		if p.Action != "published" {
			return webhookMatch{Ref: p.Release.TagName, Reason: fmt.Sprintf("Release action %q ignored", p.Action)}
		}
		if t.Strategy != "release" {
			return webhookMatch{Ref: p.Release.TagName, Reason: "Strategy does not deploy on releases"}
		}
		if p.Release.Prerelease && !t.PreRelease {
			return webhookMatch{Ref: p.Release.TagName, Reason: "Pre-release ignored"}
		}
		name := p.Release.Name
		if name == "" {
			name = p.Release.TagName
		}
		return webhookMatch{Matched: true, Trigger: "release", Branch: t.Branch, Ref: p.Release.TagName, Message: "Release " + name, Author: p.Sender.Login, Reason: fmt.Sprintf("Release %s published", name)}
	default:
		return webhookMatch{Reason: fmt.Sprintf("Event %q is not handled", event)}
	}
}

func matchTag(t models.ProjectTrigger, tag string) bool {
	if t.TagMode == "any" {
		return true
	}
	pattern := t.TagPattern
	if pattern == "" {
		pattern = "v*"
	}
	ok, err := path.Match(pattern, tag)
	return err == nil && ok
}

func shortRef(ref string) string {
	ref = strings.TrimPrefix(ref, "refs/heads/")
	ref = strings.TrimPrefix(ref, "refs/tags/")
	return ref
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func logDeployEvent(projectID int64, eventType, ref, sha string, matched bool, reason, source string, triggerID, deploymentID *int64) {
	_, _ = db.DB.Exec(
		`INSERT INTO deploy_events (project_id, event_type, ref, sha, matched, reason, source, trigger_id, deployment_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		projectID, eventType, ref, sha, boolToInt(matched), reason, source, triggerID, deploymentID,
	)
}

func randomSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return randomHex(64)
	}
	return hex.EncodeToString(b)
}

// ProjectEventsHandler lists the trigger events a project has received, newest
// first, for the Strategy tab's deployment activity feed.
func ProjectEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	if _, err := getProject(claims.UserID, id); err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	rows, err := db.DB.Query(
		`SELECT id, project_id, event_type, ref, sha, matched, reason, source, trigger_id, deployment_id, created_at
		 FROM deploy_events WHERE project_id = ? ORDER BY id DESC LIMIT 100`, id,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	events := []models.DeployEvent{}
	for rows.Next() {
		var e models.DeployEvent
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.EventType, &e.Ref, &e.SHA, &e.Matched, &e.Reason, &e.Source, &e.TriggerID, &e.DeploymentID, &e.CreatedAt); err != nil {
			continue
		}
		events = append(events, e)
	}
	respondJSON(w, http.StatusOK, events)
}

// pathInt reads an integer path parameter by name.
func pathInt(r *http.Request, name string) (int64, bool) {
	s := r.PathValue(name)
	if s == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}
