// Single source of truth for the permission keys the UI gates on.
//
// The catalogue of permissions and their labels is owned by the server
// (server/permissions/permissions.go) and fetched at runtime, so nothing here
// duplicates that. What lives here is only the set of keys this codebase asks
// "can I do X?" about, so those strings are named once instead of being spelled
// out at every call site — which is what made renaming a permission a
// twenty-two-place change before.
//
// A key that is absent from the server catalogue simply never matches anything,
// so a stale name here fails closed rather than open.
export const PERM = Object.freeze({
  PROJECTS_READ: "projects.read",
  PROJECTS_CREATE: "projects.create",
  PROJECTS_UPDATE: "projects.update",
  PROJECTS_DELETE: "projects.delete",
  PROJECTS_DEPLOY: "projects.deploy",

  DATABASES_READ: "databases.read",
  DATABASES_CREATE: "databases.create",

  STORAGE_READ: "storage.read",
  STORAGE_CREATE: "storage.create",

  SETTINGS_READ: "settings.read",
  SETTINGS_UPDATE: "settings.update",

  UPDATES_READ: "updates.read",
  UPDATES_RUN: "updates.run",

  ADMIN_USERS_READ: "admin.users.read",
  ADMIN_USERS_MANAGE: "admin.users.manage",
  ADMIN_INVITES_READ: "admin.invites.read",
  ADMIN_INVITES_MANAGE: "admin.invites.manage",
  ADMIN_ROLES_READ: "admin.roles.read",
  ADMIN_ROLES_MANAGE: "admin.roles.manage",
  ADMIN_RESOURCES_READ: "admin.resources.read",
  ADMIN_RESOURCES_MANAGE: "admin.resources.manage",
  ADMIN_SYSTEM_READ: "admin.system.read",
  ADMIN_AUDIT_READ: "admin.audit.read",
});

// WRITE_PERMISSIONS are the permissions the read-only banner treats as
// "mutating". The server derives the same set from the catalogue via
// permissions.IsWriteKey, so the two cannot drift; this list exists only so the
// banner has something to show before the catalogue has loaded.
export const WRITE_PERMISSIONS = Object.freeze([
  PERM.PROJECTS_CREATE,
  PERM.PROJECTS_UPDATE,
  PERM.PROJECTS_DELETE,
  PERM.PROJECTS_DEPLOY,
  PERM.DATABASES_CREATE,
  PERM.STORAGE_CREATE,
  PERM.SETTINGS_UPDATE,
  PERM.UPDATES_RUN,
]);

// Admin section keys, used to decide whether the Admin area is reachable.
export const ADMIN_PERMISSIONS = Object.freeze([
  PERM.ADMIN_USERS_READ,
  PERM.ADMIN_USERS_MANAGE,
  PERM.ADMIN_INVITES_READ,
  PERM.ADMIN_INVITES_MANAGE,
  PERM.ADMIN_ROLES_READ,
  PERM.ADMIN_ROLES_MANAGE,
  PERM.ADMIN_RESOURCES_READ,
  PERM.ADMIN_RESOURCES_MANAGE,
  PERM.ADMIN_SYSTEM_READ,
  PERM.ADMIN_AUDIT_READ,
]);
