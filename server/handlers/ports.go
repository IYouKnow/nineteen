package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"nineteen-server/db"
	"nineteen-server/models"
)

// --- ports ---

// validPort reports whether n is a usable TCP/UDP port number.
func validPort(n int) bool {
	return n > 0 && n <= 65535
}

// portOrNil turns a decoded JSON value into an optional port number: nil or a
// non-positive value means "no explicit port".
func portOrNil(v interface{}) *int {
	if n, ok := intOrNil(v).(int); ok {
		return &n
	}
	return nil
}

// normalizeProtocol maps an input protocol to "tcp" or "udp", defaulting to
// "tcp" for anything unrecognized.
func normalizeProtocol(p string) string {
	if strings.EqualFold(strings.TrimSpace(p), "udp") {
		return "udp"
	}
	return "tcp"
}

// loadProjectPorts returns a project's configured port mappings, primary first
// so callers can rely on index 0 when nothing is flagged primary.
func loadProjectPorts(projectID int64) ([]models.ProjectPort, error) {
	rows, err := db.DB.Query(
		`SELECT id, project_id, container_port, host_port, protocol, label, is_primary, created_date, updated_date
		 FROM project_ports WHERE project_id = ? ORDER BY is_primary DESC, id ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ports := []models.ProjectPort{}
	for rows.Next() {
		var p models.ProjectPort
		var isPrimary int
		if err := rows.Scan(&p.ID, &p.ProjectID, &p.ContainerPort, &p.HostPort, &p.Protocol, &p.Label, &isPrimary, &p.CreatedDate, &p.UpdatedDate); err != nil {
			continue
		}
		p.IsPrimary = isPrimary != 0
		ports = append(ports, p)
	}
	return ports, rows.Err()
}

// clearPrimaryPort unsets the primary flag on every port of a project, so a new
// or updated mapping can become the sole primary.
func clearPrimaryPort(projectID, exceptID int64) {
	db.DB.Exec("UPDATE project_ports SET is_primary = FALSE WHERE project_id = ? AND id != ?", projectID, exceptID)
}

// ProjectPortsHandler lists (GET) and creates (POST) a project's port mappings.
func ProjectPortsHandler(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		ports, err := loadProjectPorts(projectID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Could not load ports")
			return
		}
		respondJSON(w, http.StatusOK, ports)
	case http.MethodPost:
		var req struct {
			ContainerPort int    `json:"container_port"`
			HostPort      *int   `json:"host_port"`
			Protocol      string `json:"protocol"`
			Label         string `json:"label"`
			IsPrimary     bool   `json:"is_primary"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		if !validPort(req.ContainerPort) {
			respondError(w, http.StatusBadRequest, "container_port must be between 1 and 65535")
			return
		}
		if req.HostPort != nil && *req.HostPort != 0 && !validPort(*req.HostPort) {
			respondError(w, http.StatusBadRequest, "host_port must be between 1 and 65535")
			return
		}
		if req.HostPort != nil && *req.HostPort == 0 {
			req.HostPort = nil
		}

		existing, _ := loadProjectPorts(projectID)
		isPrimary := req.IsPrimary || len(existing) == 0

		res, err := db.DB.Exec(
			`INSERT INTO project_ports (project_id, container_port, host_port, protocol, label, is_primary)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			projectID, req.ContainerPort, req.HostPort, normalizeProtocol(req.Protocol),
			strings.TrimSpace(req.Label), boolToInt(isPrimary),
		)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Could not create port")
			return
		}
		id, _ := res.LastInsertId()
		if isPrimary {
			clearPrimaryPort(projectID, id)
		}
		respondJSON(w, http.StatusCreated, models.ProjectPort{
			ID:            id,
			ProjectID:     projectID,
			ContainerPort: req.ContainerPort,
			HostPort:      req.HostPort,
			Protocol:      normalizeProtocol(req.Protocol),
			Label:         strings.TrimSpace(req.Label),
			IsPrimary:     isPrimary,
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ProjectPortHandler updates or deletes a single port mapping.
func ProjectPortHandler(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectForFiles(w, r)
	if !ok {
		return
	}
	portID, err := strconv.ParseInt(r.PathValue("portId"), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid port ID")
		return
	}

	switch r.Method {
	case http.MethodPut:
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		sets := []string{}
		args := []interface{}{}
		if _, ok := body["container_port"]; ok {
			n := portOrNil(body["container_port"])
			if n == nil || !validPort(*n) {
				respondError(w, http.StatusBadRequest, "container_port must be between 1 and 65535")
				return
			}
			sets = append(sets, "container_port = ?")
			args = append(args, *n)
		}
		if _, ok := body["host_port"]; ok {
			// A null (or 0) host_port clears it so the next deploy auto-assigns.
			hp := portOrNil(body["host_port"])
			if hp != nil && !validPort(*hp) {
				respondError(w, http.StatusBadRequest, "host_port must be between 1 and 65535")
				return
			}
			sets = append(sets, "host_port = ?")
			args = append(args, hp)
		}
		if _, ok := body["label"]; ok {
			sets = append(sets, "label = ?")
			args = append(args, strings.TrimSpace(valueToString(body["label"])))
		}
		if _, ok := body["protocol"]; ok {
			sets = append(sets, "protocol = ?")
			args = append(args, normalizeProtocol(valueToString(body["protocol"])))
		}
		if _, ok := body["is_primary"]; ok {
			sets = append(sets, "is_primary = ?")
			args = append(args, boolToInt(toBool(body["is_primary"])))
		}
		if len(sets) == 0 {
			respondError(w, http.StatusBadRequest, "Nothing to update")
			return
		}
		sets = append(sets, "updated_date = CURRENT_TIMESTAMP")
		args = append(args, portID, projectID)
		res, err := db.DB.Exec(
			"UPDATE project_ports SET "+strings.Join(sets, ", ")+" WHERE id = ? AND project_id = ?",
			args...,
		)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Could not update port")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			respondError(w, http.StatusNotFound, "Port not found")
			return
		}
		if toBool(body["is_primary"]) {
			clearPrimaryPort(projectID, portID)
		}
		respondJSON(w, http.StatusOK, map[string]string{"message": "Port updated"})
	case http.MethodDelete:
		res, err := db.DB.Exec("DELETE FROM project_ports WHERE id = ? AND project_id = ?", portID, projectID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Could not remove port")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			respondError(w, http.StatusNotFound, "Port not found")
			return
		}
		respondJSON(w, http.StatusOK, map[string]string{"message": "Port removed"})
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}
