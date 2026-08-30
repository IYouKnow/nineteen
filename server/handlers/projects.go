package handlers

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

const (
	statusBuilding = "building"
	statusReady    = "ready"
	statusError    = "error"
)

// ---- project helpers ----

type rowScanner interface {
	Scan(dest ...interface{}) error
}

const projectSelect = `SELECT id, user_id, name, slug, status, framework, repository, branch,
	domain, description, auto_deploy, region, instance_type, build_strategy,
	last_deployed_at, created_date, updated_date FROM projects`

func ProjectsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listProjectsHandler(w, r)
	case http.MethodPost:
		createProjectHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func listProjectsHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	rows, err := db.DB.Query(projectSelect+" WHERE user_id = ? ORDER BY created_date DESC", claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	projects := []models.Project{}
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Slug, &p.Status, &p.Framework,
			&p.Repository, &p.Branch, &p.Domain, &p.Description, &p.AutoDeploy, &p.Region,
			&p.InstanceType, &p.BuildStrategy, &p.LastDeployedAt, &p.CreatedDate, &p.UpdatedDate); err != nil {
			continue
		}
		projects = append(projects, p)
	}

	respondJSON(w, http.StatusOK, projects)
}

func createProjectHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req struct {
		Name          string `json:"name"`
		Slug          string `json:"slug"`
		Status        string `json:"status"`
		Framework     string `json:"framework"`
		Repository    string `json:"repository"`
		Branch        string `json:"branch"`
		Domain        string `json:"domain"`
		Description   string `json:"description"`
		AutoDeploy    bool   `json:"auto_deploy"`
		Region        string `json:"region"`
		InstanceType  string `json:"instance_type"`
		BuildStrategy string `json:"build_strategy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	}
	if req.Framework == "" {
		req.Framework = "node"
	}
	if req.Branch == "" {
		req.Branch = "main"
	}
	if req.Region == "" {
		req.Region = "fra1"
	}
	if req.InstanceType == "" {
		req.InstanceType = "nano"
	}
	if req.BuildStrategy == "" {
		req.BuildStrategy = "detect"
	}
	if req.Status == "" {
		req.Status = "idle"
	}

	result, err := db.DB.Exec(
		`INSERT INTO projects (user_id, name, slug, status, framework, repository, branch, domain,
			description, auto_deploy, region, instance_type, build_strategy)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		claims.UserID, req.Name, req.Slug, req.Status, req.Framework, req.Repository,
		req.Branch, req.Domain, req.Description, req.AutoDeploy, req.Region, req.InstanceType, req.BuildStrategy,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create project")
		return
	}

	id, _ := result.LastInsertId()
	p, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to load project")
		return
	}
	respondJSON(w, http.StatusCreated, p)
}

func ProjectHandler(w http.ResponseWriter, r *http.Request) {
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

	switch r.Method {
	case http.MethodGet:
		p, err := getProject(claims.UserID, id)
		if err != nil {
			respondError(w, http.StatusNotFound, "Project not found")
			return
		}
		respondJSON(w, http.StatusOK, p)
	case http.MethodPut:
		p, err := updateProject(w, r, claims.UserID, id)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to update project")
			return
		}
		respondJSON(w, http.StatusOK, p)
	case http.MethodDelete:
		if _, err := db.DB.Exec("DELETE FROM projects WHERE id = ? AND user_id = ?", id, claims.UserID); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to delete project")
			return
		}
		respondJSON(w, http.StatusOK, map[string]string{"message": "Project deleted"})
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func getProject(userID, id int64) (models.Project, error) {
	var p models.Project
	err := db.DB.QueryRow(projectSelect+" WHERE id = ? AND user_id = ?", id, userID).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Slug, &p.Status, &p.Framework,
		&p.Repository, &p.Branch, &p.Domain, &p.Description, &p.AutoDeploy, &p.Region,
		&p.InstanceType, &p.BuildStrategy, &p.LastDeployedAt, &p.CreatedDate, &p.UpdatedDate,
	)
	return p, err
}

var updatableProjectColumns = map[string]bool{
	"status": true, "framework": true, "repository": true, "branch": true,
	"domain": true, "description": true, "auto_deploy": true, "region": true,
	"instance_type": true, "build_strategy": true, "name": true, "slug": true,
	"last_deployed_at": true,
}

