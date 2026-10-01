package authz

import (
	"database/sql"
	"errors"
	"strings"

	"nineteen-server/db"
	"nineteen-server/permissions"
)

// validateName enforces the role naming rules. Names are the human-facing
// handle, and they are still mirrored into users.role for backward
// compatibility, so they stay restricted to characters that are safe in a URL
// and unambiguous in logs.
func validateName(name string) error {
	if name == "" {
		return errors.New("name is required")
	}
	if len(name) > 32 {
		return errors.New("name must be 32 characters or fewer")
	}
	for _, r := range name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return errors.New("name may only contain letters, numbers, hyphens and underscores")
		}
	}
	return nil
}

// normalizePermissions validates a grant list. The global wildcard is never
// assignable: it is reserved for the superuser role, which is evaluated
// implicitly from roles.is_superuser and is not writable through the API. That
// is what keeps the root of trust out of reach of the permission editor.
func normalizePermissions(input []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, p := range input {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			continue
		}
		if p == "*" {
			return nil, errors.New("the global wildcard permission cannot be assigned to a role")
		}
		if !permissions.ValidGrant(p) {
			return nil, errors.New("unknown permission: " + p)
		}
		seen[p] = true
		out = append(out, p)
	}
	return out, nil
}

// roleColumns is the shared projection for a role row. Permissions come back as
// a comma-joined string, which is safe because permission keys never contain a
// comma; it keeps role lookup to a single round trip on the read path.
const roleColumns = `r.id, r.name, r.description, r.is_superuser, r.is_default,
	COALESCE(r.is_archived, FALSE),
	(SELECT COUNT(*) FROM users u WHERE u.role_id = r.id
		OR (u.role_id IS NULL AND u.role = r.name)),
	COALESCE((SELECT GROUP_CONCAT(rp.permission) FROM role_permissions rp
		WHERE rp.role_id = r.id), '')`

func scanRole(rows interface{ Scan(...any) error }) (Role, bool) {
	var r Role
	var permsCSV string
	if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.IsSuperuser, &r.IsDefault,
		&r.IsArchived, &r.UserCount, &permsCSV); err != nil {
		return Role{}, false
	}
	if r.IsSuperuser {
		// The superuser role's stored set is irrelevant; it implicitly has all.
		r.Permissions = []string{"*"}
	} else if permsCSV != "" {
		r.Permissions = strings.Split(permsCSV, ",")
	} else {
		r.Permissions = []string{}
	}
	return r, true
}

func roleByID(id int64) (Role, bool) {
	row := db.DB.QueryRow(`SELECT `+roleColumns+` FROM roles r WHERE r.id = ?`, id)
	r, ok := scanRole(row)
	return r, ok
}

func roleByName(name string) (Role, bool) {
	row := db.DB.QueryRow(`SELECT `+roleColumns+` FROM roles r WHERE r.name = ?`, name)
	r, ok := scanRole(row)
	return r, ok
}

// RoleByID looks up a role.
func RoleByID(id int64) (Role, bool) { return roleByID(id) }

// RoleByName looks up a role by its human-facing name.
func RoleByName(name string) (Role, bool) { return roleByName(name) }

