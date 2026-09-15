import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";
import { STRATEGY_TYPES, BRANCHES, strategyMeta, buildExamples } from "@/lib/strategies";

const DEFAULTS = {
  strategy: "commit",
  branch: "main",
  tag_mode: "pattern",
  tag_pattern: "v*",
  pre_release: false,
  enabled: true,
};

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function ExampleRow({ text, match }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">{text}</code>
      <span className={cn("shrink-0 text-xs", match ? "text-success" : "text-muted-foreground/50")}>
        {match ? "triggers" : "ignored"}
      </span>
    </div>
  );
}

export default function StrategyFormModal({ open, onOpenChange, project, trigger, onSaved }) {
  const [step, setStep] = useState("type");
  const [form, setForm] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const editing = !!trigger;

  useEffect(() => {
    if (!open) return;
    if (trigger) {
      setForm({
        strategy: trigger.strategy,
        branch: trigger.branch || project.branch || "main",
        tag_mode: trigger.tag_mode || "pattern",
        tag_pattern: trigger.tag_pattern || "v*",
        pre_release: !!trigger.pre_release,
        enabled: trigger.enabled !== false,
      });
      setStep("config");
    } else {
      setForm({ ...DEFAULTS, branch: project.branch || "main" });
      setStep("type");
    }
  }, [open, trigger, project.branch]);

  const meta = strategyMeta(form.strategy);
  const Icon = meta.icon;
  const ex = buildExamples(form.strategy, form.branch, form.tag_mode, form.pre_release);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        strategy: form.strategy,
        branch: form.branch,
        tag_mode: form.tag_mode,
        tag_pattern: form.tag_pattern,
        pre_release: form.pre_release,
        enabled: form.enabled,
      };
      const res = editing
        ? await api.projects.triggers.update(project.id, trigger.id, payload)
        : await api.projects.triggers.create(project.id, payload);
      if (res?.webhook_error) {
        toast.error("Strategy saved with a warning", { description: res.webhook_error });
      } else {
        const isGitHub = (project.provider || "github") === "github";
        toast.success(editing ? "Strategy updated" : "Strategy added", {
          description:
            isGitHub && res?.registered
              ? "Webhook registered with GitHub."
              : "Your trigger configuration has been saved.",
        });
      }
      onSaved?.(res);
      onOpenChange(false);
    } catch (e) {
      toast.error("Save failed", { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border bg-background">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit strategy" : "Add a strategy"}</DialogTitle>
          <DialogDescription>
            {step === "type"
              ? "Choose what should trigger a new deployment."
              : "Configure when this strategy fires."}
          </DialogDescription>
        </DialogHeader>

        {step === "type" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {STRATEGY_TYPES.map((opt) => {
              const OptIcon = opt.icon;
              const selected = form.strategy === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    set({ strategy: opt.id });
                    setStep("config");
                  }}
                  className={cn(
                    "group relative flex flex-col rounded-lg border p-4 text-left transition-all",
                    selected
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-foreground/20 hover:bg-muted/30"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                      selected
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground"
                    )}
                  >
                    <OptIcon className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-foreground">{opt.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{opt.description}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{meta.title}</p>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
              </div>
              {!editing && (
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setStep("type")}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Change
                </Button>
              )}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-3">
                {(form.strategy === "commit" || form.strategy === "branch") && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {form.strategy === "commit" ? "Branch" : "Watched branch"}
                    </label>
                    <select
                      className={selectCls}
                      value={form.branch}
                      onChange={(e) => set({ branch: e.target.value })}
                    >
                      {BRANCHES.map((b) => (
                        <option key={b} value={b} className="bg-card">
                          {b}
                        </option>
                      ))}
                    </select>
                    <p className="pt-1 text-xs text-muted-foreground/70">
                      {form.strategy === "commit"
                        ? `Every commit pushed to ${form.branch} will deploy automatically.`
                        : `Commits pushed to ${form.branch} will deploy automatically.`}
                    </p>
                  </div>
                )}

                {form.strategy === "tag" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Match</label>
                      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                        {["any", "pattern"].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => set({ tag_mode: m })}
                            className={cn(
                              "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                              form.tag_mode === m
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {m === "any" ? "Any tag" : "Pattern"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {form.tag_mode === "pattern" && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Tag pattern</label>
                        <Input
                          value={form.tag_pattern}
                          onChange={(e) => set({ tag_pattern: e.target.value })}
                          className="bg-card font-mono"
                          placeholder="v*"
                        />
                        <p className="text-xs text-muted-foreground/70">
                          Glob pattern. <code className="font-mono">v*</code> matches tags starting with{" "}
                          <code className="font-mono">v</code>.
                        </p>
                      </div>
                    )}
                  </>
                )}

                {form.strategy === "release" && (
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-3">
                    <div>
                      <p className="text-sm text-foreground">Include pre-releases</p>
                      <p className="text-xs text-muted-foreground">Also trigger on beta and rc releases.</p>
                    </div>
                    <Switch
                      checked={form.pre_release}
                      onCheckedChange={(v) => set({ pre_release: v })}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-3">
                  <div>
                    <p className="text-sm text-foreground">Enabled</p>
                    <p className="text-xs text-muted-foreground">Pause this strategy without deleting it.</p>
                  </div>
                  <Switch checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                  What triggers a deployment
                </p>
                <div className="space-y-1.5">
                  {ex.map((e, i) => (
                    <ExampleRow key={i} text={e.text} match={e.match} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || step === "type"} className="gap-2">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> {editing ? "Save changes" : "Add strategy"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
