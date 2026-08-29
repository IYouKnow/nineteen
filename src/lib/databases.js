const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

// Database resource metadata for the Databases area.
// Databases are first-class infrastructure resources, independent of projects,
// and can be connected to one or more projects via the DatabaseConnection entity.

export const DB_TYPES = {
  postgresql: { label: "PostgreSQL", code: "Pg", color: "#4169e1", versions: ["16.2", "15.5", "14.10"], defaultVersion: "16.2", port: 5432, scheme: "postgres", description: "Powerful relational database with JSON & extension support." },
  mysql: { label: "MySQL", code: "My", color: "#00758f", versions: ["8.4", "8.0"], defaultVersion: "8.0", port: 3306, scheme: "mysql", description: "Popular open-source relational database." },
  mariadb: { label: "MariaDB", code: "Ma", color: "#003545", versions: ["11.2", "10.11"], defaultVersion: "11.2", port: 3306, scheme: "mariadb", description: "Community-driven MySQL fork, drop-in compatible." },
  redis: { label: "Redis", code: "Re", color: "#dc382d", versions: ["7.2", "6.2"], defaultVersion: "7.2", port: 6379, scheme: "redis", description: "In-memory data store for caching and queues." },
  mongodb: { label: "MongoDB", code: "Mo", color: "#47a248", versions: ["7.0", "6.0"], defaultVersion: "7.0", port: 27017, scheme: "mongodb", description: "Document database for flexible schemas." },
};

export const DB_TYPE_LIST = Object.entries(DB_TYPES).map(([id, v]) => ({ id, ...v }));

export const DB_INSTANCE_SIZES = [
  { id: "nano", label: "Nano", cpu: "0.2 vCPU", ram: "256 MB", storage: "1 GB", price: "$0" },
  { id: "small", label: "Small", cpu: "0.5 vCPU", ram: "1 GB", storage: "10 GB", price: "$12" },
  { id: "medium", label: "Medium", cpu: "1 vCPU", ram: "4 GB", storage: "40 GB", price: "$28" },
  { id: "large", label: "Large", cpu: "2 vCPU", ram: "8 GB", storage: "80 GB", price: "$64" },
];

export function getDbType(id) {
  return DB_TYPES[id] || DB_TYPES.postgresql;
}

// Builds a display-only connection string (password masked). Real credentials
// would be provisioned by a backend and injected into connected projects.
export function buildConnectionString(db) {
  if (!db) return "";
  const t = getDbType(db.type);
  const host = db.host || `db-${(db.name || "db").toLowerCase()}.fra1.nineteen.app`;
  const port = db.port || t.port;
  const name = db.database_name || (db.type === "redis" ? "0" : "app");
  if (db.type === "redis") return `redis://${host}:${port}/${name}`;
  return `${t.scheme}://${db.username || "user"}:••••••@${host}:${port}/${name}`;
}