package handlers

import (
	"net/http"
	"strings"

	"nineteen-server/services"
)

var dockerHub = services.NewDockerHub()

// DockerHubFeaturedHandler returns the curated app-store catalog. Auth is
// required, but no specific permission is needed (read-only discovery).
func DockerHubFeaturedHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, err := extractUser(r); err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	respondJSON(w, http.StatusOK, services.FeaturedApps())
}

// DockerHubSearchHandler proxies a public Docker Hub image search.
func DockerHubSearchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, err := extractUser(r); err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		respondJSON(w, http.StatusOK, []services.DockerHubRepo{})
		return
	}
	limit := services.ParseLimit(r.URL.Query().Get("limit"), 25)
	repos, err := dockerHub.Search(r.Context(), q, limit)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Docker Hub search failed: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, repos)
}

// DockerHubTagsHandler lists the available tags of an image repository.
func DockerHubTagsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, err := extractUser(r); err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	image := strings.TrimSpace(r.URL.Query().Get("image"))
	if image == "" {
		respondError(w, http.StatusBadRequest, "image is required")
		return
	}
	limit := services.ParseLimit(r.URL.Query().Get("limit"), 25)
	tags, err := dockerHub.Tags(r.Context(), image, limit)
	if err != nil {
		respondError(w, http.StatusBadGateway, "Failed to list tags: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, tags)
}
