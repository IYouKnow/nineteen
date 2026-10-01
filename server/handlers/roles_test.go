package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"nineteen-server/auth"
	"nineteen-server/authz"
	"nineteen-server/db"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "nineteen-handlers-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)
	os.Setenv("JWT_SECRET", "test-secret-for-handler-suite-only")
	os.Setenv("NINETEEN_DATA_DIR", dir)
	db.Init(dir + "/test.db")
	os.Exit(m.Run())
}

var fixture int

func nextID() int { fixture++; return fixture }

// ---- fixtures ----

func insertRole(t *testing.T, name string, perms ...string) int64 {
	t.Helper()
	res, err := db.DB.Exec(
		`INSERT INTO roles (name, description, is_superuser, is_default, is_archived)
		 VALUES (?, '', FALSE, FALSE, FALSE)`, name)
	if err != nil {
		t.Fatalf("insert role: %v", err)
	}
	id, _ := res.LastInsertId()
	for _, p := range perms {
		db.DB.Exec(`INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)`, id, p)
	}
	return id
}

func insertUser(t *testing.T, roleName string) (int64, string) {
	t.Helper()
	name := "u" + strconv.Itoa(nextID())
	hash, err := auth.HashPassword("irrelevant")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	res, err := db.DB.Exec(
		`INSERT INTO users (username, email, password_hash, display_name, role, role_id, status)
		 VALUES (?, ?, ?, '', ?, (SELECT id FROM roles WHERE name = ?), 'active')`,
		name, name+"@test.invalid", hash, roleName, roleName)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	id, _ := res.LastInsertId()
	token, err := auth.GenerateToken(id, name, name+"@test.invalid", roleName)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	return id, token
}

// superuserToken returns a caller holding the superuser role.
func superuserToken(t *testing.T) (int64, string) {
	t.Helper()
	_, name := superuserRole(t)
	return insertUser(t, name)
}

// managerToken returns a caller holding only the delegated role-management
// permissions, i.e. the account from the original report.
func managerToken(t *testing.T) (int64, string) {
	t.Helper()
	name := "mgr" + strconv.Itoa(nextID())
	insertRole(t, name, "admin.roles.read", "admin.roles.manage",
		"admin.users.read", "admin.users.manage")
	return insertUser(t, name)
}

