package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/services"
)

func SettingsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getSettingsHandler(w, r)
	case http.MethodPut:
		updateSettingsHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func getSettingsHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	rows, err := db.DB.Query("SELECT id, user_id, key, value, created_at, updated_at FROM settings WHERE user_id = ?", claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var id, userID int64
		var key, value string
		var createdAt, updatedAt string
		if err := rows.Scan(&id, &userID, &key, &value, &createdAt, &updatedAt); err != nil {
			continue
		}
		settings[key] = value
	}

	respondJSON(w, http.StatusOK, settings)
}

func updateSettingsHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var settings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	tx, err := db.DB.Begin()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	stmt, err := tx.Prepare(`INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
		ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
	if err != nil {
		tx.Rollback()
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer stmt.Close()

	for key, value := range settings {
		if _, err := stmt.Exec(claims.UserID, key, value); err != nil {
			tx.Rollback()
			respondError(w, http.StatusInternalServerError, "Failed to save settings")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save settings")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Settings updated"})
}

func ApiKeysHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listApiKeysHandler(w, r)
	case http.MethodPost:
		createApiKeyHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func listApiKeysHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	rows, err := db.DB.Query("SELECT id, user_id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	type apiKeyResponse struct {
		ID         int64   `json:"id"`
		Name       string  `json:"name"`
		Prefix     string  `json:"prefix"`
		CreatedAt  string  `json:"created_at"`
		LastUsedAt *string `json:"last_used_at"`
	}

	var keys []apiKeyResponse
	for rows.Next() {
		var k apiKeyResponse
		var uid int64
		var createdAt string
		var lastUsedAt *string
		if err := rows.Scan(&k.ID, &uid, &k.Name, &k.Prefix, &createdAt, &lastUsedAt); err != nil {
			continue
		}
		k.CreatedAt = createdAt
		k.LastUsedAt = lastUsedAt
		keys = append(keys, k)
	}

	if keys == nil {
		keys = []apiKeyResponse{}
	}

	respondJSON(w, http.StatusOK, keys)
}

type CreateApiKeyRequest struct {
	Name string `json:"name"`
}

func createApiKeyHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req CreateApiKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "name is required")
		return
	}

	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate key")
		return
	}

	rawKey := hex.EncodeToString(bytes)
	prefix := rawKey[:8]
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])

	result, err := db.DB.Exec(
		"INSERT INTO api_keys (user_id, name, key_hash, prefix) VALUES (?, ?, ?, ?)",
		claims.UserID, req.Name, keyHash, prefix,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create API key")
		return
	}

	id, _ := result.LastInsertId()

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"id":      id,
		"name":    req.Name,
		"prefix":  prefix,
		"key":     rawKey,
		"message": "Save this key securely. It won't be shown again.",
	})
}

func ApiKeyDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		respondError(w, http.StatusBadRequest, "Invalid API key ID")
		return
	}

	idStr := parts[len(parts)-1]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid API key ID")
		return
	}

	result, err := db.DB.Exec("DELETE FROM api_keys WHERE id = ? AND user_id = ?", id, claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete API key")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		respondError(w, http.StatusNotFound, "API key not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "API key deleted"})
}

func IntegrationsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listIntegrationsHandler(w, r)
	case http.MethodPost:
		connectIntegrationHandler(w, r)
	case http.MethodPut:
		updateIntegrationHandler(w, r)
	case http.MethodDelete:
		disconnectIntegrationHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func listIntegrationsHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	rows, err := db.DB.Query("SELECT id, provider, label, username, avatar_url, config, metadata, created_at, updated_at FROM integrations WHERE user_id = ?", claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	type integrationResponse struct {
		ID        int64  `json:"id"`
		Provider  string `json:"provider"`
		Label     string `json:"label"`
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
		Config    string `json:"config"`
		Metadata  string `json:"metadata"`
		Connected bool   `json:"connected"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
		RepoCount int    `json:"repo_count"`
	}

	var integrations []integrationResponse
	for rows.Next() {
		var ig integrationResponse
		var createdAt, updatedAt string
		if err := rows.Scan(&ig.ID, &ig.Provider, &ig.Label, &ig.Username, &ig.AvatarURL, &ig.Config, &ig.Metadata, &createdAt, &updatedAt); err != nil {
			continue
		}
		ig.Connected = true
		ig.CreatedAt = createdAt
		ig.UpdatedAt = updatedAt
		if ig.Metadata != "" {
			var meta struct {
				RepoCount int `json:"repo_count"`
			}
			if err := json.Unmarshal([]byte(ig.Metadata), &meta); err == nil {
				ig.RepoCount = meta.RepoCount
			}
		}
		integrations = append(integrations, ig)
	}

	if integrations == nil {
		integrations = []integrationResponse{}
	}

	respondJSON(w, http.StatusOK, integrations)
}

