import { useState } from "react";
import { Plug } from "lucide-react";
import ArchitectureCanvas from "@/components/architecture/ArchitectureCanvas";
import ConnectDatabaseDialog from "@/components/project/ConnectDatabaseDialog";

export default function EnvArchitecture({
  project,
  environment,
  connections,
  onAddConnections,
  onRemoveConnection,
  onOpenLogs,
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Architecture</h3>
          <p className="text-xs text-muted-foreground">
            Infrastructure for the <span className="font-medium text-foreground">{environment.name}</span>{" "}
            environment.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
        >
          <Plug className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      <ArchitectureCanvas
        project={project}
        connections={connections}
        automations={[]}
        onRemove={onRemoveConnection}
        onAddClick={() => setOpen(true)}
        onOpenLogs={onOpenLogs}
      />

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