func updateProject(w http.ResponseWriter, r *http.Request, userID, id int64) (models.Project, error) {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return models.Project{}, fmt.Errorf("bad body")
	}

	sets := []string{}
	args := []interface{}{}
	for col, val := range body {
		if !updatableProjectColumns[col] {
			continue
		}
		sets = append(sets, col+" = ?")
		if col == "auto_deploy" {
			args = append(args, boolToInt(toBool(val)))
		} else {
			args = append(args, valueToString(val))
		}
	}
	if len(sets) == 0 {
		return getProject(userID, id)
	}
	sets = append(sets, "updated_date = CURRENT_TIMESTAMP")
	args = append(args, id, userID)

	q := "UPDATE projects SET " + strings.Join(sets, ", ") + " WHERE id = ? AND user_id = ?"
	if _, err := db.DB.Exec(q, args...); err != nil {
		return models.Project{}, err
	}
	return getProject(userID, id)
}

func ProjectDeploymentsHandler(w http.ResponseWriter, r *http.Request) {
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

	switch r.Method {
	case http.MethodGet:
		rows, err := db.DB.Query(
			"SELECT id, user_id, project_id, project_name, status, commit_sha, commit_message, branch, author, trigger, framework, duration, port, url, created_date, updated_date FROM deployments WHERE project_id = ? AND user_id = ? ORDER BY created_date DESC", id, claims.UserID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Database error")
			return
		}
		defer rows.Close()
		deployments := []models.Deployment{}
		for rows.Next() {
			d, err := scanDeployment(rows)
			if err != nil {
				continue
			}
			deployments = append(deployments, d)
		}
		respondJSON(w, http.StatusOK, deployments)
	case http.MethodPost:
		createDeploymentHandler(w, r, claims.UserID, id)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func createDeploymentHandler(w http.ResponseWriter, r *http.Request, userID, projectID int64) {
	project, err := getProject(userID, projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	var req struct {
		CommitMessage string `json:"commit_message"`
		Branch        string `json:"branch"`
		Author        string `json:"author"`
		Trigger       string `json:"trigger"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if req.Branch == "" {
		req.Branch = project.Branch
	}
	if req.Author == "" {
		req.Author = "you"
	}
	if req.Trigger == "" {
		req.Trigger = "manual"
	}
	if req.CommitMessage == "" {
		req.CommitMessage = "Manual deployment"
	}

	sha := randomHex(40)
	result, err := db.DB.Exec(
		`INSERT INTO deployments (user_id, project_id, project_name, status, commit_sha, commit_message,
			branch, author, trigger, framework) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, projectID, project.Name, statusBuilding, sha, req.CommitMessage,
		req.Branch, req.Author, req.Trigger, project.Framework,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create deployment")
		return
	}

	deployID, _ := result.LastInsertId()

	now := time.Now().UTC().Format(time.RFC3339)
	db.DB.Exec("UPDATE projects SET status = ?, last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusBuilding, now, project.ID)

	go buildAndDeploy(deployID, project)

	d, err := getDeployment(userID, deployID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to load deployment")
		return
	}
	respondJSON(w, http.StatusCreated, d)
}

func DeploymentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	rows, err := db.DB.Query(deploymentSelect + " WHERE user_id = ? ORDER BY created_date DESC LIMIT 50", claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()
	deployments := []models.Deployment{}
	for rows.Next() {
		d, err := scanDeployment(rows)
		if err != nil {
			continue
		}
		deployments = append(deployments, d)
	}
	respondJSON(w, http.StatusOK, deployments)
}

func DeploymentHandler(w http.ResponseWriter, r *http.Request) {
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
		respondError(w, http.StatusBadRequest, "Invalid deployment ID")
		return
	}
	d, err := getDeployment(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Deployment not found")
		return
	}
	respondJSON(w, http.StatusOK, d)
}

func DeploymentLogsHandler(w http.ResponseWriter, r *http.Request) {
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
		respondError(w, http.StatusBadRequest, "Invalid deployment ID")
		return
	}

	var deployID int64
	err = db.DB.QueryRow("SELECT id FROM deployments WHERE id = ? AND user_id = ?", id, claims.UserID).Scan(&deployID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Deployment not found")
		return
	}

	rows, err := db.DB.Query(
		"SELECT id, deployment_id, timestamp, level, message FROM deployment_logs WHERE deployment_id = ? ORDER BY id ASC",
		deployID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	logs := []models.DeploymentLog{}
	for rows.Next() {
		var l models.DeploymentLog
		var ts string
		if err := rows.Scan(&l.ID, &l.DeploymentID, &ts, &l.Level, &l.Message); err != nil {
			continue
		}
		if t, err := time.Parse("2006-01-02 15:04:05", ts); err == nil {
			l.Timestamp = t
		}
		logs = append(logs, l)
	}
	respondJSON(w, http.StatusOK, logs)
}

// ---- deployment worker (Phase B: real Docker build) ----

func buildAndDeploy(deployID int64, project models.Project) {
	log := func(level, msg string) {
		db.DB.Exec("INSERT INTO deployment_logs (deployment_id, level, message) VALUES (?, ?, ?)", deployID, level, msg)
	}
	start := time.Now()

	d := services.NewDeployer()

	if err := d.DockerAvailable(); err != nil {
		log("error", err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}

	token, err := githubToken(project.UserID)
	if err != nil {
		log("error", "No GitHub integration available to clone the repository")
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}

	log("info", fmt.Sprintf("Deploying %s (%s)", project.Repository, project.Slug))
	dir, err := d.CloneRepo(token, project.Repository, func(line string) { log("info", line) })
	defer os.RemoveAll(dir)
	if err != nil {
		log("error", "Clone failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}
	log("info", "Repository cloned")

	if _, err := os.Stat(filepath.Join(dir, "Dockerfile")); err != nil {
		log("error", "No Dockerfile found. Add a Dockerfile to the repo, or pick a different build strategy.")
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}

	buildRef := randomHex(8)
	image := fmt.Sprintf("nineteen-%s:%s", project.Slug, buildRef)
	containerName := fmt.Sprintf("nineteen-%s", project.Slug)
	log("info", "Building image "+image)
	if err := d.Build(image, dir, func(line string) { log("info", line) }); err != nil {
		log("error", "Build failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}
	log("info", "Image built successfully")

	containerPort := d.ParseExpose(dir)
	hostPort, err := d.FreePort()
	if err != nil {
		log("error", "Failed to reserve a port: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}
	d.CleanupContainer(containerName)
	log("info", fmt.Sprintf("Starting container on 127.0.0.1:%d", hostPort))
	if _, err := d.Run(image, containerName, hostPort, containerPort, func(line string) { log("info", line) }); err != nil {
		log("error", "Container failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}

	duration := int64(time.Since(start).Seconds())
	url := fmt.Sprintf("http://127.0.0.1:%d", hostPort)
	db.DB.Exec("UPDATE deployments SET status = ?, port = ?, url = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusReady, hostPort, url, duration, deployID)
	db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		time.Now().UTC().Format(time.RFC3339), project.ID)
	log("success", "Deployment ready at "+url)
}

func finishDeployment(deployID, projectID int64, status string, port int, url string) {
	db.DB.Exec("UPDATE deployments SET status = ?, port = ?, url = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		status, port, url, deployID)
	switch status {
	case statusReady:
		db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
			time.Now().UTC().Format(time.RFC3339), projectID)
	case statusError:
		db.DB.Exec("UPDATE projects SET status = 'error', updated_date = CURRENT_TIMESTAMP WHERE id = ?", projectID)
	}
}

func githubToken(userID int64) (string, error) {
	var enc string
	err := db.DB.QueryRow(
		"SELECT access_token FROM integrations WHERE user_id = ? AND provider = 'github' ORDER BY id ASC LIMIT 1",
		userID,
	).Scan(&enc)
	if err != nil {
		return "", err
	}
	return auth.DecryptToken(enc)
}

// ---- helpers ----

func scanDeployment(r rowScanner) (models.Deployment, error) {
	var d models.Deployment
	err := r.Scan(&d.ID, &d.UserID, &d.ProjectID, &d.ProjectName, &d.Status, &d.CommitSHA,
		&d.CommitMessage, &d.Branch, &d.Author, &d.Trigger, &d.Framework, &d.Duration,
		&d.Port, &d.URL, &d.CreatedDate, &d.UpdatedDate)
	return d, err
}

const deploymentSelect = `SELECT id, user_id, project_id, project_name, status, commit_sha, commit_message,
	branch, author, trigger, framework, duration, port, url, created_date, updated_date FROM deployments`

func getDeployment(userID, id int64) (models.Deployment, error) {
	var d models.Deployment
	err := db.DB.QueryRow(deploymentSelect+" WHERE id = ? AND user_id = ?", id, userID).Scan(
		&d.ID, &d.UserID, &d.ProjectID, &d.ProjectName, &d.Status, &d.CommitSHA,
		&d.CommitMessage, &d.Branch, &d.Author, &d.Trigger, &d.Framework, &d.Duration,
		&d.Port, &d.URL, &d.CreatedDate, &d.UpdatedDate,
	)
	return d, err
}

func pathID(r *http.Request) (int64, bool) {
	idStr := r.PathValue("id")
	if idStr == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

func randomHex(n int) string {
	const chars = "0123456789abcdef"
	out := make([]byte, n)
	for i := range out {
		out[i] = chars[rand.Intn(len(chars))]
	}
	return string(out)
}

func valueToString(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		return boolToString(x)
	case float64:
		return strconv.FormatInt(int64(x), 10)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func toBool(v interface{}) bool {
	switch x := v.(type) {
	case bool:
		return x
	default:
		return false
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func boolToString(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
