package authz

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"nineteen-server/db"
)

// AssignRole moves a user into a role.
//
// This is the choke point every "grant somebody this role" path funnels
// through, including invite redemption. Two guards matter:
//
//   - The caller may not put anybody into a role carrying access they do not
//     hold themselves, which is what stops a delegated role manager from
//     promoting anyone to superuser.
//   - A superuser account is only manageable by a superuser, so a delegated
//     manager cannot demote the real admins either and take the instance over
//     by removing the people who would notice.
func AssignRole(caller, targetUserID, roleID int64) error {
	target, ok := userRole(targetUserID)
	if !ok {
		return ErrNotFound
	}
	if target.IsSuperuser && !IsSuperuser(caller) {
		return ErrForbidden
	}

	next, ok := roleByID(roleID)
	if !ok {
		return ErrNotFound
	}
	if err := canAssignRole(caller, next); err != nil {
		return err
	}

	// Removing the final superuser would leave the instance unrecoverable
	// through the API. The env-based recovery path exists for genuine lockout,
	// but reaching it should require an explicit act, not a role change.
	if target.IsSuperuser && !next.IsSuperuser {
		if ActiveSuperuserCount() <= 1 {
			return ErrLastSuperuser
		}
	}

	// Dropping your own last role is almost always a mistake, and it is a way
	// to make yourself unable to reverse a mistake.
	if targetUserID == caller && !next.IsSuperuser {
		if effective := next.Effective(); len(effective) == 0 {
			return ErrSelfManaged
		}
	}

	return writeUserRole(targetUserID, next)
}

// writeUserRole persists an assignment to both the role_id reference and the
// legacy name column.
func writeUserRole(userID int64, r Role) error {
	_, err := db.DB.Exec(
		`UPDATE users SET role_id = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		r.ID, r.Name, userID)
	return err
}

func userRole(userID int64) (Role, bool) {
	return roleForUser(userID)
}

// SetUserStatus enables or disables an account.
func SetUserStatus(caller, targetUserID int64, status string) error {
	if status != "active" && status != "disabled" {
		return errors.New("status must be one of: active, disabled")
	}
	target, ok := userRole(targetUserID)
	if !ok {
		return ErrNotFound
	}
	if target.IsSuperuser && !IsSuperuser(caller) {
		return ErrForbidden
	}
	if targetUserID == caller && status == "disabled" {
		return errors.New("you cannot disable your own account")
	}
	// Disabling the last active superuser is the same lockout as demoting them.
	if target.IsSuperuser && status == "disabled" && ActiveSuperuserCount() <= 1 {
		return ErrLastSuperuser
	}
	_, err := db.DB.Exec(
		`UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		status, targetUserID)
	return err
}

// SetInviteRole validates the role an invite will place its holder in and
// returns the id to store alongside the legacy name.
//
// Invites are a grant mechanism: whoever can mint an invite can effectively
// choose who joins and with what access, so this runs through exactly the same
// containment check as assigning a role directly.
func SetInviteRole(caller int64, roleName string) (int64, string, error) {
	name := strings.TrimSpace(roleName)
	if name == "" {
		// An invite with no role falls back to the default at redemption time.
		if d, ok := DefaultRole(); ok {
			return d.ID, d.Name, nil
		}
		return 0, "", errors.New("no default role is configured")
	}
	r, ok := roleByName(name)
	if !ok {
		return 0, "", errors.New("unknown role: " + name)
	}
	if err := canAssignRole(caller, r); err != nil {
		return 0, "", err
	}
	return r.ID, r.Name, nil
}

// RoleForRegistration resolves the role a new account should receive. The
// invite's role wins, then the default. isPrivileged marks the first-ever
// registration, which becomes the superuser so a fresh instance is usable.
func RoleForRegistration(inviteRoleID sql.NullInt64, inviteRoleName string) (Role, bool, error) {
	if inviteRoleID.Valid {
		if r, ok := roleByID(inviteRoleID.Int64); ok {
			return r, false, nil
		}
	}
	if name := strings.TrimSpace(inviteRoleName); name != "" {
		if r, ok := roleByName(name); ok {
			return r, false, nil
		}
	}
	if d, ok := DefaultRole(); ok {
		return d, false, nil
	}
	// No default role is configured. Rather than mint an account with no access
	// at all, fall back to the least-privileged role that exists.
	r, _ := leastPrivilegedRole()
	return r, false, nil
}

func leastPrivilegedRole() (Role, bool) {
	rows, err := db.DB.Query(
		`SELECT id FROM roles WHERE is_superuser = FALSE AND is_archived = FALSE ORDER BY id ASC`)
	if err != nil {
		return Role{}, false
	}
	defer rows.Close()
	if !rows.Next() {
		return Role{}, false
	}
	var id int64
	if rows.Scan(&id) != nil {
		return Role{}, false
	}
	return roleByID(id)
}

// CreateSuperuserIfNone reports whether this is the first account on the
// instance, in which case it becomes the superuser. Kept here so the "first user
// is an admin" rule lives next to the guards that protect it.
func CreateSuperuserIfNone() (Role, bool) {
	var n int
	if err := db.DB.QueryRow(
		`SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`).Scan(&n); err != nil {
		return Role{}, false
	}
	if n > 0 {
		return Role{}, false
	}
	r, ok := SuperuserRole()
	return r, ok
}

// AssignRoleByName resolves a role by name and assigns it. Used by the
// registration path, where the role arrives as a name from an invite.
func AssignRoleByName(userID int64, name string) error {
	r, ok := roleByName(strings.TrimSpace(name))
	if !ok {
		return ErrNotFound
	}
	return writeUserRole(userID, r)
}

// TouchUser refreshes a user's updated_at, used after a role change so the
// admin list reflects it.
func TouchUser(userID int64) {
	db.DB.Exec(`UPDATE users SET updated_at = ? WHERE id = ?`,
		time.Now().UTC().Format("2006-01-02 15:04:05"), userID)
}
