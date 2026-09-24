import { useEffect } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { STRATEGY_TYPES, buildExamples } from "@/lib/strategies";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const MANUAL = {
  id: "manual",
  icon: GitCommitHorizontal,
  title: "Manual only",
  description: "Deploy on demand from the project page. No automatic deployments.",
};

const OPTIONS = [MANUAL, ...STRATEGY_TYPES];

function OptionCard({ opt, active, disabled, onClick }) {
  const Icon = opt.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border p-3 text-left transition-all",
        disabled
          ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
          : active
            ? "border-primary bg-primary/5 ring-1 ring-primary"
            : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", active && !disabled ? "text-primary" : "text-muted-foreground")} />
        <p className="text-sm font-medium text-foreground">{opt.title}</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{opt.description}</p>
    </button>
  );
}

// StrategyStep lets the user pick an automatic deployment strategy (or manual
// only) while creating the project, mirroring the project's Strategy tab. A
// release/tag strategy follows new tags, a commit/branch strategy follows new
// commits — either way the pinned version is only the initial deploy.
export default function StrategyStep({ config, setConfig, branch }) {
  const strategy = config.strategy || { type: "manual" };
  const update = (patch) => setConfig((c) => ({ ...c, strategy: { ...c.strategy, ...patch } }));

  // Default the watched branch to the project's production branch.
  useEffect(() => {
    if ((strategy.type === "commit" || strategy.type === "branch") && !strategy.branch) {
      update({ branch: branch || "main" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy.type, branch]);

  const type = strategy.type || "manual";
  const ex = buildExamples(type, strategy.branch || branch || "main", strategy.tag_mode, strategy.pre_release);

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">When should it deploy?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick an automatic deployment strategy, or keep it manual and deploy on demand.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {OPTIONS.map((opt) => (
          <OptionCard
            key={opt.id}
            opt={opt}
            active={type === opt.id}
            onClick={() => update({ type: opt.id })}
          />
        ))}
      </div>

      {type !== "manual" && (
        <div className="mt-5 grid gap-5 rounded-lg border border-border bg-muted/15 p-4 md:grid-cols-2">
          <div className="space-y-4">
            {(type === "commit" || type === "branch") && (
              <div>
                <Label className="text-xs">
                  {type === "commit" ? "Branch" : "Watched branch"}
                </Label>
                <Input
                  value={strategy.branch ?? branch ?? "main"}
                  onChange={(e) => update({ branch: e.target.value })}
                  className="mt-1.5 font-mono text-sm"
                  placeholder="main"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {type === "commit"
                    ? "Every commit pushed to this branch deploys automatically."
                    : "Commits pushed to this branch deploy automatically."}
                </p>
              </div>
            )}

            {type === "tag" && (
              <>
                <div>
                  <Label className="text-xs">Match</Label>
                  <div className="mt-1.5 flex items-center gap-1 rounded-md border border-border p-0.5">
                    {["any", "pattern"].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => update({ tag_mode: m })}
                        className={cn(
                          "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                          (strategy.tag_mode || "pattern") === m
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {m === "any" ? "Any tag" : "Pattern"}
                      </button>
                    ))}
                  </div>
                </div>
                {(strategy.tag_mode || "pattern") === "pattern" && (
                  <div>
                    <Label className="text-xs">Tag pattern</Label>
                    <Input
                      value={strategy.tag_pattern ?? "v*"}
                      onChange={(e) => update({ tag_pattern: e.target.value })}
                      className="mt-1.5 font-mono text-sm"
                      placeholder="v*"
                    />
                  </div>
                )}
              </>
            )}

            {type === "release" && (
              <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-3">
                <div>
                  <p className="text-sm text-foreground">Include pre-releases</p>
                  <p className="text-xs text-muted-foreground">Also trigger on beta and rc releases.</p>
                </div>
                <Switch
                  checked={!!strategy.pre_release}
                  onCheckedChange={(v) => update({ pre_release: v })}
                />
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              What triggers a deployment
            </p>
            <div className="space-y-1.5">
              {ex.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2"
                >
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
                    {e.text}
                  </code>
                  <span className={cn("shrink-0 text-xs", e.match ? "text-success" : "text-muted-foreground/50")}>
                    {e.match ? "triggers" : "ignored"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
