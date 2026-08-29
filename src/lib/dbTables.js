// Mock schema generator for database tables (frontend-only, deterministic per DB).
// A backend developer can replace generateTables with real schema introspection later.

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return h;
}

const TABLE_POOL = [
  {
    name: "users",
    columns: [
      { name: "id", type: "uuid", primaryKey: true, nullable: false },
      { name: "email", type: "varchar(255)", nullable: false, unique: true },
      { name: "full_name", type: "varchar(120)" },
      { name: "role", type: "enum", default: "'user'" },
      { name: "created_at", type: "timestamp", default: "now()" },
    ],
  },
  {
    name: "projects",
    columns: [
      { name: "id", type: "uuid", primaryKey: true, nullable: false },
      { name: "owner_id", type: "uuid", references: "users.id", nullable: false },
      { name: "name", type: "varchar(160)", nullable: false },
      { name: "status", type: "enum", default: "'idle'" },
      { name: "created_at", type: "timestamp", default: "now()" },
    ],
  },
  {
    name: "deployments",
    columns: [
      { name: "id", type: "uuid", primaryKey: true, nullable: false },
      { name: "project_id", type: "uuid", references: "projects.id", nullable: false },
      { name: "commit_sha", type: "char(40)" },
      { name: "status", type: "enum", default: "'queued'" },
      { name: "duration", type: "integer" },
      { name: "created_at", type: "timestamp", default: "now()" },
    ],
  },
  {
    name: "sessions",
    columns: [
      { name: "id", type: "uuid", primaryKey: true, nullable: false },
      { name: "user_id", type: "uuid", references: "users.id", nullable: false },
      { name: "token", type: "varchar(255)", nullable: false },
      { name: "expires_at", type: "timestamp" },
    ],
  },
  {
    name: "events",
    columns: [
      { name: "id", type: "bigint", primaryKey: true, nullable: false },
      { name: "type", type: "varchar(60)", nullable: false },
      { name: "payload", type: "jsonb" },
      { name: "created_at", type: "timestamp", default: "now()" },
    ],
  },
  {
    name: "audit_log",
    columns: [
      { name: "id", type: "bigint", primaryKey: true, nullable: false },
      { name: "actor_id", type: "uuid", references: "users.id" },
      { name: "action", type: "varchar(80)", nullable: false },
      { name: "metadata", type: "jsonb" },
      { name: "created_at", type: "timestamp", default: "now()" },
    ],
  },
  {
    name: "api_keys",
    columns: [
      { name: "id", type: "uuid", primaryKey: true, nullable: false },
      { name: "project_id", type: "uuid", references: "projects.id", nullable: false },
      { name: "key_hash", type: "char(64)", nullable: false },
      { name: "revoked", type: "boolean", default: "false" },
    ],
  },
];

const REDIS_KEYS = [
  { name: "session:*", type: "hash", ttl: "3600", info: "user sessions" },
  { name: "rate:limit:*", type: "string", ttl: "60", info: "rate limit counters" },
  { name: "cache:page:*", type: "string", ttl: "900", info: "rendered pages" },
  { name: "queue:jobs", type: "list", ttl: "—", info: "background job queue" },
  { name: "leader:lock", type: "string", ttl: "30", info: "election lock" },
];

const MONGO_TYPE_MAP = (c) =>
  c.primaryKey
    ? "ObjectId"
    : c.type.includes("timestamp")
    ? "date"
    : c.type.includes("json")
    ? "object"
    : c.type.includes("boolean")
    ? "boolean"
    : c.type.includes("int") || c.type.includes("bigint")
    ? "number"
    : "string";

function rowsFor(seed, name) {
  const h = hashStr(`${seed}:${name}`);
  const base = [0, 48, 312, 1280, 9400, 54200][h % 6];
  return base + (h % 100);
}

export function generateTables(db) {
  if (db?.type === "redis") {
    return { kind: "keys", label: "Keys", items: REDIS_KEYS };
  }
  const seed = hashStr(`${db?.name}:${db?.id || db?.name}`);
  const count = 4 + (seed % 3);
  const items = [];
  for (let i = 0; i < count; i++) {
    const base = TABLE_POOL[(seed + i) % TABLE_POOL.length];
    if (db?.type === "mongodb") {
      items.push({
        name: base.name,
        columns: base.columns.map((c) => ({ ...c, type: MONGO_TYPE_MAP(c) })),
      });
    } else {
      items.push({ ...base, rows: rowsFor(seed, base.name) });
    }
  }
  return { kind: db?.type === "mongodb" ? "collections" : "tables", label: db?.type === "mongodb" ? "Collections" : "Tables", items };
}

export function getTableNames(db) {
  const { items } = generateTables(db);
  return items.map((t) => t.name);
}