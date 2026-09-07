import { dbEntities } from "@/lib/dbEntities";
import * as api from "@/lib/api";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { Plus, Search, Database, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/dev/EmptyState";
import DatabaseCard from "@/components/db/DatabaseCard";
import DatabaseRow from "@/components/db/DatabaseRow";
import { DB_TYPE_LIST } from "@/lib/databases";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "provisioning", label: "Provisioning" },
  { id: "error", label: "Error" },
  { id: "stopped", label: "Stopped" },
];

export default function Databases() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [searchParams] = useSearchParams();
  const urlFilter = searchParams.get("filter");

  useEffect(() => {
    if (urlFilter) setFilter(urlFilter);
  }, [urlFilter]);

  const { data: databases = [], isLoading } = useQuery({
    queryKey: ["databases"],
    queryFn: () => dbEntities.Database.list("-created_date", 100),
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["db-connections-all"],
    queryFn: () => dbEntities.DatabaseConnection.list("-created_date", 200),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  const projectsById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects]
  );
  const projectsByDb = useMemo(() => {
    const map = {};
    for (const c of connections) {
      (map[c.database_id] ||= []).push(projectsById[c.project_id]?.name || c.project_name || "project");
    }
    return map;
  }, [connections, projectsById]);

  const filtered = useMemo(() => {
    return databases.filter((d) => {
      if (filter !== "all" && d.status !== filter) return false;
      if (typeFilter !== "all" && d.type !== typeFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          d.name?.toLowerCase().includes(q) ||
          d.description?.toLowerCase().includes(q) ||
          d.type?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [databases, query, filter, typeFilter]);

  const noFilters = !query && filter === "all" && typeFilter === "all";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {databases.length} database{databases.length === 1 ? "" : "s"} ·{" "}
            {connections.length} connection{connections.length === 1 ? "" : "s"} · region fra1
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/databases/new">
            <Plus className="h-4 w-4" /> New Database
          </Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search databases…"
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.id}
              to={`/databases?filter=${f.id}`}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
          <button
            onClick={() => setView("grid")}
            className={cn(
              "rounded p-1.5 transition-colors",
              view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView("list")}
            className={cn(
              "rounded p-1.5 transition-colors",
              view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setTypeFilter("all")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            typeFilter === "all"
              ? "border-foreground/30 bg-muted text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          All types
        </button>
        {DB_TYPE_LIST.map((t) => (
          <button
            key={t.id}
            onClick={() => setTypeFilter(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              typeFilter === t.id
                ? "border-foreground/30 bg-muted text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[156px] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Database}
            title={noFilters ? "No databases yet" : "No matching databases"}
            description={
              noFilters
                ? "Create your first database resource — it can be shared across projects."
                : "Try adjusting your search or filters."
            }
            action={
              noFilters ? (
                <Button asChild className="gap-2">
                  <Link to="/databases/new">
                    <Plus className="h-4 w-4" /> New Database
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((d) => (
              <DatabaseCard key={d.id} db={d} projects={projectsByDb[d.id] || []} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-1">
            <div className="divide-y divide-border/60">
              {filtered.map((d) => (
                <DatabaseRow key={d.id} db={d} projects={projectsByDb[d.id] || []} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}