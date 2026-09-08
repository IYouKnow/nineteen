import { Link } from "react-router-dom";
import { ArrowUpRight, Layers } from "lucide-react";
import StorageTypeIcon from "./StorageTypeIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import { getBucketProvider, buildBucketEndpoint, formatBytes } from "@/lib/storage";

export default function BucketCard({ bucket, projects = [] }) {
  const p = getBucketProvider(bucket.type);
  return (
    <Link
      to={`/storage/buckets/${bucket.id}`}
      className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-all hover:border-foreground/20 hover:bg-card/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <StorageTypeIcon kind="bucket" type={bucket.type} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{bucket.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {p.label} · {formatBytes(bucket.used_bytes)}
            </p>
          </div>
        </div>
        <StatusBadge status={bucket.status} kind="bucket" />
      </div>
      {bucket.description && (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{bucket.description}</p>
      )}
      <p className="mt-3 truncate font-mono text-xs text-muted-foreground/80">
        {buildBucketEndpoint(bucket)}
      </p>
      <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3">
        <Layers className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {projects.slice(0, 2).map((pname) => (
            <span
              key={pname}
              className="max-w-[80px] truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {pname}
            </span>
          ))}
          {projects.length > 2 && (
            <span className="text-[10px] text-muted-foreground/60">+{projects.length - 2}</span>
          )}
          <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 transition group-hover:text-foreground" />
        </div>
      </div>
    </Link>
  );
}
