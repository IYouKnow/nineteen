package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"nineteen-server/auth"
	"nineteen-server/authz"
	"nineteen-server/permissions"
)

// This file is a translation layer only. Every authorization decision about
// roles lives in the authz package, so there is exactly one place where the
// rules are written down and exactly one place to audit them. Handlers map
// authz's typed errors onto status codes and nothing more.

type roleResponse struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsSuperuser bool     `json:"is_superuser"`
	IsDefault   bool     `json:"is_default"`
	IsArchived  bool     `json:"is_archived"`
	UserCount   int      `json:"user_count"`
	Permissions []string `json:"permissions"`
}

func toRoleResponse(r authz.Role) roleResponse {
	return roleResponse{
		ID: r.ID, Name: r.Name, Description: r.Description,
		IsSuperuser: r.IsSuperuser, IsDefault: r.IsDefault, IsArchived: r.IsArchived,
		UserCount: r.UserCount, Permissions: r.Permissions,
	}
}

// respondAuthzError maps an authz error onto a status code. The distinction
// between "you may not" and "that would break an invariant" is preserved so
// the client can react differently, and so a refused escalation is
// distinguishable from a typo.
func respondAuthzError(w http.ResponseWriter, err error) {
	var inUse *authz.RoleInUseError
	var grant *authz.ExceedsGrantError
	switch {
	case errors.Is(err, authz.ErrNotFound):
		respondError(w, http.StatusNotFound, "Role not found")
	case errors.Is(err, authz.ErrForbidden):
		respondError(w, http.StatusForbidden, "You don't have permission to do that")
	case errors.Is(err, authz.ErrProtectedRole):
		respondError(w, http.StatusConflict, "The superuser role is protected and cannot be changed this way")
	case errors.Is(err, authz.ErrLastSuperuser):
		respondError(w, http.StatusConflict, "This is the last superuser; the instance would be locked out")
	case errors.Is(err, authz.ErrRoleInUse):
		if errors.As(err, &inUse) {
			respondError(w, http.StatusConflict, inUse.Error())
			return
		}
		respondError(w, http.StatusConflict, "This role is still assigned to users")
	case errors.Is(err, authz.ErrArchivedRole):
		respondError(w, http.StatusConflict, "This role is archived and cannot be assigned to anyone")
	case errors.Is(err, authz.ErrExceedsGrant):
		if errors.As(err, &grant) {
			respondError(w, http.StatusForbidden, grant.Error())
			return
		}
		respondError(w, http.StatusForbidden, "You can't grant permissions you don't have")
	case errors.Is(err, authz.ErrSelfManaged):
		respondError(w, http.StatusConflict, "This would leave you without any permission")
	case errors.Is(err, authz.ErrConflict):
		respondError(w, http.StatusConflict, "That conflicts with the current state")
	default:
		// Validation messages from authz are written for operators, so they pass
		// through as-is; anything unrecognised is a 400.
		respondError(w, http.StatusBadRequest, err.Error())
	}
}

// PermissionCatalogHandler returns the full permission catalogue so the UI can
// render the permission matrix. Each entry is annotated with whether the calling
// user may grant it, so the editor can disable what would be refused instead of
// letting the operator fill in a form that fails on save.
func PermissionCatalogHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	grantable := authz.GrantablePermissions(claims.UserID)
	catalog := make([]map[string]interface{}, 0)
	for _, g := range permissions.Catalog() {
		defs := make([]map[string]interface{}, 0, len(g.Permissions))
		for _, p := range g.Permissions {
			defs = append(defs, map[string]interface{}{
				"key":       p.Key,
				"label":     p.Label,
				"grantable": grantable[p.Key],
				"is_write":  permissions.IsWriteKey(p.Key),
			})
		}
		catalog = append(catalog, map[string]interface{}{
			"id": g.ID, "label": g.Label, "description": g.Description, "permissions": defs,
		})
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"groups":       catalog,
		"is_superuser": authz.IsSuperuser(claims.UserID),
	})
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

// AdminRoleHandler updates, archives or deletes a single role.
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

func listRoles(w http.ResponseWriter) {
	roles, err := authz.ListRoles()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	out := make([]roleResponse, 0, len(roles))
	for _, r := range roles {
		out = append(out, toRoleResponse(r))
	}
	respondJSON(w, http.StatusOK, out)
}

