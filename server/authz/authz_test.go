package authz

import (
	"errors"
	"os"
	"strconv"
	"testing"

	"nineteen-server/auth"
	"nineteen-server/db"
)

// The suite runs against a real migrated SQLite database rather than a mock, so
// the foreign keys, the unique constraints and the backfill migration are all
// exercised for real. That matters here: the whole point of the redesign is
// that integrity is enforced by the schema, and a mock would not test it.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "nineteen-authz-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)

	// No secrets are needed: nothing under test mints a token.
	os.Setenv("JWT_SECRET", "test-secret-for-authz-suite-only")
	os.Setenv("NINETEEN_DATA_DIR", dir)
	db.Init(dir + "/test.db")

	code := m.Run()
	if code != 0 {
		os.Exit(code)
	}
}

// ---- fixtures ----

var nextFixture int

func fixtureID() int {
	nextFixture++
	return nextFixture
}

// hash is a throwaway password hash; nothing in this suite verifies a password,
// it just has to satisfy the NOT NULL column.
func hash(t *testing.T) string {
	t.Helper()
	h, err := auth.HashPassword("irrelevant-for-this-suite")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	return h
}

// makeRole inserts a role straight into the database rather than going through
// CreateRole. Fixtures must not depend on the authorization logic they are
// used to exercise, so they bypass it deliberately. Permissions are validated
// here only to the extent of rejecting the global wildcard, which the schema
// does not itself forbid.
func makeRole(t *testing.T, name string, perms ...string) Role {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO roles (name, description, is_superuser, is_default, is_archived)
		 VALUES (?, '', FALSE, FALSE, FALSE)`, name)
	if err != nil {
		t.Fatalf("insert role %s: %v", name, err)
	}
	id, _ := res.LastInsertId()
	for _, p := range perms {
		if _, err := db.DB.Exec(
			`INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)`,
			id, p); err != nil {
			t.Fatalf("grant %s to %s: %v", p, name, err)
		}
	}
	return Role{ID: id, Name: name, Permissions: perms}
}

// makeUser inserts an account with both the role_id reference and the legacy
// name column set, the way every write path in the package does it.
func makeUser(t *testing.T, username, roleName string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO users (username, email, password_hash, display_name, role, role_id, status)
		 VALUES (?, ?, ?, '', ?, (SELECT id FROM roles WHERE name = ?), 'active')`,
		username, username+"@test.invalid", hash(t), roleName, roleName)
	if err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
	id, _ := res.LastInsertId()
	return id
}

// superuserRole is the seeded admin role.
func superuserRole(t *testing.T) Role {
	t.Helper()
	r, ok := SuperuserRole()
	if !ok {
		t.Fatal("no superuser role seeded")
	}
	return r
}

// newSuperuser returns the id of a fresh account holding the superuser role.
func newSuperuser(t *testing.T) int64 {
	t.Helper()
	su := superuserRole(t)
	return makeUser(t, "root"+strconv.Itoa(fixtureID()), su.Name)
}

// newManager returns the id of a delegated role manager: full control over
// roles and users, but no superuser. This is the account the original
// privilege-escalation report was about.
func newManager(t *testing.T) int64 {
	t.Helper()
	name := "rolemgr" + strconv.Itoa(fixtureID())
	mgr := makeRole(t, name, "admin.roles.read", "admin.roles.manage",
		"admin.users.read", "admin.users.manage")
	return makeUser(t, name, mgr.Name)
}

// ---- the original vulnerability ----

// TestDelegatedManagerCannotEscalateViaRoleReassignment is the regression test
// for the reported bug. The original deleteRole accepted ?replacement_role_id=
// and wrote the resolved name straight into users.role, so a caller holding
// only admin.roles.manage could promote every member of any role to the
// superuser role. ReassignMembers is the explicit replacement for that
// behaviour and must be closed to the same caller.
func TestDelegatedManagerCannotEscalateViaRoleReassignment(t *testing.T) {
	manager := newManager(t)
	su := superuserRole(t)

	// A role with members, which is what made the original bug reachable.
	victimRole := makeRole(t, "victim"+strconv.Itoa(fixtureID()))
	victim := makeUser(t, "victim"+strconv.Itoa(fixtureID()), victimRole.Name)

	_, err := ReassignMembers(manager, victimRole.ID, su.ID)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("delegated manager reassigned members into the superuser role: err = %v", err)
	}

	// The victim must still be where they were.
	got, ok := RoleForUser(victim)
	if !ok {
		t.Fatal("victim lost their role entirely")
	}
	if got.ID != victimRole.ID {
		t.Fatalf("victim role changed to %q; escalation succeeded", got.Name)
	}
	if IsSuperuser(victim) {
		t.Fatal("victim became a superuser; escalation succeeded")
	}
}

