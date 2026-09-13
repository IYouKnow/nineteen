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
	"strings"

	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

// validTriggerStrategies are the deployment strategies the Strategy tab offers.
var validTriggerStrategies = map[string]bool{
	"manual":  true,
	"commit":  true,
	"branch":  true,
	"tag":     true,
	"release": true,
}

// triggerResponse augments the stored trigger with the derived webhook info the
// UI needs: the URL GitHub should call, whether it is registered, and any error
// from the last registration attempt.
type triggerResponse struct {
	models.ProjectTrigger
	WebhookURL    string `json:"webhook_url"`
	PublicBaseURL string `json:"public_base_url"`
	Registered    bool   `json:"registered"`
	WebhookError  string `json:"webhook_error"`
}

func loadTrigger(projectID int64) (models.ProjectTrigger, error) {
	var t models.ProjectTrigger
	var webhookID *int64
	err := db.DB.QueryRow(
		`SELECT id, project_id, strategy, branch, tag_mode, tag_pattern, pre_release,
			enabled, webhook_id, webhook_secret, created_at, updated_at
		 FROM project_triggers WHERE project_id = ?`, projectID,
	).Scan(
		&t.ID, &t.ProjectID, &t.Strategy, &t.Branch, &t.TagMode, &t.TagPattern,
		&t.PreRelease, &t.Enabled, &webhookID, &t.WebhookSecret, &t.CreatedAt, &t.UpdatedAt,
	)
	t.WebhookID = webhookID
	return t, err
}