func do(t *testing.T, h http.HandlerFunc, method, path, token string, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		rdr = bytes.NewReader(raw)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	// pathID reads the {id} wildcard, which ServeMux populates in production.
	// httptest.NewRequest does not route, so mirror the mux and set it here.
	// URL.Path rather than the raw path, so a query string is not mistaken for
	// part of the id segment.
	for _, seg := range strings.Split(strings.Trim(req.URL.Path, "/"), "/") {
		if _, err := strconv.ParseInt(seg, 10, 64); err == nil {
			req.SetPathValue("id", seg)
			break
		}
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

// ---- the reported vulnerability, at the HTTP layer ----

// TestDeleteRoleIgnoresReplacementParam is the direct regression test for the
// reported issue. DELETE /api/admin/roles/{id}?replacement_role_id=<admin>
// used to resolve that name and write it straight into users.role, so a caller
// holding only admin.roles.manage could promote every member of the role to the
// superuser role in a single request.
//
// The parameter is now gone. Even if a client still sends it, nothing is
// reassigned, and the delete is refused while the role has members.
func TestDeleteRoleIgnoresReplacementParam(t *testing.T) {
	_, mgrToken := managerToken(t)
	victimRole := "victim" + strconv.Itoa(nextID())
	insertRole(t, victimRole)
	victimID, _ := insertUser(t, victimRole)

	suID, _ := superuserRole(t)

	w := do(t, AdminRoleHandler, http.MethodDelete,
		"/api/admin/roles/"+strconv.FormatInt(mustID(t, victimRole), 10)+
			"?replacement_role_id="+strconv.FormatInt(suID, 10), mgrToken, nil)

	// The role still has members, so the delete must be refused.
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for deleting an occupied role, got %d: %s", w.Code, w.Body.String())
	}

	// The critical assertion: the victim's access must be untouched.
	got, ok := authz.RoleForUser(victimID)
	if !ok {
		t.Fatal("victim lost their role")
	}
	if got.Name != victimRole {
		t.Fatalf("victim was reassigned to %q by a replacement_role_id on DELETE", got.Name)
	}
	if authz.IsSuperuser(victimID) {
		t.Fatal("victim was promoted to superuser by a replacement_role_id on DELETE")
	}
}

// TestReassignEndpointRefusesEscalation covers the replacement operation that
// now exists in place of the smuggled parameter. It must apply the same
// containment check as every other grant.
func TestReassignEndpointRefusesEscalation(t *testing.T) {
	_, mgrToken := managerToken(t)
	victimRole := "crew" + strconv.Itoa(nextID())
	insertRole(t, victimRole)
	victimID, _ := insertUser(t, victimRole)
	fromID := mustID(t, victimRole)

	suID, _ := superuserRole(t)

	w := do(t, ReassignRoleMembersHandler, http.MethodPost,
		"/api/admin/roles/"+strconv.FormatInt(fromID, 10)+"/reassign",
		mgrToken, map[string]interface{}{"to_role_id": suID})
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
	if authz.IsSuperuser(victimID) {
		t.Fatal("victim was promoted to superuser")
	}
}

// TestReassignEndpointAllowsLegitimateMove is the other half: a superuser must
// still be able to move people, or the fix would just be a denial of service.
func TestReassignEndpointAllowsLegitimateMove(t *testing.T) {
	_, rootToken := superuserToken(t)
	from := "from" + strconv.Itoa(nextID())
	insertRole(t, from)
	u, _ := insertUser(t, from)
	toID := mustID(t, "member")

	w := do(t, ReassignRoleMembersHandler, http.MethodPost,
		"/api/admin/roles/"+strconv.FormatInt(mustID(t, from), 10)+"/reassign",
		rootToken, map[string]interface{}{"to_role_id": toID})
	if w.Code != http.StatusOK {
		t.Fatalf("superuser could not reassign members: %d %s", w.Code, w.Body.String())
	}
	got, _ := authz.RoleForUser(u)
	if got.Name != "member" {
		t.Fatalf("user ended up in %q, want member", got.Name)
	}
}

// TestUserUpdateRefusesSuperuserGrant covers the users endpoint.
func TestUserUpdateRefusesSuperuserGrant(t *testing.T) {
	_, mgrToken := managerToken(t)
	target, _ := insertUser(t, "member")

	w := do(t, AdminUserHandler, http.MethodPut,
		"/api/admin/users/"+strconv.FormatInt(target, 10), mgrToken,
		map[string]interface{}{"role": "admin"})
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
	if authz.IsSuperuser(target) {
		t.Fatal("user was promoted to superuser")
	}
}

// TestInviteRefusesSuperuserRole covers the third path into the same state.
func TestInviteRefusesSuperuserRole(t *testing.T) {
	_, mgrToken := managerToken(t)
	w := do(t, AdminInvitesHandler, http.MethodPost, "/api/admin/invites", mgrToken,
		map[string]interface{}{"role": "admin", "max_uses": 1})
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestDeleteRefusesSuperuserRole checks the protected-role invariant is
// enforced at the endpoint, not just inside the package.
func TestDeleteRefusesSuperuserRole(t *testing.T) {
	_, rootToken := superuserToken(t)
	suID, _ := superuserRole(t)
	w := do(t, AdminRoleHandler, http.MethodDelete,
		"/api/admin/roles/"+strconv.FormatInt(suID, 10), rootToken, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

// TestArchivedRoleRejectedForAssignment checks the archive flag is honoured
// through the API.
func TestArchivedRoleRejectedForAssignment(t *testing.T) {
	_, rootToken := superuserToken(t)
	name := "retired" + strconv.Itoa(nextID())
	id := insertRole(t, name)
	target, _ := insertUser(t, "member")

	w := do(t, AdminRoleHandler, http.MethodPut,
		"/api/admin/roles/"+strconv.FormatInt(id, 10), rootToken,
		map[string]interface{}{"is_archived": true})
	if w.Code != http.StatusOK {
		t.Fatalf("archiving failed: %d %s", w.Code, w.Body.String())
	}

	w = do(t, AdminUserHandler, http.MethodPut,
		"/api/admin/users/"+strconv.FormatInt(target, 10), rootToken,
		map[string]interface{}{"role": name})
	if w.Code != http.StatusConflict {
		t.Fatalf("archived role accepted an assignment: %d %s", w.Code, w.Body.String())
	}
}

// TestPermissionCatalogAnnotatesGrantability checks the editor is told up front
// which permissions the caller may grant, so the UI can disable the rest rather
// than failing on save.
func TestPermissionCatalogAnnotatesGrantability(t *testing.T) {
	_, mgrToken := managerToken(t)
	w := do(t, PermissionCatalogHandler, http.MethodGet, "/api/permissions", mgrToken, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("catalog: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Groups []struct {
			Permissions []struct {
				Key       string `json:"key"`
				Grantable bool   `json:"grantable"`
				IsWrite   bool   `json:"is_write"`
			} `json:"permissions"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	seen := 0
	for _, g := range out.Groups {
		for _, p := range g.Permissions {
			seen++
			if p.Key == "admin.roles.manage" && !p.Grantable {
				t.Error("a permission the manager holds is reported as not grantable")
			}
			if p.Key == "settings.apikeys.manage" && p.Grantable {
				t.Error("a permission the manager lacks is reported as grantable")
			}
		}
	}
	if seen == 0 {
		t.Fatal("catalog returned no permissions")
	}
}

func superuserRole(t *testing.T) (int64, string) {
	t.Helper()
	r, ok := authz.SuperuserRole()
	if !ok {
		t.Fatal("no superuser role seeded")
	}
	return r.ID, r.Name
}

func mustID(t *testing.T, name string) int64 {
	t.Helper()
	r, ok := authz.RoleByName(name)
	if !ok {
		t.Fatalf("role %q not found", name)
	}
	return r.ID
}