// TestDelegatedManagerCannotEscalateViaAssignRole covers the sibling path: the
// user-update endpoint, which did have a guard, must keep it.
func TestDelegatedManagerCannotEscalateViaAssignRole(t *testing.T) {
	manager := newManager(t)
	target := makeUser(t, "target"+strconv.Itoa(fixtureID()), "member")
	su := superuserRole(t)

	if err := AssignRole(manager, target, su.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delegated manager assigned the superuser role: err = %v", err)
	}
	if IsSuperuser(target) {
		t.Fatal("target became a superuser")
	}
}

// TestDelegatedManagerCannotEscalateViaInvite covers the third path into the
// same state: an invite that mints an admin account.
func TestDelegatedManagerCannotEscalateViaInvite(t *testing.T) {
	manager := newManager(t)
	su := superuserRole(t)

	if _, _, err := SetInviteRole(manager, su.Name); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delegated manager minted an invite for the superuser role: err = %v", err)
	}
}

// TestDelegatedManagerCannotEditSuperuserRole covers the rename path, which
// could otherwise be used to strand a superuser account.
func TestDelegatedManagerCannotEditSuperuserRole(t *testing.T) {
	manager := newManager(t)
	su := superuserRole(t)

	name := "renamed" + strconv.Itoa(fixtureID())
	if _, err := UpdateRole(manager, su.ID, UpdateRoleInput{Name: &name}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delegated manager renamed the superuser role: err = %v", err)
	}

	archived := true
	if _, err := SetArchived(manager, su.ID, archived); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delegated manager archived the superuser role: err = %v", err)
	}

	if err := DeleteRole(manager, su.ID); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("delegated manager deleted the superuser role: err = %v", err)
	}
}

// TestSuperuserRoleIsProtected pins the protected-role invariants that apply to
// superusers too, not just to delegated managers. The superuser role is the
// root of trust: if it can be renamed, archived, deleted or made the default
// role, the invariants the rest of the package relies on stop holding.
func TestSuperuserRoleIsProtected(t *testing.T) {
	root := newSuperuser(t)
	su := superuserRole(t)

	renamed := "admin2" + strconv.Itoa(fixtureID())
	if _, err := UpdateRole(root, su.ID, UpdateRoleInput{Name: &renamed}); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("superuser role was renamed: err = %v", err)
	}

	archived := true
	if _, err := SetArchived(root, su.ID, archived); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("superuser role was archived: err = %v", err)
	}

	yes := true
	if _, err := UpdateRole(root, su.ID, UpdateRoleInput{SetDefault: &yes}); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("superuser role was made the default role: err = %v", err)
	}

	if err := DeleteRole(root, su.ID); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("superuser role was deleted: err = %v", err)
	}
}

// ---- grant containment ----

func TestDelegatedManagerCannotGrantWhatItLacks(t *testing.T) {
	manager := newManager(t)

	// admin.roles.manage does not imply settings.apikeys.manage.
	bad := []string{"admin.roles.manage", "settings.apikeys.manage"}
	_, err := CreateRole(manager, CreateRoleInput{
		Name: "overreach" + strconv.Itoa(fixtureID()), Permissions: bad})
	if !errors.Is(err, ErrExceedsGrant) {
		t.Fatalf("manager created a role exceeding its own grants: err = %v", err)
	}

	var ge *ExceedsGrantError
	if !errors.As(err, &ge) {
		t.Fatalf("expected a typed ExceedsGrantError, got %T", err)
	}
	if len(ge.Permissions) != 1 || ge.Permissions[0] != "settings.apikeys.manage" {
		t.Fatalf("expected the refusal to name the offending permission, got %v", ge.Permissions)
	}
}

