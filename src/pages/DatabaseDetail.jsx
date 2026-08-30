import db from '@/lib/db';

import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ArrowLeft,
  MoreHorizontal,
  RotateCw,
  Play,
  Square,
  Trash2,
  Copy,
  Check,
  Unplug,
  Loader2,
  Link2,
  Server,
  Cpu,
  MapPin,
  Tag,
  Calendar,
  Layers,
  GitBranch,
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
import DbTypeIcon from "@/components/db/DbTypeIcon";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import StatusDot from "@/components/dev/StatusDot";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import EmptyState from "@/components/dev/EmptyState";
import ConnectProjectsDialog from "@/components/db/ConnectProjectsDialog";
import DatabaseTables from "@/components/db/DatabaseTables";
import { getDbType, DB_INSTANCE_SIZES, buildConnectionString } from "@/lib/databases";
import { REGIONS } from "@/lib/devStatus";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "tables", label: "Tables" },
  { id: "connections", label: "Connections" },
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

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">{value}</code>
      <button onClick={copy} className="text-muted-foreground transition-colors hover:text-foreground" title="Copy">
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function DatabaseDetail() {
  const { databaseId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data: db, isLoading } = useQuery({
    queryKey: ["database", databaseId],
    queryFn: () => db.entities.Database.get(databaseId),
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["db-connections", databaseId],
    queryFn: () => db.entities.DatabaseConnection.filter({ database_id: databaseId }),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => db.entities.Project.list("-created_date", 100),
  });

  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const connected = connections
    .map((c) => ({ conn: c, project: projectsById[c.project_id] }))
    .filter((x) => x.project);

  const run = async (status) => {
    setBusy(status);
    try {
      await db.entities.Database.update(databaseId, { status });
      qc.invalidateQueries({ queryKey: ["database", databaseId] });
      qc.invalidateQueries({ queryKey: ["databases"] });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (connections.length) await db.entities.DatabaseConnection.deleteMany({ database_id: databaseId });
    await db.entities.Database.delete(databaseId);
    qc.invalidateQueries({ queryKey: ["databases"] });
    qc.invalidateQueries({ queryKey: ["db-connections-all"] });
    qc.invalidateQueries({ queryKey: ["project-databases"] });
    navigate("/databases");
  };

  const disconnect = async (conn) => {
    setBusy(conn.id);
    try {
      await db.entities.DatabaseConnection.delete(conn.id);
      qc.invalidateQueries({ queryKey: ["db-connections", databaseId] });
      qc.invalidateQueries({ queryKey: ["db-connections-all"] });
      qc.invalidateQueries({ queryKey: ["project-databases"] });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !db) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        <Skeleton className="mt-4 h-10 w-full rounded-md" />
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </div>
    );
  }

  const type = getDbType(db.type);
  const instance = DB_INSTANCE_SIZES.find((i) => i.id === db.instance_size) || DB_INSTANCE_SIZES[0];
  const region = REGIONS.find((r) => r.id === db.region) || REGIONS[0];
  const connStr = buildConnectionString(db);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link
        to="/databases"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to databases
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <DbTypeIcon type={db.type} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight">{db.name}</h1>
              <StatusBadge status={db.status} kind="database" />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
              <span>{type.label}</span>
              <span className="text-muted-foreground/30">·</span>
              <span>v{db.version}</span>
              <span className="text-muted-foreground/30">·</span>
              <span>{region.flag} {region.label}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)} className="gap-2">
            <Link2 className="h-3.5 w-3.5" /> Connect project
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 border-border bg-popover">
              <DropdownMenuItem onClick={() => run("running")} className="gap-2">
                <Play className="h-3.5 w-3.5" /> Start
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run("running")} className="gap-2">
                <RotateCw className="h-3.5 w-3.5" /> Restart
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run("stopped")} className="gap-2">
                <Square className="h-3.5 w-3.5" /> Stop
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <ConfirmDialog
                trigger={
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                }
                title={`Delete "${db.name}"?`}
                description="This permanently removes the database resource. Connected projects will lose access."
                confirmLabel="Delete database"
                onConfirm={remove}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs */}
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
                    <DbTypeIcon type={db.type} size="lg" />
                    <div>
                      <div className="flex items-center gap-2.5">
                        <StatusDot status={db.status} kind="database" className="h-2.5 w-2.5" />
                        <span className="text-lg font-semibold capitalize tracking-tight">{db.status}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {type.label} · {instance.label} ({instance.ram}) · {region.flag} {region.label}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Connection</h3>
              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <CopyField label="Host" value={db.host} />
                <CopyField label="Port" value={String(db.port || type.port)} />
                <CopyField label="Database" value={db.database_name || "—"} />
                <CopyField label="User" value={db.username || "—"} />
                <CopyField label="URI" value={connStr} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground/70">
                Credentials are managed securely and injected as environment variables into connected projects.
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Details</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <InfoTile icon={Tag} label="Type" value={type.label} />
                <InfoTile icon={GitBranch} label="Version" value={db.version || "—"} mono />
                <InfoTile icon={Cpu} label="Instance" value={instance.label} />
                <InfoTile icon={MapPin} label="Region" value={region.label} />
                <InfoTile icon={Server} label="Storage" value={instance.storage} />
                <InfoTile icon={Layers} label="Projects" value={connected.length} />
                <InfoTile icon={Calendar} label="Created" value={formatDate(db.created_date, "MMM d, yyyy")} />
                <InfoTile icon={RotateCw} label="Updated" value={formatDate(db.updated_date, "MMM d, yyyy")} />
              </div>
            </div>
          </div>
        )}

        {tab === "tables" && (
          <DatabaseTables db={db} />
        )}

        {tab === "connections" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Connected projects</h3>
                <p className="text-xs text-muted-foreground">
                  This database is shared across {connected.length} project{connected.length === 1 ? "" : "s"}.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)} className="gap-2">
                <Link2 className="h-3.5 w-3.5" /> Connect project
              </Button>
            </div>

            {connected.length === 0 ? (
              <EmptyState
                icon={Link2}
                title="No connected projects"
                description="Connect this database to one or more projects so they can use it."
                action={
                  <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)} className="gap-2">
                    <Link2 className="h-3.5 w-3.5" /> Connect project
                  </Button>
                }
              />
            ) : (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <DbTypeIcon type={db.type} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{db.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {type.label} · {db.host}:{db.port}
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
                          {p.repository || "no repository"}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground/70">
                          {conn.scope === "tables"
                            ? `${(conn.selected_tables || "").split(",").filter(Boolean).length} tables selected`
                            : "Entire database"}
                        </p>
                      </div>
                      <StatusBadge status={p.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={busy === conn.id}
                        onClick={() => disconnect(conn)}
                        title="Disconnect"
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

      <ConnectProjectsDialog
        database={db}
        open={connectOpen}
        onOpenChange={setConnectOpen}
        connectedIds={connections.map((c) => c.project_id)}
      />
    </div>
  );
}