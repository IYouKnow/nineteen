package handlers

import (
	"net/http"
	"os"
	"path"
	"strings"

	"nineteen-server/services"
)

// containerForProject authenticates the request and resolves the project's live
// container name, writing an error response and returning ok=false on failure.
func containerForProject(w http.ResponseWriter, r *http.Request) (string, bool) {
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return "", false
	}
	project, err := getProjectByID(projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return "", false
	}
	name := services.ResolveContainer(project.ID, project.Slug, project.BuildStrategy)
	if name == "" {
		respondError(w, http.StatusConflict, "This project has no container yet — deploy it first.")
		return "", false
	}
	return name, true
}

// ProjectContainerFilesHandler lists a directory inside the project's running
// container (GET, ?path=/data). Unlike the project folder, this reflects the
// live filesystem wherever the app actually writes.
func ProjectContainerFilesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	container, ok := containerForProject(w, r)
	if !ok {
		return
	}
	dir := services.NormalizeContainerPath(r.URL.Query().Get("path"))
	entries, err := services.ListContainerDir(container, dir)
	if err != nil {
		respondError(w, http.StatusBadGateway, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"path":      dir,
		"container": container,
		"entries":   entries,
	})
}

// ProjectContainerFileDownloadHandler streams a single file out of the project's
// running container (GET, ?path=/data/onb.db).
func ProjectContainerFileDownloadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	container, ok := containerForProject(w, r)
	if !ok {
		return
	}
	filePath := strings.TrimSpace(r.URL.Query().Get("path"))
	if filePath == "" {
		respondError(w, http.StatusBadRequest, "path is required")
		return
	}
	tmp, err := services.CopyContainerFile(container, filePath)
	if err != nil {
		respondError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer os.RemoveAll(tmp)

	info, err := os.Stat(tmp)
	if err != nil || info.IsDir() {
		respondError(w, http.StatusBadRequest, "Not a file")
		return
	}
	name := path.Base(services.NormalizeContainerPath(filePath))
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, tmp)
}
