import { ArrowRight, Play, Pause, Trash2, Clock, History, CheckCircle2, AlertCircle, Archive, DatabaseBackup, RefreshCw, Zap } from "lucide-react";
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
import { getAutomationType, FREQUENCIES, RETENTIONS, statusTone } from "@/lib/automations";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS = { Archive, DatabaseBackup, RefreshCw, Zap };

const STATUS_LABEL = { active: "Active", paused: "Paused", error: "Error" };

export default function AutomationDetailsDialog({ automation, open, onOpenChange, onToggle, onDelete }) {
  if (!automation) return null;
  const meta = getAutomationType(automation.type);
  const Icon = ICONS[meta.icon];
  const tone = statusTone(automation.status);
  const dotClass = { success: "bg-success", destructive: "bg-destructive", muted: "bg-muted-foreground/50" }[tone];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-warning/30 bg-warning/10 text-warning">
              <Icon className="h-3.5 w-3.5" />
            </span>
            {meta.label}
          </DialogTitle>
          <DialogDescription>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
              {STATUS_LABEL[automation.status]}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Flow */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
          {automation.sourceType === "application" ? (
            <FrameworkIcon framework={automation.sourceDbType} />
          ) : (
            <DbTypeIcon type={automation.sourceDbType} size="sm" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{automation.sourceName}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {automation.sourceType === "application"
                ? `${getFramework(automation.sourceDbType).label} · application`
                : getDbType(automation.sourceDbType).label}
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
            {meta.label}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
          <DbTypeIcon type={automation.destinationType} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{automation.destinationName}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {getDbType(automation.destinationType).label}
            </p>
          </div>
        </div>

        {/* Schedule + last run */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Schedule
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">
              {FREQUENCIES.find((f) => f.id === automation.frequency)?.label}
              {meta.hasRetention && automation.retention
                ? ` · ${RETENTIONS.find((r) => r.id === automation.retention)?.label} retention`
                : ""}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" /> Last run
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">
              {automation.lastRun ? timeAgo(automation.lastRun) : "never"}
            </p>
          </div>
        </div>

        {/* History */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Execution history</p>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {automation.history.map((run, i) => (
              <div key={i} className={cn("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-border/60")}>
                {run.status === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className="flex-1 text-xs text-muted-foreground">{timeAgo(run.at)}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{run.duration}s</span>
                <span className={cn("text-[11px] font-medium", run.status === "success" ? "text-success" : "text-destructive")}>
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onToggle(automation)} className="gap-2">
            {automation.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {automation.status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button variant="outline" onClick={() => onDelete(automation)} className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}