// TestWildcardGrantIsCheckedAgainstEveryCoveredKey is the subtle one. A wildcard
// must be refused unless the caller holds *every* permission it covers,
// otherwise holding one projects permission is enough to grant all of them.
func TestWildcardGrantIsCheckedAgainstEveryCoveredKey(t *testing.T) {
	root := newSuperuser(t)

	// A manager holding a single projects permission, deliberately not all.
	single := makeRole(t, "single"+strconv.Itoa(fixtureID()), "projects.read")
	manager := makeUser(t, "wildmgr"+strconv.Itoa(fixtureID()), single.Name)

	_, err := CreateRole(manager, CreateRoleInput{
		Name: "wild" + strconv.Itoa(fixtureID()), Permissions: []string{"projects.*"}})
	if !errors.Is(err, ErrExceedsGrant) {
		t.Fatalf("partial projects.* grant was allowed: err = %v", err)
	}

	// A superuser may always grant.
	if _, err := CreateRole(root, CreateRoleInput{
		Name: "rootwild" + strconv.Itoa(fixtureID()), Permissions: []string{"projects.*"}}); err != nil {
		t.Fatalf("superuser was refused a wildcard grant: %v", err)
	}
}

func TestGlobalWildcardIsNeverAssignable(t *testing.T) {
	root := newSuperuser(t)
	_, err := CreateRole(root, CreateRoleInput{
		Name: "star" + strconv.Itoa(fixtureID()), Permissions: []string{"*"}})
	if err == nil {
		t.Fatal("the global wildcard was assignable through the API")
	}
}

// ---- delete semantics ----

// TestDeleteBlockedWhileMembersExist is the other half of the API redesign: a
// delete must not quietly move people's access as a side effect.
func TestDeleteBlockedWhileMembersExist(t *testing.T) {
	root := newSuperuser(t)
	r := makeRole(t, "occupied"+strconv.Itoa(fixtureID()))
	u1 := makeUser(t, "occ1"+strconv.Itoa(fixtureID()), r.Name)
	u2 := makeUser(t, "occ2"+strconv.Itoa(fixtureID()), r.Name)

	err := DeleteRole(root, r.ID)
	if !errors.Is(err, ErrRoleInUse) {
		t.Fatalf("delete of an occupied role was allowed: err = %v", err)
	}
	var inUse *RoleInUseError
	if !errors.As(err, &inUse) {
		t.Fatalf("expected a typed RoleInUseError, got %T", err)
	}
	if inUse.Count != 2 || len(inUse.Members) != 2 {
		t.Fatalf("expected 2 affected members, got count=%d members=%d", inUse.Count, len(inUse.Members))
	}
	// The error should name the accounts so the operator can act on it.
	if inUse.Members[0].Username == "" {
		t.Fatal("affected members are not identified in the error")
	}

	// Nobody's access may have changed.
	for _, id := range []int64{u1, u2} {
		got, ok := RoleForUser(id)
		if !ok || got.ID != r.ID {
			t.Fatalf("user %d was moved by a blocked delete", id)
		}
	}

	// Once emptied, the delete succeeds.
	if _, err := ReassignMembers(root, r.ID, mustRole(t, "member").ID); err != nil {
		t.Fatalf("ReassignMembers: %v", err)
	}
	if err := DeleteRole(root, r.ID); err != nil {
		t.Fatalf("delete of an empty role failed: %v", err)
	}
}

func mustRole(t *testing.T, name string) Role {
	t.Helper()
	r, ok := RoleByName(name)
	if !ok {
		t.Fatalf("role %q not found", name)
	}
	return r
}

// ---- last superuser ----

// isolateSuperusers demotes every superuser except the one named, directly in
// the database. Tests that assert on last-superuser behaviour need to control
// the count exactly, and other tests in this suite legitimately create
// superusers that would otherwise make the count unpredictable.
func isolateSuperusers(t *testing.T, keep int64) {
	t.Helper()
	var memberID int64
	if err := db.DB.QueryRow(`SELECT id FROM roles WHERE name = 'member'`).Scan(&memberID); err != nil {
		t.Fatalf("no member role: %v", err)
	}
	if _, err := db.DB.Exec(
		`UPDATE users SET role_id = ?, role = 'member'
		 WHERE id != ? AND role_id IN (SELECT id FROM roles WHERE is_superuser = TRUE)`,
		memberID, keep); err != nil {
		t.Fatalf("isolate superusers: %v", err)
	}
}

