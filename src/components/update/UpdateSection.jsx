import { useCallback, useEffect, useRef, useState } from "react";
import { update } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Download, RotateCcw, RefreshCw, CheckCircle2, AlertCircle, Loader2, Terminal,
  ChevronDown, Sparkles,
} from "lucide-react";

const TERMINAL_STATES = ["success", "rolled_back", "failed"];

function stateLabel(state) {
  switch (state) {
    case "building": return "Building new image…";
    case "swapping": return "Replacing container…";
    case "success": return "Update complete";
    case "rolled_back": return "Rolled back to previous version";
    case "failed": return "Update failed";
    default: return "Idle";
  }
}

function StateBadge({ state }) {
  if (state === "success") return <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" />Healthy</Badge>;
  if (state === "rolled_back") return <Badge variant="secondary"><RotateCcw className="mr-1 h-3 w-3" />Rolled back</Badge>;
  if (state === "failed") return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Failed</Badge>;
  if (state === "building" || state === "swapping") return <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Updating…</Badge>;
  return <Badge variant="outline">Idle</Badge>;
}

// The release workflow generates each release body from the commit log, so the
// notes arrive as a small, predictable subset of Markdown: "##" sections,
// "*" bullets, "**bold**" and links. Rendering that directly keeps the panel
// readable without pulling in a Markdown dependency.
function notesLines(body) {
  return (body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\*\*full changelog\*\*/i.test(line))
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean);
}

function notesText(line) {
  return line
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+by @([\w-]+) in https?:\/\/\S+/g, " (by @$1)")
    .replace(/\s+in https?:\/\/\S+/g, "")
    .trim();
}

function NotesBody({ body }) {
  const lines = notesLines(body);
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">No notes for this release.</p>;
  }
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const bullet = /^[*-]\s+/.test(line);
        const text = notesText(bullet ? line.replace(/^[*-]\s+/, "") : line);
        if (!text) return null;
        return bullet ? (
          <div key={i} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span className="text-sm text-muted-foreground">{text}</span>
          </div>
        ) : (
          <p key={i} className="pt-1 text-sm font-medium text-foreground">{text}</p>
        );
      })}
    </div>
  );
}

