package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"nineteen-server/db"
	"nineteen-server/models"
)

func insertDatabase(t *testing.T, userID int64, name string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO databases (user_id, name, slug, type) VALUES (?, ?, ?, 'postgresql')`,
		userID, name, name+"-slug")
	if err != nil {
		t.Fatalf("insert database: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func insertProject(t *testing.T, userID int64, name string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO projects (user_id, name, slug) VALUES (?, ?, ?)`,
		userID, name, name+"-slug")
	if err != nil {
		t.Fatalf("insert project: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

// TestBulkCreateIgnoresBodyDatabaseID is the regression test for the IDOR:
// project_id is ownership-checked but database_id used to come verbatim from
// the request body, letting a caller plant a connection row pointing at
// another tenant's database. The path database (ownership-checked by the
// caller) is now authoritative.
func TestBulkCreateIgnoresBodyDatabaseID(t *testing.T) {
	victimID, _ := insertUser(t, "member")
	attackerID, attackerToken := insertUser(t, "member")

	victimDB := insertDatabase(t, victimID, "victimdb"+strconv.Itoa(nextID()))
	attackerDB := insertDatabase(t, attackerID, "attackerdb"+strconv.Itoa(nextID()))
	attackerProject := insertProject(t, attackerID, "attackerproj"+strconv.Itoa(nextID()))

	w := do(t, DatabaseConnectionsForHandler, http.MethodPost,
		"/api/databases/"+strconv.FormatInt(attackerDB, 10)+"/connections",
		attackerToken, []map[string]interface{}{
			{
				"database_id": victimDB, // forged: another tenant's database
				"project_id":  attackerProject,
				"scope":       "all",
			},
		})
	if w.Code != http.StatusCreated {
		t.Fatalf("bulk create: %d %s", w.Code, w.Body.String())
	}
	var created []models.DatabaseConnection
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(created) != 1 {
		t.Fatalf("expected 1 connection, got %d: %s", len(created), w.Body.String())
	}
	if created[0].DatabaseID != attackerDB {
		t.Fatalf("cross-tenant link created: database_id=%d, want path db %d",
			created[0].DatabaseID, attackerDB)
	}

	var n int
	if err := db.DB.QueryRow(
		`SELECT COUNT(*) FROM database_connections WHERE database_id = ?`, victimDB,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("found %d row(s) referencing victim database %d", n, victimDB)
	}
}

// TestBulkCreateWithoutDatabaseID covers the legitimate frontend shape:
// items carry no database_id and inherit the path database.
func TestBulkCreateWithoutDatabaseID(t *testing.T) {
	uid, token := insertUser(t, "member")
	dbID := insertDatabase(t, uid, "mydb"+strconv.Itoa(nextID()))
	projID := insertProject(t, uid, "myproj"+strconv.Itoa(nextID()))

	w := do(t, DatabaseConnectionsForHandler, http.MethodPost,
		"/api/databases/"+strconv.FormatInt(dbID, 10)+"/connections",
		token, []map[string]interface{}{
			{"project_id": projID, "scope": "all"},
		})
	if w.Code != http.StatusCreated {
		t.Fatalf("bulk create: %d %s", w.Code, w.Body.String())
	}
	var created []models.DatabaseConnection
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(created) != 1 || created[0].DatabaseID != dbID || created[0].ProjectID != projID {
		t.Fatalf("unexpected connections: %+v", created)
	}
}

// TestDatabaseConnectionURIEncodesPassword guards against a user-supplied
// password containing reserved characters corrupting the one-time connection
// URI (which is then copied straight into a client).
func TestDatabaseConnectionURIEncodesPassword(t *testing.T) {
	pw := "p@ss:w/rd"
	got := databaseConnectionURI("app", pw, "app", 54321)
	if strings.Contains(got, pw) {
		t.Fatalf("password not percent-encoded: %q", got)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse uri: %v", err)
	}
	if u.Scheme != "postgres" || u.Host != "127.0.0.1:54321" || u.Path != "/app" {
		t.Fatalf("unexpected uri parts: %q", got)
	}
	if gotPw, _ := u.User.Password(); gotPw != pw {
		t.Fatalf("round-trip password = %q, want %q", gotPw, pw)
	}
}

// TestCreateDatabaseRejectsShortPassword covers user-supplied password
// validation. It returns before any port reservation or Docker call.
func TestCreateDatabaseRejectsShortPassword(t *testing.T) {
	_, token := insertUser(t, "member")
	w := do(t, DatabasesHandler, http.MethodPost, "/api/databases", token,
		map[string]interface{}{"name": "shortpwdb", "password": "short"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("short password create: got %d %s", w.Code, w.Body.String())
	}
}

// TestResetPasswordRejectsShortPassword covers the reset endpoint's validation,
// which also returns before touching the container.
func TestResetPasswordRejectsShortPassword(t *testing.T) {
	uid, token := insertUser(t, "member")
	dbID := insertDatabase(t, uid, "pwreset"+strconv.Itoa(nextID()))
	w := do(t, DatabaseCredentialsHandler, http.MethodPost,
		"/api/databases/"+strconv.FormatInt(dbID, 10)+"/credentials", token,
		map[string]string{"password": "short"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("short password reset: got %d %s", w.Code, w.Body.String())
	}
}
