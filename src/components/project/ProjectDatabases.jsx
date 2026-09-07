import { dbEntities } from "@/lib/dbEntities";

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Database, Plug, Unplug, Loader2, ArrowUpRight } from "lucide-react";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import EmptyState from "@/components/dev/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDbType } from "@/lib/databases";
import ConnectDatabaseDialog from "./ConnectDatabaseDialog";

export default function ProjectDatabases({ project }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["project-databases", project.id],
    queryFn: () => dbEntities.DatabaseConnection.filter({ project_id: project.id }),
  });
  const { data: databases = [] } = useQuery({
    queryKey: ["databases"],
    queryFn: () => dbEntities.Database.list("-created_date", 100),
  });

  const dbs = connections
    .map((c) => ({ conn: c, db: databases.find((d) => d.id === c.database_id) }))
    .filter((x) => x.db);

  const disconnect = async (conn) => {
    setBusy(conn.id);
    try {
      await dbEntities.DatabaseConnection.delete(conn.id, conn.database_id);
      qc.invalidateQueries({ queryKey: ["project-databases", project.id] });
      qc.invalidateQueries({ queryKey: ["db-connections-all"] });
      qc.invalidateQueries({ queryKey: ["db-connections"] });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Connected databases</h3>
          <p className="text-xs text-muted-foreground">
            {dbs.length} database{dbs.length === 1 ? "" : "s"} attached to this project.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
          <Plug className="h-3.5 w-3.5" /> Connect database
        </Button>
      </div>

      {dbs.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No databases connected"
          description="Connect a database to use it from this project. A database can be shared across multiple projects."
          action={
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
              <Plug className="h-3.5 w-3.5" /> Connect database
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border/60 rounded-lg border border-border bg-card">
          {dbs.map(({ conn, db: d }) => {
            const type = getDbType(d.type);
            return (
              <div key={d.id} className="flex items-center gap-3 p-3.5">
                <DbTypeIcon type={d.type} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/databases/${d.id}`}
                    className="group flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
                  >
                    {d.name}
                    <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-foreground" />
                  </Link>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {type.label} · {d.version} · {d.host}:{d.port}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground/70">
                    {conn.scope === "tables"
                      ? `${(conn.selected_tables || "").split(",").filter(Boolean).length} tables selected`
                      : "Entire database"}
                  </p>
                </div>
                <StatusBadge status={d.status} kind="database" />
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
            );
          })}
        </div>
      )}

      <ConnectDatabaseDialog
        project={project}
        open={open}
        onOpenChange={setOpen}
        connectedDbIds={connections.map((c) => c.database_id)}
      />
    </div>
  );
}