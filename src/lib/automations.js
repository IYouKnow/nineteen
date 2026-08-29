// Automation metadata + mock history (frontend-only). Real scheduling/replication
// would be wired by a backend developer later.

export const AUTOMATION_TYPES = {
  backup: {
    id: "backup",
    label: "Automatic Backup",
    icon: "Archive",
    tone: "info",
    description: "Back up a database on a schedule.",
    hasRetention: true,
    sourceKind: "database",
    destKind: "database",
    verb: "backs up to",
  },
  db_backup: {
    id: "db_backup",
    label: "Database → Backup Database",
    icon: "DatabaseBackup",
    tone: "muted",
    description: "Copy a database into a backup database.",
    hasRetention: true,
    sourceKind: "database",
    destKind: "database",
    verb: "copies to",
  },
  sync: {
    id: "sync",
    label: "Database Sync / Replication",
    icon: "RefreshCw",
    tone: "info",
    description: "Keep two databases in sync.",
    hasRetention: false,
    sourceKind: "database",
    destKind: "database",
    verb: "syncs with",
  },
  cache: {
    id: "cache",
    label: "Redis Cache",
    icon: "Zap",
    tone: "warning",
    description: "Use Redis as a cache for your application.",
    hasRetention: false,
    sourceKind: "application",
    destKind: "database",
    verb: "caches via",
  },
};

export const AUTOMATION_TYPE_LIST = Object.values(AUTOMATION_TYPES);

export const FREQUENCIES = [
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "on-demand", label: "On demand" },
];

export const RETENTIONS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
];

export function getAutomationType(id) {
  return AUTOMATION_TYPES[id] || AUTOMATION_TYPES.backup;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return h;
}

export function mockHistory(seed, status = "active") {
  const h = hashStr(seed);
  const now = Date.now();
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const back = (i + 1) * 6 * 3600 * 1000;
    const failed = status === "error" ? i === 0 : i === 2 && h % 7 === 0;
    runs.push({
      at: new Date(now - back).toISOString(),
      status: failed ? "error" : "success",
      duration: 6 + ((h >> i) % 22),
    });
  }
  return runs;
}

export function statusTone(status) {
  if (status === "active") return "success";
  if (status === "error") return "destructive";
  return "muted";
}