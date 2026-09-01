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
	dockerfile_path, compose_path, port, last_deployed_at, created_date, updated_date FROM projects`

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

// reconcileProjectStatus corrects a project's status to its live container
// state so the UI badge never reads "running" for a container that is actually
// stopped or gone (e.g. Docker closed). Corrections that can be confirmed are
// written back to the DB; ambiguous ones (daemon down) only affect this read.
func reconcileProjectStatus(p *models.Project) {
	newStatus, persist := services.NewDeployer().ReconcileStatus(p.Slug, p.BuildStrategy, p.Status)
	if newStatus == p.Status {
		return
	}
	p.Status = newStatus
	if persist {
		db.DB.Exec("UPDATE projects SET status = ? WHERE id = ?", newStatus, p.ID)
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
			&p.InstanceType, &p.BuildStrategy, &p.DockerfilePath, &p.ComposePath,
			&p.Port,
			&p.LastDeployedAt, &p.CreatedDate, &p.UpdatedDate); err != nil {
			continue
		}
		projects = append(projects, p)
		reconcileProjectStatus(&projects[len(projects)-1])
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
		DockerfilePath string `json:"dockerfile_path"`
		ComposePath   string `json:"compose_path"`
		Port          *int   `json:"port"`
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
	switch req.BuildStrategy {
	case "detect", "dockerfile", "compose":
	default:
		respondError(w, http.StatusBadRequest, "build_strategy must be one of: detect, dockerfile, compose")
		return
	}
	if req.Status == "" {
		req.Status = "idle"
	}

	result, err := db.DB.Exec(
		`INSERT INTO projects (user_id, name, slug, status, framework, repository, branch, domain,
			description, auto_deploy, region, instance_type, build_strategy, dockerfile_path, compose_path, port)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		claims.UserID, req.Name, req.Slug, req.Status, req.Framework, req.Repository,
		req.Branch, req.Domain, req.Description, req.AutoDeploy, req.Region, req.InstanceType,
		req.BuildStrategy, req.DockerfilePath, req.ComposePath, req.Port,
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

// buildFileResponse is the shape returned by the build-file viewer.
type buildFileResponse struct {
	Path          string `json:"path"`
	Kind          string `json:"kind"` // "dockerfile" or "compose"
	BuildStrategy string `json:"build_strategy"`
	Branch        string `json:"branch"`
	Repository    string `json:"repository"`
	Content       string `json:"content"`
	Size          int    `json:"size"`
}

// ProjectBuildFileHandler returns the Dockerfile (or Docker Compose file)
// currently used to build a project, so the UI can show what the deploy
// actually runs. It reuses the same selection logic as the deployment worker:
// an explicit dockerfile_path / compose_path wins, otherwise the highest-ranked
// candidate from the repository's file tree is used.
func ProjectBuildFileHandler(w http.ResponseWriter, r *http.Request) {
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

	project, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}
	if project.Repository == "" {
		respondError(w, http.StatusBadRequest, "Project has no repository linked")
		return
	}

	token, err := githubToken(claims.UserID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "No GitHub integration available to read the repository")
		return
	}

	branch := project.Branch
	if branch == "" {
		branch = "main"
	}

	client := services.NewGitHubClient(token)
	files, _, err := client.GetRepoTree(project.Repository, branch)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Failed to read repository: "+err.Error())
		return
	}
	present := make(map[string]bool, len(files))
	for _, f := range files {
		present[f] = true
	}

	dockerfiles := services.RankDockerfiles(files)
	composeFiles := services.RankComposeFiles(files)

	// Mirror buildAndDeploy: pick the effective build file.
	useCompose := project.ComposePath != "" || project.BuildStrategy == "compose"
	if !useCompose && project.DockerfilePath == "" && project.BuildStrategy != "dockerfile" &&
		len(dockerfiles) == 0 && len(composeFiles) > 0 {
		useCompose = true
	}

	var resp buildFileResponse
	resp.Repository = project.Repository
	resp.Branch = branch
	resp.BuildStrategy = project.BuildStrategy

	if useCompose {
		resp.Kind = "compose"
		resp.Path = project.ComposePath
		if resp.Path == "" || !present[resp.Path] {
			if len(composeFiles) == 0 {
				respondError(w, http.StatusNotFound, "No Docker Compose file found in this branch")
				return
			}
			resp.Path = composeFiles[0]
		}
	} else {
		resp.Kind = "dockerfile"
		resp.Path = project.DockerfilePath
		if resp.Path == "" || !present[resp.Path] {
			if len(dockerfiles) == 0 {
				respondError(w, http.StatusNotFound, "No Dockerfile found in this branch")
				return
			}
			resp.Path = dockerfiles[0]
		}
	}

	raw, err := client.GetRepoFile(project.Repository, branch, resp.Path)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Failed to read "+resp.Path+": "+err.Error())
		return
	}
	resp.Content = string(raw)
	resp.Size = len(raw)

	respondJSON(w, http.StatusOK, resp)
}

