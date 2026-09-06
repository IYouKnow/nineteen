// Status & framework configuration for the deployment platform UI.
// All Tailwind classes are literal strings so the JIT compiler keeps them.

export const TONES = {
  success: {
    dot: "bg-success",
    text: "text-success",
    badge: "bg-success/10 text-success border-success/25",
    soft: "bg-success/10",
    ring: "ring-success/30",
  },
  info: {
    dot: "bg-info",
    text: "text-info",
    badge: "bg-info/10 text-info border-info/25",
    soft: "bg-info/10",
    ring: "ring-info/30",
  },
  destructive: {
    dot: "bg-destructive",
    text: "text-destructive",
    badge: "bg-destructive/10 text-destructive border-destructive/25",
    soft: "bg-destructive/10",
    ring: "ring-destructive/30",
  },
  warning: {
    dot: "bg-warning",
    text: "text-warning",
    badge: "bg-warning/10 text-warning border-warning/25",
    soft: "bg-warning/10",
    ring: "ring-warning/30",
  },
  muted: {
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    badge: "bg-muted/50 text-muted-foreground border-border",
    soft: "bg-muted/40",
    ring: "ring-border",
  },
};

export const PROJECT_STATUS = {
  running: { label: "Running", tone: "success" },
  building: { label: "Building", tone: "info", pulse: true },
  restarting: { label: "Restarting", tone: "info", pulse: true },
  error: { label: "Error", tone: "destructive" },
  idle: { label: "Idle", tone: "muted" },
  stopped: { label: "Stopped", tone: "muted" },
};

export const DEPLOYMENT_STATUS = {
  queued: { label: "Queued", tone: "muted" },
  building: { label: "Building", tone: "info", pulse: true },
  ready: { label: "Ready", tone: "success" },
  error: { label: "Error", tone: "destructive" },
  canceled: { label: "Canceled", tone: "muted" },
};

export const DB_STATUS = {
  running: { label: "Running", tone: "success" },
  provisioning: { label: "Provisioning", tone: "info", pulse: true },
  error: { label: "Error", tone: "destructive" },
  stopped: { label: "Stopped", tone: "muted" },
};

export function getStatus(status, kind = "project") {
  const map =
    kind === "deployment"
      ? DEPLOYMENT_STATUS
      : kind === "database"
      ? DB_STATUS
      : PROJECT_STATUS;
  if (kind === "database") return map[status] || DB_STATUS.running;
  return map[status] || PROJECT_STATUS.idle;
}

export const FRAMEWORKS = {
  nextjs: { label: "Next.js", code: "N", color: "#ededed" },
  vite: { label: "Vite", code: "V", color: "#a371f7" },
  node: { label: "Node.js", code: "No", color: "#5fa04e" },
  python: { label: "Python", code: "Py", color: "#ffd43b" },
  static: { label: "Static", code: "S", color: "#8b9fb5" },
  docker: { label: "Docker", code: "D", color: "#2496ed" },
  remix: { label: "Remix", code: "R", color: "#60a5fa" },
  astro: { label: "Astro", code: "A", color: "#ff8a3d" },
};

export function getFramework(framework) {
  return FRAMEWORKS[framework] || FRAMEWORKS.node;
}

export const INSTANCE_TYPES = [
  { id: "nano", label: "Nano", cpu: "0.2 vCPU", ram: "256 MB", price: "$0" },
  { id: "micro", label: "Micro", cpu: "0.5 vCPU", ram: "512 MB", price: "$5" },
  { id: "small", label: "Small", cpu: "1 vCPU", ram: "1 GB", price: "$12" },
  { id: "medium", label: "Medium", cpu: "2 vCPU", ram: "4 GB", price: "$28" },
  { id: "large", label: "Large", cpu: "4 vCPU", ram: "8 GB", price: "$64" },
];

export const REGIONS = [
  { id: "fra1", label: "Frankfurt", flag: "🇩🇪" },
  { id: "sfo1", label: "San Francisco", flag: "🇺🇸" },
  { id: "sin1", label: "Singapore", flag: "🇸🇬" },
  { id: "iad1", label: "Washington", flag: "🇺🇸" },
];

// Base port used when auto-assigning a local dev port for a project.
export const DEV_PORT_BASE = 3000;
// Size of the auto-assign pool (DEV_PORT_BASE..DEV_PORT_BASE+RANGE-1).
export const DEV_PORT_RANGE = 2000;

// Resolves the concrete dev port for a project. Accepts either an object
// ({ port, name }) or a raw port value. Uses the user-chosen port when set,
// otherwise deterministically auto-assigns one so the same project always
// maps to the same local port.
export function resolveProjectPort(portOrProject, fallbackName = "") {
  let port;
  let name = fallbackName;
  if (portOrProject && typeof portOrProject === "object") {
    port = portOrProject.port;
    name = portOrProject.name || fallbackName;
  } else {
    port = portOrProject;
  }
  const numeric = Number(port);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  let hash = 0;
  const seed = String(name || "project").toLowerCase();
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return DEV_PORT_BASE + (hash % DEV_PORT_RANGE);
}

// The local URL a project is served at (host + resolved port).
export function projectAddress(portOrProject, fallbackName = "") {
  const port = resolveProjectPort(portOrProject, fallbackName);
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}