func TestLastSuperuserCannotBeDemotedOrDisabled(t *testing.T) {
	root := newSuperuser(t)
	// Start from a known state: root is the only superuser.
	isolateSuperusers(t, root)

	// The last superuser cannot be demoted.
	if err := AssignRole(root, root, mustRole(t, "member").ID); !errors.Is(err, ErrLastSuperuser) &&
		!errors.Is(err, ErrSelfManaged) {
		t.Fatalf("last superuser demotion was allowed: err = %v", err)
	}
	if !IsSuperuser(root) {
		t.Fatal("root lost superuser access")
	}

	// Nor disabled.
	if err := SetUserStatus(root, root, "disabled"); err == nil {
		t.Fatal("last superuser was able to disable their own account")
	}

	// With a second superuser present, demoting the first is allowed.
	other := newSuperuser(t)
	if err := AssignRole(root, other, mustRole(t, "member").ID); err != nil {
		t.Fatalf("demoting a non-final superuser failed: %v", err)
	}
	if IsSuperuser(other) {
		t.Fatal("the second superuser was not demoted")
	}
	if !IsSuperuser(root) {
		t.Fatal("root should still be a superuser")
	}
}

func TestSuperuserAccountIsProtectedFromDelegatedManagers(t *testing.T) {
	manager := newManager(t)
	root := newSuperuser(t)
	member := makeUser(t, "target"+strconv.Itoa(fixtureID()), "member")

	// A delegated manager cannot touch a superuser account at all, in either
	// direction: not to demote it, not to disable it.
	if err := AssignRole(manager, root, mustRole(t, "member").ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("manager demoted a superuser: err = %v", err)
	}
	if err := SetUserStatus(manager, root, "disabled"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("manager disabled a superuser: err = %v", err)
	}
	// Nor may they reach one by way of an ordinary account.
	if err := AssignRole(manager, member, superuserRole(t).ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("manager promoted an ordinary account to superuser: err = %v", err)
	}
}

// ---- archive semantics ----

func TestArchivedRoleAcceptsNoNewMembers(t *testing.T) {
	root := newSuperuser(t)
	r := makeRole(t, "retiring"+strconv.Itoa(fixtureID()), "projects.read")
	held := makeUser(t, "holder"+strconv.Itoa(fixtureID()), r.Name)

	if _, err := SetArchived(root, r.ID, true); err != nil {
		t.Fatalf("SetArchived: %v", err)
	}

	// Existing members keep the access they had; archiving is not a way to
	// silently change what people can do.
	if !Can(held, "projects.read") {
		t.Fatal("archiving revoked an existing member's access")
	}

	// But nobody new can be put into it.
	fresh := makeUser(t, "fresh"+strconv.Itoa(fixtureID()), "member")
	if err := AssignRole(root, fresh, r.ID); !errors.Is(err, ErrArchivedRole) {
		t.Fatalf("archived role accepted a new member: err = %v", err)
	}

	// And it disappears from the default-role candidates.
	if _, _, err := SetInviteRole(root, r.Name); !errors.Is(err, ErrArchivedRole) {
		t.Fatalf("archived role was offered as an invite role: err = %v", err)
	}
}

// ---- integrity ----

// TestRenameKeepsUsersAttached is the reason role_id exists: with a name-based
// assignment a rename has to rewrite every user row, and anything that misses
// silently orphans them.
func TestRenameKeepsUsersAttached(t *testing.T) {
	root := newSuperuser(t)
	r := makeRole(t, "before"+strconv.Itoa(fixtureID()), "projects.read", "projects.create")
	u := makeUser(t, "attached"+strconv.Itoa(fixtureID()), r.Name)

	after := "after" + strconv.Itoa(fixtureID())
	if _, err := UpdateRole(root, r.ID, UpdateRoleInput{Name: &after}); err != nil {
		t.Fatalf("rename: %v", err)
	}

	got, ok := RoleForUser(u)
	if !ok {
		t.Fatal("user lost their role on rename")
	}
	if got.Name != after {
		t.Fatalf("user role is %q, want %q", got.Name, after)
	}
	if !Can(u, "projects.create") {
		t.Fatal("user lost permissions on rename")
	}

	// The legacy name column must be in step, or older reads would resolve the
	// user to nothing.
	var legacy string
	if err := db.DB.QueryRow(`SELECT role FROM users WHERE id = ?`, u).Scan(&legacy); err != nil {
		t.Fatalf("read legacy role: %v", err)
	}
	if legacy != after {
		t.Fatalf("legacy role column is %q, want %q", legacy, after)
	}
}

