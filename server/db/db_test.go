package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// freshDB initialises a brand new migrated database and points the package
// global at it. Each test gets its own file so migrations run from scratch, and
// the connection is closed on cleanup so the temp directory can be removed.
func freshDB(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	Init(path)
	t.Cleanup(func() {
		if DB != nil {
			DB.Close()
		}
	})
	return path
}

// reinit closes the current connection and reopens the same file, which is what
// a real process restart does. The first handle is closed explicitly so the
// temp directory is not left locked on Windows.
func reinit(t *testing.T, path string) {
	t.Helper()
	if DB != nil {
		DB.Close()
	}
	Init(path)
}

// insertUser writes an account. roleID may be nil to simulate a row written by
// a binary from before the role_id foreign key existed.
func insertUser(t *testing.T, username, roleName string, roleID *int64) {
	t.Helper()
	var idArg interface{}
	if roleID != nil {
		idArg = *roleID
	}
	var nameArg interface{} = roleName
	if roleID != nil {
		nameArg = roleName
	}
	if _, err := DB.Exec(
		`INSERT INTO users (username, email, password_hash, role, role_id, status)
		 VALUES (?, ?, 'x', ?, ?, 'active')`,
		username, username+"@test.invalid", nameArg, idArg); err != nil {
		t.Fatalf("insert %s: %v", username, err)
	}
}

func roleIDByName(t *testing.T, name string) int64 {
	t.Helper()
	var id int64
	if err := DB.QueryRow(`SELECT id FROM roles WHERE name = ?`, name).Scan(&id); err != nil {
		t.Fatalf("role %q: %v", name, err)
	}
	return id
}

func superuserRoleID(t *testing.T) int64 {
	t.Helper()
	var id int64
	if err := DB.QueryRow(`SELECT id FROM roles WHERE is_superuser = TRUE LIMIT 1`).Scan(&id); err != nil {
		t.Fatalf("no superuser role: %v", err)
	}
	return id
}

func clearSuperusers(t *testing.T) {
	t.Helper()
	member := roleIDByName(t, "member")
	if _, err := DB.Exec(
		`UPDATE users SET role_id = ?, role = 'member'
		 WHERE role_id IN (SELECT id FROM roles WHERE is_superuser = TRUE)`, member,
	); err != nil {
		t.Fatalf("clear superusers: %v", err)
	}
}

func TestMigrationAddsRoleColumns(t *testing.T) {
	freshDB(t)
	for _, c := range []struct{ table, column string }{
		{"users", "role_id"},
		{"invite_codes", "role_id"},
		{"roles", "is_archived"},
	} {
		ok, err := columnExists(c.table, c.column)
		if err != nil {
			t.Fatalf("columnExists(%s.%s): %v", c.table, c.column, err)
		}
		if !ok {
			t.Errorf("migration did not add %s.%s", c.table, c.column)
		}
	}
}

func TestIndexesExistForRoleReferences(t *testing.T) {
	freshDB(t)
	rows, err := DB.Query(`SELECT name FROM sqlite_master WHERE type = 'index'`)
	if err != nil {
		t.Fatalf("list indexes: %v", err)
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var n string
		if rows.Scan(&n) == nil {
			found[n] = true
		}
	}
	for _, want := range []string{"idx_users_role_id", "idx_invite_codes_role_id"} {
		if !found[want] {
			t.Errorf("index %s was not created", want)
		}
	}
}

// TestBackfillResolvesLegacyRows is the backward-compatibility guarantee: a row
// carrying only the legacy name column is repaired on the next boot.
func TestBackfillResolvesLegacyRows(t *testing.T) {
	path := freshDB(t)
	// A superuser must already exist, otherwise the first-user promotion (which
	// runs after the backfill) would claim the legacy row and the assertion
	// below would be measuring the wrong thing.
	su := superuserRoleID(t)
	insertUser(t, "root", "admin", &su)
	insertUser(t, "legacy", "member", nil)

	var before interface{}
	if err := DB.QueryRow(`SELECT role_id FROM users WHERE username = 'legacy'`).Scan(&before); err != nil {
		t.Fatalf("read role_id: %v", err)
	}
	if before != nil {
		t.Fatal("expected role_id to start NULL for a legacy row")
	}

	// Re-running the migrations is what a real restart does.
	reinit(t, path)

	var after sql.NullInt64
	if err := DB.QueryRow(`SELECT role_id FROM users WHERE username = 'legacy'`).Scan(&after); err != nil {
		t.Fatalf("read role_id: %v", err)
	}
	if !after.Valid {
		t.Fatal("legacy row was not backfilled with a role_id reference")
	}
	if int64(after.Int64) != roleIDByName(t, "member") {
		t.Fatalf("backfilled role_id is %d, want the member role", after.Int64)
	}
}

