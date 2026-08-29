import { useState } from "react";
import { ChevronRight, Table2, KeyRound, Braces } from "lucide-react";
import { generateTables } from "@/lib/dbTables";
import { cn } from "@/lib/utils";

function ColumnBadges({ c }) {
  return (
    <span className="flex items-center gap-1">
      {c.primaryKey && (
        <span className="rounded bg-warning/10 px-1 py-px text-[9px] font-semibold text-warning">PK</span>
      )}
      {c.references && (
        <span className="rounded bg-info/10 px-1 py-px text-[9px] font-semibold text-info">FK</span>
      )}
      {c.unique && !c.primaryKey && (
        <span className="rounded bg-success/10 px-1 py-px text-[9px] font-semibold text-success">UNQ</span>
      )}
      {!c.nullable && !c.primaryKey && (
        <span className="rounded bg-muted/40 px-1 py-px text-[9px] font-medium text-muted-foreground">NN</span>
      )}
    </span>
  );
}

export default function DatabaseTables({ db }) {
  const [open, setOpen] = useState(null);
  const { kind, label, items } = generateTables(db);

  if (kind === "keys") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{label}</h3>
          <span className="text-xs text-muted-foreground">{items.length} keys</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {items.map((k, i) => (
            <div key={k.name} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border/60")}>
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{k.name}</code>
              <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{k.type}</span>
              <span className="w-16 text-right text-[10px] text-muted-foreground">TTL {k.ttl}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{label}</h3>
        <span className="text-xs text-muted-foreground">{items.length} {kind === "collections" ? "collections" : "tables"}</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {items.map((t, i) => {
          const isOpen = open === t.name;
          return (
            <div key={t.name} className={cn(i > 0 && "border-t border-border/60")}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : t.name)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                {kind === "collections" ? (
                  <Braces className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                ) : (
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                )}
                <span className="flex-1 truncate text-sm font-medium text-foreground">{t.name}</span>
                <span className="text-[11px] text-muted-foreground">{t.columns.length} columns</span>
                {t.rows !== undefined && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{t.rows.toLocaleString()} rows</span>
                  </>
                )}
              </button>

              {isOpen && (
                <div className="border-t border-border/60 bg-background/30">
                  <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    <span className="col-span-4">Column</span>
                    <span className="col-span-3">Type</span>
                    <span className="col-span-5">Constraints</span>
                  </div>
                  {t.columns.map((c, j) => (
                    <div key={c.name} className={cn("grid grid-cols-12 items-center gap-2 px-4 py-2", j > 0 && "border-t border-border/40")}>
                      <code className="col-span-4 truncate font-mono text-xs text-foreground">{c.name}</code>
                      <code className="col-span-3 truncate font-mono text-[11px] text-info">{c.type}</code>
                      <div className="col-span-5 flex flex-wrap items-center gap-1.5">
                        <ColumnBadges c={c} />
                        {c.default && <code className="font-mono text-[10px] text-muted-foreground">= {c.default}</code>}
                        {c.references && <code className="font-mono text-[10px] text-muted-foreground">→ {c.references}</code>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}