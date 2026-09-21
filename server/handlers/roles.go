package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/permissions"
)

// roleExists reports whether a role name exists.
func roleExists(name string) bool {
	var exists bool
	db.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM roles WHERE name = ?)", name).Scan(&exists)
	return exists
}

// roleIsSuperuser reports whether a role name is the superuser role.
func roleIsSuperuser(name string) bool {
	var super bool
	db.DB.QueryRow("SELECT is_superuser FROM roles WHERE name = ?", name).Scan(&super)
	return super
}

// defaultRoleName returns the configured default role for new registrations,
// falling back to member.
func defaultRoleName() string {
	var name string
	if err := db.DB.QueryRow("SELECT name FROM roles WHERE is_default = TRUE LIMIT 1").Scan(&name); err == nil && name != "" {
		return name
	}
	return auth.RoleMember
}

// superuserRoleName returns the name of the superuser role, falling back to
// admin.
func superuserRoleName() string {
	var name string
	if err := db.DB.QueryRow("SELECT name FROM roles WHERE is_superuser = TRUE LIMIT 1").Scan(&name); err == nil && name != "" {
		return name
	}
	return auth.RoleAdmin
}

type roleResponse struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsSuperuser bool     `json:"is_superuser"`
	IsDefault   bool     `json:"is_default"`
	UserCount   int      `json:"user_count"`
	Permissions []string `json:"permissions"`
}

// PermissionCatalogHandler returns the full permission catalogue so the UI can
// render the permission matrix.
func PermissionCatalogHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, err := extractUser(r); err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	respondJSON(w, http.StatusOK, permissions.Catalog())
}

// AdminRolesHandler lists and creates roles.
func AdminRolesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if _, ok := requirePermission(w, r, "admin.roles.read"); !ok {
			return
		}
		listRoles(w)
	case http.MethodPost:
		claims, ok := requirePermission(w, r, "admin.roles.manage")
		if !ok {
			return
		}
		createRole(w, r, claims)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// AdminRoleHandler updates or deletes a single role.
func AdminRoleHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPut:
		claims, ok := requirePermission(w, r, "admin.roles.manage")
		if !ok {
			return
		}
		updateRole(w, r, claims)
	case http.MethodDelete:
		claims, ok := requirePermission(w, r, "admin.roles.manage")
		if !ok {
			return
		}
		deleteRole(w, r, claims)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func rolePermissionsByID(roleID int64, isSuper bool) []string {
	if isSuper {
		return []string{"*"}
	}
	rows, err := db.DB.Query("SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission", roleID)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			out = append(out, p)
		}
	}
	return out
}

func listRoles(w http.ResponseWriter) {
	rows, err := db.DB.Query(`
		SELECT r.id, r.name, r.description, r.is_superuser, r.is_default,
			(SELECT COUNT(*) FROM users u WHERE u.role = r.name)
		FROM roles r ORDER BY r.id ASC`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	roles := []roleResponse{}
	for rows.Next() {
		var role roleResponse
		if err := rows.Scan(&role.ID, &role.Name, &role.Description, &role.IsSuperuser,
			&role.IsDefault, &role.UserCount); err != nil {
			continue
		}
		role.Permissions = rolePermissionsByID(role.ID, role.IsSuperuser)
		roles = append(roles, role)
	}
	respondJSON(w, http.StatusOK, roles)
}

type roleWriteRequest struct {
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Permissions *[]string `json:"permissions"`
	IsDefault   *bool     `json:"is_default"`
}

func validateRoleName(name string) string {
	if name == "" {
		return "name is required"
	}
	if len(name) > 32 {
		return "name must be 32 characters or fewer"
	}
	for _, r := range name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return "name may only contain letters, numbers, hyphens and underscores"
		}
	}
	return ""
}

func createRole(w http.ResponseWriter, r *http.Request, claims *Claims) {
	var req roleWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.Name == nil {
		respondError(w, http.StatusBadRequest, "name is required")
		return
	}
	name := strings.TrimSpace(*req.Name)
	if msg := validateRoleName(name); msg != "" {
		respondError(w, http.StatusBadRequest, msg)
		return
	}
	description := ""
	if req.Description != nil {
		description = strings.TrimSpace(*req.Description)
	}

	perms, msg := normalizePermissions(req.Permissions)
	if msg != "" {
		respondError(w, http.StatusBadRequest, msg)
		return
	}

	result, err := db.DB.Exec(
		"INSERT INTO roles (name, description, is_superuser, is_default) VALUES (?, ?, FALSE, FALSE)",
		name, description,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			respondError(w, http.StatusConflict, "A role with that name already exists")
			return
		}
		respondError(w, http.StatusInternalServerError, "Failed to create role")
		return
	}
	id, _ := result.LastInsertId()
	replaceRolePermissions(id, perms)

	logAudit(r, claims.UserID, claims.Username, "admin.role_create", "role", strconv.FormatInt(id, 10), name)
	respondJSON(w, http.StatusCreated, roleResponse{
		ID: id, Name: name, Description: description, Permissions: perms,
	})
}

