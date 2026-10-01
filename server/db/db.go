package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"nineteen-server/auth"
	"nineteen-server/permissions"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

// sqliteDSN appends the connection pragmas the modernc driver understands.
// NOTE: modernc.org/sqlite does not read the mattn-style "_journal_mode" /
// "_foreign_keys" parameters; those must be set through "_pragma" or they are
// silently ignored (leaving foreign keys off and the DB in rollback-journal
// mode, which causes SQLITE_BUSY errors under concurrent access).
func sqliteDSN(dbPath string) string {
	sep := "?"
	if strings.Contains(dbPath, "?") {
		sep = "&"
	}
	return dbPath + sep +
		"_pragma=busy_timeout(10000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=foreign_keys(1)"
}

func Init(dbPath string) {
	var err error
	DB, err = sql.Open("sqlite", sqliteDSN(dbPath))
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	runMigrations()
	cleanupOrphans()
	seedInviteCode()
	log.Println("Database initialized successfully")
}

// cleanupOrphans removes child rows left behind by deletes that ran while
// foreign keys were disabled (the old DSN silently ignored foreign_keys). Once
// foreign keys are enforced these cascades happen automatically, so this only
// needs to sweep up pre-existing rows.
func cleanupOrphans() {
	projectTables := []string{
		"project_members", "deployments", "runtime_logs", "env_vars",
		"build_file_overrides", "database_connections", "project_volumes",
		"project_ports", "project_triggers", "project_webhooks", "deploy_events",
	}
	for _, t := range projectTables {
		if _, err := DB.Exec("DELETE FROM " + t + " WHERE project_id NOT IN (SELECT id FROM projects)"); err != nil {
			log.Printf("Orphan cleanup failed for %s: %v", t, err)
		}
	}
	if _, err := DB.Exec("DELETE FROM deployment_logs WHERE deployment_id NOT IN (SELECT id FROM deployments)"); err != nil {
		log.Printf("Orphan cleanup failed for deployment_logs: %v", err)
	}
	if _, err := DB.Exec("DELETE FROM database_connections WHERE database_id NOT IN (SELECT id FROM databases)"); err != nil {
		log.Printf("Orphan cleanup failed for database_connections: %v", err)
	}
}

