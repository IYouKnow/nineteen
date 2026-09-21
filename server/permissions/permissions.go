// Package permissions defines the catalogue of granular permissions the
// application understands and the matching rules used to evaluate a role's
// grants. A permission key is either an exact key from the catalogue, a
// wildcard such as "projects.*" / "admin.users.*", or the global "*" wildcard.
package permissions

import "strings"

// Def is a single permission shown in the admin UI.
type Def struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Group collects related permissions for display.
type Group struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Permissions []Def  `json:"permissions"`
}

var catalog = []Group{
	{
		ID: "projects", Label: "Projects",
		Description: "Projects and everything attached to them",
		Permissions: []Def{
			{"projects.read", "View projects"},
			{"projects.create", "Create projects"},
			{"projects.update", "Edit projects"},
			{"projects.delete", "Delete projects"},
			{"projects.deploy", "Deploy, start, stop and restart"},
			{"projects.env.read", "View environment variables"},
			{"projects.env.manage", "Manage environment variables"},
			{"projects.files.read", "View project files"},
			{"projects.files.manage", "Manage project files"},
			{"projects.volumes.read", "View volumes"},
			{"projects.volumes.manage", "Manage volumes"},
			{"projects.triggers.read", "View automation triggers"},
			{"projects.triggers.manage", "Manage automation triggers"},
			{"projects.buildfile.read", "View build files"},
			{"projects.buildfile.manage", "Edit build files"},
			{"projects.logs.read", "View deployment logs"},
			{"projects.runtime.read", "View runtime logs and resources"},
		},
	},
	{
		ID: "databases", Label: "Databases",
		Description: "Managed database instances and their connections",
		Permissions: []Def{
			{"databases.read", "View databases"},
			{"databases.create", "Create databases"},
			{"databases.update", "Edit databases"},
			{"databases.delete", "Delete databases"},
			{"databases.connections.read", "View database connections"},
			{"databases.connections.manage", "Manage database connections"},
		},
	},
	{
		ID: "storage", Label: "Storage",
		Description: "Buckets and volumes",
		Permissions: []Def{
			{"storage.read", "View storage"},
			{"storage.create", "Create storage"},
			{"storage.update", "Edit storage"},
			{"storage.delete", "Delete storage"},
		},
	},
	{
		ID: "settings", Label: "Settings & integrations",
		Description: "Application settings, integrations and API keys",
		Permissions: []Def{
			{"settings.read", "View settings"},
			{"settings.update", "Change settings"},
			{"settings.integrations.read", "View integrations"},
			{"settings.integrations.manage", "Connect and disconnect integrations"},
			{"settings.apikeys.read", "View API keys"},
			{"settings.apikeys.manage", "Create and revoke API keys"},
		},
	},
	{
		ID: "updates", Label: "Updates",
		Description: "Nineteen self-update",
		Permissions: []Def{
			{"updates.read", "Check for updates"},
			{"updates.run", "Install updates and roll back"},
		},
	},
	{
		ID: "admin", Label: "Administration",
		Description: "Admin panel sections",
		Permissions: []Def{
			{"admin.users.read", "View users"},
			{"admin.users.manage", "Manage users, roles and account status"},
			{"admin.invites.read", "View invite codes"},
			{"admin.invites.manage", "Create and revoke invite codes"},
			{"admin.roles.read", "View roles and permissions"},
			{"admin.roles.manage", "Create, edit and delete roles"},
			{"admin.resources.read", "View all users' resources"},
			{"admin.resources.manage", "Manage all users' resources"},
			{"admin.system.read", "View system information"},
			{"admin.audit.read", "View the audit log"},
		},
	},
}

// Catalog returns the full permission catalogue.
func Catalog() []Group { return catalog }

// All returns every exact permission key in the catalogue.
func All() []string {
	var out []string
	for _, g := range catalog {
		for _, p := range g.Permissions {
			out = append(out, p.Key)
		}
	}
	return out
}

// ValidGrant reports whether a permission string may be stored for a role: the
// global wildcard, an exact catalogue key, or a wildcard whose prefix matches
// at least one catalogue key (e.g. "projects.*").
func ValidGrant(perm string) bool {
	if perm == "*" {
		return true
	}
	if strings.HasSuffix(perm, ".*") {
		prefix := strings.TrimSuffix(perm, ".*")
		for _, key := range All() {
			if strings.HasPrefix(key, prefix+".") {
				return true
			}
		}
		return false
	}
	for _, key := range All() {
		if key == perm {
			return true
		}
	}
	return false
}

// Covers reports whether a single granted permission satisfies required.
func Covers(granted, required string) bool {
	if granted == "*" || granted == required {
		return true
	}
	if strings.HasSuffix(granted, ".*") {
		prefix := strings.TrimSuffix(granted, ".*")
		return required == prefix || strings.HasPrefix(required, prefix+".")
	}
	return false
}

// Allows reports whether any granted permission satisfies required.
func Allows(granted []string, required string) bool {
	for _, g := range granted {
		if Covers(g, required) {
			return true
		}
	}
	return false
}

// MemberDefaults is the permission set seeded for the built-in member role so
// existing installs keep working: everything on their own resources, but no
// admin panel access and no self-update.
func MemberDefaults() []string {
	var out []string
	for _, g := range catalog {
		if g.ID == "admin" {
			continue
		}
		for _, p := range g.Permissions {
			if p.Key == "updates.run" {
				continue
			}
			out = append(out, p.Key)
		}
	}
	return out
}

// ViewerDefaults is the read-only permission set seeded for the built-in
// viewer role.
func ViewerDefaults() []string {
	var out []string
	for _, g := range catalog {
		if g.ID == "admin" {
			continue
		}
		for _, p := range g.Permissions {
			if strings.HasSuffix(p.Key, ".read") {
				out = append(out, p.Key)
			}
		}
	}
	return out
}