// ListRoles returns every role, newest last, matching the admin table order.
func ListRoles() ([]Role, error) {
	rows, err := db.DB.Query(`SELECT ` + roleColumns + ` FROM roles r ORDER BY r.id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Role{}
	for rows.Next() {
		if r, ok := scanRole(rows); ok {
			out = append(out, r)
		}
	}
	return out, rows.Err()
}

// permissionsForRole loads a role's raw grant rows.
func permissionsForRole(roleID int64) []string {
	rows, err := db.DB.Query(
		`SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission`, roleID)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			out = append(out, p)
		}
	}
	return out
}

// replacePermissions swaps a role's grant set.
func replacePermissions(exec execer, roleID int64, perms []string) error {
	if _, err := exec.Exec(`DELETE FROM role_permissions WHERE role_id = ?`, roleID); err != nil {
		return err
	}
	for _, p := range perms {
		if _, err := exec.Exec(
			`INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)`,
			roleID, p); err != nil {
			return err
		}
	}
	return nil
}

// execer is satisfied by both *sql.DB and *sql.Tx, so operations can run inside
// a transaction when they need to touch several tables atomically.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

// CreateRoleInput describes a new role.
type CreateRoleInput struct {
	Name        string
	Description string
	Permissions []string
}

// CreateRole creates a non-superuser role. Roles are never created as
// superusers: is_superuser is set only by the seeder, and granting the
// superuser role to a user is a separate, superuser-only operation.
func CreateRole(caller int64, in CreateRoleInput) (Role, error) {
	name := strings.TrimSpace(in.Name)
	if err := validateName(name); err != nil {
		return Role{}, err
	}
	perms, err := normalizePermissions(in.Permissions)
	if err != nil {
		return Role{}, err
	}
	if err := canGrantAll(caller, perms); err != nil {
		return Role{}, err
	}

	res, err := db.DB.Exec(
		`INSERT INTO roles (name, description, is_superuser, is_default, is_archived)
		 VALUES (?, ?, FALSE, FALSE, FALSE)`, name, strings.TrimSpace(in.Description))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return Role{}, errors.New("a role with that name already exists")
		}
		return Role{}, err
	}
	id, _ := res.LastInsertId()
	if err := replacePermissions(db.DB, id, perms); err != nil {
		return Role{}, err
	}
	return Role{ID: id, Name: name, Description: strings.TrimSpace(in.Description), Permissions: perms}, nil
}

// UpdateRoleInput carries a partial update. Nil fields are left alone.
type UpdateRoleInput struct {
	Name        *string
	Description *string
	Permissions *[]string
	SetDefault  *bool
	Archived    *bool
}

// UpdateRole applies a partial update to a role.
//
// The permission set and the metadata are validated and written in one
// transaction, so a rejected grant cannot leave a half-applied edit behind. The
// original handler committed the rename before validating permissions, which
// meant a failed save could still have moved every user in the role.
func UpdateRole(caller int64, roleID int64, in UpdateRoleInput) (Role, error) {
	current, ok := roleByID(roleID)
	if !ok {
		return Role{}, ErrNotFound
	}
	if err := canManageRole(caller, current); err != nil {
		return Role{}, err
	}

	// Anything other than a permission change on the superuser role is refused
	// outright, for superusers as well as everyone else. The superuser role has
	// a fixed identity: it cannot be renamed, archived, deleted, or made the
	// default role for new registrations.
	if current.IsSuperuser {
		if in.Name != nil && *in.Name != current.Name {
			return Role{}, ErrProtectedRole
		}
		if in.Archived != nil && *in.Archived != current.IsArchived {
			return Role{}, ErrProtectedRole
		}
		if in.SetDefault != nil && *in.SetDefault && !current.IsDefault {
			return Role{}, ErrProtectedRole
		}
	}

	newName := current.Name
	if in.Name != nil {
		newName = strings.TrimSpace(*in.Name)
		if err := validateName(newName); err != nil {
			return Role{}, err
		}
	}
	newDesc := current.Description
	if in.Description != nil {
		newDesc = strings.TrimSpace(*in.Description)
	}
	newArchived := current.IsArchived
	if in.Archived != nil {
		newArchived = *in.Archived
	}

	// Permissions are only meaningful for a normal role; the superuser role
	// confers "*" implicitly and stores nothing.
	var perms []string
	if !current.IsSuperuser && in.Permissions != nil {
		var err error
		if perms, err = normalizePermissions(*in.Permissions); err != nil {
			return Role{}, err
		}
		if err := canGrantAll(caller, perms); err != nil {
			return Role{}, err
		}
	} else {
		perms = current.Permissions
	}

	makeDefault := current.IsDefault
	if in.SetDefault != nil && *in.SetDefault && !current.IsDefault {
		if !IsSuperuser(caller) {
			return Role{}, ErrForbidden
		}
		// The default role is handed to every new registration, so it must not
		// be the superuser role — that would make signup mint administrators.
		if current.IsSuperuser {
			return Role{}, ErrProtectedRole
		}
		makeDefault = true
	}

	tx, err := db.DB.Begin()
	if err != nil {
		return Role{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE roles SET name = ?, description = ?, is_archived = ?,
		 updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		newName, newDesc, newArchived, roleID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return Role{}, errors.New("a role with that name already exists")
		}
		return Role{}, err
	}

	// Keep the legacy name column in step. With role_id in place this is no
	// longer load-bearing for resolution, but older rows and any name-based read
	// still consult it, and a stale name there is how a user ends up orphaned.
	if newName != current.Name {
		if _, err := tx.Exec(
			`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE role_id = ? OR (role_id IS NULL AND role = ?)`,
			newName, roleID, current.Name); err != nil {
			return Role{}, err
		}
	}

	if !current.IsSuperuser && in.Permissions != nil {
		if err := replacePermissions(tx, roleID, perms); err != nil {
			return Role{}, err
		}
	}

	if makeDefault {
		if _, err := tx.Exec(`UPDATE roles SET is_default = FALSE`); err != nil {
			return Role{}, err
		}
		if _, err := tx.Exec(`UPDATE roles SET is_default = TRUE WHERE id = ?`, roleID); err != nil {
			return Role{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Role{}, err
	}

	updated, _ := roleByID(roleID)
	return updated, nil
}

// SetArchived archives or restores a role. Archiving stops the role being handed
// to anybody new but deliberately leaves existing members in place with their
// current access, so retiring a role is not a way to silently change what people
// can do. Use ReassignMembers to move people, then DeleteRole to remove it.
func SetArchived(caller int64, roleID int64, archived bool) (Role, error) {
	return UpdateRole(caller, roleID, UpdateRoleInput{Archived: &archived})
}

// DeleteRole removes a role that has no members.
//
// A role that still has members is refused with the affected accounts attached,
// rather than being reassigned as a side effect of the delete. Mass privilege
// change is a deliberate, separately audited operation (ReassignMembers), not
// something a caller can trigger as a query parameter on a DELETE.
func DeleteRole(caller int64, roleID int64) error {
	r, ok := roleByID(roleID)
	if !ok {
		return ErrNotFound
	}
	if r.IsSuperuser {
		return ErrProtectedRole
	}
	if r.IsDefault {
		return errors.New("set another role as the default before deleting this one")
	}

	members, err := MembersOfRole(roleID, 200)
	if err != nil {
		return err
	}
	if len(members) > 0 {
		return &RoleInUseError{RoleID: r.ID, RoleName: r.Name, Count: r.UserCount, Members: members}
	}

	// role_permissions cascades via the foreign key. The users guard above is
	// what keeps a role from being removed while somebody still points at it.
	if _, err := db.DB.Exec(`DELETE FROM roles WHERE id = ?`, roleID); err != nil {
		return err
	}
	return nil
}

// MembersOfRole lists the users holding a role, up to limit.
func MembersOfRole(roleID int64, limit int) ([]Member, error) {
	rows, err := db.DB.Query(
		`SELECT u.id, u.username, u.email, COALESCE(u.display_name, '')
		 FROM users u JOIN roles r ON r.id = u.role_id
		 WHERE r.id = ? ORDER BY u.id ASC LIMIT ?`, roleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if rows.Scan(&m.UserID, &m.Username, &m.Email, &m.DisplayName) == nil {
			out = append(out, m)
		}
	}
	return out, rows.Err()
}

// CountMembers reports how many users hold a role.
func CountMembers(roleID int64) int {
	var n int
	db.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role_id = ?`, roleID).Scan(&n)
	return n
}

