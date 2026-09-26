package services

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// dockerHubAPI is the public Docker Hub v2 API root. It requires no auth for
// public image search, tag listing and repository metadata (rate limits apply).
const dockerHubAPI = "https://hub.docker.com/v2"

// DockerHubRepo is one image repository as returned by Docker Hub search.
type DockerHubRepo struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Repository  string `json:"repository"` // "<namespace>/<name>"
	Description string `json:"description"`
	StarCount   int    `json:"star_count"`
	PullCount   int64  `json:"pull_count"`
	IsOfficial  bool   `json:"is_official"`
	IsAutomated bool   `json:"is_automated"`
	LogoURL     string `json:"logo_url"`
	LastUpdated string `json:"last_updated"`
}

// DockerHubTag is one published tag of an image repository.
type DockerHubTag struct {
	Name        string `json:"name"`
	FullSize    int64  `json:"full_size"`
	LastUpdated string `json:"last_updated"`
}

// DockerHub wraps the public Docker Hub API for image discovery.
type DockerHub struct {
	client *http.Client
}

func NewDockerHub() *DockerHub {
	return &DockerHub{client: &http.Client{Timeout: 12 * time.Second}}
}

// dockerHubSearchResponse is the envelope returned by /v2/search/repositories.
type dockerHubSearchResponse struct {
	Count   int `json:"count"`
	Results []struct {
		RepoName        string `json:"repo_name"`
		ShortDesc       string `json:"short_description"`
		StarCount       int    `json:"star_count"`
		PullCount       int64  `json:"pull_count"`
		IsOfficial      bool   `json:"is_official"`
		IsAutomated     bool   `json:"is_automated"`
		LogoURL         string `json:"logo_url"`
		LastUpdated     string `json:"last_updated"`
	} `json:"results"`
}

// Search queries Docker Hub for public repositories matching q, best matches
// first. Official images are surfaced by Docker's own ranking.
func (h *DockerHub) Search(ctx context.Context, q string, limit int) ([]DockerHubRepo, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []DockerHubRepo{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	endpoint := fmt.Sprintf("%s/search/repositories/?query=%s&page_size=%d",
		dockerHubAPI, url.QueryEscape(q), limit)

	var payload dockerHubSearchResponse
	if err := h.getJSON(ctx, endpoint, &payload); err != nil {
		return nil, err
	}

	repos := make([]DockerHubRepo, 0, len(payload.Results))
	for _, r := range payload.Results {
		repos = append(repos, repoFromName(r.RepoName, r.ShortDesc, r.StarCount, r.PullCount,
			r.IsOfficial, r.IsAutomated, r.LogoURL, r.LastUpdated))
	}
	return repos, nil
}

// Tags lists the most recently updated tags of an image ("namespace/name" or a
// bare official name like "nginx").
func (h *DockerHub) Tags(ctx context.Context, image string, limit int) ([]DockerHubTag, error) {
	ns, name, err := splitImage(image)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	endpoint := fmt.Sprintf("%s/repositories/%s/%s/tags/?page_size=%d&ordering=last_updated",
		dockerHubAPI, url.PathEscape(ns), url.PathEscape(name), limit)

	var payload struct {
		Results []struct {
			Name        string `json:"name"`
			FullSize    int64  `json:"full_size"`
			LastUpdated string `json:"last_updated"`
		} `json:"results"`
	}
	if err := h.getJSON(ctx, endpoint, &payload); err != nil {
		return nil, err
	}

	tags := make([]DockerHubTag, 0, len(payload.Results))
	for _, t := range payload.Results {
		tags = append(tags, DockerHubTag{Name: t.Name, FullSize: t.FullSize, LastUpdated: t.LastUpdated})
	}
	return tags, nil
}

// Repo fetches metadata for a single image repository.
func (h *DockerHub) Repo(ctx context.Context, image string) (DockerHubRepo, error) {
	ns, name, err := splitImage(image)
	if err != nil {
		return DockerHubRepo{}, err
	}
	endpoint := fmt.Sprintf("%s/repositories/%s/%s/", dockerHubAPI, url.PathEscape(ns), url.PathEscape(name))

	var payload struct {
		Name        string `json:"name"`
		Namespace   string `json:"namespace"`
		Description string `json:"description"`
		StarCount   int    `json:"star_count"`
		PullCount   int64  `json:"pull_count"`
		IsOfficial  bool   `json:"is_official"`
		IsAutomated bool   `json:"is_automated"`
		LogoURL     string `json:"logo_url"`
		LastUpdated string `json:"last_updated"`
	}
	if err := h.getJSON(ctx, endpoint, &payload); err != nil {
		return DockerHubRepo{}, err
	}
	full := payload.Namespace + "/" + payload.Name
	if payload.Namespace == "" {
		full = "library/" + payload.Name
	}
	return repoFromName(full, payload.Description, payload.StarCount, payload.PullCount,
		payload.IsOfficial, payload.IsAutomated, payload.LogoURL, payload.LastUpdated), nil
}

func (h *DockerHub) getJSON(ctx context.Context, endpoint string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "nineteen/1.0")

	res, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return fmt.Errorf("image not found")
	}
	if res.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("Docker Hub rate limit reached — try again shortly")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("Docker Hub returned %s", res.Status)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// repoFromName builds a DockerHubRepo from a "namespace/name" string.
