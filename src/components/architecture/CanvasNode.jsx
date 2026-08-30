import { ArrowUpRight, Unplug, Boxes, Archive, DatabaseBackup, RefreshCw, Zap, Terminal } from "lucide-react";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import StatusDot from "@/components/dev/StatusDot";
import { getRole } from "@/lib/architecture";
import { getDbType } from "@/lib/databases";
import { TONES } from "@/lib/devStatus";
import { cn } from "@/lib/utils";

const AUTOMATION_ICONS = { Archive, DatabaseBackup, RefreshCw, Zap };

const ROLE_BORDER = {
  info: "border-info/40",
  warning: "border-warning/40",
  success: "border-success/40",
  muted: "border-border",
};

export default function CanvasNode({ node, selected, onOpen, onRemove, onOpenLogs }) {
  if (node.kind === "app") {
    return (
      <div
        className={cn(
          "group relative w-[214px] select-none rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 shadow-lg shadow-primary/5",
          selected && "ring-2 ring-primary/60"
        )}
      >
        <div className="flex items-center gap-3">
          <FrameworkIcon framework={node.framework} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{node.label}</p>
            <p className="truncate text-xs text-muted-foreground">{node.sub}</p>
          </div>
          <StatusBadge status={node.status} />
        </div>
        {onOpenLogs && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenLogs(); }}
            title="View runtime logs"
            className={cn(
              "absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-opacity hover:text-foreground",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (node.kind === "project") {
    return (
      <div
        className={cn(
          "w-[150px] select-none rounded-lg border border-border bg-muted/30 px-3 py-2",
          selected && "ring-2 ring-primary/50"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{node.label}</p>
            <p className="text-[10px] text-muted-foreground">project</p>
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "automation") {
    const Icon = AUTOMATION_ICONS[node.aIcon] || Zap;
    const dotStatus = node.status === "active" ? "running" : node.status === "error" ? "error" : "stopped";
    return (
      <div
        className={cn(
          "flex select-none items-center gap-2 rounded-full border border-warning/40 bg-warning/5 px-3 py-1.5 shadow-md",
          selected && "ring-2 ring-warning/50"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="whitespace-nowrap text-xs font-medium text-foreground">{node.label}</span>
        <StatusDot status={dotStatus} kind="database" />
      </div>
    );
  }

  // db / service node
  const role = getRole(node.role);
  const type = getDbType(node.type);
  return (
    <div
      className={cn(
        "group relative w-[206px] select-none rounded-xl border bg-card px-3.5 py-3 transition-shadow",
        ROLE_BORDER[role.tone] || "border-border",
        selected ? "ring-2 ring-primary/60 shadow-lg" : "shadow-md"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
            TONES[role.tone].badge
          )}
        >
          {role.short}
        </span>
        <StatusDot status={node.status} kind="database" />
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <DbTypeIcon type={node.type} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{node.label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {type.label}
            {node.version ? ` · ${node.version}` : ""}
          </p>
          {node.scope === "tables" && (
            <p className="truncate text-[10px] text-muted-foreground/70">
              {(node.selectedTables || []).length} tables selected
            </p>
          )}
        </div>
      </div>
      <div className={cn("absolute -right-2 -top-2 flex gap-1", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onOpen(node); }}
          title="Open details"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(node); }}
          title="Remove connection"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-destructive"
        >
          <Unplug className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}