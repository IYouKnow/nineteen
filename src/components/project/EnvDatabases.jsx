const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState } from "react";
import { Link } from "react-router-dom";
import { Database, Plug, Unplug, ArrowUpRight } from "lucide-react";
import DbTypeIcon from "@/components/db/DbTypeIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import EmptyState from "@/components/dev/EmptyState";
import { Button } from "@/components/ui/button";
import { getDbType } from "@/lib/databases";
import ConnectDatabaseDialog from "@/components/project/ConnectDatabaseDialog";

export default function EnvDatabases({
  project,
  environment,
  connections,
  onAddConnections,
  onRemoveConnection,
}) {
  const [open, setOpen] = useState(false);
  const dbs = connections.map((c) => ({ conn: c, db: c.db || c }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Connected databases</h3>
          <p className="text-xs text-muted-foreground">
            {dbs.length} database{dbs.length === 1 ? "" : "s"} attached to {environment.name}.
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
          description={`Connect a database to the ${environment.name} environment.`}
          action={
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
              <Plug className="h-3.5 w-3.5" /> Connect database
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border/60 rounded-lg border border-border bg-card">
          {dbs.map(({ conn, db }) => {
            const type = getDbType(db.type);
            return (
              <div key={conn.id} className="flex items-center gap-3 p-3.5">
                <DbTypeIcon type={db.type} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/databases/${db.id}`}
                    className="group flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
                  >
                    {db.name}
                    <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-foreground" />
                  </Link>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {type.label} · {db.version} · {db.host || "—"}:{db.port || "—"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground/70">
                    {conn.scope === "tables"
                      ? `${(conn.selectedTables || []).length} tables selected`
                      : "Entire database"}
                  </p>
                </div>
                <StatusBadge status={db.status} kind="database" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveConnection(conn)}
                  title="Disconnect"
                >
                  <Unplug className="h-3.5 w-3.5" />
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
        connectedDbIds={connections.map((c) => c.databaseId)}
        onConnect={onAddConnections}
      />
    </div>
  );
}