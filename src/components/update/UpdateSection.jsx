import { useCallback, useEffect, useRef, useState } from "react";
import { update } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Download, RotateCcw, RefreshCw, CheckCircle2, AlertCircle, Loader2, Terminal,
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

export function UpdateSection() {
  const [info, setInfo] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const logRef = useRef(null);
  const streamRef = useRef(null);
  const pollRef = useRef(null);
  const infoRef = useRef(null);

  infoRef.current = info;

  const inProgress = info && (info.state === "building" || info.state === "swapping");
  const terminal = info && TERMINAL_STATES.includes(info.state);

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
  }, []);

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
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
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
        }
      } catch { /* ignore transient network errors during swap */ }
    }, 2000);
  }, []);

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

          {info.message && <p className="text-sm text-muted-foreground">{info.message}</p>}

          {!inProgress && !terminal && info.update_available && (
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                {info.state === "success" && <CheckCircle2 className="h-4 w-4 text-success" />}
                {info.state === "rolled_back" && <RotateCcw className="h-4 w-4 text-warning" />}
                {info.state === "failed" && <AlertCircle className="h-4 w-4 text-destructive" />}
                <span className="text-foreground">{stateLabel(info.state)}</span>
              </div>
              <div className="flex items-center gap-2">
                {info.state === "success" && info.previous_image && (
                  <Button variant="outline" onClick={startRollback} disabled={starting}>
                    <RotateCcw className="mr-1 h-4 w-4" /> Roll back
                  </Button>
                )}
                <Button variant="outline" onClick={loadStatus} disabled={checking}>
                  <RefreshCw className={`mr-1 h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Check again
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
