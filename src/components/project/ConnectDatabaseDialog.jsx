const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Plug, ChevronLeft, Table2 } from "lucide-react";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import { getDbType } from "@/lib/databases";
import { getTableNames } from "@/lib/dbTables";
import { cn } from "@/lib/utils";

export default function ConnectDatabaseDialog({ project, open, onOpenChange, connectedDbIds = [], onConnect }) {
  const qc = useQueryClient();
  const [step, setStep] = useState("select");
  const [selected, setSelected] = useState([]);
  const [scope, setScope] = useState({}); // { [dbId]: { mode: "all"|"tables", tables: [] } }
  const [saving, setSaving] = useState(false);

  const { data: databases = [], isLoading } = useQuery({
    queryKey: ["databases"],
    queryFn: () => db.entities.Database.list("-created_date", 100),
    enabled: open,
  });

  const available = databases.filter((d) => !connectedDbIds.includes(d.id));
  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const chosen = databases.filter((d) => selected.includes(d.id));
  const setScopeMode = (dbId, mode) =>
    setScope((s) => ({ ...s, [dbId]: { mode, tables: mode === "tables" ? getTableNames(dbId) : [] } }));
  const toggleTable = (dbId, table) =>
    setScope((s) => {
      const cur = s[dbId] || { mode: "tables", tables: [] };
      const tables = cur.tables.includes(table)
        ? cur.tables.filter((t) => t !== table)
        : [...cur.tables, table];
      return { ...s, [dbId]: { mode: "tables", tables } };
    });

  const reset = () => {
    setStep("select");
    setSelected([]);
    setScope({});
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = chosen.map((d) => {
        const sc = scope[d.id] || { mode: "all", tables: [] };
        return {
          db: d,
          scope: { mode: sc.mode === "tables" ? "tables" : "all", tables: sc.mode === "tables" ? sc.tables : [] },
        };
      });
      if (onConnect) {
        onConnect(payload);
        reset();
        onOpenChange(false);
        return;
      }
      await db.entities.DatabaseConnection.bulkCreate(
        payload.map((it) => ({
          database_id: it.db.id,
          database_name: it.db.name,
          database_type: it.db.type,
          project_id: project.id,
          project_name: project.name,
          scope: it.scope.mode,
          selected_tables: it.scope.mode === "tables" ? it.scope.tables.join(",") : "",
        }))
      );
      qc.invalidateQueries({ queryKey: ["project-databases", project.id] });
      qc.invalidateQueries({ queryKey: ["db-connections-all"] });
      qc.invalidateQueries({ queryKey: ["db-connections"] });
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {step === "scope" && (
              <button
                type="button"
                onClick={() => setStep("select")}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <Plug className="h-4 w-4" /> Connect databases to {project?.name}
          </DialogTitle>
          <DialogDescription>
            {step === "select"
              ? "Select databases to attach to this project. The same database can be shared by multiple projects."
              : "Choose whether each database is attached in full or only specific tables."}
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="max-h-72 overflow-y-auto -mx-1 px-1">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : available.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                All databases are already connected.
              </p>
            ) : (
              available.map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
                >
                  <Checkbox checked={selected.includes(d.id)} onCheckedChange={() => toggle(d.id)} />
                  <DbTypeIcon type={d.type} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{d.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {getDbType(d.type).label} · {d.version}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto -mx-1 px-1">
            {chosen.map((d) => {
              const sc = scope[d.id] || { mode: "all", tables: [] };
              const tables = getTableNames(d);
              return (
                <div key={d.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2.5">
                    <DbTypeIcon type={d.type} size="sm" />
                    <p className="flex-1 truncate text-sm font-medium text-foreground">{d.name}</p>
                  </div>
                  <div className="mt-2.5 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setScopeMode(d.id, "all")}
                      className={cn(
                        "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        sc.mode === "all" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                      )}
                    >
                      Entire database
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopeMode(d.id, "tables")}
                      className={cn(
                        "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        sc.mode === "tables" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                      )}
                    >
                      Specific tables
                    </button>
                  </div>
                  {sc.mode === "tables" && (
                    <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                      {tables.map((t) => (
                        <label
                          key={t}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 hover:bg-muted/30"
                        >
                          <Checkbox checked={sc.tables.includes(t)} onCheckedChange={() => toggleTable(d.id, t)} />
                          <Table2 className="h-3 w-3 text-muted-foreground/60" />
                          <span className="truncate font-mono text-[11px] text-foreground/90">{t}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {step === "scope" && (
            <Button variant="outline" onClick={() => setStep("select")} className="border-border">
              Back
            </Button>
          )}
          {step === "select" ? (
            <Button onClick={() => setStep("scope")} disabled={selected.length === 0} className="gap-2">
              Continue
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Connect {selected.length || ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}