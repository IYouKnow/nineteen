package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

// ---- users ----

type adminUserRow struct {
	ID              int64  `json:"id"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	DisplayName     string `json:"display_name"`
	Role            string `json:"role"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
	ProjectCount    int    `json:"project_count"`
	DatabaseCount   int    `json:"database_count"`
	DeploymentCount int    `json:"deployment_count"`
}

// AdminUsersHandler lists every account with its role, status and resource
// counts.
func AdminUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, ok := requirePermission(w, r, "admin.users.read"); !ok {
		return
	}

	rows, err := db.DB.Query(`
		SELECT u.id, u.username, u.email, u.display_name, u.role, u.status, u.created_at,
			(SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id),
			(SELECT COUNT(*) FROM databases d WHERE d.user_id = u.id),
			(SELECT COUNT(*) FROM deployments dep WHERE dep.user_id = u.id)
		FROM users u ORDER BY u.id ASC`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	users := []adminUserRow{}
	for rows.Next() {
		var u adminUserRow
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.Role, &u.Status,
			&u.CreatedAt, &u.ProjectCount, &u.DatabaseCount, &u.DeploymentCount); err != nil {
			continue
		}
		if u.Role == "" {
			u.Role = auth.RoleMember
		}
		if u.Status == "" {
			u.Status = "active"
		}
		users = append(users, u)
	}

	respondJSON(w, http.StatusOK, users)
}

type adminUserUpdate struct {
	Role   *string `json:"role"`
	Status *string `json:"status"`
}

// AdminUserHandler updates a user's role/status or soft-deletes the account.
func AdminUserHandler(w http.ResponseWriter, r *http.Request) {
	claims, ok := requirePermission(w, r, "admin.users.manage")
	if !ok {
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid user ID")
		return
	}

	var targetRole, targetStatus, targetUsername string
	var targetSuper bool
	err := db.DB.QueryRow(
		`SELECT u.role, u.status, u.username, COALESCE(r.is_superuser, FALSE)
		 FROM users u LEFT JOIN roles r ON r.name = u.role WHERE u.id = ?`, id,
	).Scan(&targetRole, &targetStatus, &targetUsername, &targetSuper)
	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req adminUserUpdate
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		sets := []string{}
		args := []interface{}{}

		if req.Role != nil {
			role := strings.TrimSpace(*req.Role)
			if !roleExists(role) {
				respondError(w, http.StatusBadRequest, "Unknown role: "+role)
				return
			}
			if targetSuper && !roleIsSuperuser(role) && activeAdminCount() <= 1 {
				respondError(w, http.StatusConflict, "Cannot demote the last admin")
				return
			}
			sets = append(sets, "role = ?")
			args = append(args, role)
		}

		if req.Status != nil {
			status := strings.TrimSpace(*req.Status)
			if status != "active" && status != "disabled" {
				respondError(w, http.StatusBadRequest, "status must be active or disabled")
				return
			}
			if id == claims.UserID && status == "disabled" {
				respondError(w, http.StatusConflict, "You cannot disable your own account")
				return
			}
			if targetSuper && status == "disabled" && activeAdminCount() <= 1 {
				respondError(w, http.StatusConflict, "Cannot disable the last admin")
				return
			}
			sets = append(sets, "status = ?")
			args = append(args, status)
		}

		if len(sets) == 0 {
			respondError(w, http.StatusBadRequest, "Nothing to update")
			return
		}

		sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
		args = append(args, id)
		if _, err := db.DB.Exec("UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to update user")
			return
		}

		details := strings.TrimPrefix(strings.Join(sets, "; "), "updated_at = CURRENT_TIMESTAMP; ")
		logAudit(r, claims.UserID, claims.Username, "admin.user_update", "user", strconv.FormatInt(id, 10), details)

		var u models.User
		db.DB.QueryRow(
			"SELECT id, username, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?", id,
		).Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt)
		respondJSON(w, http.StatusOK, u)

	case http.MethodDelete:
		if id == claims.UserID {
			respondError(w, http.StatusConflict, "You cannot delete your own account here")
			return
		}
		if targetSuper && activeAdminCount() <= 1 {
			respondError(w, http.StatusConflict, "Cannot delete the last admin")
			return
		}
		if _, err := db.DB.Exec(
			"UPDATE users SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id,
		); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to delete user")
			return
		}
		logAudit(r, claims.UserID, claims.Username, "admin.user_delete", "user", strconv.FormatInt(id, 10), "soft-delete "+targetUsername)
		respondJSON(w, http.StatusOK, map[string]string{"message": "User deleted"})

	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ---- invite codes ----