func updateRole(w http.ResponseWriter, r *http.Request, claims *Claims) {
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid role ID")
		return
	}

	var currentName, currentDesc string
	var isSuper, isDefault bool
	err := db.DB.QueryRow(
		"SELECT name, description, is_superuser, is_default FROM roles WHERE id = ?", id,
	).Scan(&currentName, &currentDesc, &isSuper, &isDefault)
	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "Role not found")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	var req roleWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	newName := currentName
	if req.Name != nil {
		newName = strings.TrimSpace(*req.Name)
		if msg := validateRoleName(newName); msg != "" {
			respondError(w, http.StatusBadRequest, msg)
			return
		}
	}
	newDesc := currentDesc
	if req.Description != nil {
		newDesc = strings.TrimSpace(*req.Description)
	}

	tx, err := db.DB.Begin()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec("UPDATE roles SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		newName, newDesc, id); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			respondError(w, http.StatusConflict, "A role with that name already exists")
			return
		}
		respondError(w, http.StatusInternalServerError, "Failed to update role")
		return
	}

	// Renaming a role must move every user assigned to it.
	if newName != currentName {
		if _, err := tx.Exec("UPDATE users SET role = ? WHERE role = ?", newName, currentName); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to rename role")
			return
		}
	}

	if req.IsDefault != nil && *req.IsDefault && !isDefault {
		if _, err := tx.Exec("UPDATE roles SET is_default = FALSE"); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to set default role")
			return
		}
		if _, err := tx.Exec("UPDATE roles SET is_default = TRUE WHERE id = ?", id); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to set default role")
			return
		}
		isDefault = true
	}

	if err := tx.Commit(); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update role")
		return
	}

	// The superuser role implicitly has every permission; its stored set is
	// irrelevant, so it is never written.
	perms := rolePermissionsByID(id, isSuper)
	if !isSuper && req.Permissions != nil {
		newPerms, msg := normalizePermissions(req.Permissions)
		if msg != "" {
			respondError(w, http.StatusBadRequest, msg)
			return
		}
		replaceRolePermissions(id, newPerms)
		perms = newPerms
	}

	logAudit(r, claims.UserID, claims.Username, "admin.role_update", "role", strconv.FormatInt(id, 10), newName)
	respondJSON(w, http.StatusOK, roleResponse{
		ID: id, Name: newName, Description: newDesc,
		IsSuperuser: isSuper, IsDefault: isDefault, Permissions: perms,
	})
}

func deleteRole(w http.ResponseWriter, r *http.Request, claims *Claims) {
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid role ID")
		return
	}

	var name string
	var isSuper, isDefault bool
	err := db.DB.QueryRow("SELECT name, is_superuser, is_default FROM roles WHERE id = ?", id).
		Scan(&name, &isSuper, &isDefault)
	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "Role not found")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if isSuper {
		respondError(w, http.StatusConflict, "The superuser role cannot be deleted")
		return
	}

	var userCount int
	db.DB.QueryRow("SELECT COUNT(*) FROM users WHERE role = ?", name).Scan(&userCount)

	replacementID := int64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("replacement_role_id")); raw != "" {
		replacementID, _ = strconv.ParseInt(raw, 10, 64)
	}

	if userCount > 0 {
		if replacementID == 0 {
			respondError(w, http.StatusConflict,
				"This role is assigned to "+strconv.Itoa(userCount)+" user(s). Choose a replacement role first.")
			return
		}
		if replacementID == id {
			respondError(w, http.StatusBadRequest, "Replacement role must be different")
			return
		}
		var replacementName string
		if err := db.DB.QueryRow("SELECT name FROM roles WHERE id = ?", replacementID).Scan(&replacementName); err != nil {
			respondError(w, http.StatusBadRequest, "Replacement role not found")
			return
		}
		if _, err := db.DB.Exec("UPDATE users SET role = ? WHERE role = ?", replacementName, name); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to reassign users")
			return
		}
	}

	if isDefault && replacementID != 0 {
		db.DB.Exec("UPDATE roles SET is_default = TRUE WHERE id = ?", replacementID)
	}

	if _, err := db.DB.Exec("DELETE FROM roles WHERE id = ?", id); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete role")
		return
	}

	logAudit(r, claims.UserID, claims.Username, "admin.role_delete", "role", strconv.FormatInt(id, 10), name)
	respondJSON(w, http.StatusOK, map[string]string{"message": "Role deleted"})
}

// normalizePermissions validates a permission list, returning a message when
// any entry is unknown.
func normalizePermissions(input *[]string) ([]string, string) {
	if input == nil {
		return []string{}, ""
	}
	out := []string{}
	seen := map[string]bool{}
	for _, p := range *input {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			continue
		}
		if !permissions.ValidGrant(p) {
			return nil, "Unknown permission: " + p
		}
		seen[p] = true
		out = append(out, p)
	}
	return out, ""
}

// replaceRolePermissions swaps a role's permission set.
func replaceRolePermissions(roleID int64, perms []string) {
	db.DB.Exec("DELETE FROM role_permissions WHERE role_id = ?", roleID)
	for _, p := range perms {
		db.DB.Exec("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)", roleID, p)
	}
}