func repoFromName(full, desc string, stars int, pulls int64, official, automated bool, logo, updated string) DockerHubRepo {
	ns, name := "", full
	if i := strings.Index(full, "/"); i >= 0 {
		ns, name = full[:i], full[i+1:]
	}
	return DockerHubRepo{
		Name: name, Namespace: ns, Repository: full, Description: desc,
		StarCount: stars, PullCount: pulls, IsOfficial: official, IsAutomated: automated,
		LogoURL: logo, LastUpdated: updated,
	}
}

// splitImage parses an image reference into its namespace and name. Official
// images without a namespace are placed under "library" (Docker Hub's canonical
// namespace for them).
func splitImage(image string) (namespace, name string, err error) {
	image = strings.TrimSpace(image)
	image = strings.TrimPrefix(image, "docker.io/")
	image = strings.TrimPrefix(image, "index.docker.io/")
	if image == "" {
		return "", "", fmt.Errorf("image is required")
	}
	// Drop any tag/digest so "nginx:1.27" resolves to the repository "nginx".
	if i := strings.IndexAny(image, ":@"); i >= 0 {
		image = image[:i]
	}
	image = strings.Trim(image, "/")
	parts := strings.Split(image, "/")
	switch len(parts) {
	case 1:
		return "library", parts[0], nil
	case 2:
		return parts[0], parts[1], nil
	default:
		// Registry host + namespace + name (e.g. ghcr.io/org/app).
		return strings.Join(parts[:len(parts)-1], "/"), parts[len(parts)-1], nil
	}
}

// AppEnv describes one environment variable a featured app understands.
type AppEnv struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Default  string `json:"default"`
	Required bool   `json:"required"`
	Secret   bool   `json:"secret"`
}