// TestBackfillRepairsOrphanedUsers covers a user whose role was deleted out from
// under them before this migration existed. They must land somewhere real rather
// than silently resolving to no permissions.
func TestBackfillRepairsOrphanedUsers(t *testing.T) {
	path := freshDB(t)
	// A superuser already exists, so the first-user promotion does not claim the
	// orphan and the assertion below is about the repair specifically.
	su := superuserRoleID(t)
	insertUser(t, "root", "admin", &su)
	// A role name that no longer resolves to any role, and one with no name.
	insertUser(t, "ghost", "deleted-role", nil)
	insertUser(t, "blank", "", nil)

	reinit(t, path)

	for _, username := range []string{"ghost", "blank"} {
		var after sql.NullInt64
		if err := DB.QueryRow(`SELECT role_id FROM users WHERE username = ?`, username).Scan(&after); err != nil {
			t.Fatalf("read role_id: %v", err)
		}
		if !after.Valid {
			t.Fatalf("%s was not repaired", username)
		}
		if int64(after.Int64) != roleIDByName(t, "member") {
			t.Fatalf("%s was moved to role %d, want the default role", username, after.Int64)
		}
	}
}

// TestBackfillKeepsLegacyNameInStep is the regression test for a bug this
// migration originally had: it repaired the role_id reference but left the
// legacy role name stale. Resolution prefers role_id, so those users kept
// working, but the two columns disagreed — which is precisely the divergence the
// migration exists to remove, since any older binary, or any future reader of
// the name column, would resolve them to a role that does not exist.
//
// Keeping the name in step on an ordinary role rename is the application's job
// (authz.UpdateRole, covered by the authz suite) rather than a trigger, so it is
// deliberately not asserted here.
func TestBackfillKeepsLegacyNameInStep(t *testing.T) {
	path := freshDB(t)
	su := superuserRoleID(t)
	insertUser(t, "root", "admin", &su)
	insertUser(t, "ghost", "deleted-role", nil)

	reinit(t, path)

	var legacy string
	if err := DB.QueryRow(`SELECT role FROM users WHERE username = 'ghost'`).Scan(&legacy); err != nil {
		t.Fatalf("read legacy role: %v", err)
	}
	if legacy != "member" {
		t.Fatalf("legacy role column is %q, want it repaired to %q as well", legacy, "member")
	}
}

// TestForeignKeyBlocksOrphaning is the property the redesign rests on: a user
// cannot be left pointing at a role that does not exist.
func TestForeignKeyBlocksOrphaning(t *testing.T) {
	freshDB(t)
	member := roleIDByName(t, "member")
	insertUser(t, "fkuser", "member", &member)

	if _, err := DB.Exec(`UPDATE users SET role_id = 999999 WHERE username = 'fkuser'`); err == nil {
		t.Fatal("the foreign key allowed a user to reference a nonexistent role")
	}
	if _, err := DB.Exec(`DELETE FROM roles WHERE id = ?`, member); err == nil {
		t.Fatal("a role with members was deleted, orphaning its users")
	}
}

func TestRolePermissionsCascadeOnDelete(t *testing.T) {
	freshDB(t)
	res, err := DB.Exec(
		`INSERT INTO roles (name, is_superuser, is_default, is_archived)
		 VALUES ('cascade-test', FALSE, FALSE, FALSE)`)
	if err != nil {
		t.Fatalf("insert role: %v", err)
	}
	id, _ := res.LastInsertId()
	if _, err := DB.Exec(
		`INSERT INTO role_permissions (role_id, permission) VALUES (?, 'projects.read')`, id,
	); err != nil {
		t.Fatalf("insert permission: %v", err)
	}

	if _, err := DB.Exec(`DELETE FROM roles WHERE id = ?`, id); err != nil {
		t.Fatalf("delete role: %v", err)
	}
	var n int
	DB.QueryRow(`SELECT COUNT(*) FROM role_permissions WHERE role_id = ?`, id).Scan(&n)
	if n != 0 {
		t.Fatalf("%d permission row(s) survived the role deletion", n)
	}
}

