import { storageEntities } from "@/lib/storageEntities";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { Plus, Search, HardDrive, Database, LayoutGrid, List, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/dev/EmptyState";
import BucketCard from "@/components/storage/BucketCard";
import BucketRow from "@/components/storage/BucketRow";
import VolumeCard from "@/components/storage/VolumeCard";
import VolumeRow from "@/components/storage/VolumeRow";
import { BUCKET_PROVIDER_LIST, VOLUME_TYPE_LIST } from "@/lib/storage";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "available", label: "Available" },
  { id: "attached", label: "Attached" },
  { id: "provisioning", label: "Provisioning" },
  { id: "error", label: "Error" },
];

const TABS = [
  { id: "buckets", label: "Buckets", icon: Database },
  { id: "volumes", label: "Volumes", icon: Folder },
];

export default function Storage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlType = searchParams.get("type") === "volumes" ? "volumes" : "buckets";
  const [type, setType] = useState(urlType);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [view, setView] = useState("grid");

  useEffect(() => {
    setType(urlType);
  }, [urlType]);

  const setTab = (id) => {
    setType(id);
    setSearchParams({ type: id });
    setFilter("all");
    setTypeFilter("all");
  };

  const { data: buckets = [], isLoading: bucketsLoading } = useQuery({
    queryKey: ["storage", "buckets"],
    queryFn: () => storageEntities.Bucket.list("-created_date", 100),
  });
  const { data: volumes = [], isLoading: volumesLoading } = useQuery({
    queryKey: ["storage", "volumes"],
    queryFn: () => storageEntities.Volume.list("-created_date", 100),
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["storage-connections-all"],
    queryFn: () => storageEntities.Connection.list({}),
  });

  const projectsByStorage = useMemo(() => {
    const map = {};
    for (const c of connections) {
      (map[`${c.storage_type}-${c.storage_id}`] ||= []).push(c.project_name || "project");
    }
    return map;
  }, [connections]);

  const isBucket = type === "buckets";
  const items = isBucket ? buckets : volumes;
  const isLoading = isBucket ? bucketsLoading : volumesLoading;
  const providers = isBucket ? BUCKET_PROVIDER_LIST : VOLUME_TYPE_LIST;

  const filtered = useMemo(() => {
    const field = isBucket ? "type" : "type";
    return items.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (typeFilter !== "all" && item[field] !== typeFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          item.name?.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.type?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, query, filter, typeFilter, isBucket]);

  const noFilters = !query && filter === "all" && typeFilter === "all";
  const storageKey = (item) => `${type}-${item.id}`;
  const projectsFor = (item) => projectsByStorage[storageKey(item)] || [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {buckets.length} bucket{buckets.length === 1 ? "" : "s"} · {volumes.length} volume
            {volumes.length === 1 ? "" : "s"} · region fra1
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link to={isBucket ? "/storage/buckets/new" : "/storage/volumes/new"}>
            <Plus className="h-4 w-4" /> New {isBucket ? "Bucket" : "Volume"}
          </Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                type === t.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${isBucket ? "buckets" : "volumes"}…`}
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
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
        {providers.map((t) => (
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
            icon={HardDrive}
            title={noFilters ? `No ${isBucket ? "buckets" : "volumes"} yet` : "No matching resources"}
            description={
              noFilters
                ? isBucket
                  ? "Create your first object storage bucket — it can be shared across projects."
                  : "Create your first persistent volume — it can be mounted into projects."
                : "Try adjusting your search or filters."
            }
            action={
              noFilters ? (
                <Button asChild className="gap-2">
                  <Link to={isBucket ? "/storage/buckets/new" : "/storage/volumes/new"}>
                    <Plus className="h-4 w-4" /> New {isBucket ? "Bucket" : "Volume"}
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) =>
              isBucket ? (
                <BucketCard key={item.id} bucket={item} projects={projectsFor(item)} />
              ) : (
                <VolumeCard key={item.id} volume={item} projects={projectsFor(item)} />
              )
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-1">
            <div className="divide-y divide-border/60">
              {filtered.map((item) =>
                isBucket ? (
                  <BucketRow key={item.id} bucket={item} projects={projectsFor(item)} />
                ) : (
                  <VolumeRow key={item.id} volume={item} projects={projectsFor(item)} />
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
