package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"nineteen-server/services"
)

// maxUploadBytes caps a single upload request body.
const maxUploadBytes = 256 << 20 // 256 MiB

// projectForFiles authenticates the request and confirms the project belongs to
// the caller. It writes the error response itself and returns ok=false on
// failure.
func projectForFiles(w http.ResponseWriter, r *http.Request) (int64, bool) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return 0, false
	}
	projectID, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return 0, false
	}
	if _, err := getProject(claims.UserID, projectID); err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return 0, false
	}
	return projectID, true
}

func respondTree(w http.ResponseWriter, projectID int64) {
	tree, err := services.ProjectFileTree(projectID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Could not read the project folder")
		return
	}
	respondJSON(w, http.StatusOK, tree)
}

// ProjectFilesHandler returns a project's file tree.
func ProjectFilesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	respondTree(w, projectID)
}

// ProjectFileUploadHandler accepts multipart uploads into a folder. The target
// folder is passed in the "path" field.
func ProjectFileUploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid upload")
		return
	}
	parent := r.FormValue("path")
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		respondError(w, http.StatusBadRequest, "No files uploaded")
		return
	}
	for _, header := range files {
		f, err := header.Open()
		if err != nil {
			respondError(w, http.StatusBadRequest, "Could not read upload")
			return
		}
		err = services.SaveProjectUpload(projectID, parent, header.Filename, f)
		f.Close()
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	respondTree(w, projectID)
}

// ProjectFolderHandler creates a new folder (JSON body: path, name).
func ProjectFolderHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	var req struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := services.CreateProjectFolder(projectID, req.Path, req.Name); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondTree(w, projectID)
}

// ProjectFileEntryHandler renames (PUT, JSON body: path, name) or deletes
// (DELETE, ?path=) a file or folder.
func ProjectFileEntryHandler(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodPut:
		var req struct {
			Path string `json:"path"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		if err := services.RenameProjectEntry(projectID, req.Path, req.Name); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
	case http.MethodDelete:
		path := r.URL.Query().Get("path")
		if strings.TrimSpace(path) == "" {
			respondError(w, http.StatusBadRequest, "path is required")
			return
		}
		if err := services.DeleteProjectEntry(projectID, path); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	respondTree(w, projectID)
}

// ProjectFileDownloadHandler streams a single file (?path=).
func ProjectFileDownloadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	if strings.TrimSpace(path) == "" {
		respondError(w, http.StatusBadRequest, "path is required")
		return
	}
	full, info, err := services.OpenProjectFile(projectID, path)
	if err != nil {
		respondError(w, http.StatusNotFound, "File not found")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\""+info.Name()+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, full)
}