type ConnectIntegrationRequest struct {
	Provider    string `json:"provider"`
	AccessToken string `json:"access_token"`
	Label       string `json:"label"`
	Config      string `json:"config"`
}

func connectIntegrationHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req ConnectIntegrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Provider = strings.TrimSpace(req.Provider)
	if req.Provider == "" {
		respondError(w, http.StatusBadRequest, "provider is required")
		return
	}

	req.AccessToken = strings.TrimSpace(req.AccessToken)
	if req.AccessToken == "" {
		respondError(w, http.StatusBadRequest, "access_token is required")
		return
	}

	if req.Config == "" {
		req.Config = "{}"
	}

	if req.Label == "" {
		req.Label = req.Provider
	}

	var username, avatarURL string
	repoCount := 0

	switch req.Provider {
	case "github":
		ghClient := services.NewGitHubClient(req.AccessToken)
		user, err := ghClient.ValidateToken()
		if err != nil {
			respondError(w, http.StatusBadRequest, "Invalid GitHub token: "+err.Error())
			return
		}
		username = user.Login
		avatarURL = user.AvatarURL
		if count, err := ghClient.CountRepositories(); err == nil {
			repoCount = count
		}
	default:
		respondError(w, http.StatusBadRequest, "Unsupported provider")
		return
	}

	metadata := fmt.Sprintf(`{"repo_count": %d}`, repoCount)

	encryptedToken, err := auth.EncryptToken(req.AccessToken)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to encrypt token")
		return
	}

	_, err = db.DB.Exec(
		`INSERT INTO integrations (user_id, provider, label, username, avatar_url, access_token, config, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		claims.UserID, req.Provider, req.Label, username, avatarURL, encryptedToken, req.Config, metadata,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save integration")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":    fmt.Sprintf("%s connected", req.Provider),
		"username":   username,
		"avatar":     avatarURL,
		"repo_count": repoCount,
	})
}

func disconnectIntegrationHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	provider := r.URL.Query().Get("provider")
	if provider == "" {
		respondError(w, http.StatusBadRequest, "provider query param is required")
		return
	}

	result, err := db.DB.Exec("DELETE FROM integrations WHERE user_id = ? AND provider = ?", claims.UserID, provider)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to disconnect integration")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		respondError(w, http.StatusNotFound, "Integration not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": fmt.Sprintf("%s disconnected", provider)})
}

type UpdateIntegrationRequest struct {
	Label string `json:"label"`
}

func updateIntegrationHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		respondError(w, http.StatusBadRequest, "Invalid integration ID")
		return
	}

	idStr := parts[len(parts)-1]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid integration ID")
		return
	}

	var req UpdateIntegrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Label = strings.TrimSpace(req.Label)
	if req.Label == "" {
		respondError(w, http.StatusBadRequest, "label is required")
		return
	}

	result, err := db.DB.Exec(
		"UPDATE integrations SET label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
		req.Label, id, claims.UserID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update integration")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		respondError(w, http.StatusNotFound, "Integration not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Integration updated"})
}

type RepoResponse struct {
	FullName    string `json:"full_name"`
	Description string `json:"description"`
	Framework   string `json:"framework"`
	Branch      string `json:"branch"`
	Stars       int64  `json:"stars"`
	Private     bool   `json:"private"`
}

// detectFramework maps a GitHub repo language (or known name hints) to one of
// the platform's runtime framework ids.
func detectFramework(language, name string) string {
	ln := strings.ToLower(name)
	switch strings.ToLower(language) {
	case "typescript", "javascript":
		switch {
		case strings.Contains(ln, "next"):
			return "nextjs"
		case strings.Contains(ln, "astro"):
			return "astro"
		case strings.Contains(ln, "remix"):
			return "remix"
		case strings.Contains(ln, "vite"):
			return "vite"
		default:
			return "node"
		}
	case "python":
		return "python"
	case "go":
		return "docker"
	case "dockerfile":
		return "docker"
	default:
		return "node"
	}
}

// IntegrationReposHandler lists the GitHub repositories accessible to a stored
// integration (identified by its id) using its decrypted access token.
func IntegrationReposHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		respondError(w, http.StatusBadRequest, "id query param is required")
		return
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid integration ID")
		return
	}

	page, perPage := 1, 30
	if p := r.URL.Query().Get("page"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			page = n
		}
	}
	if pp := r.URL.Query().Get("per_page"); pp != "" {
		if n, err := strconv.Atoi(pp); err == nil && n > 0 {
			perPage = n
		}
	}

	var provider, encryptedToken string
	err = db.DB.QueryRow(
		"SELECT provider, access_token FROM integrations WHERE id = ? AND user_id = ?",
		id, claims.UserID,
	).Scan(&provider, &encryptedToken)
	if err != nil {
		respondError(w, http.StatusNotFound, "Integration not found")
		return
	}
	if provider != "github" {
		respondError(w, http.StatusBadRequest, "Provider does not support repository listing")
		return
	}

	token, err := auth.DecryptToken(encryptedToken)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to decrypt integration token")
		return
	}

	ghClient := services.NewGitHubClient(token)
	repos, err := ghClient.ListRepositories(page, perPage)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Failed to fetch repositories: "+err.Error())
		return
	}

	list := make([]RepoResponse, 0, len(repos))
	for _, rp := range repos {
		branch := rp.DefaultBranch
		if branch == "" {
			branch = "main"
		}
		list = append(list, RepoResponse{
			FullName:    rp.FullName,
			Description: rp.Description,
			Framework:   detectFramework(rp.Language, rp.Name),
			Branch:      branch,
			Stars:       rp.StargazersCount,
			Private:     rp.Private,
		})
	}

	respondJSON(w, http.StatusOK, list)
}

type ScanResponse struct {
	Repository   string   `json:"repository"`
	Branch       string   `json:"branch"`
	Files        []string `json:"files"`
	Truncated    bool     `json:"truncated"`
	Dockerfiles  []string `json:"dockerfiles"`
	ComposeFiles []string `json:"compose_files"`
	Port         int      `json:"port"`
}

var repoNameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

const scanFileLimit = 2000

// IntegrationScanHandler scans a repository's file tree (via the GitHub API)
// and returns the full file list plus ranked Dockerfile / Compose candidates,
// so the project wizard can let the user pick the build file. Private repos
// require a stored GitHub integration; public repos work without one.
func IntegrationScanHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	repo := strings.TrimSpace(r.URL.Query().Get("repo"))
	branch := strings.TrimSpace(r.URL.Query().Get("branch"))
	if repo == "" || !repoNameRe.MatchString(repo) {
		respondError(w, http.StatusBadRequest, "repo query param must be owner/name")
		return
	}

	// Use the user's GitHub integration token when available (private repos);
	// fall back to an anonymous call for public repos.
	token := ""
	var enc string
	if err := db.DB.QueryRow(
		"SELECT access_token FROM integrations WHERE user_id = ? AND provider = 'github' ORDER BY id ASC LIMIT 1",
		claims.UserID,
	).Scan(&enc); err == nil {
		if t, err := auth.DecryptToken(enc); err == nil {
			token = t
		}
	}

	client := services.NewGitHubClient(token)
	files, truncated, err := client.GetRepoTree(repo, branch)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Failed to scan repository: "+err.Error())
		return
	}

	dockerfiles := services.RankDockerfiles(files)
	composeFiles := services.RankComposeFiles(files)

	// Detect a fixed port from the best-ranked Dockerfile so the wizard can
	// pre-fill it for apps that only work on a specific port.
	port := 0
	if len(dockerfiles) > 0 {
		if data, err := client.GetRepoFile(repo, branch, dockerfiles[0]); err == nil {
			port = services.ParseExposeContent(data)
		}
	}

	if len(files) > scanFileLimit {
		files = files[:scanFileLimit]
	}
	if files == nil {
		files = []string{}
	}

	respondJSON(w, http.StatusOK, ScanResponse{
		Repository:   repo,
		Branch:       branch,
		Files:        files,
		Truncated:    truncated,
		Dockerfiles:  dockerfiles,
		ComposeFiles: composeFiles,
		Port:         port,
	})
}

// IntegrationPortHandler fetches a single repository file (typically a
// Dockerfile) and returns the EXPOSE port it declares, so the project wizard
// can pre-fill a fixed port for apps that require one.
func IntegrationPortHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	repo := strings.TrimSpace(r.URL.Query().Get("repo"))
	branch := strings.TrimSpace(r.URL.Query().Get("branch"))
	file := strings.TrimSpace(r.URL.Query().Get("file"))
	if repo == "" || !repoNameRe.MatchString(repo) || file == "" {
		respondError(w, http.StatusBadRequest, "repo and file query params are required")
		return
	}

	// Use the user's GitHub integration token when available (private repos);
	// fall back to an anonymous call for public repos.
	token := ""
	var enc string
	if err := db.DB.QueryRow(
		"SELECT access_token FROM integrations WHERE user_id = ? AND provider = 'github' ORDER BY id ASC LIMIT 1",
		claims.UserID,
	).Scan(&enc); err == nil {
		if t, err := auth.DecryptToken(enc); err == nil {
			token = t
		}
	}

	client := services.NewGitHubClient(token)
	data, err := client.GetRepoFile(repo, branch, file)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Failed to fetch file: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]int{"port": services.ParseExposeContent(data)})
}

type TestIntegrationRequest struct {
	Provider    string `json:"provider"`
	AccessToken string `json:"access_token"`
}

func TestIntegrationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req TestIntegrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Provider = strings.TrimSpace(req.Provider)
	req.AccessToken = strings.TrimSpace(req.AccessToken)

	if req.Provider == "" || req.AccessToken == "" {
		respondError(w, http.StatusBadRequest, "provider and access_token are required")
		return
	}

	switch req.Provider {
	case "github":
		ghClient := services.NewGitHubClient(req.AccessToken)
		user, err := ghClient.ValidateToken()
		if err != nil {
			respondError(w, http.StatusBadRequest, "Invalid token: "+err.Error())
			return
		}
		repoCount := 0
		if count, err := ghClient.CountRepositories(); err == nil {
			repoCount = count
		}
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"valid":      true,
			"username":   user.Login,
			"avatar":     user.AvatarURL,
			"name":       user.Name,
			"type":       user.Type,
			"repo_count": repoCount,
		})
	default:
		respondError(w, http.StatusBadRequest, "Unsupported provider")
	}
}

func UpdateIntegrationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		respondError(w, http.StatusBadRequest, "Invalid integration ID")
		return
	}

	idStr := parts[len(parts)-1]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid integration ID")
		return
	}

	var req UpdateIntegrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Label = strings.TrimSpace(req.Label)
	if req.Label == "" {
		respondError(w, http.StatusBadRequest, "label is required")
		return
	}

	result, err := db.DB.Exec(
		"UPDATE integrations SET label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
		req.Label, id, claims.UserID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update integration")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		respondError(w, http.StatusNotFound, "Integration not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Integration updated"})
}