func runMigrations() {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			display_name TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS roles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			description TEXT DEFAULT '',
			is_superuser BOOLEAN DEFAULT FALSE,
			is_default BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS role_permissions (
			role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
			permission TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (role_id, permission)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id)`,
		`CREATE TABLE IF NOT EXISTS invite_codes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT UNIQUE NOT NULL,
			used BOOLEAN DEFAULT FALSE,
			used_by INTEGER REFERENCES users(id),
			role TEXT DEFAULT 'member',
			label TEXT DEFAULT '',
			expires_at DATETIME,
			max_uses INTEGER DEFAULT 1,
			uses INTEGER DEFAULT 0,
			revoked BOOLEAN DEFAULT FALSE,
			created_by INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			username TEXT DEFAULT '',
			action TEXT NOT NULL,
			target_type TEXT DEFAULT '',
			target_id TEXT DEFAULT '',
			details TEXT DEFAULT '',
			ip TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(id)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`,
		`CREATE TABLE IF NOT EXISTS settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			key TEXT NOT NULL,
			value TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, key)
		)`,
		`CREATE TABLE IF NOT EXISTS api_keys (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			key_hash TEXT NOT NULL,
			prefix TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_used_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS integrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			provider TEXT NOT NULL,
			label TEXT DEFAULT '',
			username TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			access_token TEXT DEFAULT '',
			config TEXT DEFAULT '{}',
			metadata TEXT DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, provider)
		)`,
		`CREATE TABLE IF NOT EXISTS projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			status TEXT DEFAULT 'idle',
			framework TEXT DEFAULT 'node',
			repository TEXT DEFAULT '',
			branch TEXT DEFAULT 'main',
			domain TEXT DEFAULT '',
			description TEXT DEFAULT '',
			auto_deploy BOOLEAN DEFAULT FALSE,
			region TEXT DEFAULT 'fra1',
			instance_type TEXT DEFAULT 'nano',
			build_strategy TEXT DEFAULT 'detect',
			last_deployed_at DATETIME,
			created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS project_members (
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			role TEXT NOT NULL DEFAULT 'viewer',
			added_by INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (project_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`,
		`CREATE TABLE IF NOT EXISTS deployments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			project_name TEXT DEFAULT '',
			status TEXT DEFAULT 'queued',
			commit_sha TEXT DEFAULT '',
			commit_message TEXT DEFAULT '',
			branch TEXT DEFAULT 'main',
			author TEXT DEFAULT '',
			trigger TEXT DEFAULT 'manual',
			framework TEXT DEFAULT '',
			duration INTEGER DEFAULT 0,
			port INTEGER,
			url TEXT DEFAULT '',
			created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS deployment_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			level TEXT DEFAULT 'info',
			message TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
			container TEXT DEFAULT '',
			level TEXT DEFAULT 'info',
			message TEXT NOT NULL,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_logs_project ON runtime_logs(project_id, id)`,
		`CREATE TABLE IF NOT EXISTS env_vars (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			key TEXT NOT NULL,
			value_encrypted TEXT NOT NULL,
			is_secret BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(project_id, key)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id)`,
		`CREATE TABLE IF NOT EXISTS build_file_overrides (
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			file_path TEXT NOT NULL,
			content TEXT DEFAULT '',
			one_shot BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY(project_id, file_path)
		)`,
		`CREATE TABLE IF NOT EXISTS databases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			type TEXT NOT NULL,
			version TEXT DEFAULT '',
			status TEXT DEFAULT 'provisioning',
			region TEXT DEFAULT 'fra1',
			instance_size TEXT DEFAULT 'small',
			host TEXT DEFAULT '',
			port INTEGER,
			host_port INTEGER,
			database_name TEXT DEFAULT 'app',
			username TEXT DEFAULT 'app',
			password_encrypted TEXT DEFAULT '',
			description TEXT DEFAULT '',
			created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_databases_user ON databases(user_id)`,
		`CREATE TABLE IF NOT EXISTS database_connections (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			database_id INTEGER NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			database_name TEXT DEFAULT '',
			database_type TEXT DEFAULT '',
			project_name TEXT DEFAULT '',
			scope TEXT DEFAULT 'all',
			selected_tables TEXT DEFAULT '',
			role TEXT DEFAULT 'primary',
			created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(database_id, project_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_db_connections_database ON database_connections(database_id)`,
		`CREATE INDEX IF NOT EXISTS idx_db_connections_project ON database_connections(project_id)`,
		`CREATE TABLE IF NOT EXISTS project_volumes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			host_path TEXT NOT NULL,
			container_path TEXT NOT NULL,
			kind TEXT DEFAULT 'bind',
			volume_name TEXT DEFAULT '',
			created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_project_volumes_project ON project_volumes(project_id)`,
		`CREATE TABLE IF NOT EXISTS project_ports (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			container_port INTEGER NOT NULL,
			host_port INTEGER,
			protocol TEXT DEFAULT 'tcp',
			label TEXT DEFAULT '',
			is_primary BOOLEAN DEFAULT FALSE,
			created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_project_ports_project ON project_ports(project_id)`,
		`CREATE TABLE IF NOT EXISTS project_triggers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			strategy TEXT DEFAULT 'commit',
			branch TEXT DEFAULT 'main',
			tag_mode TEXT DEFAULT 'pattern',
			tag_pattern TEXT DEFAULT 'v*',
			pre_release BOOLEAN DEFAULT FALSE,
			enabled BOOLEAN DEFAULT TRUE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_project_triggers_project ON project_triggers(project_id)`,
		`CREATE TABLE IF NOT EXISTS project_webhooks (
			project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
			webhook_id INTEGER,
			webhook_secret TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS deploy_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			event_type TEXT DEFAULT '',
			ref TEXT DEFAULT '',
			sha TEXT DEFAULT '',
			matched BOOLEAN DEFAULT FALSE,
			reason TEXT DEFAULT '',
			source TEXT DEFAULT '',
			deployment_id INTEGER,
			trigger_id INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_deploy_events_project ON deploy_events(project_id, id)`,
		// Stateful session tracking for refresh rotation and per-token
		// logout. Access-token revocations live here too, keyed by jti.
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			jti TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at DATETIME NOT NULL,
			revoked BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`,
		`CREATE TABLE IF NOT EXISTS revoked_tokens (
			jti TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id)`,
	}

	for _, m := range migrations {
		if _, err := DB.Exec(m); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}

	columns := []struct {
		table  string
		column string
		ddl    string
	}{
		{"integrations", "label", `ALTER TABLE integrations ADD COLUMN label TEXT DEFAULT ''`},
		{"integrations", "username", `ALTER TABLE integrations ADD COLUMN username TEXT DEFAULT ''`},
		{"integrations", "avatar_url", `ALTER TABLE integrations ADD COLUMN avatar_url TEXT DEFAULT ''`},
		{"integrations", "metadata", `ALTER TABLE integrations ADD COLUMN metadata TEXT DEFAULT '{}'`},
		{"projects", "image", `ALTER TABLE projects ADD COLUMN image TEXT DEFAULT ''`},
		{"projects", "dockerfile_path", `ALTER TABLE projects ADD COLUMN dockerfile_path TEXT DEFAULT ''`},
		{"projects", "compose_path", `ALTER TABLE projects ADD COLUMN compose_path TEXT DEFAULT ''`},
		{"projects", "deploy_type", `ALTER TABLE projects ADD COLUMN deploy_type TEXT DEFAULT 'branch'`},
		{"projects", "deploy_ref", `ALTER TABLE projects ADD COLUMN deploy_ref TEXT DEFAULT ''`},
		{"projects", "port", `ALTER TABLE projects ADD COLUMN port INTEGER`},
		{"projects", "provider", `ALTER TABLE projects ADD COLUMN provider TEXT DEFAULT 'github'`},
		{"projects", "integration_id", `ALTER TABLE projects ADD COLUMN integration_id INTEGER`},
		{"projects", "restart_policy", `ALTER TABLE projects ADD COLUMN restart_policy TEXT DEFAULT 'unless-stopped'`},
		{"projects", "restart_retries", `ALTER TABLE projects ADD COLUMN restart_retries INTEGER`},
		{"projects", "working_dir", `ALTER TABLE projects ADD COLUMN working_dir TEXT DEFAULT ''`},
		{"deploy_events", "trigger_id", `ALTER TABLE deploy_events ADD COLUMN trigger_id INTEGER`},
		{"users", "role", `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'`},
		{"users", "status", `ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`},
		{"users", "deleted_at", `ALTER TABLE users ADD COLUMN deleted_at DATETIME`},
		{"users", "token_version", `ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0`},
		{"invite_codes", "role", `ALTER TABLE invite_codes ADD COLUMN role TEXT DEFAULT 'member'`},
		{"invite_codes", "label", `ALTER TABLE invite_codes ADD COLUMN label TEXT DEFAULT ''`},
		{"invite_codes", "expires_at", `ALTER TABLE invite_codes ADD COLUMN expires_at DATETIME`},
		{"invite_codes", "max_uses", `ALTER TABLE invite_codes ADD COLUMN max_uses INTEGER DEFAULT 1`},
		{"invite_codes", "uses", `ALTER TABLE invite_codes ADD COLUMN uses INTEGER DEFAULT 0`},
		{"invite_codes", "revoked", `ALTER TABLE invite_codes ADD COLUMN revoked BOOLEAN DEFAULT FALSE`},
		{"invite_codes", "created_by", `ALTER TABLE invite_codes ADD COLUMN created_by INTEGER`},
		{"roles", "is_superuser", `ALTER TABLE roles ADD COLUMN is_superuser BOOLEAN DEFAULT FALSE`},
		{"roles", "is_default", `ALTER TABLE roles ADD COLUMN is_default BOOLEAN DEFAULT FALSE`},
		{"roles", "updated_at", `ALTER TABLE roles ADD COLUMN updated_at DATETIME`},
		{"database_connections", "database_name", `ALTER TABLE database_connections ADD COLUMN database_name TEXT DEFAULT ''`},
		{"database_connections", "database_type", `ALTER TABLE database_connections ADD COLUMN database_type TEXT DEFAULT ''`},
		{"database_connections", "project_name", `ALTER TABLE database_connections ADD COLUMN project_name TEXT DEFAULT ''`},
		{"deployments", "deploy_source", `ALTER TABLE deployments ADD COLUMN deploy_source TEXT DEFAULT 'default'`},
		{"deployments", "deploy_ref", `ALTER TABLE deployments ADD COLUMN deploy_ref TEXT DEFAULT ''`},
		{"project_volumes", "kind", `ALTER TABLE project_volumes ADD COLUMN kind TEXT DEFAULT 'bind'`},
		{"project_volumes", "volume_name", `ALTER TABLE project_volumes ADD COLUMN volume_name TEXT DEFAULT ''`},
	}

	for _, c := range columns {
		exists, err := columnExists(c.table, c.column)
		if err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		if exists {
			continue
		}
		if _, err := DB.Exec(c.ddl); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}

	// Build context support. Added once: existing projects are pinned to the
	// repository root ('.') so their builds are unchanged, while the empty
	// string is reserved for "auto" (the Dockerfile's own directory) on
	// projects created after this migration.
	if exists, err := columnExists("projects", "build_context"); err != nil {
		log.Fatalf("Migration failed: %v", err)
	} else if !exists {
		if _, err := DB.Exec(`ALTER TABLE projects ADD COLUMN build_context TEXT DEFAULT ''`); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		if _, err := DB.Exec(`UPDATE projects SET build_context = '.'`); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}

	// Multiple accounts per provider are supported (e.g. several self-hosted
	// Gitea instances), so the legacy UNIQUE(user_id, provider) constraint is
	// dropped by rebuilding the table.
	migrateIntegrationsDropUnique()

	// Every project gets a default data volume. Backfill any created before the
	// project_volumes table existed.
	if _, err := DB.Exec(
		`INSERT INTO project_volumes (project_id, name, host_path, container_path)
		 SELECT id, 'data', 'data', '/app/data' FROM projects
		 WHERE id NOT IN (SELECT project_id FROM project_volumes)`,
	); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}

	// Older installs stored a single strategy per project in project_triggers,
	// including a per-project webhook. Rebuild that table for multiple rules and
	// move the webhook to the project-level project_webhooks table. A project
	// with no trigger rows now means "manual deployments only".
	migrateProjectTriggers()

	// Sessions issued before token_version existed read back as NULL.
	// Coalesce to 0 so they match the legacy GenerateToken version claim
	// instead of failing every comparison.
	if _, err := DB.Exec(`UPDATE users SET token_version = 0 WHERE token_version IS NULL`); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	// Drop naturally-expired revocation/refresh rows left by older runs.
	// Best-effort: a failure here must never block startup. Both layouts
	// are tried because rows may predate the UTC format switch.
	for _, t := range []string{"revoked_tokens", "refresh_tokens"} {
		_, _ = DB.Exec(`DELETE FROM `+t+` WHERE expires_at < datetime('now', '-1 day')`)
	}

	migrateRoleReferences()
	seedRoles()
	backfillRoleReferences()
	seedRolePermissions()
	promoteFirstUserToAdmin()
	recoverSuperuserAccess()
	encryptLegacySecrets()
}

// migrateRoleReferences adds the role_id columns that make user -> role
// assignment a real foreign key instead of a name matched on
// roles.name = users.role. See the column entries above for why the columns are
// nullable.
func migrateRoleReferences() {
	for _, c := range []struct{ table, column, ddl string }{
		{"users", "role_id", `ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id)`},
		{"invite_codes", "role_id", `ALTER TABLE invite_codes ADD COLUMN role_id INTEGER REFERENCES roles(id)`},
		{"roles", "is_archived", `ALTER TABLE roles ADD COLUMN is_archived BOOLEAN DEFAULT FALSE`},
	} {
		exists, err := columnExists(c.table, c.column)
		if err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		if exists {
			continue
		}
		if _, err := DB.Exec(c.ddl); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}

	// Indexed here rather than alongside the CREATE TABLE statements, because
	// those run before the columns above are added.
	for _, idx := range []string{
		`CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id)`,
		`CREATE INDEX IF NOT EXISTS idx_invite_codes_role_id ON invite_codes(role_id)`,
	} {
		if _, err := DB.Exec(idx); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}
}

// backfillRoleReferences populates role_id from the legacy name column for any
// row that has not been migrated yet. It runs on every boot so rows written by
// an older binary during a rolling deploy are picked up, and it repairs users
// whose role name no longer matches any role (a role deleted out from under
// them) by pinning them to the default role instead of leaving them with an
// unresolvable assignment.
func backfillRoleReferences() {
	if _, err := DB.Exec(
		`UPDATE users SET role_id = (SELECT r.id FROM roles r WHERE r.name = users.role)
		 WHERE role_id IS NULL AND role IN (SELECT name FROM roles)`,
	); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	if _, err := DB.Exec(
		`UPDATE invite_codes SET role_id = (SELECT r.id FROM roles r WHERE r.name = invite_codes.role)
		 WHERE role_id IS NULL AND role IN (SELECT name FROM roles)`,
	); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}

	// A user pinned to a role that no longer exists would silently resolve to
	// zero permissions. Move them to the default role and record it.
	//
	// Both columns must be written. Resolution prefers role_id, so leaving the
	// legacy name stale would still work today, but the two disagreeing is
	// exactly the failure mode this migration exists to remove: any older
	// binary, or any future code path that consults the name, would resolve
	// these users to a role that does not exist.
	orphaned, err := orphanedUserCount()
	if err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	if orphaned > 0 {
		log.Printf("Repairing %d user(s) with a missing role assignment", orphaned)
		if _, err := DB.Exec(
			`UPDATE users SET
				role = COALESCE((SELECT r.name FROM roles r WHERE r.is_default = TRUE
					ORDER BY r.id ASC LIMIT 1), role),
				role_id = (SELECT r.id FROM roles r WHERE r.is_default = TRUE
					ORDER BY r.id ASC LIMIT 1)
			 WHERE role_id IS NULL
			   AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = users.role)`,
		); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}
}

func orphanedUserCount() (int, error) {
	var n int
	err := DB.QueryRow(
		`SELECT COUNT(*) FROM users u
		 WHERE u.role_id IS NULL
		   AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = u.role)
		   AND EXISTS (SELECT 1 FROM roles r WHERE r.is_default = TRUE)`,
	).Scan(&n)
	return n, err
}

// encryptLegacySecrets encrypts secrets that were written before encryption at
// rest was enabled (integration tokens, database passwords and env var values).
// Best-effort: a failure to encrypt one row never blocks startup.
func encryptLegacySecrets() {
	cols := []struct{ table, id, col string }{
		{"env_vars", "id", "value_encrypted"},
		{"integrations", "id", "access_token"},
		{"databases", "id", "password_encrypted"},
	}
	for _, c := range cols {
		rows, err := DB.Query(fmt.Sprintf("SELECT %s, %s FROM %s", c.id, c.col, c.table))
		if err != nil {
			continue
		}
		type row struct {
			id  int64
			val string
		}
		var pending []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.val); err != nil {
				continue
			}
			if r.val == "" || auth.IsEncrypted(r.val) {
				continue
			}
			pending = append(pending, r)
		}
		rows.Close()
		for _, r := range pending {
			enc, err := auth.EncryptToken(r.val)
			if err != nil {
				log.Printf("Failed to encrypt %s.%s for id %d: %v", c.table, c.col, r.id, err)
				continue
			}
			if _, err := DB.Exec(fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", c.table, c.col, c.id), enc, r.id); err != nil {
				log.Printf("Failed to store encrypted %s.%s for id %d: %v", c.table, c.col, r.id, err)
			}
		}
	}
}