type adminInviteRow struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	Role      string  `json:"role"`
	Label     string  `json:"label"`
	Used      bool    `json:"used"`
	Revoked   bool    `json:"revoked"`
	ExpiresAt *string `json:"expires_at"`
	MaxUses   int     `json:"max_uses"`
	Uses      int     `json:"uses"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
}

// AdminInvitesHandler lists and creates invite codes.
func AdminInvitesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if _, ok := requirePermission(w, r, "admin.invites.read"); !ok {
			return
		}
		rows, err := db.DB.Query(`
			SELECT i.id, i.code, i.role, i.label, i.used, i.revoked, i.expires_at,
				i.max_uses, i.uses, COALESCE(u.username, ''), i.created_at
			FROM invite_codes i
			LEFT JOIN users u ON u.id = i.created_by
			ORDER BY i.id DESC`)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Database error")
			return
		}
		defer rows.Close()

		invites := []adminInviteRow{}
		for rows.Next() {
			var inv adminInviteRow
			var expires sql.NullString
			if err := rows.Scan(&inv.ID, &inv.Code, &inv.Role, &inv.Label, &inv.Used, &inv.Revoked,
				&expires, &inv.MaxUses, &inv.Uses, &inv.CreatedBy, &inv.CreatedAt); err != nil {
				continue
			}
			if expires.Valid {
				inv.ExpiresAt = &expires.String
			}
			if inv.Role == "" {
				inv.Role = auth.RoleMember
			}
			if inv.MaxUses == 0 {
				inv.MaxUses = 1
			}
			invites = append(invites, inv)
		}
		respondJSON(w, http.StatusOK, invites)

	case http.MethodPost:
		claims, ok := requirePermission(w, r, "admin.invites.manage")
		if !ok {
			return
		}
		var req struct {
			Code      string `json:"code"`
			Role      string `json:"role"`
			Label     string `json:"label"`
			ExpiresAt string `json:"expires_at"`
			MaxUses   int    `json:"max_uses"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		req.Code = strings.TrimSpace(req.Code)
		req.Role = strings.TrimSpace(req.Role)
		req.Label = strings.TrimSpace(req.Label)
		req.ExpiresAt = strings.TrimSpace(req.ExpiresAt)

		if req.Role == "" {
			req.Role = defaultRoleName()
		}
		if !roleExists(req.Role) {
			respondError(w, http.StatusBadRequest, "Unknown role: "+req.Role)
			return
		}
		if req.MaxUses <= 0 {
			req.MaxUses = 1
		}
		if req.Code == "" {
			req.Code = randomInviteCode(12)
		}

		var expires interface{}
		if req.ExpiresAt != "" {
			t, err := parseFlexibleTime(req.ExpiresAt)
			if err != nil {
				respondError(w, http.StatusBadRequest, "expires_at must be a valid date")
				return
			}
			expires = t.UTC().Format("2006-01-02 15:04:05")
		}

		result, err := db.DB.Exec(
			`INSERT INTO invite_codes (code, role, label, expires_at, max_uses, created_by)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			req.Code, req.Role, req.Label, expires, req.MaxUses, claims.UserID,
		)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint") {
				respondError(w, http.StatusConflict, "That invite code already exists")
				return
			}
			respondError(w, http.StatusInternalServerError, "Failed to create invite code")
			return
		}
		id, _ := result.LastInsertId()
		logAudit(r, claims.UserID, claims.Username, "admin.invite_create", "invite", strconv.FormatInt(id, 10),
			"role="+req.Role)

		respondJSON(w, http.StatusCreated, map[string]interface{}{
			"id":       id,
			"code":     req.Code,
			"role":     req.Role,
			"label":    req.Label,
			"max_uses": req.MaxUses,
		})

	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// AdminInviteHandler revokes a single invite code.
func AdminInviteHandler(w http.ResponseWriter, r *http.Request) {
	claims, ok := requirePermission(w, r, "admin.invites.manage")
	if !ok {
		return
	}
	if r.Method != http.MethodDelete {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid invite ID")
		return
	}
	res, err := db.DB.Exec("UPDATE invite_codes SET revoked = TRUE WHERE id = ?", id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to revoke invite code")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		respondError(w, http.StatusNotFound, "Invite code not found")
		return
	}
	logAudit(r, claims.UserID, claims.Username, "admin.invite_revoke", "invite", strconv.FormatInt(id, 10), "")
	respondJSON(w, http.StatusOK, map[string]string{"message": "Invite code revoked"})
}

// ---- audit log ----

// AdminAuditHandler returns the most recent audit entries.
func AdminAuditHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, ok := requirePermission(w, r, "admin.audit.read"); !ok {
		return
	}

	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	offset := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v > 0 {
		offset = v
	}

	where := ""
	args := []interface{}{}
	if action := strings.TrimSpace(r.URL.Query().Get("action")); action != "" {
		where = " WHERE action LIKE ?"
		args = append(args, action+"%")
	}
	if userID := strings.TrimSpace(r.URL.Query().Get("user_id")); userID != "" {
		if n, err := strconv.ParseInt(userID, 10, 64); err == nil {
			if where == "" {
				where = " WHERE user_id = ?"
			} else {
				where += " AND user_id = ?"
			}
			args = append(args, n)
		}
	}

	args = append(args, limit, offset)
	rows, err := db.DB.Query(
		"SELECT id, user_id, username, action, target_type, target_id, details, ip, created_at FROM audit_logs"+
			where+" ORDER BY id DESC LIMIT ? OFFSET ?", args...)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	type auditRow struct {
		ID         int64  `json:"id"`
		UserID     int64  `json:"user_id"`
		Username   string `json:"username"`
		Action     string `json:"action"`
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Details    string `json:"details"`
		IP         string `json:"ip"`
		CreatedAt  string `json:"created_at"`
	}

	entries := []auditRow{}
	for rows.Next() {
		var e auditRow
		if err := rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Action, &e.TargetType,
			&e.TargetID, &e.Details, &e.IP, &e.CreatedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	respondJSON(w, http.StatusOK, entries)
}

// ---- system info ----

// AdminSystemHandler reports runtime, Docker and host metrics plus instance
// totals.
func AdminSystemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, ok := requirePermission(w, r, "admin.system.read"); !ok {
		return
	}

	version := "dev"
	if UpdateSvc != nil {
		if st := UpdateSvc.GetState(); st.CurrentVersion != "" {
			version = st.CurrentVersion
		}
	}

	info := services.GetSystemInfo(version)

	var usersTotal, projectsTotal, databasesTotal int
	db.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&usersTotal)
	db.DB.QueryRow("SELECT COUNT(*) FROM projects").Scan(&projectsTotal)
	db.DB.QueryRow("SELECT COUNT(*) FROM databases").Scan(&databasesTotal)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"system":          info,
		"users_total":     usersTotal,
		"projects_total":  projectsTotal,
		"databases_total": databasesTotal,
	})
}

// ---- cross-user resources ----

type adminProjectRow struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Status      string `json:"status"`
	Framework   string `json:"framework"`
	Repository  string `json:"repository"`
	UserID      int64  `json:"user_id"`
	Owner       string `json:"owner"`
	CreatedDate string `json:"created_date"`
}

type adminDatabaseRow struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	UserID      int64  `json:"user_id"`
	Owner       string `json:"owner"`
	CreatedDate string `json:"created_date"`
}

// AdminResourcesHandler lists every project and database across all users.
func AdminResourcesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, ok := requirePermission(w, r, "admin.resources.read"); !ok {
		return
	}

	projects := []adminProjectRow{}
	prows, err := db.DB.Query(`
		SELECT p.id, p.name, p.slug, p.status, p.framework, p.repository, p.user_id,
			COALESCE(u.username, ''), p.created_date
		FROM projects p LEFT JOIN users u ON u.id = p.user_id
		ORDER BY p.created_date DESC`)
	if err == nil {
		defer prows.Close()
		for prows.Next() {
			var p adminProjectRow
			if err := prows.Scan(&p.ID, &p.Name, &p.Slug, &p.Status, &p.Framework,
				&p.Repository, &p.UserID, &p.Owner, &p.CreatedDate); err != nil {
				continue
			}
			p.Status = reconcileProjectStatusByID(p.ID, p.Slug, p.Status)
			projects = append(projects, p)
		}
	}

	databases := []adminDatabaseRow{}
	drows, err := db.DB.Query(`
		SELECT d.id, d.name, d.slug, d.type, d.status, d.user_id,
			COALESCE(u.username, ''), d.created_date
		FROM databases d LEFT JOIN users u ON u.id = d.user_id
		ORDER BY d.created_date DESC`)
	if err == nil {
		defer drows.Close()
		for drows.Next() {
			var d adminDatabaseRow
			if err := drows.Scan(&d.ID, &d.Name, &d.Slug, &d.Type, &d.Status,
				&d.UserID, &d.Owner, &d.CreatedDate); err != nil {
				continue
			}
			databases = append(databases, d)
		}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"projects":  projects,
		"databases": databases,
	})
}

// reconcileProjectStatusByID refreshes a project's status for the admin list
// without needing the full model.
func reconcileProjectStatusByID(id int64, slug, status string) string {
	var strategy string
	db.DB.QueryRow("SELECT build_strategy FROM projects WHERE id = ?", id).Scan(&strategy)
	newStatus, persist := services.NewDeployer().ReconcileStatus(id, slug, strategy, status)
	if persist {
		db.DB.Exec("UPDATE projects SET status = ? WHERE id = ?", newStatus, id)
	}
	return newStatus
}

// AdminProjectHandler performs lifecycle actions or deletes any user's project.
func AdminProjectHandler(w http.ResponseWriter, r *http.Request) {
	claims, ok := requirePermission(w, r, "admin.resources.manage")
	if !ok {
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	project, err := getProjectByID(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req struct {
			Action string `json:"action"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		req.Action = strings.TrimSpace(req.Action)

		container := services.ResolveContainer(project.ID, project.Slug, project.BuildStrategy)
		if container == "" {
			respondError(w, http.StatusBadRequest, "No container found for this project — deploy first")
			return
		}
		d := &services.Deployer{}
		switch req.Action {
		case "start":
			if err := d.StartContainer(container); err != nil {
				respondError(w, http.StatusInternalServerError, "Docker start failed: "+err.Error())
				return
			}
			setProjectStatus(project.ID, "running")
		case "stop":
			if err := d.StopContainer(container); err != nil {
				respondError(w, http.StatusInternalServerError, "Docker stop failed: "+err.Error())
				return
			}
			setProjectStatus(project.ID, "stopped")
		case "restart":
			setProjectStatus(project.ID, "restarting")
			go func() {
				status := "running"
				if err := d.RestartContainer(container); err != nil {
					status = "error"
				}
				setProjectStatus(project.ID, status)
			}()
		default:
			respondError(w, http.StatusBadRequest, "action must be one of: start, stop, restart")
			return
		}
		logAudit(r, claims.UserID, claims.Username, "admin.project_action", "project", strconv.FormatInt(id, 10), req.Action)
		respondJSON(w, http.StatusOK, map[string]string{"message": "ok"})

	case http.MethodDelete:
		removeProjectContainers(project)
		if _, err := db.DB.Exec("DELETE FROM projects WHERE id = ?", id); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to delete project")
			return
		}
		services.RemoveProjectDataDir(id)
		logAudit(r, claims.UserID, claims.Username, "admin.project_delete", "project", strconv.FormatInt(id, 10), project.Name)
		respondJSON(w, http.StatusOK, map[string]string{"message": "Project deleted"})

	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// AdminDatabaseHandler performs lifecycle actions or deletes any user's