// ReassignMembers moves every member of one role into another.
//
// This is the explicit replacement for the old "delete a role and pass
// ?replacement_role_id=" behaviour. Keeping it as a named operation means the
// permission change is checked once, in canAssignRole, audited under its own
// action, and impossible to smuggle in as a side effect of something else.
func ReassignMembers(caller int64, fromRoleID, toRoleID int64) (int, error) {
	if fromRoleID == toRoleID {
		return 0, errors.New("replacement role must be different")
	}
	from, ok := roleByID(fromRoleID)
	if !ok {
		return 0, ErrNotFound
	}
	to, ok := roleByID(toRoleID)
	if !ok {
		return 0, ErrNotFound
	}
	if from.IsSuperuser {
		return 0, ErrProtectedRole
	}
	if err := canAssignRole(caller, to); err != nil {
		return 0, err
	}

	// Carry the default flag across so deleting a default role cannot leave the
	// instance with no default for new registrations.
	makeDefault := from.IsDefault

	tx, err := db.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`UPDATE users SET role_id = ?, role = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE role_id = ? OR (role_id IS NULL AND role = ?)`,
		to.ID, to.Name, from.ID, from.Name)
	if err != nil {
		return 0, err
	}
	moved := 0
	if n, err := res.RowsAffected(); err == nil {
		moved = int(n)
	}

	if makeDefault {
		if _, err := tx.Exec(`UPDATE roles SET is_default = FALSE`); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`UPDATE roles SET is_default = TRUE WHERE id = ?`, to.ID); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return moved, nil
}
