package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/permissions"
)

// ProjectMembersHandler lists (GET) and adds (POST) a project's collaborators.
// Reading requires projects.members.read; adding requires
// projects.members.manage, which only the owner (or an admin) holds.
func ProjectMembersHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !hasProjectPermission(claims.UserID, id, "projects.members.read") {
			respondError(w, http.StatusForbidden, "You don't have permission to do that")
			return
		}
		listProjectMembers(w, id)
	case http.MethodPost:
		if !hasProjectPermission(claims.UserID, id, "projects.members.manage") {
			respondError(w, http.StatusForbidden, "You don't have permission to do that")
			return
		}
		addProjectMember(w, r, claims, id)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ProjectMemberItemHandler changes (PUT) or removes (DELETE) a collaborator.
func ProjectMemberItemHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	memberID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil || memberID <= 0 {
		respondError(w, http.StatusBadRequest, "Invalid member ID")
		return
	}
	if !hasProjectPermission(claims.UserID, id, "projects.members.manage") {
		respondError(w, http.StatusForbidden, "You don't have permission to do that")
		return
	}

	switch r.Method {
	case http.MethodPut:
		updateProjectMemberRole(w, r, claims, id, memberID)
	case http.MethodDelete:
		removeProjectMember(w, r, claims, id, memberID)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// listProjectMembers returns the owner followed by every collaborator.
func listProjectMembers(w http.ResponseWriter, projectID int64) {
	project, err := getProjectByID(projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	members := []models.ProjectMember{}
	var owner models.ProjectMember
	if err := db.DB.QueryRow(
		"SELECT id, username, COALESCE(display_name, ''), COALESCE(email, '') FROM users WHERE id = ?",
		project.UserID,
	).Scan(&owner.UserID, &owner.Username, &owner.DisplayName, &owner.Email); err == nil {
		owner.Role = permissions.ProjectRoleOwner
		members = append(members, owner)
	}

	rows, err := db.DB.Query(`
		SELECT m.user_id, u.username, COALESCE(u.display_name, ''), COALESCE(u.email, ''),
			m.role, COALESCE(m.added_by, 0), COALESCE(m.created_at, '')
		FROM project_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.project_id = ?
		ORDER BY m.created_at ASC, m.user_id ASC`, projectID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var m models.ProjectMember
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName, &m.Email, &m.Role, &m.AddedBy, &m.CreatedAt); err != nil {
			continue
		}
		if !permissions.ValidProjectRole(m.Role) {
			m.Role = permissions.ProjectRoleViewer
		}
		members = append(members, m)
	}
	respondJSON(w, http.StatusOK, members)
}

func addProjectMember(w http.ResponseWriter, r *http.Request, claims *Claims, projectID int64) {
	var req struct {
		User string `json:"user"`
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req.User = strings.TrimSpace(req.User)
	req.Role = strings.TrimSpace(req.Role)
	if req.User == "" {
		respondError(w, http.StatusBadRequest, "user is required")
		return
	}
	if req.Role == "" {
		req.Role = permissions.ProjectRoleViewer
	}
	if !permissions.ValidProjectRole(req.Role) {
		respondError(w, http.StatusBadRequest, "role must be one of: viewer, editor, manager")
		return
	}

	var userID int64
	var status string
	err := db.DB.QueryRow(
		"SELECT id, COALESCE(status, 'active') FROM users WHERE username = ? OR email = ?",
		req.User, req.User,
	).Scan(&userID, &status)
	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "No user found with that username or email")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if status != "active" {
		respondError(w, http.StatusBadRequest, "That account is disabled")
		return
	}

	var ownerID int64
	if err := db.DB.QueryRow("SELECT user_id FROM projects WHERE id = ?", projectID).Scan(&ownerID); err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}
	if userID == ownerID {
		respondError(w, http.StatusBadRequest, "That user already owns this project")
		return
	}

	if _, err := db.DB.Exec(
		`INSERT INTO project_members (project_id, user_id, role, added_by)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(project_id, user_id) DO UPDATE SET
			role = excluded.role, updated_at = CURRENT_TIMESTAMP`,
		projectID, userID, req.Role, claims.UserID,
	); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to add member")
		return
	}

	logAudit(r, claims.UserID, claims.Username, "project.member_add", "project",
		strconv.FormatInt(projectID, 10), "user="+strconv.FormatInt(userID, 10)+" role="+req.Role)
	listProjectMembers(w, projectID)
}

func updateProjectMemberRole(w http.ResponseWriter, r *http.Request, claims *Claims, projectID, memberID int64) {
	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req.Role = strings.TrimSpace(req.Role)
	if !permissions.ValidProjectRole(req.Role) {
		respondError(w, http.StatusBadRequest, "role must be one of: viewer, editor, manager")
		return
	}

	res, err := db.DB.Exec(
		"UPDATE project_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND user_id = ?",
		req.Role, projectID, memberID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update member")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		respondError(w, http.StatusNotFound, "Member not found")
		return
	}

	logAudit(r, claims.UserID, claims.Username, "project.member_update", "project",
		strconv.FormatInt(projectID, 10), "user="+strconv.FormatInt(memberID, 10)+" role="+req.Role)
	listProjectMembers(w, projectID)
}

func removeProjectMember(w http.ResponseWriter, r *http.Request, claims *Claims, projectID, memberID int64) {
	res, err := db.DB.Exec(
		"DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectID, memberID,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to remove member")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		respondError(w, http.StatusNotFound, "Member not found")
		return
	}

	logAudit(r, claims.UserID, claims.Username, "project.member_remove", "project",
		strconv.FormatInt(projectID, 10), "user="+strconv.FormatInt(memberID, 10))
	listProjectMembers(w, projectID)
}

// userLookupRow is the minimal user shape exposed to the share picker.
type userLookupRow struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
}

// UserLookupHandler searches active accounts by username, email or display
// name so a project owner can find someone to share with. Any authenticated
// user may call it; only non-sensitive fields are returned.
func UserLookupHandler(w http.ResponseWriter, r *http.Request) {
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
		respondJSON(w, http.StatusOK, []userLookupRow{})
		return
	}
	like := "%" + q + "%"
	rows, err := db.DB.Query(
		`SELECT id, username, COALESCE(display_name, ''), COALESCE(email, '')
		 FROM users
		 WHERE COALESCE(status, 'active') = 'active'
		   AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)
		 ORDER BY username ASC LIMIT 20`,
		like, like, like,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	out := []userLookupRow{}
	for rows.Next() {
		var u userLookupRow
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Email); err != nil {
			continue
		}
		out = append(out, u)
	}
	respondJSON(w, http.StatusOK, out)
}
