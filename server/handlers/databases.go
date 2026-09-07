package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

const databaseSelect = `SELECT id, user_id, name, slug, type, version, status, region,
	instance_size, host, port, host_port, database_name, username, password_encrypted,
	description, created_date, updated_date FROM databases`

// supportedDatabaseTypes are the engines this build can provision. Only
// PostgreSQL is implemented in the first pass.
var supportedDatabaseTypes = map[string]bool{"postgresql": true}

// defaultDatabaseVersion is used when a create request omits a version.
const defaultDatabaseVersion = "16.2"

func DatabasesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listDatabasesHandler(w, r)
	case http.MethodPost:
		createDatabaseHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func listDatabasesHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	order := sanitizeOrder(r.URL.Query().Get("order"), "created_date")
	limit := parseLimit(r.URL.Query().Get("limit"), 100)

	rows, err := db.DB.Query(databaseSelect+" WHERE user_id = ? ORDER BY "+order+" LIMIT ?", claims.UserID, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()

	dbs := []models.Database{}
	for rows.Next() {
		var d models.Database
		if err := scanDatabase(rows, &d); err != nil {
			continue
		}
		dbs = append(dbs, d)
		reconcileDatabase(&dbs[len(dbs)-1])
	}
	respondJSON(w, http.StatusOK, dbs)
}

func createDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req struct {
		Name         string `json:"name"`
		Slug         string `json:"slug"`
		Type         string `json:"type"`
		Version      string `json:"version"`
		Status       string `json:"status"`
		Region       string `json:"region"`
		InstanceSize string `json:"instance_size"`
		Host         string `json:"host"`
		Port         *int   `json:"port"`
		DatabaseName string `json:"database_name"`
		Username     string `json:"username"`
		Description  string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Type == "" {
		req.Type = "postgresql"
	}
	if !supportedDatabaseTypes[req.Type] {
		respondError(w, http.StatusBadRequest, "unsupported database type: "+req.Type)
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	}
	if req.Version == "" {
		req.Version = defaultDatabaseVersion
	}
	if req.Region == "" {
		req.Region = "fra1"
	}
	if req.InstanceSize == "" {
		req.InstanceSize = "small"
	}
	if req.DatabaseName == "" {
		req.DatabaseName = "app"
	}
	if req.Username == "" {
		req.Username = "app"
	}
	port := 5432
	if req.Port != nil && *req.Port > 0 {
		port = *req.Port
	}
	host := req.Host
	if host == "" {
		host = "db-" + req.Slug + "." + req.Region + ".nineteen.app"
	}

	password := randomHex(16)
	enc, err := auth.EncryptToken(password)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to encrypt password")
		return
	}

	hostPort, err := services.NewDeployer().FreePort()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to reserve a port")
		return
	}

	result, err := db.DB.Exec(
		`INSERT INTO databases (user_id, name, slug, type, version, status, region, instance_size,
			host, port, host_port, database_name, username, password_encrypted, description)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		claims.UserID, req.Name, req.Slug, req.Type, req.Version, "provisioning", req.Region,
		req.InstanceSize, host, port, hostPort, req.DatabaseName, req.Username, enc, req.Description,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create database")
		return
	}
	id, _ := result.LastInsertId()

	status := "running"
	if perr := services.NewDatabaseProvisioner().Create(context.Background(), req.Slug, req.Version, req.DatabaseName, req.Username, password, hostPort); perr != nil {
		status = "error"
	}
	db.DB.Exec("UPDATE databases SET status = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?", status, id)

	d, err := getDatabase(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to load database")
		return
	}
	respondJSON(w, http.StatusCreated, d)
}

func DatabaseHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid database ID")
		return
	}

	switch r.Method {
	case http.MethodGet:
		d, err := getDatabase(claims.UserID, id)
		if err != nil {
			respondError(w, http.StatusNotFound, "Database not found")
			return
		}
		respondJSON(w, http.StatusOK, d)
	case http.MethodPut:
		d, err := updateDatabase(w, r, claims.UserID, id)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to update database")
			return
		}
		respondJSON(w, http.StatusOK, d)
	case http.MethodDelete:
		// Remove the container + data volume, then the record (connections are
		// cascaded by the FK).
		row := db.DB.QueryRow("SELECT slug FROM databases WHERE id = ? AND user_id = ?", id, claims.UserID)
		var slug string
		if err := row.Scan(&slug); err != nil {
			respondError(w, http.StatusNotFound, "Database not found")
			return
		}
		services.NewDatabaseProvisioner().Delete(slug)
		if _, err := db.DB.Exec("DELETE FROM databases WHERE id = ? AND user_id = ?", id, claims.UserID); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to delete database")
			return
		}
		respondJSON(w, http.StatusOK, map[string]string{"message": "Database deleted"})
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// DatabaseActionHandler performs a Docker lifecycle action (start / stop /
// restart) on a database container and syncs the DB status.
func DatabaseActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid database ID")
		return
	}
	d, err := getDatabase(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Database not found")
		return
	}

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

	updated, err := getDatabase(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to load database")
		return
	}
	respondJSON(w, http.StatusOK, updated)
}

// DatabaseConnectionsHandler lists connections across the user's databases.
// Used by the Databases list page and project pages. Supports optional
// database_id / project_id filters.
func DatabaseConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	order := sanitizeOrder(r.URL.Query().Get("order"), "created_date")
	limit := parseLimit(r.URL.Query().Get("limit"), 200)

	where := " WHERE user_id = ?"
	args := []interface{}{claims.UserID}
	if dbID := r.URL.Query().Get("database_id"); dbID != "" {
		if n, err := strconv.ParseInt(dbID, 10, 64); err == nil {
			where += " AND database_id = ?"
			args = append(args, n)
		}
	}
	if projID := r.URL.Query().Get("project_id"); projID != "" {
		if n, err := strconv.ParseInt(projID, 10, 64); err == nil {
			where += " AND project_id = ?"
			args = append(args, n)
		}
	}

	args = append(args, limit)
	rows, err := db.DB.Query(connectionSelect+where+" ORDER BY "+order+" LIMIT ?", args...)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}
	defer rows.Close()
	respondConnections(w, rows)
}

// DatabaseConnectionsForHandler lists / creates / bulk-deletes the connections
// for one database.
func DatabaseConnectionsForHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid database ID")
		return
	}
	if _, err := getDatabase(claims.UserID, id); err != nil {
		respondError(w, http.StatusNotFound, "Database not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		order := sanitizeOrder(r.URL.Query().Get("order"), "created_date")
		limit := parseLimit(r.URL.Query().Get("limit"), 200)
		rows, err := db.DB.Query(connectionSelect+" WHERE user_id = ? AND database_id = ? ORDER BY "+order+" LIMIT ?", claims.UserID, id, limit)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Database error")
			return
		}
		defer rows.Close()
		respondConnections(w, rows)
	case http.MethodPost:
		bulkCreateConnections(w, r, claims.UserID, id)
	case http.MethodDelete:
		// deleteMany: remove every connection for this database.
		if _, err := db.DB.Exec("DELETE FROM database_connections WHERE database_id = ? AND user_id = ?", id, claims.UserID); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to disconnect projects")
			return
		}
		respondJSON(w, http.StatusOK, map[string]int{"deleted": 1})
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// DatabaseConnectionHandler deletes a single connection.
func DatabaseConnectionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	dbID, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid database ID")
		return
	}
	connIDStr := r.PathValue("connId")
	connID, err := strconv.ParseInt(connIDStr, 10, 64)
	if err != nil || connID <= 0 {
		respondError(w, http.StatusBadRequest, "Invalid connection ID")
		return
	}
	res, err := db.DB.Exec("DELETE FROM database_connections WHERE id = ? AND database_id = ? AND user_id = ?", connID, dbID, claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to disconnect project")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		respondError(w, http.StatusNotFound, "Connection not found")
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"message": "Project disconnected"})
}

func bulkCreateConnections(w http.ResponseWriter, r *http.Request, userID, dbID int64) {
	var items []struct {
		DatabaseID   int64  `json:"database_id"`
		ProjectID    int64  `json:"project_id"`
		DatabaseName string `json:"database_name"`
		DatabaseType string `json:"database_type"`
		ProjectName  string `json:"project_name"`
		Scope        string `json:"scope"`
		SelectedTables string `json:"selected_tables"`
		Role         string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var dbName, dbType string
	db.DB.QueryRow("SELECT name, type FROM databases WHERE id = ? AND user_id = ?", dbID, userID).Scan(&dbName, &dbType)

	created := []models.DatabaseConnection{}
	for _, it := range items {
		if it.DatabaseID == 0 {
			it.DatabaseID = dbID
		}
		if it.ProjectID == 0 {
			continue
		}
		// Ensure the project belongs to the user.
		var name string
		if err := db.DB.QueryRow("SELECT name FROM projects WHERE id = ? AND user_id = ?", it.ProjectID, userID).Scan(&name); err != nil {
			continue
		}
		if it.ProjectName == "" {
			it.ProjectName = name
		}
		if it.DatabaseName == "" {
			it.DatabaseName = dbName
		}
		if it.DatabaseType == "" {
			it.DatabaseType = dbType
		}
		if it.Scope == "" {
			it.Scope = "all"
		}
		if it.Role == "" {
			it.Role = "primary"
		}
		res, err := db.DB.Exec(
			`INSERT INTO database_connections (user_id, database_id, project_id, database_name, database_type,
				project_name, scope, selected_tables, role)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(database_id, project_id) DO UPDATE SET
				scope = excluded.scope, selected_tables = excluded.selected_tables, role = excluded.role`,
			userID, it.DatabaseID, it.ProjectID, it.DatabaseName, it.DatabaseType,
			it.ProjectName, it.Scope, it.SelectedTables, it.Role,
		)
		if err != nil {
			continue
		}
		cid, _ := res.LastInsertId()
		created = append(created, models.DatabaseConnection{
			ID: cid, UserID: userID, DatabaseID: it.DatabaseID, ProjectID: it.ProjectID,
			DatabaseName: it.DatabaseName, DatabaseType: it.DatabaseType, ProjectName: it.ProjectName,
			Scope: it.Scope, SelectedTables: it.SelectedTables, Role: it.Role,
		})
	}
	respondJSON(w, http.StatusCreated, created)
}

// ---- helpers ----

const connectionSelect = `SELECT id, user_id, database_id, project_id, database_name, database_type,
	project_name, scope, selected_tables, role, created_date FROM database_connections`

func scanDatabase(row rowScanner, d *models.Database) error {
	var port, hostPort sql.NullInt64
	err := row.Scan(&d.ID, &d.UserID, &d.Name, &d.Slug, &d.Type, &d.Version, &d.Status,
		&d.Region, &d.InstanceSize, &d.Host, &port, &hostPort, &d.DatabaseName,
		&d.Username, &d.PasswordEncrypted, &d.Description, &d.CreatedDate, &d.UpdatedDate)
	if port.Valid {
		p := int(port.Int64)
		d.Port = &p
	}
	if hostPort.Valid {
		p := int(hostPort.Int64)
		d.HostPort = &p
	}
	if plain, e := auth.DecryptToken(d.PasswordEncrypted); e == nil {
		d.Password = plain
	}
	return err
}

func getDatabase(userID, id int64) (models.Database, error) {
	var d models.Database
	err := db.DB.QueryRow(databaseSelect+" WHERE id = ? AND user_id = ?", id, userID).Scan(
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

// reconcileDatabase corrects a database's status to its live container state so
// the UI badge never reads "running" for a container that is actually stopped.
func reconcileDatabase(d *models.Database) {
	newStatus, persist := services.NewDatabaseProvisioner().ReconcileStatus(d.Slug, d.Status)
	if newStatus == d.Status {
		return
	}
	d.Status = newStatus
	if persist {
		db.DB.Exec("UPDATE databases SET status = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?", newStatus, d.ID)
	}
}

func setDatabaseStatus(id int64, status string) {
	db.DB.Exec("UPDATE databases SET status = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?", status, id)
}

func updateDatabase(w http.ResponseWriter, r *http.Request, userID, id int64) (models.Database, error) {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return models.Database{}, err
	}

	sets := []string{}
	args := []interface{}{}
	for col, val := range body {
		switch col {
		case "name", "description", "host", "database_name", "username", "version", "region", "instance_size", "status":
			sets = append(sets, col+" = ?")
			args = append(args, valueToString(val))
		}
	}
	if len(sets) == 0 {
		return getDatabase(userID, id)
	}
	sets = append(sets, "updated_date = CURRENT_TIMESTAMP")
	args = append(args, id, userID)

	q := "UPDATE databases SET " + strings.Join(sets, ", ") + " WHERE id = ? AND user_id = ?"
	if _, err := db.DB.Exec(q, args...); err != nil {
		return models.Database{}, err
	}
	return getDatabase(userID, id)
}

func respondConnections(w http.ResponseWriter, rows *sql.Rows) {
	conns := []models.DatabaseConnection{}
	for rows.Next() {
		var c models.DatabaseConnection
		if err := rows.Scan(&c.ID, &c.UserID, &c.DatabaseID, &c.ProjectID, &c.DatabaseName,
			&c.DatabaseType, &c.ProjectName, &c.Scope, &c.SelectedTables, &c.Role, &c.CreatedDate); err != nil {
			continue
		}
		conns = append(conns, c)
	}
	respondJSON(w, http.StatusOK, conns)
}

func sanitizeOrder(order, fallback string) string {
	if order == "" {
		order = fallback
	}
	dir := "ASC"
	if strings.HasPrefix(order, "-") {
		dir = "DESC"
		order = strings.TrimPrefix(order, "-")
	}
	switch order {
	case "name", "status", "type", "created_date", "updated_date":
	default:
		order = fallback
	}
	return order + " " + dir
}

func parseLimit(raw string, def int) int {
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return def
	}
	if n > 500 {
		return 500
	}
	return n
}
