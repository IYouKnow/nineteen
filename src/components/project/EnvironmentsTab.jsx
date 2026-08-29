import { useState } from "react";
import { Plus, Trash2, GitBranch, Boxes, Layers, Rocket, Cog } from "lucide-react";
import StatusBadge from "@/components/dev/StatusBadge";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CREATEABLE_TYPES, getEnvType, PRODUCTION_ENV_ID } from "@/lib/environments";
import { cn } from "@/lib/utils";

export default function EnvironmentsTab({
  environments,
  selectedEnvId,
  onOpenEnv,
  onCreateEnv,
  onDeleteEnv,
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="animate-fade-in space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Environments</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Each environment has its own deployments, variables and infrastructure. Production is
            created by default — add more only when you need them.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-2">
          <Plus className="h-3.5 w-3.5" /> Add environment
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {environments.map((env) => {
          const t = getEnvType(env.type);
          const active = env.id === selectedEnvId;
          const isProd = env.id === PRODUCTION_ENV_ID;
          return (
            <div
              key={env.id}
              className={cn(
                "rounded-lg border bg-card p-4 transition-colors",
                active ? "border-primary/50 ring-1 ring-primary/40" : "border-border"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-lg border"
                    style={{ color: t.color, borderColor: `${t.color}44`, background: `${t.color}14` }}
                  >
                    <Layers className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{env.name}</p>
                      {isProd && (
                        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          default
                        </span>
                      )}
                      {active && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          current
                        </span>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: t.color }}>
                      {t.label}
                    </span>
                  </div>
                </div>
                <StatusBadge status={env.status} />
              </div>

              <div className="mt-3 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <GitBranch className="h-3 w-3" /> {env.branch || "main"}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => onOpenEnv(env.id, "deployments")} className="gap-1.5">
                  <Rocket className="h-3.5 w-3.5" /> Deployments
                </Button>
                <Button variant="outline" size="sm" onClick={() => onOpenEnv(env.id, "architecture")} className="gap-1.5">
                  <Boxes className="h-3.5 w-3.5" /> Architecture
                </Button>
                <Button variant="outline" size="sm" onClick={() => onOpenEnv(env.id, "settings")} className="gap-1.5">
                  <Cog className="h-3.5 w-3.5" /> Config
                </Button>
                {!isProd && (
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Delete environment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    }
                    title={`Delete "${env.name}" environment?`}
                    description="This removes the environment and its local configuration. This action cannot be undone."
                    confirmLabel="Delete environment"
                    onConfirm={() => onDeleteEnv(env.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CreateEnvironmentDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={onCreateEnv} />
    </div>
  );
}

function CreateEnvironmentDialog({ open, onOpenChange, onCreate }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("staging");
  const [branch, setBranch] = useState("");

  const reset = () => {
    setName("");
    setType("staging");
    setBranch("");
  };

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), type, branch: branch.trim() || "main" });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New environment</DialogTitle>
          <DialogDescription>
            Add an isolated environment with its own deployments, variables and infrastructure.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Staging"
              className="mt-1.5"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {CREATEABLE_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    type === t.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/30"
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Branch (optional)</Label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="mt-1.5 font-mono"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The source branch this environment tracks. Defaults to <span className="font-mono">main</span>.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            Create environment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}