// seedRoles ensures the built-in roles exist. Roles are stored in their own
// table so additional roles can be created at runtime; the three built-ins are
// only inserted when missing.
func seedRoles() {
	roles := []struct {
		name string
		desc string
	}{
		{"admin", "Full access including the admin panel"},
		{"member", "Full access to their own resources"},
		{"viewer", "Read-only access"},
	}
	for _, role := range roles {
		if _, err := DB.Exec(
			"INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)",
			role.name, role.desc,
		); err != nil {
			log.Fatalf("Failed to seed roles: %v", err)
		}
	}

	// The admin role is the immutable superuser; member is the default role for
	// new registrations. Flags are set idempotently so a rename survives.
	if _, err := DB.Exec("UPDATE roles SET is_superuser = TRUE WHERE name = 'admin'"); err != nil {
		log.Fatalf("Failed to seed roles: %v", err)
	}
	if _, err := DB.Exec(
		"UPDATE roles SET is_default = TRUE WHERE name = 'member' AND NOT EXISTS (SELECT 1 FROM roles WHERE is_default = TRUE)",
	); err != nil {
		log.Fatalf("Failed to seed roles: %v", err)
	}
}

// seedRolePermissions gives the built-in member and viewer roles sensible
// defaults the first time the permission system is installed (empty table).
// The admin role is a superuser and needs no rows. Existing installs therefore
// keep their current behaviour; later edits are never overwritten.
func seedRolePermissions() {
	var count int
	if err := DB.QueryRow("SELECT COUNT(*) FROM role_permissions").Scan(&count); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	if count > 0 {
		return
	}

	seed := func(role string, perms []string) {
		var id int64
		if err := DB.QueryRow("SELECT id FROM roles WHERE name = ?", role).Scan(&id); err != nil {
			return
		}
		for _, p := range perms {
			if _, err := DB.Exec(
				"INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)", id, p,
			); err != nil {
				log.Fatalf("Failed to seed role permissions: %v", err)
			}
		}
	}
	seed("member", permissions.MemberDefaults())
	seed("viewer", permissions.ViewerDefaults())
}

