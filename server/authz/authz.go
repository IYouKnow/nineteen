// Package authz owns every decision about who may hold which permissions.
//
// Two rules shaped this package:
//
//  1. Read-path predicates (Can, IsSuperuser, EffectivePermissions) stay cheap
//     and side-effect free, because they run on every authenticated request.
//
//  2. Every *privileged mutation* — creating a role, editing its permissions,
//     assigning a user, reassigning a role's members, minting an invite — goes
//     through an operation in this package rather than assembling SQL in a
//     handler. That is deliberate: the original privilege-escalation bug lived
//     in a handler that resolved a role name from a query parameter and wrote it
//     straight into users.role, and the fix is to make that shape impossible
//     rather than to patch the one handler.
//
// A user holds access through exactly one role. There are no per-user grants or
// denies, which keeps every permission decision traceable to a single row and
// is what makes the containment checks below tractable.
package authz

import (
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"nineteen-server/db"
	"nineteen-server/permissions"
)

// Errors returned by operations. Handlers map these onto status codes, so the
// distinction between "you may not" and "that would break an invariant" is
// preserved all the way to the client instead of collapsing into one 400.
var (
	// ErrNotFound means the referenced role or user does not exist.
	ErrNotFound = errors.New("not found")
	// ErrForbidden means the caller lacks the access required for the operation.
	ErrForbidden = errors.New("forbidden")
	// ErrInvalid means the request was malformed.
	ErrInvalid = errors.New("invalid request")
	// ErrConflict means the operation is well-formed but conflicts with state.
	ErrConflict = errors.New("conflict")

	// ErrProtectedRole is returned for any mutation of the superuser role that
	// is not a permission change by a superuser: renaming, archiving, deleting
	// or making it the default role.
	ErrProtectedRole = errors.New("the superuser role is protected")
	// ErrLastSuperuser prevents an instance from losing its final superuser.
	ErrLastSuperuser = errors.New("cannot remove the last superuser")
	// ErrRoleInUse means members still reference the role.
	ErrRoleInUse = errors.New("role is still assigned to users")
	// ErrArchivedRole means the role is archived and cannot receive members.
	ErrArchivedRole = errors.New("role is archived")
	// ErrExceedsGrant means the caller tried to grant access they do not hold.
	ErrExceedsGrant = errors.New("exceeds the caller's own permissions")
	// ErrSelfManaged means the operation would lock the caller out of their own
	// account, e.g. removing the last permission they hold.
	ErrSelfManaged = errors.New("would leave you without any permission")
)

// Role is a row of the roles table plus the derived facts the admin UI needs.
type Role struct {
	ID          int64
	Name        string
	Description string
	IsSuperuser bool
	IsDefault   bool
	IsArchived  bool
	// Permissions is the raw grant list, wildcards included. This is what the
	// editor round-trips; Effective is the expanded set used for checks.
	Permissions []string
	// UserCount is the number of users assigned to this role.
	UserCount int
}

// Effective returns the concrete permission keys this role confers.
func (r Role) Effective() []string {
	if r.IsSuperuser {
		return permissions.Expand([]string{"*"})
	}
	return permissions.Expand(r.Permissions)
}

// RoleInUseError reports a delete blocked by remaining members and carries a
// sample of them so the UI can tell the operator exactly who is affected
// instead of only a count.
type RoleInUseError struct {
	RoleID   int64
	RoleName string
	Count    int
	Members  []Member
}

func (e *RoleInUseError) Error() string {
	return "role " + e.RoleName + " is still assigned to " + strconv.Itoa(e.Count) + " user(s)"
}

// Is lets errors.Is(err, ErrRoleInUse) match this typed error.
func (e *RoleInUseError) Is(target error) bool { return target == ErrRoleInUse }

// ExceedsGrantError lists the specific permissions the caller was not allowed to
// grant, so the response can be actionable instead of a bare rejection.
type ExceedsGrantError struct {
	Permissions []string
	Reason      string
}

func (e *ExceedsGrantError) Error() string {
	if e.Reason != "" {
		return e.Reason
	}
	return "cannot grant permissions you do not hold: " + strings.Join(e.Permissions, ", ")
}

// Is lets errors.Is(err, ErrExceedsGrant) match this typed error.
func (e *ExceedsGrantError) Is(target error) bool { return target == ErrExceedsGrant }

// Member is a user holding a role, used for previews and impact reporting.
type Member struct {
	UserID      int64
	Username    string
	Email       string
	DisplayName string
}

// ---- read path ----

// roleForUser loads a user's role. role_id is authoritative; the legacy
// `users.role` name column is a fallback for rows written before the foreign
// key existed, and for any role whose name changed while an old binary was
// still running during a rolling deploy.
//
// The fallback deliberately does not write back. Role resolution happens on
// every authenticated request, and a write on that path would mean taking a
// SQLite write lock inside a permission check. Writes to role_id only ever
// originate from an explicit assignment in this package, plus the boot-time
// backfill in the db package.
func roleForUser(userID int64) (Role, bool) {
	var (
		roleID     sql.NullInt64
		legacyName sql.NullString
	)
	err := db.DB.QueryRow(`SELECT role_id, role FROM users WHERE id = ?`, userID).
		Scan(&roleID, &legacyName)
	if err != nil {
		return Role{}, false
	}
	if roleID.Valid {
		if r, ok := roleByID(roleID.Int64); ok {
			return r, true
		}
	}
	if legacyName.Valid && legacyName.String != "" {
		if r, ok := roleByName(legacyName.String); ok {
			return r, true
		}
	}
	// The user's role was deleted out from under them. Treat them as holding no
	// access rather than inheriting anything: the boot-time backfill moves these
	// to the default role, and until then the safe answer is "no permissions".
	return Role{}, false
}

