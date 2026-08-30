import db from '@/lib/db';

import { useState, useEffect } from "react";
import { Database, Zap, Archive, Share2, Plug, ArrowRight, ChevronLeft, Table2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import { getDbType } from "@/lib/databases";
import { getRole } from "@/lib/architecture";
import { getTableNames } from "@/lib/dbTables";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS = { primary: Database, cache: Zap, backup: Archive, shared: Share2, service: Plug };

const CATEGORIES = [
  { id: "primary", label: "Primary database", description: "Your app's main database for storing core data." },
  { id: "cache", label: "Cache", description: "Use Redis as a fast cache for frequently accessed data." },
  { id: "backup", label: "Backup", description: "Create a backup of an existing database for recovery." },
  { id: "shared", label: "Shared database", description: "Connect a database already used by another project." },
  { id: "service", label: "Existing service", description: "Connect any other existing database or service." },
];

function DbOption({ db, selected, onSelect, extra }) {
  const t = getDbType(db.type);
  return (
    <button
      type="button"
      onClick={() => onSelect(db)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-foreground/15 hover:bg-muted/30"
      )}
    >
      <DbTypeIcon type={db.type} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{db.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {t.label}
          {db.version ? ` · ${db.version}` : ""}
        </p>
        {extra}
      </div>
    </button>
  );
}

export default function AddConnectionDialog({
  open,
  onOpenChange,
  databases,
  currentConnections,
  sharingByDb,
  onAdd,
}) {
  const [step, setStep] = useState("category");
  const [category, setCategory] = useState(null);
  const [target, setTarget] = useState(null);
  const [source, setSource] = useState(null);
  const [scopeMode, setScopeMode] = useState("all");
  const [scopeTables, setScopeTables] = useState([]);

  useEffect(() => {
    if (open) {
      setStep("category");
      setCategory(null);
      setTarget(null);
      setSource(null);
      setScopeMode("all");
      setScopeTables([]);
    }
  }, [open]);

  const connectedIds = new Set(currentConnections.map((c) => c.databaseId));
  const pool = databases.filter((d) => !connectedIds.has(d.id));
  const chooseTarget = (d) => {
    setTarget(d);
    setScopeMode("all");
    setScopeTables([]);
  };
  const toggleScopeTable = (t) =>
    setScopeTables((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const pickPool = () => {
    if (category === "cache") return pool.filter((d) => d.type === "redis");
    if (category === "shared") return pool.filter((d) => (sharingByDb[d.id] || []).length > 0);
    return pool;
  };
  const sources = currentConnections.filter((c) => c.role !== "backup");

  const canAdd = () => (category === "backup" ? !!source && !!target : !!target);

  const submit = () => {
    if (!canAdd()) return;
    if (category === "backup") {
      onAdd({
        id: `local-${target.id}-${Date.now()}`,
        databaseId: target.id,
        name: target.name,
        type: target.type,
        status: target.status || "running",
        version: target.version,
        role: "backup",
        backupOf: { id: source.databaseId, name: source.name },
        sharedWith: [],
        scope: "all",
        selectedTables: [],
        isMock: true,
      });
    } else {
      onAdd({
        id: `local-${target.id}-${Date.now()}`,
        databaseId: target.id,
        name: target.name,
        type: target.type,
        status: target.status || "running",
        version: target.version,
        role: category === "service" ? "service" : category,
        backupOf: null,
        sharedWith: category === "shared" ? sharingByDb[target.id] || [] : [],
        scope: scopeMode,
        selectedTables: scopeMode === "tables" ? scopeTables : [],
        isMock: true,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "configure" && (
              <button
                onClick={() => setStep("category")}
                className="text-muted-foreground hover:text-foreground"
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {step === "category" ? "What do you want to add?" : `Add ${getRole(category).label.toLowerCase()}`}
          </DialogTitle>
          <DialogDescription>
            {step === "category"
              ? "Choose the role this service plays for your application."
              : getRole(category).description}
          </DialogDescription>
        </DialogHeader>

        {step === "category" ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICONS[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategory(c.id);
                    setStep("configure");
                    setTarget(null);
                    setSource(null);
                  }}
                  className="group flex items-start gap-3 rounded-lg border border-border p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground group-hover:text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{c.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : category === "backup" ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                What is being backed up
              </p>
              <div className="space-y-1.5">
                {sources.length === 0 && (
                  <p className="text-xs text-muted-foreground">Connect a database first to back it up.</p>
                )}
                {sources.map((c) => (
                  <DbOption
                    key={c.id}
                    db={{ id: c.databaseId, name: c.name, type: c.type, version: c.version }}
                    selected={source && source.databaseId === c.databaseId}
                    onSelect={() => setSource(c)}
                  />
                ))}
              </div>
            </div>
            {source && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                  <span>Where it's stored</span>
                  <ArrowRight className="h-3 w-3" />
                  <code className="font-mono normal-case text-foreground/70">{source.name} → backup</code>
                </div>
                <div className="space-y-1.5">
                  {pool.length === 0 && (
                    <p className="text-xs text-muted-foreground">No available databases to use as backup.</p>
                  )}
                  {pool.map((d) => (
                    <DbOption key={d.id} db={d} selected={target && target.id === d.id} onSelect={chooseTarget} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              {category === "shared"
                ? "Databases shared by other projects"
                : category === "cache"
                ? "Available caches"
                : "Available databases"}
            </p>
            {pickPool().length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No available databases. Create one in the Databases area first.
              </p>
            ) : (
              pickPool().map((d) => (
                <DbOption
                  key={d.id}
                  db={d}
                  selected={target && target.id === d.id}
                  onSelect={chooseTarget}
                  extra={
                    category === "shared" && (sharingByDb[d.id] || []).length > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">used by</span>
                        {(sharingByDb[d.id] || []).map((p) => (
                          <span
                            key={p}
                            className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    ) : null
                  }
                />
              ))
            )}

            {target && category !== "cache" && (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Connection scope</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setScopeMode("all"); setScopeTables([]); }}
                    className={cn(
                      "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      scopeMode === "all" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                    )}
                  >
                    Entire database
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeMode("tables")}
                    className={cn(
                      "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      scopeMode === "tables" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                    )}
                  >
                    Specific tables
                  </button>
                </div>
                {scopeMode === "tables" && (
                  <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    {getTableNames(target).map((t) => (
                      <label
                        key={t}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 hover:bg-muted/30"
                      >
                        <Checkbox checked={scopeTables.includes(t)} onCheckedChange={() => toggleScopeTable(t)} />
                        <Table2 className="h-3 w-3 text-muted-foreground/60" />
                        <span className="truncate font-mono text-[11px] text-foreground/90">{t}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === "configure" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canAdd()}>
              Add connection
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}