type roleWriteRequest struct {
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Permissions *[]string `json:"permissions"`
	IsDefault   *bool     `json:"is_default"`
	IsArchived  *bool     `json:"is_archived"`
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
	perms := []string{}
	if req.Permissions != nil {
		perms = *req.Permissions
	}
	desc := ""
	if req.Description != nil {
		desc = *req.Description
	}

	created, err := authz.CreateRole(claims.UserID, authz.CreateRoleInput{
		Name: *req.Name, Description: desc, Permissions: perms,
	})
	if err != nil {
		respondAuthzError(w, err)
		return
	}

	logAudit(r, claims.UserID, claims.Username, "admin.role_create",
		"role", strconv.FormatInt(created.ID, 10), created.Name)
	respondJSON(w, http.StatusCreated, toRoleResponse(created))
}

func updateRole(w http.ResponseWriter, r *http.Request, claims *Claims) {
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid role ID")
		return
	}
	var req roleWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updated, err := authz.UpdateRole(claims.UserID, id, authz.UpdateRoleInput{
		Name: req.Name, Description: req.Description,
		Permissions: req.Permissions, SetDefault: req.IsDefault, Archived: req.IsArchived,
	})
	if err != nil {
		respondAuthzError(w, err)
		return
	}

	logAudit(r, claims.UserID, claims.Username, "admin.role_update",
		"role", strconv.FormatInt(id, 10), updated.Name)
	respondJSON(w, http.StatusOK, toRoleResponse(updated))
}

// deleteRole removes a role that has no members.
//
// There is no replacement_role_id parameter. Choosing where a role's members go
// is a privilege change, and the original endpoint let a caller smuggle one in
// through a query string on a DELETE, writing a resolved role name straight
// into users.role with no check that the caller was allowed to grant it. Mass
// reassignment is now ReassignRoleMembersHandler: a named, separately audited
// operation that runs the same containment check as every other grant.
func deleteRole(w http.ResponseWriter, r *http.Request, claims *Claims) {
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid role ID")
		return
	}
	if err := authz.DeleteRole(claims.UserID, id); err != nil {
		respondAuthzError(w, err)
		return
	}

	logAudit(r, claims.UserID, claims.Username, "admin.role_delete",
		"role", strconv.FormatInt(id, 10), "")
	respondJSON(w, http.StatusOK, map[string]string{"message": "Role deleted"})
}

type reassignRequest struct {
	ToRoleID int64 `json:"to_role_id"`
}

// ReassignRoleMembersHandler moves every member of one role into another.
func ReassignRoleMembersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, ok := requirePermission(w, r, "admin.roles.manage")
	if !ok {
		return
	}
	fromID, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid role ID")
		return
	}
	var req reassignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.ToRoleID == 0 {
		respondError(w, http.StatusBadRequest, "to_role_id is required")
		return
	}

	moved, err := authz.ReassignMembers(claims.UserID, fromID, req.ToRoleID)
	if err != nil {
		respondAuthzError(w, err)
		return
	}

	to, _ := authz.RoleByID(req.ToRoleID)
	logAudit(r, claims.UserID, claims.Username, "admin.role_reassign",
		"role", strconv.FormatInt(fromID, 10),
		"moved="+strconv.Itoa(moved)+" to_role_id="+strconv.FormatInt(req.ToRoleID, 10)+
			" to="+to.Name)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Reassigned " + strconv.Itoa(moved) + " user(s) to " + to.Name,
		"moved":   moved,
	})
}

// RoleMembersHandler lists the accounts holding a role, so the UI can show
// exactly who a delete or an archive would affect.
func RoleMembersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, ok := requirePermission(w, r, "admin.roles.read"); !ok {
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid role ID")
		return
	}
	if _, ok := authz.RoleByID(id); !ok {
		respondError(w, http.StatusNotFound, "Role not found")
		return
	}
	members, err := authz.MembersOfRole(id, 500)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	respondJSON(w, http.StatusOK, members)
}

// defaultRoleName keeps the registration path working for callers that only
// have the role name to hand.
func defaultRoleName() string {
	if r, ok := authz.DefaultRole(); ok {
		return r.Name
	}
	return auth.RoleMember
}