// ensureTriggerRow returns a project's trigger, creating the default row if it
// is missing (projects created before the table existed, or races).
func ensureTriggerRow(projectID int64) models.ProjectTrigger {
	if t, err := loadTrigger(projectID); err == nil {
		return t
	}
	_, _ = db.DB.Exec("INSERT OR IGNORE INTO project_triggers (project_id, strategy) VALUES (?, 'manual')", projectID)
	t, _ := loadTrigger(projectID)
	return t
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

func buildTriggerResponse(t models.ProjectTrigger, project models.Project, base string) triggerResponse {
	resp := triggerResponse{ProjectTrigger: t, PublicBaseURL: base}
	if base != "" {
		resp.WebhookURL = webhookURL(base, project.ID)
	}
	resp.Registered = t.WebhookID != nil && *t.WebhookID > 0 && t.Strategy != "manual" && t.Enabled
	return resp
}

// webhookEvents maps a strategy to the GitHub events its hook subscribes to.
func webhookEvents(strategy string) []string {
	switch strategy {
	case "tag":
		return []string{"push", "create"}
	case "release":
		return []string{"release"}
	default:
		return []string{"push"}
	}
}

// ProjectTriggerHandler reads and updates a project's deployment strategy.
// Saving a non-manual strategy registers (or refreshes) the GitHub webhook;
// switching to manual removes it.
func ProjectTriggerHandler(w http.ResponseWriter, r *http.Request) {
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
		t := ensureTriggerRow(project.ID)
		base := publicBaseURL(claims.UserID)
		respondJSON(w, http.StatusOK, buildTriggerResponse(t, project, base))
	case http.MethodPut:
		updateTriggerHandler(w, r, claims.UserID, project)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func updateTriggerHandler(w http.ResponseWriter, r *http.Request, userID int64, project models.Project) {
	var req struct {
		Strategy   string `json:"strategy"`
		Branch     string `json:"branch"`
		TagMode    string `json:"tag_mode"`
		TagPattern string `json:"tag_pattern"`
		PreRelease bool   `json:"pre_release"`
		Enabled    *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Strategy = strings.TrimSpace(req.Strategy)
	if !validTriggerStrategies[req.Strategy] {
		respondError(w, http.StatusBadRequest, "strategy must be one of: manual, commit, branch, tag, release")
		return
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
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	if _, err := db.DB.Exec(
		`INSERT INTO project_triggers (project_id, strategy, branch, tag_mode, tag_pattern, pre_release, enabled)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(project_id) DO UPDATE SET
			strategy = excluded.strategy, branch = excluded.branch, tag_mode = excluded.tag_mode,
			tag_pattern = excluded.tag_pattern, pre_release = excluded.pre_release,
			enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`,
		project.ID, req.Strategy, req.Branch, req.TagMode, req.TagPattern, boolToInt(req.PreRelease), boolToInt(enabled),
	); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save trigger configuration")
		return
	}

	// Keep the legacy auto_deploy flag in sync so other views stay correct.
	autoDeploy := req.Strategy != "manual" && enabled
	db.DB.Exec("UPDATE projects SET auto_deploy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", boolToInt(autoDeploy), project.ID)

	t := ensureTriggerRow(project.ID)
	base := publicBaseURL(userID)
	webhookErr := ""

	switch {
	case req.Strategy == "manual" || !enabled:
		removeWebhook(userID, &t, project)
	case base == "":
		webhookErr = "Set a public base URL in Settings → Integrations so GitHub can reach this server."
	default:
		if err := ensureWebhook(userID, &t, project, base); err != nil {
			webhookErr = err.Error()
		}
	}

	t = ensureTriggerRow(project.ID)
	resp := buildTriggerResponse(t, project, base)
	resp.WebhookError = webhookErr
	respondJSON(w, http.StatusOK, resp)
}

// ensureWebhook creates or updates the repository webhook so it points at this
// project's inbound endpoint with the current secret and event set.
func ensureWebhook(userID int64, t *models.ProjectTrigger, project models.Project, base string) error {
	if project.Repository == "" {
		return fmt.Errorf("Link a repository before enabling automatic deployments")
	}
	token, err := githubToken(userID)
	if err != nil {
		return fmt.Errorf("Connect a GitHub integration before enabling automatic deployments")
	}

	hookURL := webhookURL(base, project.ID)
	secret := t.WebhookSecret
	if secret == "" {
		secret = randomSecret()
	}
	events := webhookEvents(t.Strategy)
	client := services.NewGitHubClient(token)

	if t.WebhookID != nil && *t.WebhookID > 0 {
		if err := client.UpdateWebhook(project.Repository, *t.WebhookID, hookURL, secret, events); err == nil {
			db.DB.Exec("UPDATE project_triggers SET webhook_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", secret, t.ID)
			return nil
		}
		// The stored hook may have been deleted on GitHub — recreate it below.
	}

	id, err := client.CreateWebhook(project.Repository, hookURL, secret, events)
	if err != nil {
		return err
	}
	db.DB.Exec("UPDATE project_triggers SET webhook_id = ?, webhook_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id, secret, t.ID)
	return nil
}

// removeWebhook deletes the repository webhook and clears the stored id/secret.
// Best-effort: a GitHub outage must not block switching a project to manual.
func removeWebhook(userID int64, t *models.ProjectTrigger, project models.Project) {
	if t.WebhookID == nil || *t.WebhookID == 0 {
		return
	}
	if token, err := githubToken(userID); err == nil {
		client := services.NewGitHubClient(token)
		_ = client.DeleteWebhook(project.Repository, *t.WebhookID)
	}
	db.DB.Exec("UPDATE project_triggers SET webhook_id = NULL, webhook_secret = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?", t.ID)
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

	t, err := loadTrigger(projectID)
	if err != nil || t.WebhookSecret == "" {
		respondError(w, http.StatusNotFound, "Webhook is not configured for this project")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		respondError(w, http.StatusBadRequest, "Failed to read payload")
		return
	}
	if !verifyWebhookSignature(t.WebhookSecret, body, r.Header.Get("X-Hub-Signature-256")) {
		respondError(w, http.StatusUnauthorized, "Invalid webhook signature")
		return
	}

	event := r.Header.Get("X-GitHub-Event")
	if event == "ping" {
		logDeployEvent(projectID, "ping", "", "", true, "Webhook connected", "webhook", nil)
		respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "message": "pong"})
		return
	}

	if !t.Enabled || t.Strategy == "manual" {
		logDeployEvent(projectID, event, "", "", false, "Automatic deployments are disabled for this project", "webhook", nil)
		respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "matched": false})
		return
	}

	m := matchWebhookEvent(t, event, body)
	if !m.Matched {
		logDeployEvent(projectID, event, m.Ref, m.SHA, false, m.Reason, "webhook", nil)
		respondJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "matched": false, "reason": m.Reason})
		return
	}

	project, err := getProjectByID(projectID)
	if err != nil {
		logDeployEvent(projectID, event, m.Ref, m.SHA, false, "Project not found", "webhook", nil)
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	deployment, err := startDeployment(project.UserID, project, m.Trigger, m.Branch, m.Message, m.Author)
	if err != nil {
		logDeployEvent(projectID, event, m.Ref, m.SHA, false, "Failed to start deployment: "+err.Error(), "webhook", nil)
		respondError(w, http.StatusInternalServerError, "Failed to start deployment")
		return
	}
	logDeployEvent(projectID, event, m.Ref, m.SHA, true, m.Reason, "webhook", &deployment.ID)
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

func logDeployEvent(projectID int64, eventType, ref, sha string, matched bool, reason, source string, deploymentID *int64) {
	_, _ = db.DB.Exec(
		`INSERT INTO deploy_events (project_id, event_type, ref, sha, matched, reason, source, deployment_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		projectID, eventType, ref, sha, boolToInt(matched), reason, source, deploymentID,
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
		`SELECT id, project_id, event_type, ref, sha, matched, reason, source, deployment_id, created_at
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
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.EventType, &e.Ref, &e.SHA, &e.Matched, &e.Reason, &e.Source, &e.DeploymentID, &e.CreatedAt); err != nil {
			continue
		}
		events = append(events, e)
	}
	respondJSON(w, http.StatusOK, events)
}
