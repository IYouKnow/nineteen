package handlers

import (
	"database/sql"
	"strconv"
	"strings"

	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/permissions"
)

// resolveProjectRole returns the caller's effective role on a project:
// "owner" when they created it, otherwise the membership role stored in
// project_members. ok is false when the caller has no access at all.
func resolveProjectRole(userID, projectID int64) (string, bool) {
	var ownerID int64
	if err := db.DB.QueryRow("SELECT user_id FROM projects WHERE id = ?", projectID).Scan(&ownerID); err != nil {
		return "", false
	}
	if ownerID == userID {
		return permissions.ProjectRoleOwner, true
	}

	var role string
	err := db.DB.QueryRow(
		"SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
		projectID, userID,
	).Scan(&role)
	if err != nil {
		return "", false
	}
	if !permissions.ValidProjectRole(role) {
		role = permissions.ProjectRoleViewer
	}
	return role, true
}

// hasProjectPermission reports whether the caller may perform perm on a
// specific project. Instance admins bypass project membership entirely; for
// everyone else the project role's permission set is authoritative, so access
// does not depend on the user's global role.
func hasProjectPermission(userID, projectID int64, perm string) bool {
	if hasPermission(userID, "admin.resources.manage") {
		return true
	}
	role, ok := resolveProjectRole(userID, projectID)
	if !ok {
		return false
	}
	return permissions.Allows(permissions.ProjectRolePermissions(role), perm)
}

// getProjectForUser loads a project the caller can access (as owner or
// member) and stamps their effective access onto the model. It returns
// sql.ErrNoRows when the project is missing or the caller has no access.
func getProjectForUser(userID, id int64) (models.Project, error) {
	role, ok := resolveProjectRole(userID, id)
	if !ok {
		return models.Project{}, sql.ErrNoRows
	}
	p, err := getProjectByID(id)
	if err != nil {
		return p, err
	}
	p.Access = role
	p.IsOwner = role == permissions.ProjectRoleOwner
	return p, nil
}

// projectIDFromSegments extracts the numeric id from an /api/projects/{id}/...
// path. It returns false for the collection route (/api/projects).
func projectIDFromPath(path string) (int64, bool) {
	seg := strings.Split(strings.Trim(path, "/"), "/")
	if len(seg) < 3 || seg[0] != "api" || seg[1] != "projects" {
		return 0, false
	}
	id, err := strconv.ParseInt(seg[2], 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// isProjectScopedPath reports whether a path addresses a single project
// (/api/projects/{id}/...) rather than the collection route.
func isProjectScopedPath(path string) bool {
	seg := strings.Split(strings.Trim(path, "/"), "/")
	return len(seg) >= 3 && seg[0] == "api" && seg[1] == "projects"
}

// isDeploymentScopedPath reports whether a path addresses a single deployment
// (/api/deployments/{id}/...).
func isDeploymentScopedPath(path string) bool {
	seg := strings.Split(strings.Trim(path, "/"), "/")
	return len(seg) >= 3 && seg[0] == "api" && seg[1] == "deployments"
}

// deploymentIDFromPath extracts the numeric id from an /api/deployments/{id}/...
// path, excluding the collection route.
func deploymentIDFromPath(path string) (int64, bool) {
	seg := strings.Split(strings.Trim(path, "/"), "/")
	if len(seg) < 3 || seg[0] != "api" || seg[1] != "deployments" {
		return 0, false
	}
	id, err := strconv.ParseInt(seg[2], 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// deploymentProjectID resolves the project a deployment belongs to.
func deploymentProjectID(deploymentID int64) (int64, bool) {
	var projectID int64
	if err := db.DB.QueryRow("SELECT project_id FROM deployments WHERE id = ?", deploymentID).Scan(&projectID); err != nil {
		return 0, false
	}
	return projectID, true
}

// ---- exported helpers for the server's middleware ----

// ProjectIDFromPath exposes project path parsing to the middleware.
func ProjectIDFromPath(path string) (int64, bool) { return projectIDFromPath(path) }

// IsProjectScopedPath exposes the project-route test to the middleware.
func IsProjectScopedPath(path string) bool { return isProjectScopedPath(path) }

// IsDeploymentScopedPath exposes the deployment-route test to the middleware.
func IsDeploymentScopedPath(path string) bool { return isDeploymentScopedPath(path) }

// DeploymentIDFromPath exposes deployment path parsing to the middleware.
func DeploymentIDFromPath(path string) (int64, bool) { return deploymentIDFromPath(path) }

// DeploymentProjectID exposes the deployment→project lookup to the middleware.
func DeploymentProjectID(deploymentID int64) (int64, bool) { return deploymentProjectID(deploymentID) }

// HasProjectPermission exposes the per-project permission check to the
// middleware.
func HasProjectPermission(userID, projectID int64, perm string) bool {
	return hasProjectPermission(userID, projectID, perm)
}