// ---- superuser recovery ----

func TestBootstrapAdminRecoversLostAccess(t *testing.T) {
	freshDB(t)
	defer os.Unsetenv("NINETEEN_BOOTSTRAP_ADMIN")
	clearSuperusers(t)

	su := superuserRoleID(t)
	insertUser(t, "alice", "member", memberPtr(t))
	if countSuperusers() != 0 {
		t.Fatal("test setup left a superuser in place")
	}
	_ = su

	os.Setenv("NINETEEN_BOOTSTRAP_ADMIN", "alice")
	recoverSuperuserAccess()

	if countSuperusers() != 1 {
		t.Fatalf("expected 1 superuser after recovery, got %d", countSuperusers())
	}
	var roleName string
	if err := DB.QueryRow(`SELECT role FROM users WHERE username = 'alice'`).Scan(&roleName); err != nil {
		t.Fatalf("read role: %v", err)
	}
	if roleName != "admin" {
		t.Fatalf("recovered user has role %q, want the superuser role name", roleName)
	}
}

func TestBootstrapAdminIsIdempotent(t *testing.T) {
	freshDB(t)
	defer os.Unsetenv("NINETEEN_BOOTSTRAP_ADMIN")
	clearSuperusers(t)
	insertUser(t, "alice", "member", memberPtr(t))

	os.Setenv("NINETEEN_BOOTSTRAP_ADMIN", "alice")
	recoverSuperuserAccess()
	recoverSuperuserAccess()

	if countSuperusers() != 1 {
		t.Fatalf("repeated recovery produced %d superusers", countSuperusers())
	}
}

func TestBootstrapAdminIsNoOpWhenSuperuserExists(t *testing.T) {
	freshDB(t)
	defer os.Unsetenv("NINETEEN_BOOTSTRAP_ADMIN")

	// A superuser already exists, so leaving the env var set must be harmless:
	// it cannot be used to promote somebody else over a healthy instance.
	su := superuserRoleID(t)
	insertUser(t, "root", "admin", &su)
	insertUser(t, "alice", "member", memberPtr(t))
	before := countSuperusers()

	os.Setenv("NINETEEN_BOOTSTRAP_ADMIN", "alice")
	recoverSuperuserAccess()

	if countSuperusers() != before {
		t.Fatalf("recovery changed the superuser count from %d to %d", before, countSuperusers())
	}
}

func TestBootstrapAdminIgnoresUnknownUser(t *testing.T) {
	freshDB(t)
	defer os.Unsetenv("NINETEEN_BOOTSTRAP_ADMIN")
	clearSuperusers(t)
	insertUser(t, "alice", "member", memberPtr(t))

	os.Setenv("NINETEEN_BOOTSTRAP_ADMIN", "does-not-exist")
	recoverSuperuserAccess()

	if countSuperusers() != 0 {
		t.Fatal("recovery promoted an account that did not match the env var")
	}
}

func TestPromoteFirstUserToAdminRecognisesRenamedSuperuserRole(t *testing.T) {
	freshDB(t)
	// The guard counts superusers through is_superuser, not the literal name
	// 'admin', so a renamed superuser role still counts and nobody is promoted.
	if _, err := DB.Exec(`UPDATE roles SET name = 'root-role' WHERE is_superuser = TRUE`); err != nil {
		t.Fatalf("rename: %v", err)
	}
	member := *memberPtr(t)
	insertUser(t, "only", "member", &member)

	su := superuserRoleID(t)
	insertUser(t, "boss", "root-role", &su)
	before := countSuperusers()

	promoteFirstUserToAdmin()

	if countSuperusers() != before {
		t.Fatalf("a second account was promoted even though a superuser existed")
	}
}

// memberPtr returns the member role id by address, for fixture inserts.
func memberPtr(t *testing.T) *int64 {
	t.Helper()
	id := roleIDByName(t, "member")
	return &id
}
