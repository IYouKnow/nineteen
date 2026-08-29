const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { Plus, Search, FolderGit2, ArrowUpRight, LayoutGrid, List } from "lucide-react";
import StatusBadge from "@/components/dev/StatusBadge";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import EmptyState from "@/components/dev/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { getFramework } from "@/lib/devStatus";
import { cn } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "building", label: "Building" },
  { id: "error", label: "Error" },
  { id: "idle", label: "Idle" },
];

function ProjectCard({ project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-all hover:border-foreground/20 hover:bg-card/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <FrameworkIcon framework={project.framework} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {project.repository || "no repository"}
            </p>
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>
      {project.description && (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
      )}
      <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span className="font-mono">{getFramework(project.framework).label}</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="font-mono">{project.branch || "main"}</span>
        <span className="ml-auto flex items-center gap-1">
          {timeAgo(project.last_deployed_at)}
          <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 transition group-hover:text-foreground" />
        </span>
      </div>
    </Link>
  );
}

function ProjectRow({ project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/30"
    >
      <FrameworkIcon framework={project.framework} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {project.repository || "no repository"}
        </p>
      </div>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {getFramework(project.framework).label}
      </span>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {project.branch || "main"}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {timeAgo(project.last_deployed_at)}
      </span>
      <StatusBadge status={project.status} />
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition group-hover:text-foreground" />
    </Link>
  );
}

export default function Projects() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [searchParams] = useSearchParams();
  const urlFilter = searchParams.get("filter") || "all";

  useEffect(() => {
    setFilter(urlFilter);
  }, [urlFilter]);

  const { data: projects, isLoading, isError } = useQuery({
    queryKey: ["projects"],
    queryFn: () => db.entities.Project.list("-created_date", 100),
    enabled: true,
  });

  const filtered = useMemo(() => {
    const list = projects || [];
    return list.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          p.name?.toLowerCase().includes(q) ||
          p.repository?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [projects, query, filter]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {(projects || []).length} project{(projects || []).length === 1 ? "" : "s"} deployed to fra1
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/projects/new">
            <Plus className="h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects or repositories…"
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              to={`/projects?filter=${f.id}`}
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

      <div className="mt-5">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[140px] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title={query || filter !== "all" ? "No matching projects" : "No projects yet"}
            description={
              query || filter !== "all"
                ? "Try adjusting your search or filters."
                : "Import a repository from GitHub to deploy your first project."
            }
            action={
              !query && filter === "all" ? (
                <Button asChild className="gap-2">
                  <Link to="/projects/new">
                    <Plus className="h-4 w-4" />
                    New Project
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-1">
            <div className="divide-y divide-border/60">
              {filtered.map((p) => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}