// database.
func AdminDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	claims, ok := requirePermission(w, r, "admin.resources.manage")
	if !ok {
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid database ID")
		return
	}
	d, err := getDatabaseByID(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Database not found")
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req struct {
			Action string `json:"action"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		req.Action = strings.TrimSpace(req.Action)

		prov := services.NewDatabaseProvisioner()
		switch req.Action {
		case "start":
			if err := prov.Start(d.Slug); err != nil {
				respondError(w, http.StatusInternalServerError, "Docker start failed: "+err.Error())
				return
			}
			setDatabaseStatus(d.ID, "running")
		case "stop":
			if err := prov.Stop(d.Slug); err != nil {
				respondError(w, http.StatusInternalServerError, "Docker stop failed: "+err.Error())
				return
			}
			setDatabaseStatus(d.ID, "stopped")
		case "restart":
			if err := prov.Restart(d.Slug); err != nil {
				respondError(w, http.StatusInternalServerError, "Docker restart failed: "+err.Error())
				return
			}
			setDatabaseStatus(d.ID, "running")
		default:
			respondError(w, http.StatusBadRequest, "action must be one of: start, stop, restart")
			return
		}
		logAudit(r, claims.UserID, claims.Username, "admin.database_action", "database", strconv.FormatInt(id, 10), req.Action)
		respondJSON(w, http.StatusOK, map[string]string{"message": "ok"})

	case http.MethodDelete:
		services.NewDatabaseProvisioner().Delete(d.Slug)
		if _, err := db.DB.Exec("DELETE FROM databases WHERE id = ?", id); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to delete database")
			return
		}
		logAudit(r, claims.UserID, claims.Username, "admin.database_delete", "database", strconv.FormatInt(id, 10), d.Name)
		respondJSON(w, http.StatusOK, map[string]string{"message": "Database deleted"})

	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// getDatabaseByID loads a database without scoping it to a user.
func getDatabaseByID(id int64) (models.Database, error) {
	var d models.Database
	err := db.DB.QueryRow(databaseSelect+" WHERE id = ?", id).Scan(
		&d.ID, &d.UserID, &d.Name, &d.Slug, &d.Type, &d.Version, &d.Status,
		&d.Region, &d.InstanceSize, &d.Host, &d.Port, &d.HostPort, &d.DatabaseName,
		&d.Username, &d.PasswordEncrypted, &d.Description, &d.CreatedDate, &d.UpdatedDate,
	)
	if err != nil {
		return d, err
	}
	reconcileDatabase(&d)
	return d, nil
}

// randomInviteCode returns a random, unambiguous (no 0/O/1/I) invite code.
func randomInviteCode(n int) string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// parseFlexibleTime accepts a date or RFC3339 timestamp.
func parseFlexibleTime(v string) (time.Time, error) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	var lastErr error
	for _, layout := range layouts {
		t, err := time.Parse(layout, v)
		if err == nil {
			return t, nil
		}
		lastErr = err
	}
	return time.Time{}, lastErr
}