// ProjectResourcesHandler returns live CPU/memory usage for a project's
// running container (via docker stats), or an empty "not running" snapshot.
func ProjectResourcesHandler(w http.ResponseWriter, r *http.Request) {
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
	project, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}
	stats, err := services.NewDeployer().Stats(project.Slug, project.BuildStrategy)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to read container stats")
		return
	}
	respondJSON(w, http.StatusOK, stats)
}

// ProjectResourcesStreamHandler pushes live container CPU/memory samples over
// SSE (one JSON frame per second) so the UI can render without refreshing.
// Auth is accepted via the Authorization header or a `token` query param.
func ProjectResourcesStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := authFromRequest(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	projectID, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	project, err := getProject(claims.UserID, projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	fl, ok := w.(http.Flusher)
	if !ok {
		respondError(w, http.StatusInternalServerError, "Streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	writeSSE(w, fl, map[string]interface{}{"connected": true})

	d := services.NewDeployer()
	ctx := r.Context()

	// Use a single long-running `docker stats` (streaming) process so Docker
	// pushes a fresh, per-interval CPU/memory sample every ~1s with no
	// per-second CLI spawn latency — true point-in-time usage. If the container
	// exits or is redeployed (new name), re-resolve and re-attach.
	for {
		name := services.ResolveContainer(project.Slug, project.BuildStrategy)
		if name == "" || d.ContainerState(name) != "running" {
			return // no live container — stream ends, client reconnects on redeploy
		}
		if err := d.StreamStats(ctx, name, func(stats services.ContainerStats) {
			writeSSE(w, fl, stats)
		}); err != nil && ctx.Err() != nil {
			return // request cancelled / client disconnected
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func getProject(userID, id int64) (models.Project, error) {
	var p models.Project
	err := db.DB.QueryRow(projectSelect+" WHERE id = ? AND user_id = ?", id, userID).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Slug, &p.Status, &p.Framework,
		&p.Repository, &p.Branch, &p.Domain, &p.Description, &p.AutoDeploy, &p.Region,
		&p.InstanceType, &p.BuildStrategy, &p.DockerfilePath, &p.ComposePath,
		&p.Port,
		&p.LastDeployedAt, &p.CreatedDate, &p.UpdatedDate,
	)
	reconcileProjectStatus(&p)
	return p, err
}

var updatableProjectColumns = map[string]bool{
	"status": true, "framework": true, "repository": true, "branch": true,
	"domain": true, "description": true, "auto_deploy": true, "region": true,
	"instance_type": true, "build_strategy": true, "name": true, "slug": true,
	"dockerfile_path": true, "compose_path": true,
	"last_deployed_at": true, "port": true,
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
		} else if col == "port" {
			args = append(args, intOrNil(val))
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

// ProjectActionHandler performs a Docker lifecycle action (start / stop /
// restart) on the project's running container and syncs the DB status.
func ProjectActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
	project, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req.Action = strings.TrimSpace(req.Action)

	container := services.ResolveContainer(project.Slug, project.BuildStrategy)
	if container == "" {
		respondError(w, http.StatusBadRequest, "No container found for this project — deploy first")
		return
	}

	d := &services.Deployer{}
	switch req.Action {
	case "start":
		if err := d.StartContainer(container); err != nil {
			respondError(w, http.StatusInternalServerError, "Docker start failed: "+err.Error())
			return
		}
		setProjectStatus(project.ID, "running")
	case "stop":
		if err := d.StopContainer(container); err != nil {
			respondError(w, http.StatusInternalServerError, "Docker stop failed: "+err.Error())
			return
		}
		setProjectStatus(project.ID, "stopped")
	case "restart":
		// Restart can take a few seconds (stop + start). Run it in the background
		// and report progress via the project status (restarting → running).
		setProjectStatus(project.ID, "restarting")
		go func() {
			status := "running"
			if err := d.RestartContainer(container); err != nil {
				status = "error"
			}
			setProjectStatus(project.ID, status)
		}()
	default:
		respondError(w, http.StatusBadRequest, "action must be one of: start, stop, restart")
		return
	}

	updated, err := getProject(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to load project")
		return
	}
	respondJSON(w, http.StatusOK, updated)
}

func setProjectStatus(projectID int64, status string) {
	db.DB.Exec("UPDATE projects SET status = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?", status, projectID)
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

// ---- deployment worker (Docker: Dockerfile or Docker Compose) ----

const composeSearchHint = "docker-compose.yml, docker-compose.yaml, compose.yml or compose.yaml"

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

	if sha := d.GitHead(dir); sha != "" {
		db.DB.Exec("UPDATE deployments SET commit_sha = ? WHERE id = ?", sha, deployID)
	}

	// Load the project's env vars and write a temp .env to inject at runtime.
	envVars, envErr := services.LoadEnvVars(project.ID)
	if envErr != nil {
		log("warn", "Failed to load environment variables: "+envErr.Error())
		envVars = nil
	}
	envPath, envErr := services.WriteEnvFile(envVars)
	if envErr != nil {
		log("warn", "Failed to write env file: "+envErr.Error())
		envPath = ""
	}
	if envPath != "" {
		defer os.Remove(envPath)
	}

	dockerfiles := d.FindDockerfiles(dir)
	composeFiles := d.FindComposeFiles(dir)

	useCompose := project.ComposePath != "" || project.BuildStrategy == "compose"
	if !useCompose && project.DockerfilePath == "" && project.BuildStrategy != "dockerfile" && len(dockerfiles) == 0 && len(composeFiles) > 0 {
		// auto mode: fall back to compose when the repo only has one
		log("info", "No Dockerfile found — a Docker Compose file is available, using it")
		useCompose = true
	}

	if useCompose {
		composeDeploy(log, d, deployID, project, dir, composeFiles, envPath, start)
		return
	}
	dockerfileDeploy(log, d, deployID, project, dir, dockerfiles, composeFiles, envPath, start)
}

func dockerfileDeploy(log func(string, string), d *services.Deployer, deployID int64, project models.Project, dir string, dockerfiles, composeFiles []string, envPath string, start time.Time) {
	dockerfile := project.DockerfilePath
	if dockerfile != "" && !d.RepoFileExists(dir, dockerfile) {
		log("warn", fmt.Sprintf("Dockerfile %q from the project settings was not found in this branch — searching the repository", dockerfile))
		dockerfile = ""
	}
	if dockerfile == "" {
		if len(dockerfiles) == 0 {
			log("error", noBuildFileMessage(len(composeFiles), composeFiles))
			finishDeployment(deployID, project.ID, statusError, 0, "")
			return
		}
		dockerfile = dockerfiles[0]
	}
	log("info", "Using Dockerfile at "+dockerfile)

	buildRef := randomHex(8)
	image := fmt.Sprintf("nineteen-%s:%s", project.Slug, buildRef)
	containerName := fmt.Sprintf("nineteen-%s", project.Slug)
	log("info", "Building image "+image)
	if err := d.Build(image, dir, dockerfile, func(line string) { log("info", line) }); err != nil {
		log("error", "Build failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}
	log("info", "Image built successfully")

	containerPort := d.ParseExpose(dir, dockerfile)
	if containerPort == 0 {
		containerPort = d.ImagePort(image)
		if containerPort > 0 {
			log("info", fmt.Sprintf("No EXPOSE in the Dockerfile — image exposes port %d", containerPort))
		}
	}
	if containerPort == 0 {
		containerPort = 3000
		log("warn", "No EXPOSE found in the Dockerfile or the image — assuming port 3000. Add EXPOSE <port> to your Dockerfile if this is wrong.")
	}

	hostPort := 0
	if project.Port != nil && *project.Port > 0 {
		hostPort = *project.Port
		log("info", fmt.Sprintf("Using configured port %d", hostPort))
	} else {
		hp, err := d.FreePort()
		if err != nil {
			log("error", "Failed to reserve a port: "+err.Error())
			finishDeployment(deployID, project.ID, statusError, 0, "")
			return
		}
		hostPort = hp
	}
	d.CleanupContainer(containerName)
	d.CleanupCompose(composeProjectName(project.Slug), func(line string) { log("info", line) })
	log("info", fmt.Sprintf("Starting container on 127.0.0.1:%d", hostPort))
	if _, err := d.Run(image, containerName, hostPort, containerPort, envPath, func(line string) { log("info", line) }); err != nil {
		log("error", "Container failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}

	duration := int64(time.Since(start).Seconds())
	url := fmt.Sprintf("http://localhost:%d", hostPort)
	db.DB.Exec("UPDATE deployments SET status = ?, port = ?, url = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusReady, hostPort, url, duration, deployID)
	db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		time.Now().UTC().Format(time.RFC3339), project.ID)
	log("success", "Deployment ready at "+url)
	services.EnsureTailed(project.ID, deployID, containerName)
}

func composeDeploy(log func(string, string), d *services.Deployer, deployID int64, project models.Project, dir string, composeFiles []string, envPath string, start time.Time) {
	composeFile := project.ComposePath
	if composeFile != "" && !d.RepoFileExists(dir, composeFile) {
		log("warn", fmt.Sprintf("Compose file %q from the project settings was not found in this branch — searching the repository", composeFile))
		composeFile = ""
	}
	if composeFile == "" {
		if len(composeFiles) == 0 {
			log("error", "No Docker Compose file found in the repository (looked for "+composeSearchHint+" in every folder). Add one, or switch the project to a Dockerfile build.")
			finishDeployment(deployID, project.ID, statusError, 0, "")
			return
		}
		composeFile = composeFiles[0]
	}
	log("info", "Using Docker Compose file at "+composeFile)

	// Inject env vars into every service via a generated override.
	overridePath := ""
	if envPath != "" {
		if names := services.ComposeServiceNames(filepath.Join(dir, composeFile)); len(names) > 0 {
			if p, err := services.WriteComposeEnvOverride(names, envPath); err == nil {
				overridePath = p
				defer os.Remove(overridePath)
			} else {
				log("warn", "Failed to generate compose env override: "+err.Error())
			}
		} else {
			log("warn", "Could not list compose services — environment variables not injected")
		}
	}

	name := composeProjectName(project.Slug)
	d.CleanupContainer(fmt.Sprintf("nineteen-%s", project.Slug))
	d.CleanupCompose(name, func(line string) { log("info", line) })

	if err := d.ComposeUp(dir, composeFile, overridePath, name, func(line string) { log("info", line) }); err != nil {
		log("error", "docker compose failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return
	}
	log("info", "Compose stack started")

	ports := d.ComposePorts(name)
	if len(ports) == 0 {
		duration := int64(time.Since(start).Seconds())
		db.DB.Exec("UPDATE deployments SET status = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
			statusReady, duration, deployID)
		db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
			time.Now().UTC().Format(time.RFC3339), project.ID)
		log("warn", "The compose stack is running but publishes no ports — there is no URL to open. Add a ports: mapping to your compose file.")
		return
	}

	picked, _ := services.PickAppPort(ports)
	for _, p := range ports {
		if p.Port == picked.Port && p.Service == picked.Service {
			log("info", fmt.Sprintf("Published port %d (service %q, image %s)", p.Port, p.Service, p.Image))
		}
	}

	duration := int64(time.Since(start).Seconds())
	url := fmt.Sprintf("http://localhost:%d", picked.Port)
	db.DB.Exec("UPDATE deployments SET status = ?, port = ?, url = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusReady, picked.Port, url, duration, deployID)
	db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		time.Now().UTC().Format(time.RFC3339), project.ID)
	log("success", "Deployment ready at "+url)
	if cname := services.ResolveContainer(project.Slug, project.BuildStrategy); cname != "" {
		services.EnsureTailed(project.ID, deployID, cname)
	}
}

func composeProjectName(slug string) string {
	name := "nineteen-" + slug
	if len(name) > 60 {
		name = name[:60]
	}
	return name
}

func noBuildFileMessage(composeCount int, composeFiles []string) string {
	msg := "No Dockerfile found in the repository (searched every folder, skipping node_modules/.git). "
	if composeCount > 0 {
		msg += "This repo has a Docker Compose file (" + strings.Join(composeFiles, ", ") + ") — switch the project's build to Docker Compose to use it."
	} else {
		msg += "Add a Dockerfile (or a " + composeSearchHint + "), then deploy again."
	}
	return msg
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

// intOrNil returns a *int for a JSON port value, or nil when the value is
// empty / null (meaning "auto-assign a port at deploy time").
func intOrNil(v interface{}) interface{} {
	switch x := v.(type) {
	case nil:
		return nil
	case float64:
		if x <= 0 {
			return nil
		}
		return int(x)
	case string:
		if strings.TrimSpace(x) == "" {
			return nil
		}
		if n, err := strconv.Atoi(strings.TrimSpace(x)); err == nil && n > 0 {
			return n
		}
		return nil
	default:
		return nil
	}
}
