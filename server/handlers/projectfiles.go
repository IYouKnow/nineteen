package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"nineteen-server/db"
	"nineteen-server/models"
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

// --- volumes ---

func loadProjectVolumes(projectID int64) ([]models.ProjectVolume, error) {
	rows, err := db.DB.Query(
		"SELECT id, project_id, name, host_path, container_path, created_date, updated_date FROM project_volumes WHERE project_id = ? ORDER BY id ASC",
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	vols := []models.ProjectVolume{}
	for rows.Next() {
		var v models.ProjectVolume
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.Name, &v.HostPath, &v.ContainerPath, &v.CreatedDate, &v.UpdatedDate); err != nil {
			continue
		}
		v.HostDir = services.HostProjectVolumeDir(projectID, v.HostPath)
		vols = append(vols, v)
	}
	return vols, rows.Err()
}

// projectBindMounts returns the host→container bind mounts for a project's
// volumes, creating the host folders if needed. Used at deploy time.
func projectBindMounts(projectID int64) []services.BindMount {
	vols, err := loadProjectVolumes(projectID)
	if err != nil {
		return nil
	}
	mounts := make([]services.BindMount, 0, len(vols))
	for _, v := range vols {
		if _, err := services.EnsureProjectVolumeDir(projectID, v.HostPath); err != nil {
			continue
		}
		mounts = append(mounts, services.BindMount{
			Source: services.HostProjectVolumeDir(projectID, v.HostPath),
			Target: v.ContainerPath,
		})
	}
	return mounts
}

func validContainerPath(p string) bool {
	p = strings.TrimSpace(p)
	return strings.HasPrefix(p, "/") && len(p) > 1 && !strings.ContainsAny(p, " \t\r\n\x00")
}

// ProjectVolumesHandler lists (GET) and creates (POST) a project's volume
// mappings.
func ProjectVolumesHandler(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		vols, err := loadProjectVolumes(projectID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Could not load volumes")
			return
		}
		respondJSON(w, http.StatusOK, vols)
	case http.MethodPost:
		var req struct {
			Name          string `json:"name"`
			HostPath      string `json:"host_path"`
			ContainerPath string `json:"container_path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}
		hostPath := strings.TrimSpace(req.HostPath)
		if hostPath == "" {
			hostPath = slugify(name)
		}
		hostPath, err := services.ValidHostPath(hostPath)
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		containerPath := strings.TrimSpace(req.ContainerPath)
		if !validContainerPath(containerPath) {
			respondError(w, http.StatusBadRequest, "container path must be an absolute path like /app/data")
			return
		}
		res, err := db.DB.Exec(
			"INSERT INTO project_volumes (project_id, name, host_path, container_path) VALUES (?, ?, ?, ?)",
			projectID, name, hostPath, containerPath,
		)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Could not create volume")
			return
		}
		if _, err := services.EnsureProjectVolumeDir(projectID, hostPath); err != nil {
			respondError(w, http.StatusInternalServerError, "Could not create the volume folder")
			return
		}
		id, _ := res.LastInsertId()
		respondJSON(w, http.StatusCreated, models.ProjectVolume{
			ID:            id,
			ProjectID:     projectID,
			Name:          name,
			HostPath:      hostPath,
			ContainerPath: containerPath,
			HostDir:       services.HostProjectVolumeDir(projectID, hostPath),
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ProjectVolumeHandler deletes a volume mapping.
func ProjectVolumeHandler(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodDelete {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	volumeID, err := strconv.ParseInt(r.PathValue("volumeId"), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid volume ID")
		return
	}
	res, err := db.DB.Exec("DELETE FROM project_volumes WHERE id = ? AND project_id = ?", volumeID, projectID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Could not remove volume")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		respondError(w, http.StatusNotFound, "Volume not found")
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"message": "Volume removed"})
}

// --- files ---

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