function ReleaseItem({ release, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{release.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <code className="font-mono">{release.version}</code>
            {release.prerelease && " · pre-release"}
            {release.published_at && ` · ${new Date(release.published_at).toLocaleDateString()}`}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-3">
        <NotesBody body={release.body} />
        {release.url && (
          <a
            href={release.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            View on GitHub
          </a>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function UpdateSection() {
  const [info, setInfo] = useState(null);
  const [logs, setLogs] = useState([]);
  const [releases, setReleases] = useState([]);
  const [releasesError, setReleasesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const logRef = useRef(null);
  const streamRef = useRef(null);
  const pollRef = useRef(null);
  const reloadRef = useRef(null);
  const infoRef = useRef(null);

  infoRef.current = info;

  const inProgress = info && (info.state === "building" || info.state === "swapping");
  const terminal = info && TERMINAL_STATES.includes(info.state);

  const loadReleases = useCallback(async () => {
    try {
      const data = await update.releases();
      setReleases(data?.releases || []);
      setReleasesError(data?.error || "");
    } catch (err) {
      setReleases([]);
      setReleasesError(err.message || "Could not load release notes");
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const data = await update.status();
      setInfo(data);
    } catch (err) {
      toast.error("Could not check for updates", { description: err.message });
    } finally {
      setChecking(false);
    }
    await loadReleases();
  }, [loadReleases]);

  useEffect(() => {
    (async () => {
      try {
        const data = await update.status();
        setInfo(data);
      } catch (err) {
        setInfo({ current_version: "—", state: "idle", message: err.message });
      } finally {
        setLoading(false);
      }
    })();
    loadReleases();
  }, [loadReleases]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // After a successful update, let the "Update complete" status settle for a
  // moment, then switch to "Nineteen is up to date" (when there is no newer
  // release to show).
  useEffect(() => {
    if (info?.state === "success") {
      const t = setTimeout(() => setShowUpToDate(true), 4000);
      return () => clearTimeout(t);
    }
    setShowUpToDate(false);
  }, [info?.state]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
      if (reloadRef.current) clearTimeout(reloadRef.current);
    };
  }, []);

  // The updated container serves a new frontend bundle, but the browser keeps
  // running this (stale) one. Schedule a hard reload so the user picks up the
  // new UI. Only called on the polling transition to a terminal state — never
  // on initial mount — so a page load showing a persisted "success" won't loop.
  const scheduleReload = useCallback((title) => {
    toast.success(title, { description: "Reloading to load the new version…" });
    if (reloadRef.current) clearTimeout(reloadRef.current);
    reloadRef.current = setTimeout(() => {
      window.location.reload();
    }, 3500);
  }, []);

  const reloadNow = useCallback(() => {
    if (reloadRef.current) clearTimeout(reloadRef.current);
    window.location.reload();
  }, []);

  const openStream = useCallback(() => {
    if (streamRef.current) streamRef.current.close();
    const es = new EventSource(update.logsStreamUrl());
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.line) setLogs((prev) => [...prev, data.line]);
      } catch { /* ignore */ }
    };
    streamRef.current = es;
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await update.poll();
        setInfo(data);
        if (TERMINAL_STATES.includes(data.state)) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (streamRef.current) streamRef.current.close();
          if (data.state === "success") {
            scheduleReload("Update complete");
          } else if (data.state === "rolled_back") {
            scheduleReload("Rolled back to previous version");
          }
        }
      } catch { /* ignore transient network errors during swap */ }
    }, 2000);
  }, [scheduleReload]);

  const startUpdate = async () => {
    setStarting(true);
    try {
      await update.start(info.latest_version);
      toast.info("Update started — Nineteen will restart briefly");
      setLogs([]);
      setInfo((prev) => ({ ...prev, state: "building" }));
      openStream();
      startPolling();
    } catch (err) {
      toast.error("Update could not start", { description: err.message });
    } finally {
      setStarting(false);
    }
  };

  const startRollback = async () => {
    setStarting(true);
    try {
      await update.rollback();
      toast.info("Rollback started — Nineteen will restart briefly");
      setLogs([]);
      setInfo((prev) => ({ ...prev, state: "swapping" }));
      openStream();
      startPolling();
    } catch (err) {
      toast.error("Rollback could not start", { description: err.message });
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="mb-4 flex items-center gap-2.5">
          <Download className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold text-foreground">Updates</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Self-update Nineteen</p>
          </div>
        </div>
        <Card><CardContent className="pt-6 space-y-4"><Skeleton className="h-4 w-48" /><Skeleton className="h-9 w-full" /></CardContent></Card>
      </div>
    );
  }

  const showLogs = inProgress || terminal;

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center gap-2.5">
        <Download className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-xl font-semibold text-foreground">Updates</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Update Nineteen itself without touching hosted projects</p>
        </div>
      </div>

      {info && info.is_owner === false && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Only the instance owner can manage updates.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Current version</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm">
                  {info.current_version || "dev"}
                </code>
                <StateBadge state={info.state} />
              </div>
            </div>
            <Button variant="outline" onClick={loadStatus} disabled={checking || inProgress}>
              <RefreshCw className={`mr-1 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              Check for updates
            </Button>
          </div>

          {info.repo && (
            <p className="text-xs text-muted-foreground">Source: <code className="font-mono">{info.repo}</code></p>
          )}

          <Separator />

          {info.message && (
            <p className="text-sm text-muted-foreground">
              {info.state === "success" && showUpToDate && !info.update_available
                ? "You're running the latest version."
                : info.message}
            </p>
          )}

          {!inProgress && info.update_available && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/40 bg-success/5 p-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-success" />
                <div>
                  <p className="text-sm font-medium text-foreground">Version {info.latest_version} is available</p>
                  <p className="text-xs text-muted-foreground">Update Nineteen to the latest release.</p>
                </div>
              </div>
              <Button variant="white" onClick={startUpdate} disabled={starting || inProgress}>
                {starting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                Update Nineteen
              </Button>
            </div>
          )}

          {!inProgress && !terminal && !info.update_available && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Nineteen is up to date.
            </div>
          )}

          {inProgress && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {stateLabel(info.state)}
            </div>
          )}

          {terminal && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                {info.state === "success" && <CheckCircle2 className="h-4 w-4 text-success" />}
                {info.state === "rolled_back" && <RotateCcw className="h-4 w-4 text-warning" />}
                {info.state === "failed" && <AlertCircle className="h-4 w-4 text-destructive" />}
                <span className="text-foreground">
                  {info.state === "success" && showUpToDate && !info.update_available
                    ? "Nineteen is up to date"
                    : stateLabel(info.state)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {info.state === "success" && info.previous_image && (
                  <Button variant="outline" onClick={startRollback} disabled={starting}>
                    <RotateCcw className="mr-1 h-4 w-4" /> Roll back
                  </Button>
                )}
                {(info.state === "success" || info.state === "rolled_back") && (
                  <Button variant="default" onClick={reloadNow}>
                    <RefreshCw className="mr-1 h-4 w-4" /> Reload now
                  </Button>
                )}
                <Button variant="outline" onClick={loadStatus} disabled={checking}>
                  <RefreshCw className={`mr-1 h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Check again
                </Button>
              </div>
              {(info.state === "success" || info.state === "rolled_back") && (
                <p className="text-xs text-muted-foreground">
                  New code is live — the page reloads automatically to pick it up.
                </p>
              )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(releases.length > 0 || releasesError) && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              What's new
            </div>
            {releasesError && releases.length === 0 && (
              <p className="text-sm text-muted-foreground">{releasesError}</p>
            )}
            {releases.map((release, i) => (
              <ReleaseItem key={release.version} release={release} defaultOpen={i === 0} />
            ))}
          </CardContent>
        </Card>
      )}

      {showLogs && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              Update log
            </div>
            <pre
              ref={logRef}
              className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground"
            >
              {logs.length === 0 ? "Waiting for log output…" : logs.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
