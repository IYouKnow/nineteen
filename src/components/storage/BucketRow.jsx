import { Link } from "react-router-dom";
import { ArrowUpRight, Layers } from "lucide-react";
import StorageTypeIcon from "./StorageTypeIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import { getBucketProvider, buildBucketEndpoint, formatBytes } from "@/lib/storage";

export default function BucketRow({ bucket, projects = [] }) {
  const p = getBucketProvider(bucket.type);
  return (
    <Link
      to={`/storage/buckets/${bucket.id}`}
      className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/30"
    >
      <StorageTypeIcon kind="bucket" type={bucket.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{bucket.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {buildBucketEndpoint(bucket)}
        </p>
      </div>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {formatBytes(bucket.used_bytes)}
      </span>
      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
        <Layers className="h-3 w-3 text-muted-foreground/50" />
        {projects.length}
      </span>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{p.code}</span>
      <StatusBadge status={bucket.status} kind="bucket" />
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition group-hover:text-foreground" />
    </Link>
  );
}
