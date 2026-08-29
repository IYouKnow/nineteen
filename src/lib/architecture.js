// Architecture relationship model for the project's infrastructure map.
// A connection (project <-> database) is stored in DatabaseConnection.
// The ROLE describes HOW a project uses a database — a presentation concept
// here, structured so it can be promoted to a stored field on the connection
// when wiring the backend later.

export const ROLES = {
  primary: {
    id: "primary",
    label: "Primary database",
    short: "primary",
    verb: "uses",
    tone: "info",
    description: "Your app's main database for storing core data.",
  },
  cache: {
    id: "cache",
    label: "Cache",
    short: "cache",
    verb: "caches",
    tone: "warning",
    description: "Use Redis as a fast cache for frequently accessed data.",
  },
  backup: {
    id: "backup",
    label: "Backup",
    short: "backup",
    verb: "backs up",
    tone: "muted",
    description: "Create a backup of an existing database for recovery.",
  },
  shared: {
    id: "shared",
    label: "Shared database",
    short: "shared",
    verb: "shares",
    tone: "success",
    description: "Connect a database already used by another project.",
  },
  service: {
    id: "service",
    label: "Existing service",
    short: "service",
    verb: "uses",
    tone: "info",
    description: "Any other database or service your app connects to.",
  },
};

export function getRole(id) {
  return ROLES[id] || ROLES.service;
}

// Infer a role from a real connection when no explicit role is stored.
export function inferRole(dbType, sharedCount) {
  if (sharedCount > 1) return "shared";
  if (dbType === "redis") return "cache";
  return "primary";
}