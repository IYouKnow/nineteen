package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type GitHubUser struct {
	Login     string `json:"login"`
	ID        int64  `json:"id"`
	AvatarURL string `json:"avatar_url"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Type      string `json:"type"`
}

type GitHubRepo struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	FullName       string `json:"full_name"`
	Private        bool   `json:"private"`
	HTMLURL        string `json:"html_url"`
	CloneURL       string `json:"clone_url"`
	Language       string `json:"language"`
	Description    string `json:"description"`
	DefaultBranch  string `json:"default_branch"`
	StargazersCount int64 `json:"stargazers_count"`
	Fork           bool   `json:"fork"`
	Owner          struct {
		Login string `json:"login"`
	} `json:"owner"`
	UpdatedAt string `json:"updated_at"`
}

type GitHubClient struct {
	Token  string
	Client *http.Client
}

func NewGitHubClient(token string) *GitHubClient {
	return &GitHubClient{
		Token: token,
		Client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (g *GitHubClient) doRequest(url string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	if g.Token != "" {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return body, nil
}

func (g *GitHubClient) GetCurrentUser() (*GitHubUser, error) {
	body, err := g.doRequest("https://api.github.com/user")
	if err != nil {
		return nil, err
	}

	var user GitHubUser
	if err := json.Unmarshal(body, &user); err != nil {
		return nil, err
	}

	return &user, nil
}

func (g *GitHubClient) ListRepositories(page, perPage int) ([]GitHubRepo, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 30
	}

	url := fmt.Sprintf("https://api.github.com/user/repos?page=%d&per_page=%d&sort=updated&direction=desc", page, perPage)
	body, err := g.doRequest(url)
	if err != nil {
		return nil, err
	}

	var repos []GitHubRepo
	if err := json.Unmarshal(body, &repos); err != nil {
		return nil, err
	}

	return repos, nil
}

// GetRepoTree returns every file path in a repository at the given ref
// (branch name, tag or "HEAD"). The boolean reports whether GitHub truncated
// the listing for very large repositories.
func (g *GitHubClient) GetRepoTree(fullName, ref string) ([]string, bool, error) {
	if ref == "" {
		ref = "HEAD"
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s/git/trees/%s?recursive=1", fullName, url.PathEscape(strings.TrimSpace(ref)))
	body, err := g.doRequest(url)
	if err != nil {
		return nil, false, err
	}

	var tree struct {
		Truncated bool `json:"truncated"`
		Tree      []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
	}
	if err := json.Unmarshal(body, &tree); err != nil {
		return nil, false, err
	}

	files := make([]string, 0, len(tree.Tree))
	for _, e := range tree.Tree {
		if e.Type == "blob" && e.Path != "" {
			files = append(files, e.Path)
		}
	}
	return files, tree.Truncated, nil
}

// GetRepoFile fetches a single file's decoded content at a given ref (branch,
// tag or "HEAD") using the GitHub Contents API. Works for private repositories
// when g.Token is set; returns the decoded bytes.
func (g *GitHubClient) GetRepoFile(fullName, ref, path string) ([]byte, error) {
	if ref == "" {
		ref = "HEAD"
	}
	fullName = strings.TrimSpace(fullName)
	path = strings.TrimSpace(path)
	if fullName == "" || path == "" {
		return nil, fmt.Errorf("fullName and path are required")
	}
	u := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s?ref=%s",
		fullName, url.PathEscape(path), url.QueryEscape(ref))
	body, err := g.doRequest(u)
	if err != nil {
		return nil, err
	}

	var file struct {
		Type     string `json:"type"`
		Size     int    `json:"size"`
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := json.Unmarshal(body, &file); err != nil {
		return nil, err
	}
	if file.Type != "" && file.Type != "file" {
		return nil, fmt.Errorf("%s is not a file", path)
	}
	if file.Content == "" {
		return nil, fmt.Errorf("file %q has no content", path)
	}
	cleaned := strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, file.Content)
	decoded, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		// Some responses are base64-encoded without padding; retry decoded-safe.
		if dec, derr := base64.RawStdEncoding.DecodeString(cleaned); derr == nil {
			return dec, nil
		}
		return nil, fmt.Errorf("failed to decode %q: %w", path, err)
	}
	return decoded, nil
}

func (g *GitHubClient) ValidateToken() (*GitHubUser, error) {
	return g.GetCurrentUser()
}

// CountRepositories returns the total number of repositories accessible to the
// token by paginating through the user's repository list.
func (g *GitHubClient) CountRepositories() (int, error) {
	const perPage = 100
	total := 0
	for page := 1; ; page++ {
		repos, err := g.ListRepositories(page, perPage)
		if err != nil {
			return 0, err
		}
		total += len(repos)
		if len(repos) < perPage || page >= 50 {
			break
		}
	}
	return total, nil
}

// GitHubWebhook is the subset of a repository hook the app cares about.
type GitHubWebhook struct {
	ID     int64    `json:"id"`
	Active bool     `json:"active"`
	Events []string `json:"events"`
	Config struct {
		URL         string `json:"url"`
		ContentType string `json:"content_type"`
	} `json:"config"`
}

// doJSON performs a request with an optional JSON body and returns the response
// body and status code. Non-2xx responses are returned to the caller (not as an
// error) so callers can map status codes to friendly messages.
func (g *GitHubClient) doJSON(method, url string, payload interface{}) ([]byte, int, error) {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
		body = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, 0, err
	}
	if g.Token != "" {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return data, resp.StatusCode, nil
}

// webhookPermissionError turns GitHub's webhook API failures into a message
// that tells the user exactly what token scope / access is missing.
func webhookPermissionError(status int, body []byte) error {
	switch status {
	case http.StatusForbidden:
		return fmt.Errorf("GitHub refused to manage the webhook (403). The token needs webhook write access — classic: repo, write:repo_hook or admin:repo_hook; fine-grained: Webhooks (read and write) — and you must have admin access to the repository")
	case http.StatusUnauthorized:
		return fmt.Errorf("GitHub rejected the token (401) while managing the webhook")
	case http.StatusNotFound:
		return fmt.Errorf("repository not found or you do not have admin access (404)")
	default:
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = http.StatusText(status)
		}
		return fmt.Errorf("GitHub API returned status %d: %s", status, msg)
	}
}

// CreateWebhook registers a repository webhook that delivers the given events
// to hookURL, signed with secret. It returns the new hook id.
func (g *GitHubClient) CreateWebhook(fullName, hookURL, secret string, events []string) (int64, error) {
	if len(events) == 0 {
		events = []string{"push"}
	}
	payload := map[string]interface{}{
		"name":   "web",
		"active": true,
		"events": events,
		"config": map[string]interface{}{
			"url":          hookURL,
			"content_type": "json",
			"secret":       secret,
			"insecure_ssl": "0",
		},
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s/hooks", fullName)
	data, status, err := g.doJSON(http.MethodPost, url, payload)
	if err != nil {
		return 0, err
	}
	if status < 200 || status >= 300 {
		return 0, webhookPermissionError(status, data)
	}
	var hook struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(data, &hook); err != nil {
		return 0, err
	}
	return hook.ID, nil
}

// UpdateWebhook points an existing repository webhook at hookURL and refreshes
// its secret and event list.
func (g *GitHubClient) UpdateWebhook(fullName string, hookID int64, hookURL, secret string, events []string) error {
	if len(events) == 0 {
		events = []string{"push"}
	}
	payload := map[string]interface{}{
		"active": true,
		"events": events,
		"config": map[string]interface{}{
			"url":          hookURL,
			"content_type": "json",
			"secret":       secret,
			"insecure_ssl": "0",
		},
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s/hooks/%d", fullName, hookID)
	data, status, err := g.doJSON(http.MethodPatch, url, payload)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return webhookPermissionError(status, data)
	}
	return nil
}

// DeleteWebhook removes a repository webhook.
func (g *GitHubClient) DeleteWebhook(fullName string, hookID int64) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/hooks/%d", fullName, hookID)
	data, status, err := g.doJSON(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return webhookPermissionError(status, data)
	}
	return nil
}

// ListWebhooks returns the repository's webhooks, used to detect an existing
// hook for this app before creating a duplicate.
func (g *GitHubClient) ListWebhooks(fullName string) ([]GitHubWebhook, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/hooks", fullName)
	data, status, err := g.doJSON(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, webhookPermissionError(status, data)
	}
	var hooks []GitHubWebhook
	if err := json.Unmarshal(data, &hooks); err != nil {
		return nil, err
	}
	return hooks, nil
}
