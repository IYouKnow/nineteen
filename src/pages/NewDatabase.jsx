import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ArrowLeft, ArrowRight, Loader2, Rocket, Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import Stepper from "@/components/newproject/Stepper";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import { DB_TYPE_LIST, getDbType } from "@/lib/databases";
import { dbEntities } from "@/lib/dbEntities";

const SUPPORTED_DB_TYPES = ["postgresql", "mysql", "mariadb"];
const DEFAULT_INSTANCE_SIZE = "small";

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
    database_name: "app",
    username: "app",
    password: "",
    description: "",
  });
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const meta = type ? getDbType(type) : null;
  const effectiveVersion = config.version || meta?.defaultVersion || "";
  const host = "localhost";
  const passwordError = config.password && config.password.length < 8 ? "At least 8 characters" : null;
  const canContinue =
    step === 0 ? !!type : config.name.trim().length > 0 && !passwordError;

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
        instance_size: DEFAULT_INSTANCE_SIZE,
        host,
        port: t.port,
        database_name: config.database_name || "app",
        username: config.username || "app",
        ...(config.password ? { password: config.password } : {}),
        color: t.color,
        description: config.description,
      });
      qc.invalidateQueries({ queryKey: ["databases"] });
      navigate(`/databases/${created.id}`, {
        state: {
          password_once: created.password_once,
          connection_uri: created.connection_uri,
        },
      });
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
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
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                {DB_TYPE_LIST.map((t) => {
                  const supported = SUPPORTED_DB_TYPES.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      disabled={!supported}
                      onClick={() => supported && setType(t.id)}
                      className={cn(
                        "relative flex items-start gap-3 rounded-lg border p-4 text-left transition-all",
                        !supported && "cursor-not-allowed opacity-50",
                        type === t.id
                          ? "border-primary/50 bg-primary/5"
                          : supported
                            ? "border-border hover:border-foreground/20 hover:bg-muted/30"
                            : "border-border"
                      )}
                    >
                      {!supported && (
                        <span className="absolute right-3 top-3 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Soon
                        </span>
                      )}
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
                  );
                })}
              </div>
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
                  <Label>Password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={config.password}
                      onChange={(e) => setConfig({ ...config, password: e.target.value })}
                      className="bg-card pr-9 font-mono"
                      placeholder="Leave blank to auto-generate"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordError ? (
                    <p className="text-xs text-destructive">{passwordError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/70">
                      Optional — leave blank to auto-generate a secure password.
                    </p>
                  )}
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