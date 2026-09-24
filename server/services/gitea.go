package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GiteaUser is the subset of Gitea's /user response the app cares about.
type GiteaUser struct {
	Login     string `json:"login"`
	ID        int64  `json:"id"`
	AvatarURL string `json:"avatar_url"`
	FullName  string `json:"full_name"`
	Email     string `json:"email"`
}

// GiteaRepo is the subset of a Gitea repository the app cares about.
type GiteaRepo struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	FullName      string `json:"full_name"`
	Private       bool   `json:"private"`
	HTMLURL       string `json:"html_url"`
	CloneURL      string `json:"clone_url"`
	Language      string `json:"language"`
	Description   string `json:"description"`
	DefaultBranch string `json:"default_branch"`
	StarsCount    int64  `json:"stars_count"`
	Fork          bool   `json:"fork"`
	Owner         struct {
		Login string `json:"login"`
	} `json:"owner"`
	UpdatedAt string `json:"updated_at"`
}

// GiteaClient talks to a self-hosted (or gitea.com) Gitea instance's REST API.
// BaseURL is the instance root (e.g. "https://gitea.example.com"); the "/api/v1"
// prefix is added automatically. Gitea's API mirrors GitHub's, but tokens are
// sent as "Authorization: token <t>" and every instance has its own host.
type GiteaClient struct {
	BaseURL string
	Token   string
	Client  *http.Client
}

func NewGiteaClient(baseURL, token string) *GiteaClient {
	return &GiteaClient{
		BaseURL: NormalizeGiteaBaseURL(baseURL),
		Token:   token,
		Client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// NormalizeGiteaBaseURL trims whitespace and trailing slashes, and drops a
// trailing "/api/v1" so a user may paste either the instance root or its API
// base. Returns "" when the input is empty.
func NormalizeGiteaBaseURL(baseURL string) string {
	u := strings.TrimSpace(baseURL)
	u = strings.TrimRight(u, "/")
	u = strings.TrimSuffix(u, "/api/v1")
	return strings.TrimRight(u, "/")
}

func (g *GiteaClient) apiURL(path string) string {
	return g.BaseURL + "/api/v1" + path
}

func (g *GiteaClient) doRequest(url string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	if g.Token != "" {
		req.Header.Set("Authorization", "token "+g.Token)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Gitea API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return body, nil
}

func (g *GiteaClient) GetCurrentUser() (*GiteaUser, error) {
	if g.BaseURL == "" {
		return nil, fmt.Errorf("Gitea base URL is required")
	}
	body, err := g.doRequest(g.apiURL("/user"))
	if err != nil {
		return nil, err
	}

	var user GiteaUser
	if err := json.Unmarshal(body, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

func (g *GiteaClient) ListRepositories(page, perPage int) ([]GiteaRepo, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 30
	}
	u := fmt.Sprintf("%s?page=%d&limit=%d", g.apiURL("/user/repos"), page, perPage)
	body, err := g.doRequest(u)
	if err != nil {
		return nil, err
	}

	var repos []GiteaRepo
	if err := json.Unmarshal(body, &repos); err != nil {
		return nil, err
	}
	return repos, nil
}

// CountRepositories returns the total number of repositories accessible to the
// token by paginating through the user's repository list.
func (g *GiteaClient) CountRepositories() (int, error) {
	const perPage = 50
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

// ListReleases returns a repository's published releases, newest first. Drafts
// are filtered out. A repository with no releases yields an empty slice.
func (g *GiteaClient) ListReleases(fullName string, limit int) ([]RepoVersion, error) {
	if limit <= 0 {
		limit = 30
	}
	fullName = strings.Trim(strings.TrimSpace(fullName), "/")
	if fullName == "" {
		return nil, fmt.Errorf("fullName is required")
	}
	u := fmt.Sprintf("%s?limit=%d", g.apiURL("/repos/"+fullName+"/releases"), limit)
	body, err := g.doRequest(u)
	if err != nil {
		return nil, err
	}

	var releases []RepoVersion
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil, err
	}
	out := make([]RepoVersion, 0, len(releases))
	for _, r := range releases {
		if r.TagName == "" {
			continue
		}
		r.IsRelease = true
		out = append(out, r)
	}
	return out, nil
}

// ListTags returns a repository's git tags, newest first, so a deploy can offer
// tagged versions even when no Gitea release was published for them.
func (g *GiteaClient) ListTags(fullName string, limit int) ([]RepoVersion, error) {
	if limit <= 0 {
		limit = 30
	}
	fullName = strings.Trim(strings.TrimSpace(fullName), "/")
	if fullName == "" {
		return nil, fmt.Errorf("fullName is required")
	}
	u := fmt.Sprintf("%s?limit=%d", g.apiURL("/repos/"+fullName+"/tags"), limit)
	body, err := g.doRequest(u)
	if err != nil {
		return nil, err
	}

	var tags []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &tags); err != nil {
		return nil, err
	}
	out := make([]RepoVersion, 0, len(tags))
	for _, t := range tags {
		if t.Name == "" {
			continue
		}
		out = append(out, RepoVersion{TagName: t.Name, Name: t.Name})
	}
	return out, nil
}

// GetRepoTree returns every file path in a repository at the given ref (branch
// name, tag or "HEAD"). The boolean reports whether Gitea truncated the listing.
func (g *GiteaClient) GetRepoTree(fullName, ref string) ([]string, bool, error) {
	if ref == "" {
		ref = "HEAD"
	}
	fullName = strings.Trim(strings.TrimSpace(fullName), "/")
	u := fmt.Sprintf("%s?recursive=true&per_page=1000",
		g.apiURL("/repos/"+fullName+"/git/trees/"+url.PathEscape(strings.TrimSpace(ref))))
	body, err := g.doRequest(u)
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

// GetRepoFile fetches a single file's decoded content at a given ref using the
// Gitea Contents API.
func (g *GiteaClient) GetRepoFile(fullName, ref, path string) ([]byte, error) {
	if ref == "" {
		ref = "HEAD"
	}
	fullName = strings.Trim(strings.TrimSpace(fullName), "/")
	path = strings.Trim(strings.TrimSpace(path), "/")
	if fullName == "" || path == "" {
		return nil, fmt.Errorf("fullName and path are required")
	}
	u := fmt.Sprintf("%s?ref=%s", g.apiURL("/repos/"+fullName+"/contents/"+path), url.QueryEscape(ref))
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
		if dec, derr := base64.RawStdEncoding.DecodeString(cleaned); derr == nil {
			return dec, nil
		}
		return nil, fmt.Errorf("failed to decode %q: %w", path, err)
	}
	return decoded, nil
}

func (g *GiteaClient) ValidateToken() (*GiteaUser, error) {
	return g.GetCurrentUser()
}