// RoleForUser exposes the caller's own resolved role.
func RoleForUser(userID int64) (Role, bool) { return roleForUser(userID) }

// IsSuperuser reports whether the user holds a superuser role.
func IsSuperuser(userID int64) bool {
	r, ok := roleForUser(userID)
	return ok && r.IsSuperuser
}

// EffectivePermissions returns the user's grants with wildcards intact. This is
// the stored form, used for display and for evaluating further grants.
func EffectivePermissions(userID int64) []string {
	r, ok := roleForUser(userID)
	if !ok {
		return []string{}
	}
	if r.IsSuperuser {
		return []string{"*"}
	}
	return r.Permissions
}

// ExpandedPermissions returns every concrete catalogue key the user holds. The
// client uses this instead of reimplementing wildcard matching.
func ExpandedPermissions(userID int64) []string {
	return permissions.Expand(EffectivePermissions(userID))
}

// Can reports whether the user holds perm.
func Can(userID int64, perm string) bool {
	return permissions.Allows(EffectivePermissions(userID), perm)
}

// ActiveSuperuserCount reports how many enabled accounts hold a superuser role.
func ActiveSuperuserCount() int {
	var n int
	db.DB.QueryRow(
		`SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
		 WHERE r.is_superuser = TRUE AND u.status = 'active'`,
	).Scan(&n)
	return n
}

// UserIsSuperuser reports whether a user holds a superuser role. Callers use it
// for the "you may not touch a superuser account" guard.
func UserIsSuperuser(userID int64) bool { return IsSuperuser(userID) }

// DefaultRole returns the role assigned to new registrations when no invite
// specifies one.
func DefaultRole() (Role, bool) {
	var id int64
	err := db.DB.QueryRow(
		`SELECT id FROM roles WHERE is_default = TRUE AND is_archived = FALSE ORDER BY id ASC LIMIT 1`,
	).Scan(&id)
	if err != nil {
		return Role{}, false
	}
	return roleByID(id)
}

// SuperuserRole returns the superuser role.
func SuperuserRole() (Role, bool) {
	var id int64
	err := db.DB.QueryRow(`SELECT id FROM roles WHERE is_superuser = TRUE ORDER BY id ASC LIMIT 1`).Scan(&id)
	if err != nil {
		return Role{}, false
	}
	return roleByID(id)
}

// ---- grant containment ----

// canGrant reports whether caller may hand perm to a role. This is the single
// containment rule behind every escalation path: you can never grant access you
// do not yourself hold.
//
// A wildcard grant is checked against every catalogue key it covers, so
// "projects.*" is refused if the caller lacks any single projects permission.
// Without that, a caller holding one projects permission could grant the whole
// namespace.
func canGrant(caller int64, perm string) bool {
	if IsSuperuser(caller) {
		return true
	}
	if strings.HasSuffix(perm, ".*") {
		prefix := strings.TrimSuffix(perm, ".*")
		for _, key := range permissions.All() {
			if (key == prefix || strings.HasPrefix(key, prefix+".")) && !Can(caller, key) {
				return false
			}
		}
		return true
	}
	return Can(caller, perm)
}

// ungrantable returns the subset of perms the caller may not grant.
func ungrantable(caller int64, perms []string) []string {
	var out []string
	for _, p := range perms {
		if !canGrant(caller, p) {
			out = append(out, p)
		}
	}
	return out
}

// canGrantAll reports whether caller may grant every permission in perms.
func canGrantAll(caller int64, perms []string) error {
	if bad := ungrantable(caller, perms); len(bad) > 0 {
		return &ExceedsGrantError{Permissions: bad}
	}
	return nil
}

// GrantablePermissions returns the catalogue keys the caller may grant. The
// role editor uses it to disable checkboxes up front instead of letting the
// operator fill in a form that the server will reject on save.
func GrantablePermissions(caller int64) map[string]bool {
	out := map[string]bool{}
	super := IsSuperuser(caller)
	for _, key := range permissions.All() {
		out[key] = super || Can(caller, key)
	}
	return out
}

// canManageRole reports whether caller may modify role r at all. Editing the
// superuser role, and any action on it beyond its permission set, is reserved
// for superusers.
func canManageRole(caller int64, r Role) error {
	if r.IsSuperuser && !IsSuperuser(caller) {
		return ErrForbidden
	}
	return nil
}

// canAssignRole is the single choke point for "may this caller cause these users
// to end up in this role".
//
// Every path that moves somebody into a role reduces to this one check:
// assigning a single user, reassigning every member of a role, and minting an
// invite that will place its holder in a role. That is what closes the class of
// bug rather than the single instance of it — the original defect was a
// replacement role on a DELETE that skipped the equivalent of this check.
func canAssignRole(caller int64, r Role) error {
	if r.IsSuperuser {
		if !IsSuperuser(caller) {
			return ErrForbidden
		}
		return nil
	}
	if r.IsArchived {
		return ErrArchivedRole
	}
	// A delegated manager cannot funnel users into access they do not hold. This
	// covers both the superuser role and any other role that happens to carry
	// something sensitive the caller lacks.
	return canGrantAll(caller, r.Effective())
}