// promoteFirstUserToAdmin guarantees the instance always has at least one admin.
// On a fresh install the first registered user is promoted at registration; on
// an existing install (created before roles existed) the oldest user is
// promoted here so the instance is never locked out of the admin panel.
//
// It counts superusers through role_id rather than the literal name 'admin' so
// a renamed superuser role is still recognised, and writes both columns so the
// name-based fallback stays in sync.
func promoteFirstUserToAdmin() {
	if countSuperusers() > 0 {
		return
	}

	var id int64
	if err := DB.QueryRow("SELECT id FROM users ORDER BY id ASC LIMIT 1").Scan(&id); err != nil {
		// No users yet — the first registration will become admin.
		return
	}
	promoteToSuperuserRole(id, "first user")
}

// countSuperusers reports how many active users hold a superuser role.
func countSuperusers() int {
	var n int
	DB.QueryRow(
		`SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
		 WHERE r.is_superuser = TRUE AND u.status = 'active'`,
	).Scan(&n)
	return n
}

// promoteToSuperuserRole assigns the superuser role to a user, writing both the
// role_id reference and the legacy name column.
func promoteToSuperuserRole(userID int64, reason string) {
	var roleID int64
	var name string
	if err := DB.QueryRow(
		`SELECT id, name FROM roles WHERE is_superuser = TRUE ORDER BY id ASC LIMIT 1`,
	).Scan(&roleID, &name); err != nil {
		log.Printf("Cannot promote user %d: no superuser role exists", userID)
		return
	}
	if _, err := DB.Exec(
		`UPDATE users SET role_id = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		roleID, name, userID,
	); err != nil {
		log.Printf("Cannot promote user %d: %v", userID, err)
		return
	}
	log.Printf("Promoted user %d to superuser role %q (%s)", userID, name, reason)
}

// recoverSuperuserAccess is the escape hatch for an instance that has lost every
// superuser, which the last-superuser guard makes possible to reach through
// ordinary role changes. Setting NINETEEN_BOOTSTRAP_ADMIN to a username grants
// that account the superuser role on the next boot. It is a no-op whenever the
// instance already has an active superuser, so leaving it set is harmless.
//
// This is deliberately env-only: it is not reachable from the API, so it cannot
// be used to escalate over a healthy instance.
func recoverSuperuserAccess() {
	username := strings.TrimSpace(os.Getenv("NINETEEN_BOOTSTRAP_ADMIN"))
	if username == "" {
		return
	}
	if countSuperusers() > 0 {
		log.Printf("NINETEEN_BOOTSTRAP_ADMIN is set but the instance already has an active superuser; ignoring")
		return
	}
	var id int64
	if err := DB.QueryRow(
		`SELECT id FROM users WHERE username = ? AND status = 'active'`, username,
	).Scan(&id); err != nil {
		log.Printf("NINETEEN_BOOTSTRAP_ADMIN=%q did not match an active account; cannot recover admin access", username)
		return
	}
	promoteToSuperuserRole(id, "NINETEEN_BOOTSTRAP_ADMIN recovery")
}

// migrateProjectTriggers upgrades the original one-trigger-per-project schema to
// the multi-rule schema. The presence of the legacy webhook_id column marks an
// un-migrated table, so this is safe to run on every boot.
func migrateProjectTriggers() {
	exists, err := columnExists("project_triggers", "webhook_id")
	if err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	if !exists {
		return
	}

	if _, err := DB.Exec(
		`INSERT OR REPLACE INTO project_webhooks (project_id, webhook_id, webhook_secret)
		 SELECT project_id, webhook_id, webhook_secret FROM project_triggers
		 WHERE webhook_id IS NOT NULL AND webhook_id > 0`,
	); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}

	steps := []string{
		`CREATE TABLE project_triggers_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			strategy TEXT DEFAULT 'commit',
			branch TEXT DEFAULT 'main',
			tag_mode TEXT DEFAULT 'pattern',
			tag_pattern TEXT DEFAULT 'v*',
			pre_release BOOLEAN DEFAULT FALSE,
			enabled BOOLEAN DEFAULT TRUE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO project_triggers_new (id, project_id, strategy, branch, tag_mode, tag_pattern, pre_release, enabled, created_at, updated_at)
		 SELECT id, project_id, strategy, branch, tag_mode, tag_pattern, pre_release, enabled, created_at, updated_at
		 FROM project_triggers WHERE strategy != 'manual'`,
		`DROP TABLE project_triggers`,
		`ALTER TABLE project_triggers_new RENAME TO project_triggers`,
		`CREATE INDEX IF NOT EXISTS idx_project_triggers_project ON project_triggers(project_id)`,
	}
	for _, s := range steps {
		if _, err := DB.Exec(s); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}
}

// migrateIntegrationsDropUnique rebuilds the integrations table without the
// original UNIQUE(user_id, provider) constraint so a user can connect more than
// one account per provider (notably multiple self-hosted Gitea instances).
// SQLite cannot drop a constraint in place, so the table is recreated and its
// rows copied. The presence of a unique index over (user_id, provider) marks an
// un-migrated table, making this safe to run on every boot.
func migrateIntegrationsDropUnique() {
	needsRebuild := false
	for _, name := range uniqueIndexes("integrations") {
		cols := indexColumns(name)
		if len(cols) == 2 && cols[0] == "user_id" && cols[1] == "provider" {
			needsRebuild = true
			break
		}
	}
	if !needsRebuild {
		return
	}

	steps := []string{
		`CREATE TABLE integrations_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			provider TEXT NOT NULL,
			label TEXT DEFAULT '',
			username TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			access_token TEXT DEFAULT '',
			config TEXT DEFAULT '{}',
			metadata TEXT DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO integrations_new (id, user_id, provider, label, username, avatar_url, access_token, config, metadata, created_at, updated_at)
		 SELECT id, user_id, provider, label, username, avatar_url, access_token, config, metadata, created_at, updated_at FROM integrations`,
		`DROP TABLE integrations`,
		`ALTER TABLE integrations_new RENAME TO integrations`,
	}
	for _, s := range steps {
		if _, err := DB.Exec(s); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}
}

// uniqueIndexes returns the names of the table's UNIQUE constraint indexes.
func uniqueIndexes(table string) []string {
	rows, err := DB.Query(fmt.Sprintf("PRAGMA index_list(%s)", table))
	if err != nil {
		return nil
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var seq, unique, partial int
		var name, origin string
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return names
		}
		if unique == 1 && origin == "u" {
			names = append(names, name)
		}
	}
	return names
}

// indexColumns returns the column names an index covers, in order.
func indexColumns(index string) []string {
	rows, err := DB.Query(fmt.Sprintf("PRAGMA index_info(%s)", index))
	if err != nil {
		return nil
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var seqno, cid int
		var name string
		if err := rows.Scan(&seqno, &cid, &name); err != nil {
			return cols
		}
		cols = append(cols, name)
	}
	return cols
}

func columnExists(table, column string) (bool, error) {
	rows, err := DB.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	exists := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype, dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name.String == column {
			exists = true
			break
		}
	}

	return exists, rows.Err()
}

func seedInviteCode() {
	code := os.Getenv("INVITE_CODE")
	if code == "" {
		log.Println("No INVITE_CODE set, skipping seed")
		return
	}

	var exists bool
	err := DB.QueryRow("SELECT EXISTS(SELECT 1 FROM invite_codes WHERE code = ?)", code).Scan(&exists)
	if err != nil {
		log.Fatalf("Failed to check invite code: %v", err)
	}

	if !exists {
		_, err := DB.Exec("INSERT INTO invite_codes (code) VALUES (?)", code)
		if err != nil {
			log.Fatalf("Failed to seed invite code: %v", err)
		}
		log.Printf("Seeded invite code: %s", code)
	}
}

func Close() {
	if DB != nil {
		DB.Close()
	}
}
