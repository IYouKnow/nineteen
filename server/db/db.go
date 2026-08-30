package db

import (
	"database/sql"
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
	}

	for _, m := range migrations {
		if _, err := DB.Exec(m); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}
}

func seedInviteCode() {
	code := os.Getenv("INVITE_CODE")
	if code == "" {
		code = "nexuscore-invite-2026"
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
