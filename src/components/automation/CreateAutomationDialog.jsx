import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Archive, DatabaseBackup, RefreshCw, Zap, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import { getDbType } from "@/lib/databases";
import { getFramework } from "@/lib/devStatus";
import {
  AUTOMATION_TYPE_LIST,
  FREQUENCIES,
  RETENTIONS,
  getAutomationType,
  mockHistory,
} from "@/lib/automations";
import { cn } from "@/lib/utils";

const ICONS = { Archive, DatabaseBackup, RefreshCw, Zap };

const STEPS = ["Type", "Source", "Destination", "Options", "Review"];

function SourceOption({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        active ? "border-primary/50 bg-primary/5" : "border-border hover:border-foreground/15 hover:bg-muted/30"
      )}
    >
      {children}
    </button>
  );
}

export default function CreateAutomationDialog({ open, onOpenChange, project, connections, databases, onCreate }) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState(null);
  const [sourceId, setSourceId] = useState(null);
  const [destId, setDestId] = useState(null);
  const [frequency, setFrequency] = useState("daily");
  const [retention, setRetention] = useState("30");

  useEffect(() => {
    if (open) {
      setStep(0);
      setType(null);
      setSourceId(null);
      setDestId(null);
      setFrequency("daily");
      setRetention("30");
    }
  }, [open]);

  const meta = type ? getAutomationType(type) : null;
  const sourceConn = connections.find((c) => c.databaseId === sourceId);
  const destDb = databases.find((d) => d.id === destId);

  const sourceOptions =
    type === "cache"
      ? [{ kind: "app", id: "app", name: project.name, framework: project.framework, sub: `${getFramework(project.framework).label} · application` }]
      : connections
          .filter((c) => c.role !== "backup" && c.role !== "service")
          .map((c) => ({ kind: "db", id: c.databaseId, name: c.name, type: c.type, version: c.version, status: c.status }));

  const destPool = databases.filter((d) => {
    if (type === "cache") return d.type === "redis";
    return d.id !== sourceId;
  });

  const canNext = () => {
    if (step === 0) return !!type;
    if (step === 1) return type === "cache" ? true : !!sourceId;
    if (step === 2) return !!destId;
    if (step === 3) return !!frequency && (!meta?.hasRetention || !!retention);
    return true;
  };

  const next = () => {
    if (type === "cache" && step === 1) {
      setSourceId("app");
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const create = () => {
    if (!meta) return;
    const id = `auto-${Date.now()}`;
    const auto = {
      id,
      type,
      sourceType: type === "cache" ? "application" : "database",
      sourceId: type === "cache" ? project.id : sourceId,
      sourceName: type === "cache" ? project.name : sourceConn?.name,
      sourceDbType: type === "cache" ? project.framework : sourceConn?.type,
      sourceVersion: type === "cache" ? undefined : sourceConn?.version,
      sourceStatus: type === "cache" ? project.status : sourceConn?.status || "running",
      destinationId: destId,
      destinationName: destDb?.name,
      destinationType: destDb?.type,
      destinationVersion: destDb?.version,
      destinationStatus: destDb?.status || "running",
      frequency,
      retention: meta.hasRetention ? retention : null,
      status: "active",
      history: mockHistory(id, "active"),
      isMock: true,
    };
    auto.lastRun = auto.history[0]?.at;
    onCreate(auto);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step > 0 && (
              <button type="button" onClick={back} className="text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            New automation
          </DialogTitle>
          <DialogDescription>
            <span className="text-muted-foreground/60">Step {step + 1} of {STEPS.length} · </span>
            {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step 0: type */}
        {step === 0 && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {AUTOMATION_TYPE_LIST.map((t) => {
              const Icon = ICONS[t.icon];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setType(t.id); setSourceId(null); setDestId(null); }}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors",
                    type === t.id ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground group-hover:text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 1: source */}
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              {type === "cache" ? "Application (source)" : "Source database"}
            </p>
            {type === "cache" && (
              <p className="text-xs text-muted-foreground">A Redis cache sits in front of your application.</p>
            )}
            {sourceOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Connect a database to this project first.</p>
            ) : (
              sourceOptions.map((s) => (
                <SourceOption key={s.id} active={sourceId === s.id} onClick={() => setSourceId(s.id)}>
                  {s.kind === "app" ? (
                    <FrameworkIcon framework={s.framework} />
                  ) : (
                    <DbTypeIcon type={s.type} size="sm" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {s.kind === "app" ? s.sub : `${getDbType(s.type).label}${s.version ? ` · ${s.version}` : ""}`}
                    </p>
                  </div>
                </SourceOption>
              ))
            )}
          </div>
        )}

        {/* Step 2: destination */}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              {type === "cache" ? "Redis cache (destination)" : "Destination database"}
            </p>
            {destPool.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {type === "cache" ? "No Redis databases available. Create one in the Databases area." : "No databases available."}
              </p>
            ) : (
              destPool.map((d) => (
                <SourceOption key={d.id} active={destId === d.id} onClick={() => setDestId(d.id)}>
                  <DbTypeIcon type={d.type} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{d.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {getDbType(d.type).label}{d.version ? ` · ${d.version}` : ""}
                    </p>
                  </div>
                </SourceOption>
              ))
            )}
          </div>
        )}

        {/* Step 3: options */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Frequency</p>
              <div className="flex flex-wrap gap-2">
                {FREQUENCIES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFrequency(f.id)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      frequency === f.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {meta?.hasRetention && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Retention</p>
                <div className="flex flex-wrap gap-2">
                  {RETENTIONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRetention(r.id)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                        retention === r.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: review */}
        {step === 4 && meta && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
              {type === "cache" ? (
                <FrameworkIcon framework={project.framework} />
              ) : (
                <DbTypeIcon type={sourceConn?.type} size="sm" />
              )}
              <span className="truncate text-sm font-medium text-foreground">{sourceConn?.name || project.name}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                {meta.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              <DbTypeIcon type={destDb?.type} size="sm" />
              <span className="truncate text-sm font-medium text-foreground">{destDb?.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-muted-foreground/70">Frequency</p>
                <p className="mt-0.5 font-medium text-foreground">{FREQUENCIES.find((f) => f.id === frequency)?.label}</p>
              </div>
              {meta.hasRetention && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-muted-foreground/70">Retention</p>
                  <p className="mt-0.5 font-medium text-foreground">{RETENTIONS.find((r) => r.id === retention)?.label}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {step > 0 && (
            <Button variant="outline" onClick={back}>
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={!canNext()} className="gap-1.5">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={create}>Create automation</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}