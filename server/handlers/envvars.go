package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

// ProjectEnvVarsHandler lists and creates env vars for a project.
func ProjectEnvVarsHandler(w http.ResponseWriter, r *http.Request) {
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

	switch r.Method {
	case http.MethodGet:
		listEnvVars(w, projectID)
	case http.MethodPost:
		createEnvVar(w, r, claims.UserID, projectID)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ProjectEnvVarHandler updates or deletes a single env var.
func ProjectEnvVarHandler(w http.ResponseWriter, r *http.Request) {
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
	varID, ok := envVarID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid env var ID")
		return
	}
	if _, err := getProject(claims.UserID, projectID); err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	switch r.Method {
	case http.MethodPut:
		updateEnvVar(w, r, claims.UserID, projectID, varID)
	case http.MethodDelete:
		deleteEnvVar(w, claims.UserID, projectID, varID)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func listEnvVars(w http.ResponseWriter, projectID int64) {
	rows, err := db.DB.Query(
		"SELECT id, project_id, key, value_encrypted, is_secret, created_at, updated_at FROM env_vars WHERE project_id = ? ORDER BY key ASC",
		projectID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	vars := []models.EnvVar{}
	for rows.Next() {
		var v models.EnvVar
		var isSecret int
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.Key, &v.Encrypted, &isSecret, &v.CreatedAt, &v.UpdatedAt); err != nil {
			continue
		}
		v.IsSecret = isSecret != 0
		v.HasValue = v.Encrypted != ""
		if !v.IsSecret {
			if plain, e := auth.DecryptToken(v.Encrypted); e == nil {
				v.Value = plain
			}
		}
		vars = append(vars, v)
	}
	respondJSON(w, http.StatusOK, vars)
}

func createEnvVar(w http.ResponseWriter, r *http.Request, userID, projectID int64) {
	req, ok := decodeEnvVar(w, r)
	if !ok {
		return
	}
	enc, err := auth.EncryptToken(req.Value)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to encrypt value")
		return
	}
	_, err = db.DB.Exec(
		`INSERT INTO env_vars (user_id, project_id, key, value_encrypted, is_secret)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(project_id, key) DO UPDATE SET
			value_encrypted = excluded.value_encrypted,
			is_secret = excluded.is_secret,
			updated_at = CURRENT_TIMESTAMP`,
		userID, projectID, req.Key, enc, boolToInt(req.IsSecret),
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save variable")
		return
	}
	listEnvVars(w, projectID)
}

func updateEnvVar(w http.ResponseWriter, r *http.Request, userID, projectID, varID int64) {
	req, ok := decodeEnvVar(w, r)
	if !ok {
		return
	}

	// Write-only secrets: keeping an empty value preserves the existing one.
	valueEncrypted := ""
	if req.Value != "" {
		enc, err := auth.EncryptToken(req.Value)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to encrypt value")
			return
		}
		valueEncrypted = enc
	} else {
		err := db.DB.QueryRow(
			"SELECT value_encrypted FROM env_vars WHERE id = ? AND project_id = ? AND user_id = ?",
			varID, projectID, userID,
		).Scan(&valueEncrypted)
		if err != nil {
			respondError(w, http.StatusNotFound, "Environment variable not found")
			return
		}
	}

	_, err := db.DB.Exec(
		"UPDATE env_vars SET key = ?, value_encrypted = ?, is_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND user_id = ?",
		req.Key, valueEncrypted, boolToInt(req.IsSecret), varID, projectID, userID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update variable")
		return
	}
	listEnvVars(w, projectID)
}

func deleteEnvVar(w http.ResponseWriter, userID, projectID, varID int64) {
	_, err := db.DB.Exec(
		"DELETE FROM env_vars WHERE id = ? AND project_id = ? AND user_id = ?",
		varID, projectID, userID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete variable")
		return
	}
	listEnvVars(w, projectID)
}

func decodeEnvVar(w http.ResponseWriter, r *http.Request) (struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	IsSecret bool   `json:"is_secret"`
}, bool) {
	var req struct {
		Key      string `json:"key"`
		Value    string `json:"value"`
		IsSecret bool   `json:"is_secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return req, false
	}
	req.Key = strings.TrimSpace(req.Key)
	if !services.ValidateEnvKey(req.Key) {
		respondError(w, http.StatusBadRequest, "Invalid key — use A-Z, 0-9 and underscores, starting with a letter or underscore")
		return req, false
	}
	return req, true
}

func envVarID(r *http.Request) (int64, bool) {
	idStr := r.PathValue("varId")
	if idStr == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(idStr, 10, 64)
	return n, err == nil && n > 0
}