// TestFailedUpdateDoesNotPartiallyApply guards the transaction. The original
// updateRole committed the rename before validating the permission set, so a
// rejected save could still have rewritten every user in the role. Here a
// delegated manager attempts a rename together with a grant it is not allowed
// to make: the whole edit must be refused with nothing written.
func TestFailedUpdateDoesNotPartiallyApply(t *testing.T) {
	manager := newManager(t)
	r := makeRole(t, "atomic"+strconv.Itoa(fixtureID()), "admin.roles.manage")
	u := makeUser(t, "atomicuser"+strconv.Itoa(fixtureID()), r.Name)

	renamed := "atomic2" + strconv.Itoa(fixtureID())
	tooMuch := []string{"settings.apikeys.manage"}
	_, err := UpdateRole(manager, r.ID, UpdateRoleInput{Name: &renamed, Permissions: &tooMuch})
	if !errors.Is(err, ErrExceedsGrant) {
		t.Fatalf("update with an ungrantable permission succeeded: err = %v", err)
	}

	// The rename must have been rolled back with the permission change.
	got, _ := RoleForUser(u)
	if got.Name != r.Name {
		t.Fatalf("failed update left a partial rename behind: role is %q, want %q", got.Name, r.Name)
	}
	if Can(u, "settings.apikeys.manage") {
		t.Fatal("failed update applied its permission change anyway")
	}
	if Can(u, "admin.roles.manage") == false {
		t.Fatal("failed update disturbed the role's existing permissions")
	}

	// The role itself must also be un-renamed on disk, not just for the user.
	onDisk, ok := RoleByID(r.ID)
	if !ok {
		t.Fatal("role vanished after a failed update")
	}
	if onDisk.Name != r.Name {
		t.Fatalf("role was renamed on disk to %q despite the failed update", onDisk.Name)
	}
}

// TestDefaultRoleIsNeverSuperuser checks the signup path cannot mint admins.
func TestDefaultRoleIsNeverSuperuser(t *testing.T) {
	root := newSuperuser(t)
	su := superuserRole(t)

	yes := true
	if _, err := UpdateRole(root, su.ID, UpdateRoleInput{SetDefault: &yes}); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("superuser role was made the default role: err = %v", err)
	}

	d, ok := DefaultRole()
	if !ok {
		t.Fatal("no default role configured")
	}
	if d.IsSuperuser {
		t.Fatal("the default role is the superuser role; every signup would be an admin")
	}
}

// TestRoleIDBackfill covers the backward-compatible migration path: a row written
// with only the legacy name column must still resolve, and must resolve to the
// renamed role after a rename.
func TestRoleIDBackfill(t *testing.T) {
	root := newSuperuser(t)
	r := makeRole(t, "legacy"+strconv.Itoa(fixtureID()), "projects.read")

	// Simulate a row written by an older binary: name only, no role_id.
	name := "oldbinary" + strconv.Itoa(fixtureID())
	hash, _ := auth.HashPassword("x")
	res, err := db.DB.Exec(
		`INSERT INTO users (username, email, password_hash, display_name, role, role_id, status)
		 VALUES (?, ?, ?, '', ?, NULL, 'active')`,
		name, name+"@test.invalid", hash, r.Name)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	id, _ := res.LastInsertId()

	// Resolves through the name fallback.
	if !Can(id, "projects.read") {
		t.Fatal("a row with only the legacy name column did not resolve")
	}

	// And it still resolves after the role is renamed, because the fallback
	// matches on the current name.
	renamed := "legacy2" + strconv.Itoa(fixtureID())
	if _, err := UpdateRole(root, r.ID, UpdateRoleInput{Name: &renamed}); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, ok := RoleForUser(id); !ok {
		t.Fatal("legacy row lost its role after a rename")
	}
}

// TestReassignCarriesDefaultFlag keeps a deletion of the default role from
// leaving the instance with no default for new registrations.
func TestReassignCarriesDefaultFlag(t *testing.T) {
	root := newSuperuser(t)

	from := makeRole(t, "wasdefault"+strconv.Itoa(fixtureID()))
	yes := true
	if _, err := UpdateRole(root, from.ID, UpdateRoleInput{SetDefault: &yes}); err != nil {
		t.Fatalf("SetDefault: %v", err)
	}
	if _, err := ReassignMembers(root, from.ID, mustRole(t, "viewer").ID); err != nil {
		t.Fatalf("ReassignMembers: %v", err)
	}
	d, ok := DefaultRole()
	if !ok {
		t.Fatal("no default role after reassignment")
	}
	if d.Name != "viewer" {
		t.Fatalf("default role is %q, want the replacement role", d.Name)
	}
	// Restore, so the rest of the suite is unaffected.
	yes = true
	if _, err := UpdateRole(root, mustRole(t, "member").ID, UpdateRoleInput{SetDefault: &yes}); err != nil {
		t.Fatalf("restore default: %v", err)
	}
}