// FeaturedApp is a hand-picked, one-click-installable application for the app
// store. It carries just enough metadata (default port, env vars) to run the
// image with no extra configuration.
type FeaturedApp struct {
	Repository  string   `json:"repository"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	LogoURL     string   `json:"logo_url"`
	Port        int      `json:"port"`
	Env         []AppEnv `json:"env"`
}

// dashboardIconURL returns a stable logo URL for a featured app from the
// community-maintained dashboard-icons set (served via the jsDelivr CDN).
// Docker Hub's public API no longer returns repository logo URLs, so the store
// catalog ships curated icons instead.
func dashboardIconURL(slug string) string {
	return "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/" + slug + ".png"
}

// FeaturedApps returns the curated catalog shown by the app store. These are
// public images that run with sensible defaults; env vars are optional unless
// marked required.
func FeaturedApps() []FeaturedApp {
	return []FeaturedApp{
		{Repository: "nginx", Name: "Nginx", Category: "Web", Port: 80, LogoURL: dashboardIconURL("nginx"),
			Description: "High-performance HTTP server and reverse proxy."},
		{Repository: "httpd", Name: "Apache HTTP Server", Category: "Web", Port: 80, LogoURL: dashboardIconURL("apache"),
			Description: "The Apache Foundation's battle-tested web server."},
		{Repository: "caddy", Name: "Caddy", Category: "Web", Port: 80, LogoURL: dashboardIconURL("caddy"),
			Description: "Web server with automatic HTTPS."},
		{Repository: "redis", Name: "Redis", Category: "Data", Port: 6379, LogoURL: dashboardIconURL("redis"),
			Description: "In-memory key/value store for caching and queues."},
		{Repository: "postgres", Name: "PostgreSQL", Category: "Data", Port: 5432, LogoURL: dashboardIconURL("postgresql"),
			Env:         []AppEnv{{Key: "POSTGRES_PASSWORD", Label: "Password", Required: true, Secret: true}},
			Description: "Powerful open-source relational database."},
		{Repository: "mysql", Name: "MySQL", Category: "Data", Port: 3306, LogoURL: dashboardIconURL("mysql"),
			Env:         []AppEnv{{Key: "MYSQL_ROOT_PASSWORD", Label: "Root password", Required: true, Secret: true}},
			Description: "The world's most popular open-source database."},
		{Repository: "mongo", Name: "MongoDB", Category: "Data", Port: 27017, LogoURL: dashboardIconURL("mongodb"),
			Description: "Document database for flexible schemas."},
		{Repository: "grafana/grafana", Name: "Grafana", Category: "Monitoring", Port: 3000, LogoURL: dashboardIconURL("grafana"),
			Env:         []AppEnv{{Key: "GF_SECURITY_ADMIN_PASSWORD", Label: "Admin password", Default: "admin", Secret: true}},
			Description: "Dashboards and analytics for all your metrics."},
		{Repository: "prom/prometheus", Name: "Prometheus", Category: "Monitoring", Port: 9090, LogoURL: dashboardIconURL("prometheus"),
			Description: "Metrics collection and alerting toolkit."},
		{Repository: "louislam/uptime-kuma", Name: "Uptime Kuma", Category: "Monitoring", Port: 3001, LogoURL: dashboardIconURL("uptime-kuma"),
			Description: "Self-hosted uptime monitoring with a clean UI."},
		{Repository: "vaultwarden/server", Name: "Vaultwarden", Category: "Security", Port: 80, LogoURL: dashboardIconURL("vaultwarden"),
			Description: "Lightweight Bitwarden-compatible password manager server."},
		{Repository: "portainer/portainer-ce", Name: "Portainer", Category: "Management", Port: 9000, LogoURL: dashboardIconURL("portainer"),
			Description: "Web UI for managing Docker environments."},
		{Repository: "jellyfin/jellyfin", Name: "Jellyfin", Category: "Media", Port: 8096, LogoURL: dashboardIconURL("jellyfin"),
			Description: "Free media server for movies, shows and music."},
		{Repository: "gitea/gitea", Name: "Gitea", Category: "Developer", Port: 3000, LogoURL: dashboardIconURL("gitea"),
			Description: "Lightweight self-hosted Git service."},
		{Repository: "metabase/metabase", Name: "Metabase", Category: "Analytics", Port: 3000, LogoURL: dashboardIconURL("metabase"),
			Description: "Easy BI and analytics for everyone."},
		{Repository: "nocodb/nocodb", Name: "NocoDB", Category: "Data", Port: 8080, LogoURL: dashboardIconURL("nocodb"),
			Description: "Open-source Airtable alternative."},
		{Repository: "adminer", Name: "Adminer", Category: "Data", Port: 8080, LogoURL: dashboardIconURL("adminer"),
			Description: "Full-featured database management in a single file."},
		{Repository: "phpmyadmin/phpmyadmin", Name: "phpMyAdmin", Category: "Data", Port: 80, LogoURL: dashboardIconURL("phpmyadmin"),
			Description: "Web interface for MySQL and MariaDB."},
	}
}

// ParseLimit reads a positive limit from a query string value, clamping it to
// [1, 100] and falling back to def when unset or invalid.
func ParseLimit(raw string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return def
	}
	if n > 100 {
		return 100
	}
	return n
}
