import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { strategyMeta, strategySummary } from "@/lib/strategies";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

function WebhookBadge({ webhook }) {
  if (webhook?.registered) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
        <CheckCircle2 className="h-3 w-3" /> Webhook
      </span>
    );
  }
  if (webhook?.webhook_error) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
        <AlertTriangle className="h-3 w-3" /> Webhook
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      No webhook
    </span>
  );
}

export default function StrategyRow({ trigger, webhook, showWebhook = true, lastEvent, onEdit, onToggle, onDelete, busy }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const meta = strategyMeta(trigger.strategy);
  const Icon = meta.icon;
  const enabled = trigger.enabled !== false;
  const summary = strategySummary(trigger);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-colors",
        !enabled && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            enabled
              ? "border-border bg-muted/30 text-foreground"
              : "border-border bg-muted/20 text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{meta.title}</p>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                enabled
                  ? "border-success/25 bg-success/10 text-success"
                  : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              {enabled ? "Active" : "Paused"}
            </span>
            {showWebhook && <WebhookBadge webhook={webhook} />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground/70">
            {lastEvent
              ? `${lastEvent.matched ? "Triggered" : "Ignored"} ${timeAgo(lastEvent.created_at)} · ${lastEvent.reason}`
              : "No events yet"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => onToggle(trigger, v)}
            disabled={busy}
            aria-label={enabled ? "Pause strategy" : "Enable strategy"}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              <DropdownMenuItem onClick={() => onEdit(trigger)} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={() => setConfirmOpen(true)}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this strategy?"
        description={`"${meta.title}" (${summary}) will stop triggering deployments. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete(trigger);
        }}
      />
    </div>
  );
}
