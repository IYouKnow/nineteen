package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

// runtimeLogSelect matches the columns inserted by the tailer.
const runtimeLogSelect = `SELECT id, project_id, deployment_id, container, level, message, timestamp FROM runtime_logs`

// ProjectRuntimeLogsHandler returns persisted runtime logs (all-time). Optional
// `after` (row id) and `limit` query params support incremental / bounded reads.
func ProjectRuntimeLogsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	projectID, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	if _, err := getProject(claims.UserID, projectID); err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	var after int64
	if a := r.URL.Query().Get("after"); a != "" {
		after, _ = strconv.ParseInt(a, 10, 64)
	}
	limit := 1000
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 5000 {
			limit = n
		}
	}

	query := runtimeLogSelect + " WHERE project_id = ?"
	args := []interface{}{projectID}
	if after > 0 {
		query += " AND id > ?"
		args = append(args, after)
	}
	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	logs := []models.RuntimeLog{}
	for rows.Next() {
		var l models.RuntimeLog
		var ts string
		if err := rows.Scan(&l.ID, &l.ProjectID, &l.DeploymentID, &l.Container, &l.Level, &l.Message, &ts); err != nil {
			continue
		}
		if t, err := time.Parse("2006-01-02 15:04:05", ts); err == nil {
			l.Timestamp = t
		} else {
			l.Timestamp = time.Now()
		}
		logs = append(logs, l)
	}

	// Reverse to ascending so the UI can append/stream naturally.
	for i, j := 0, len(logs)-1; i < j; i, j = i+1, j-1 {
		logs[i], logs[j] = logs[j], logs[i]
	}

	respondJSON(w, http.StatusOK, logs)
}

// ProjectRuntimeLogsStreamHandler streams live container output over SSE. Auth
// is accepted via the Authorization header or a `token` query param (EventSource
// cannot set headers).
func ProjectRuntimeLogsStreamHandler(w http.ResponseWriter, r *http.Request) {
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

	container := services.ResolveContainer(project.Slug, project.BuildStrategy)
	if container == "" {
		respondError(w, http.StatusBadRequest, "No running container for this project")
		return
	}

	var depID int64
	_ = db.DB.QueryRow("SELECT id FROM deployments WHERE project_id = ? ORDER BY id DESC LIMIT 1", projectID).Scan(&depID)

	services.EnsureTailed(projectID, depID, container)
	ch, unsub := services.SubscribeStream(projectID)
	defer unsub()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	writeSSE(w, fl, map[string]interface{}{"connected": true, "container": container})

	ctx := r.Context()
	beat := time.NewTicker(15 * time.Second)
	defer beat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-ch:
			writeSSE(w, fl, ev)
		case <-beat.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		}
	}
}

func writeSSE(w http.ResponseWriter, fl http.Flusher, data interface{}) {
	b, _ := json.Marshal(data)
	fmt.Fprintf(w, "data: %s\n\n", b)
	fl.Flush()
}

func authFromRequest(r *http.Request) (*Claims, error) {
	if claims, err := extractUser(r); err == nil {
		return claims, nil
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		return nil, fmt.Errorf("missing credentials")
	}
	return auth.ValidateToken(token)
}
