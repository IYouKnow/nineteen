// Mock runtime application log generator.
// Structured so a backend developer can later replace these functions with a
// real log source (WebSocket / SSE / log-collection API) without changing the
// UI that consumes them.

export const RUNTIME_LEVELS = ["info", "warn", "error"];

const LEVEL_META = {
  info: { label: "INFO", tone: "info" },
  warn: { label: "WARN", tone: "warning" },
  error: { label: "ERROR", tone: "destructive" },
};

export function levelMeta(level) {
  return LEVEL_META[level] || LEVEL_META.info;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randHex(len) {
  return Array.from({ length: len }, () => "0123456789abcdef"[randInt(0, 15)]).join("");
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const PATHS = ["/api/health", "/api/users", "/api/orders", "/api/sessions", "/api/webhooks", "/api/invoices"];

const TEMPLATES = [
  (r) => ({ level: "info", text: `${r.method} ${r.path} ${r.status} ${r.ms}ms` }),
  () => ({ level: "info", text: `GET /api/health 200 ${randInt(4, 30)}ms` }),
  () => ({ level: "info", text: `cache hit session:user:${randHex(6)}` }),
  () => ({ level: "info", text: `job ${randHex(4)} completed in ${randInt(20, 400)}ms` }),
  () => ({ level: "warn", text: `slow query ${randInt(280, 900)}ms (threshold=250ms)` }),
  () => ({ level: "warn", text: `rate limit nearing 10.0.${randInt(0, 9)}.${randInt(0, 9)}` }),
  () => ({ level: "warn", text: `retrying job ${randHex(4)} attempt ${randInt(2, 3)}/3` }),
  () => ({ level: "error", text: `upstream timeout db-primary:${randHex(4)} (ETIMEDOUT)` }),
  () => ({ level: "error", text: `UnhandledRejection: Cannot read 'id' of undefined` }),
  () => ({ level: "error", text: `TypeError: headers.append is not a function` }),
  () => ({ level: "info", text: `worker booted pid=${randInt(1000, 9999)}` }),
  () => ({ level: "info", text: `WS client connected (total ${randInt(1, 40)})` }),
  () => ({ level: "info", text: `serving build ${randHex(7)}` }),
];

let counter = 0;
function makeEntry(ts, level, text, instance) {
  counter += 1;
  return { id: `log-${counter}`, ts, level, text, instance };
}

export function projectInstance(project) {
  const region = (project && project.region) || "fra1";
  return `${region}-${randHex(4)}`;
}

function requestCtx() {
  return {
    method: pick(METHODS),
    path: pick(PATHS),
    status: pick([200, 200, 200, 201, 204, 304, 400, 404, 500]),
    ms: randInt(3, 480),
  };
}

export function generateRuntimeLogs(project, instance, count = 80) {
  const now = Date.now();
  const logs = [];
  let t = now - count * 1400;
  for (let i = 0; i < count; i++) {
    t += randInt(300, 2600);
    if (t > now) t = now - randInt(0, 1500);
    const e = pick(TEMPLATES)(requestCtx());
    logs.push(makeEntry(t, e.level, e.text, instance));
  }
  return logs;
}

export function nextRuntimeLog(instance) {
  const e = pick(TEMPLATES)(requestCtx());
  return makeEntry(Date.now(), e.level, e.text, instance);
}

export function formatLogTime(ts) {
  const d = new Date(ts);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}