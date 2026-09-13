import { cn } from "@/lib/utils";
import { GitCommitHorizontal, Tag, Rocket, Hand, History, Webhook, CheckCircle2, MinusCircle } from "lucide-react";
import { timeAgo, shortSha } from "@/lib/format";
import { strategyMeta } from "@/lib/strategies";

const SOURCES = {
  commit: { icon: GitCommitHorizontal, label: "Commit", badge: "bg-info/10 text-info border-info/25" },
  push: { icon: GitCommitHorizontal, label: "Commit", badge: "bg-info/10 text-info border-info/25" },
  tag: { icon: Tag, label: "Tag", badge: "bg-warning/10 text-warning border-warning/25" },
  create: { icon: Tag, label: "Tag", badge: "bg-warning/10 text-warning border-warning/25" },
  release: { icon: Rocket, label: "Release", badge: "bg-success/10 text-success border-success/25" },
  manual: { icon: Hand, label: "Manual", badge: "bg-muted/50 text-muted-foreground border-border" },
  ping: { icon: Webhook, label: "Ping", badge: "bg-muted/50 text-muted-foreground border-border" },
};

export default function TriggerHistory({ events = [], triggers = [] }) {
  const byId = Object.fromEntries(triggers.map((t) => [t.id, t]));
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground/60" />
        <h3 className="text-sm font-medium">Deployment activity</h3>
        <span className="text-xs text-muted-foreground">· how recent deployments were triggered</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Webhook className="mx-auto h-6 w-6 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">No trigger events yet</p>
            <p className="text-xs text-muted-foreground/70">
              Events from GitHub will appear here once the webhook is registered and fires.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {events.map((row) => {
              const src = SOURCES[row.event_type] || SOURCES.ping;
              const Icon = src.icon;
              const ref = row.ref || shortSha(row.sha) || "—";
              const trig = row.trigger_id != null ? byId[row.trigger_id] : null;
              const trigTitle = trig ? strategyMeta(trig.strategy).title : null;
              return (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                      src.badge
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {src.label}
                  </span>
                  <code className="min-w-0 shrink-0 truncate font-mono text-sm text-foreground/90">{ref}</code>
                  <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
                    {trigTitle ? `${trigTitle} · ` : ""}
                    {row.reason}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">{timeAgo(row.created_at)}</span>
                  {row.matched ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <MinusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
