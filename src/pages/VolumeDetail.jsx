import * as api from "@/lib/api";
import { storageEntities } from "@/lib/storageEntities";

import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ArrowLeft,
  MoreHorizontal,
  Trash2,
  Unplug,
  Loader2,
  Link2,
  Server,
  MapPin,
  Tag,
  Calendar,
  Layers,
  GitBranch,
  HardDrive,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import StorageTypeIcon from "@/components/storage/StorageTypeIcon";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import StatusDot from "@/components/dev/StatusDot";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import EmptyState from "@/components/dev/EmptyState";
import ConnectStorageDialog from "@/components/storage/ConnectStorageDialog";
import { getVolumeType, VOLUME_SIZES } from "@/lib/storage";
import { REGIONS } from "@/lib/devStatus";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "attachments", label: "Attachments" },
];

function InfoTile({ icon: Icon, label, value, mono }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        {label}
      </div>
      <p className={cn("mt-1.5 text-sm text-foreground/90", mono && "font-mono")}>{value}</p>
    </div>
  );
}

export default function VolumeDetail() {
  const { volumeId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data: volume, isLoading } = useQuery({
    queryKey: ["storage", "volume", volumeId],
    queryFn: () => storageEntities.Volume.get(volumeId),
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["storage-connections", volumeId],
    queryFn: () => storageEntities.Connection.list({ storage_id: volumeId, storage_type: "volume" }),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const connected = connections
    .map((c) => ({ conn: c, project: projectsById[c.project_id] }))
    .filter((x) => x.project);

  const remove = async () => {
    if (connections.length) await storageEntities.Connection.removeForStorage(volumeId, "volume");
    await storageEntities.Volume.remove(volumeId);
    qc.invalidateQueries({ queryKey: ["storage", "volumes"] });
    qc.invalidateQueries({ queryKey: ["storage-connections-all"] });
    navigate("/storage");
  };

  const disconnect = async (conn) => {
    setBusy(conn.id);
    try {
      await storageEntities.Connection.remove(volumeId, "volume", conn.id);
      qc.invalidateQueries({ queryKey: ["storage-connections", volumeId] });
      qc.invalidateQueries({ queryKey: ["storage-connections-all"] });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !volume) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        <Skeleton className="mt-4 h-10 w-full rounded-md" />
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </div>
    );
  }

  const vtype = getVolumeType(volume.type);
  const size = VOLUME_SIZES.find((s) => s.value === volume.size) || { label: `${volume.size} GB` };
  const region = REGIONS.find((r) => r.id === volume.region) || REGIONS[0];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link
        to="/storage"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to storage
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <StorageTypeIcon kind="volume" type={volume.type} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight">{volume.name}</h1>
              <StatusBadge status={volume.status} kind="volume" />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
              <span>{vtype.label}</span>
              <span className="text-muted-foreground/30">·</span>
              <span>{size.label}</span>
              <span className="text-muted-foreground/30">·</span>
              <span>{region.flag} {region.label}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)} className="gap-2">
            <Link2 className="h-3.5 w-3.5" /> Attach project
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 border-border bg-popover">
              <ConfirmDialog
                trigger={
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                }
                title={`Delete "${volume.name}"?`}
                description="This permanently removes the volume and its data. Attached projects will lose their mount."
                confirmLabel="Delete volume"
                onConfirm={remove}
              />
              <DropdownMenuSeparator className="bg-border" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-6 border-b border-border">
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative px-3 py-2.5 text-sm transition-colors",
                tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6 animate-fade-in">
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="relative">
                <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
                <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-4">
                    <StorageTypeIcon kind="volume" type={volume.type} size="lg" />
                    <div>
                      <div className="flex items-center gap-2.5">
                        <StatusDot status={volume.status} kind="volume" className="h-2.5 w-2.5" />
                        <span className="text-lg font-semibold capitalize tracking-tight">{volume.status}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {vtype.label} · {size.label} · {region.flag} {region.label}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Mount</h3>
              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">Path</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
                    {volume.mount_path || "—"}
                  </code>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">Device</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
                    /dev/nineteen/{volume.slug || volume.name}
                  </code>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Details</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <InfoTile icon={Tag} label="Filesystem" value={vtype.label} />
                <InfoTile icon={HardDrive} label="Size" value={size.label} />
                <InfoTile icon={Server} label="Device" value={volume.slug || volume.name} mono />
                <InfoTile icon={MapPin} label="Region" value={region.label} />
                <InfoTile icon={Layers} label="Projects" value={connected.length} />
                <InfoTile icon={GitBranch} label="Mount" value={volume.mount_path || "—"} mono />
                <InfoTile icon={Calendar} label="Created" value={formatDate(volume.created_date, "MMM d, yyyy")} />
                <InfoTile icon={Calendar} label="Updated" value={formatDate(volume.updated_date, "MMM d, yyyy")} />
              </div>
            </div>
          </div>
        )}

        {tab === "attachments" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Attached projects</h3>
                <p className="text-xs text-muted-foreground">
                  This volume is mounted into {connected.length} project{connected.length === 1 ? "" : "s"}.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)} className="gap-2">
                <Link2 className="h-3.5 w-3.5" /> Attach project
              </Button>
            </div>

            {connected.length === 0 ? (
              <EmptyState
                icon={Link2}
                title="No attached projects"
                description="Attach this volume to one or more projects so they can mount it."
                action={
                  <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)} className="gap-2">
                    <Link2 className="h-3.5 w-3.5" /> Attach project
                  </Button>
                }
              />
            ) : (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <StorageTypeIcon kind="volume" type={volume.type} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{volume.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {vtype.label} · {size.label}
                    </p>
                  </div>
                </div>
                <div className="ml-[18px] space-y-1 border-l border-border/70 pl-6">
                  {connected.map(({ conn, project: p }) => (
                    <div key={conn.id} className="group relative flex items-center gap-3 py-2">
                      <span className="absolute -left-6 top-1/2 h-px w-5 border-t border-border/70" />
                      <FrameworkIcon framework={p.framework} />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/projects/${p.id}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {p.name}
                        </Link>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          mounted at {conn.mount_path || volume.mount_path || "—"}
                        </p>
                      </div>
                      <StatusBadge status={p.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={busy === conn.id}
                        onClick={() => disconnect(conn)}
                        title="Detach"
                      >
                        {busy === conn.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Unplug className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConnectStorageDialog
        storage={volume}
        kind="volume"
        open={connectOpen}
        onOpenChange={setConnectOpen}
        connectedIds={connections.map((c) => c.project_id)}
      />
    </div>
  );
}
