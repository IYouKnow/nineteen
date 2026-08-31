import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Copy, Check, Trash2, Terminal, Container, Clock,
  ArrowDown, Ban, Loader2, WifiOff,
} from "lucide-react";
import * as api from "@/lib/api";
import StatusBadge from "@/components/dev/StatusBadge";
import { cn } from "@/lib/utils";
import {
  formatLogTime, levelMeta,
} from "@/lib/runtimeLogs";

const RANGE_MS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, all: 0 };
const RANGES = [
  { id: "1m", label: "1m" }, { id: "5m", label: "5m" },
  { id: "15m", label: "15m" }, { id: "1h", label: "1h" },
  { id: "all", label: "All" },
];
const LEVELS = [
  { id: "info", label: "Info" },
  { id: "error", label: "Error" },
];
const LEVEL_DOT = { info: "bg-info", error: "bg-destructive" };
const LEVEL_TEXT = { info: "text-info", error: "text-destructive" };

function relativeTime(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function ProjectLogs({ project, environment, isProd = true }) {
  const status = isProd ? project?.status || "idle" : environment?.status || "running";
  const running = status === "running";
  const stopped = status === "stopped" || status === "idle";
  const building = status === "building" || status === "restarting";
  const container = project?.slug ? `nineteen-${project.slug}` : "—";

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState("");
  const [activeLevels, setActiveLevels] = useState(new Set(["info", "error"]));
  const [range, setRange] = useState("5m");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const scrollRef = useRef(null);

  const normalize = (l) => ({
    id: l.id,
    ts: new Date(l.timestamp).getTime() || Date.now(),
    level: l.level === "error" ? "error" : "info",
    text: l.message ?? l.text ?? "",
    instance: l.container || container,
  });

  // Load persisted history on mount / project switch. Clear only resets the
  // live buffer, never the database, so history stays across reloads.
  useEffect(() => {
    if (building) { setLogs([]); setLoading(false); setOffline(false); return; }
    let alive = true;
    setLoading(true);
    setOffline(false);
    setNewCount(0);
    api.runtimeLogs
      .list(project?.id, { limit: 1000 })
      .then((rows) => {
        if (!alive) return;
        setLogs(rows.map(normalize));
        setLoading(false);
      })
      .catch(() => { if (alive) { setOffline(true); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Live stream via SSE — always on while the project is running. EventSource
  // auto-reconnects; a reconnection clears the offline note automatically.
  useEffect(() => {
    if (!running || !project?.id) return;
    const url = api.runtimeLogs.streamUrl(project.id);
    const es = new EventSource(url);
    let alive = true;

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.connected) { setOffline(false); return; }
        if (d.error) { setOffline(true); return; }
        const entry = normalize(d);
        if (!entry.text) return;
        setLogs((prev) => {
          if (entry.id && prev.some((x) => x.id === entry.id)) return prev;
          return [...prev, entry];
        });
        if (!atBottomRef.current) setNewCount((n) => n + 1);
      } catch { /* ignore malformed frame */ }
    };
    es.onerror = () => { if (alive) setOffline(true); };

    return () => { alive = false; es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, project?.id]);

  // Tick for relative timestamps + range cutoff.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Auto-scroll to bottom whenever new logs arrive and the user is at the
  // bottom (manual scrolls up are respected via the "N new" chip).
  useEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom && newCount > 0) setNewCount(0);
  };

  const jumpToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setNewCount(0);
  };

  const toggleLevel = (lvl) =>
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
      if (next.size === 0) { next.add("info"); next.add("warn"); next.add("error"); }
      return next;
    });

  const filtered = useMemo(() => {
    const cutoff = RANGE_MS[range] ? now - RANGE_MS[range] : 0;
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (cutoff && l.ts < cutoff) return false;
      if (!activeLevels.has(l.level)) return false;
      if (q && !l.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, range, now, activeLevels, query]);

  const handleCopy = () => {
    const text = filtered
      .map((l) => `${formatLogTime(l.ts)} [${levelMeta(l.level).label}] ${l.instance} ${l.text}`)
      .join("\n");
    navigator.clipboard.writeText(text || " ");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const handleClear = () => { setLogs([]); setNewCount(0); };

  const lastTs = logs.length ? logs[logs.length - 1].ts : null;
  const lastReceived = lastTs ? relativeTime(lastTs, now) : "—";

  return (
    <div className="animate-fade-in space-y-4">
      <header className="mb-1">
        <h2 className="text-lg font-semibold tracking-tight">Application logs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Runtime output from the running instance — separate from build &amp; deployment logs.
        </p>
      </header>

      {/* Context bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-xs text-muted-foreground">Application</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Container className="h-3.5 w-3.5" />
          <span className="font-mono text-foreground/80">{container}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Last received <span className="font-mono text-foreground/80">{lastReceived}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs…"
            className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring sm:w-52"
          />
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
          {LEVELS.map((l) => {
            const on = activeLevels.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleLevel(l.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
                  on ? cn("bg-muted/60", LEVEL_TEXT[l.id]) : "text-muted-foreground/50 hover:text-foreground"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", on ? LEVEL_DOT[l.id] : "bg-muted-foreground/30")} />
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-colors",
                range === r.id ? "bg-muted/60 text-foreground" : "text-muted-foreground/50 hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy visible logs"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="Clear log buffer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {offline && !loading && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            Log stream is offline — reconnecting automatically.
          </p>
        </div>
      )}

      {/* Terminal */}
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3.5 py-2">
          <div className="flex items-center gap-2.5 font-mono text-xs text-muted-foreground">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
            </span>
            <Terminal className="ml-1 h-3.5 w-3.5 text-muted-foreground/60" />
            <span>runtime.log</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">{container}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground/60">{filtered.length} lines</span>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="terminal-surface relative h-[460px] overflow-auto p-4 font-mono text-[12.5px] leading-[1.65]"
        >
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
              <div>
                <p className="text-sm font-medium text-foreground">Loading logs…</p>
                <p className="mt-1 text-xs text-muted-foreground">Fetching {container}</p>
              </div>
            </div>
          ) : building ? (
            <Unavailable
              title="Application is building"
              desc="Runtime logs will be available once the deployment finishes and the instance starts."
            />
          ) : stopped ? (
            <Unavailable
              title="Application is stopped"
              desc="Start the project to resume streaming runtime logs."
              footer={
                lastTs ? (
                  <p className="text-xs text-muted-foreground">Last log received {relativeTime(lastTs, now)}.</p>
                ) : null
              }
            />
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Terminal className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">
                {logs.length === 0 ? "Log buffer cleared" : "No logs match your filters"}
              </p>
              <p className="text-xs text-muted-foreground">
                {logs.length === 0
                  ? "New runtime logs will appear here."
                  : "Try adjusting search, levels or time range."}
              </p>
            </div>
          ) : (
            <>
              {filtered.map((l) => (
                <div key={l.id} className="flex gap-3">
                  <span className="select-none text-muted-foreground/35">{formatLogTime(l.ts)}</span>
                  <span className={cn("w-12 shrink-0 select-none font-semibold", LEVEL_TEXT[l.level])}>
                    {levelMeta(l.level).label}
                  </span>
                  <span className="select-none text-muted-foreground/30">{l.instance}</span>
                  <span className="whitespace-pre-wrap break-all text-foreground/85">{l.text}</span>
                </div>
              ))}
              {running && !building && !stopped && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-block h-3.5 w-2 animate-pulse bg-info" />
                </div>
              )}
            </>
          )}

          {newCount > 0 && !atBottom && (
            <div className="sticky bottom-3 z-10 flex justify-center">
              <button
                type="button"
                onClick={jumpToBottom}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted"
              >
                <ArrowDown className="h-3.5 w-3.5" /> {newCount} new
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Unavailable({ title, desc, footer }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground">
        <Ban className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{desc}</p>
      </div>
      {footer}
    </div>
  );
}