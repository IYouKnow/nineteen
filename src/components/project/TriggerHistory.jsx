import { cn } from "@/lib/utils";
import { GitCommitHorizontal, Tag, Rocket, Hand, History } from "lucide-react";

const SOURCES = {
  commit: { icon: GitCommitHorizontal, label: "Commit", badge: "bg-info/10 text-info border-info/25" },
  tag: { icon: Tag, label: "Tag", badge: "bg-warning/10 text-warning border-warning/25" },
  release: { icon: Rocket, label: "Release", badge: "bg-success/10 text-success border-success/25" },
  manual: { icon: Hand, label: "Manual", badge: "bg-muted/50 text-muted-foreground border-border" },
};

// Illustrative trigger history (frontend mock). Wired to real deployments later.
const HISTORY = [
  { id: "1", type: "commit", ref: "91bc22e", sub: "main · feat: add login flow", time: "2h ago", status: "ready" },
  { id: "2", type: "tag", ref: "v1.4.0", sub: "tag created", time: "1d ago", status: "ready" },
  { id: "3", type: "release", ref: "v1.3.0", sub: "release published", time: "3d ago", status: "ready" },
  { id: "4", type: "commit", ref: "a4f9c10", sub: "main · fix: cache invalidation", time: "3d ago", status: "ready" },
  { id: "5", type: "manual", ref: "manual", sub: "triggered by alex", time: "5d ago", status: "ready" },
  { id: "6", type: "commit", ref: "7e2bd44", sub: "develop · chore: bump deps", time: "6d ago", status: "error" },
];

export default function TriggerHistory() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground/60" />
        <h3 className="text-sm font-medium">Deployment activity</h3>
        <span className="text-xs text-muted-foreground">· how recent deployments were triggered</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border/60">
          {HISTORY.map((row) => {
            const src = SOURCES[row.type];
            const Icon = src.icon;
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
                <code className="min-w-0 shrink-0 truncate font-mono text-sm text-foreground/90">{row.ref}</code>
                <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">{row.sub}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">{row.time}</span>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    row.status === "ready" ? "bg-success" : "bg-destructive"
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}