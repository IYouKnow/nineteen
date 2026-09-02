package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func Init(dbPath string) {
	var err error
	DB, err = sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	runMigrations()
	seedInviteCode()
	log.Println("Database initialized successfully")
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
		`CREATE TABLE IF NOT EXISTS invite_codes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT UNIQUE NOT NULL,
			used BOOLEAN DEFAULT FALSE,
			used_by INTEGER REFERENCES users(id),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
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
		{"projects", "dockerfile_path", `ALTER TABLE projects ADD COLUMN dockerfile_path TEXT DEFAULT ''`},
		{"projects", "compose_path", `ALTER TABLE projects ADD COLUMN compose_path TEXT DEFAULT ''`},
		{"projects", "port", `ALTER TABLE projects ADD COLUMN port INTEGER`},
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
