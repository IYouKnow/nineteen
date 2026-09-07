import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ArrowLeft, ArrowRight, Loader2, Rocket, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import Stepper from "@/components/newproject/Stepper";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import { DB_TYPE_LIST, DB_INSTANCE_SIZES, getDbType } from "@/lib/databases";
import { dbEntities } from "@/lib/dbEntities";
import { REGIONS } from "@/lib/devStatus";

const STEPS = [
  { id: "type", label: "Type" },
  { id: "config", label: "Configuration" },
];

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-not-allowed disabled:opacity-50";

export default function NewDatabase() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [type, setType] = useState(null);
  const [config, setConfig] = useState({
    name: "",
    version: "",
    region: "fra1",
    instance_size: "small",
    database_name: "app",
    username: "app",
    description: "",
  });
  const [creating, setCreating] = useState(false);

  const meta = type ? getDbType(type) : null;
  const effectiveVersion = config.version || meta?.defaultVersion || "";
  const slug = (config.name || "database")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const host = `db-${slug}.fra1.nineteen.app`;
  const canContinue = step === 0 ? !!type : config.name.trim().length > 0;

  const create = async () => {
    if (!type || !config.name.trim()) return;
    setCreating(true);
    try {
      const t = getDbType(type);
      const created = await dbEntities.Database.create({
        name: config.name.trim(),
        type,
        status: "provisioning",
        version: effectiveVersion,
        region: config.region,
        instance_size: config.instance_size,
        host,
        port: t.port,
        database_name: config.database_name || "app",
        username: config.username || "app",
        color: t.color,
        description: config.description,
      });
      qc.invalidateQueries({ queryKey: ["databases"] });
      navigate(`/databases/${created.id}`);
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <button
        onClick={() => navigate("/databases")}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to databases
      </button>

      <h1 className="text-2xl font-semibold tracking-tight">New Database</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Provision a managed database resource. It can be connected to one or more projects.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Stepper steps={STEPS} current={step} />
        </div>

        <div className="px-6 py-6">
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {DB_TYPE_LIST.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-4 text-left transition-all",
                    type === t.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-foreground/20 hover:bg-muted/30"
                  )}
                >
                  <DbTypeIcon type={t.id} size="lg" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{t.label}</p>
                      {type === t.id && <Check className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/70">
                      v {t.defaultVersion} · port {t.port}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 1 && meta && (
            <div className="grid gap-6 md:grid-cols-5">
              <div className="space-y-4 md:col-span-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Database name</Label>
                  <Input
                    id="name"
                    value={config.name}
                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                    placeholder="production-db"
                    className="bg-card font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Version</Label>
                    <select
                      className={selectCls}
                      value={effectiveVersion}
                      onChange={(e) => setConfig({ ...config, version: e.target.value })}
                    >
                      {meta.versions.map((v) => (
                        <option key={v} value={v} className="bg-card">
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Region</Label>
                    <select
                      className={selectCls}
                      value={config.region}
                      onChange={(e) => setConfig({ ...config, region: e.target.value })}
                    >
                      {REGIONS.map((r) => (
                        <option key={r.id} value={r.id} className="bg-card">
                          {r.flag} {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Instance size</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {DB_INSTANCE_SIZES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setConfig({ ...config, instance_size: s.id })}
                        className={cn(
                          "rounded-md border px-3 py-2 text-left transition-colors",
                          config.instance_size === s.id
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:border-foreground/20"
                        )}
                      >
                        <p className="text-sm font-medium text-foreground">{s.label}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {s.cpu} · {s.ram}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Database name</Label>
                    <Input
                      value={config.database_name}
                      onChange={(e) => setConfig({ ...config, database_name: e.target.value })}
                      className="bg-card font-mono"
                      placeholder="app"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input
                      value={config.username}
                      onChange={(e) => setConfig({ ...config, username: e.target.value })}
                      className="bg-card font-mono"
                      placeholder="app"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea
                    value={config.description}
                    onChange={(e) => setConfig({ ...config, description: e.target.value })}
                    rows={2}
                    className="resize-none bg-card"
                    placeholder="Primary transactional database"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                    Preview
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <DbTypeIcon type={type} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {config.name || "database-name"}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {meta.label} · {effectiveVersion}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-1.5 font-mono text-xs text-muted-foreground">
                    <p><span className="text-muted-foreground/60">host   </span> {host}</p>
                    <p><span className="text-muted-foreground/60">port   </span> {meta.port}</p>
                    <p><span className="text-muted-foreground/60">db     </span> {config.database_name || "—"}</p>
                    <p><span className="text-muted-foreground/60">user   </span> {config.username || "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? navigate("/databases") : setStep(0))}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(1)} disabled={!canContinue} className="gap-2">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={create} disabled={creating} className="gap-2">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Provisioning…
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" /> Create database
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}