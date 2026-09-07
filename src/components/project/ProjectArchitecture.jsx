import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Info, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import ArchitectureCanvas from "@/components/architecture/ArchitectureCanvas";
import AddConnectionDialog from "@/components/architecture/AddConnectionDialog";
import CreateAutomationDialog from "@/components/automation/CreateAutomationDialog";
import AutomationDetailsDialog from "@/components/automation/AutomationDetailsDialog";
import { inferRole } from "@/lib/architecture";
import { dbEntities } from "@/lib/dbEntities";

export default function ProjectArchitecture({ project, onOpenLogs }) {
  const [mockAdded, setMockAdded] = useState([]);
  const [mockRemoved, setMockRemoved] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [automations, setAutomations] = useState([]);
  const [createAutoOpen, setCreateAutoOpen] = useState(false);
  const [detailsAuto, setDetailsAuto] = useState(null);

  const { data: allConnections = [], isLoading } = useQuery({
    queryKey: ["db-connections-all"],
    queryFn: () => dbEntities.DatabaseConnection.list("-created_date", 200),
  });
  const { data: databases = [] } = useQuery({
    queryKey: ["databases"],
    queryFn: () => dbEntities.Database.list("-created_date", 100),
  });

  const sharingByDb = useMemo(() => {
    const map = {};
    for (const c of allConnections) {
      if (c.project_id === project.id) continue;
      if (!map[c.database_id]) map[c.database_id] = [];
      const name = c.project_name || c.project_id;
      if (!map[c.database_id].includes(name)) map[c.database_id].push(name);
    }
    return map;
  }, [allConnections, project.id]);

  const connections = useMemo(() => {
    const real = allConnections
      .filter((c) => c.project_id === project.id && !mockRemoved.includes(c.database_id))
      .map((c) => {
        const db = databases.find((d) => d.id === c.database_id);
        const sharedCount = allConnections.filter((x) => x.database_id === c.database_id).length;
        const role = inferRole(db?.type || c.database_type, sharedCount);
        return {
          id: c.id,
          databaseId: c.database_id,
          name: db?.name || c.database_name || "database",
          type: db?.type || c.database_type || "postgresql",
          status: db?.status || "running",
          version: db?.version,
          role,
          backupOf: null,
          sharedWith: role === "shared" ? sharingByDb[c.database_id] || [] : [],
          scope: c.scope === "tables" ? "tables" : "all",
          selectedTables: c.scope === "tables" ? (c.selected_tables || "").split(",").filter(Boolean) : [],
          isMock: false,
        };
      });
    return [...real, ...mockAdded];
  }, [allConnections, databases, mockAdded, mockRemoved, sharingByDb, project.id]);

  const remove = (conn) => {
    if (conn.isMock) setMockAdded((m) => m.filter((x) => x.id !== conn.id));
    else setMockRemoved((m) => [...m, conn.databaseId]);
  };
  const add = (conn) => setMockAdded((m) => [...m, conn]);

  const createAutomation = (auto) => setAutomations((a) => [...a, auto]);
  const openAutomation = (id) => setDetailsAuto(automations.find((a) => a.id === id) || null);
  const toggleAutomation = (auto) =>
    setAutomations((a) =>
      a.map((x) =>
        x.id === auto.id ? { ...x, status: x.status === "active" ? "paused" : "active" } : x
      )
    );
  const deleteAutomation = (auto) => {
    setAutomations((a) => a.filter((x) => x.id !== auto.id));
    setDetailsAuto(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Architecture</h3>
          <p className="text-xs text-muted-foreground">A visual map of how this project connects to its infrastructure.</p>
        </div>
        {!hintDismissed && (
          <div className="hidden items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:flex sm:max-w-md">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
            <p className="flex-1">Drag nodes to rearrange, scroll to zoom, drag the canvas to pan. Double-click a resource to open it.</p>
            <button
              type="button"
              onClick={() => setHintDismissed(true)}
              className="text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-[600px] w-full rounded-lg" />
      ) : (
        <ArchitectureCanvas
          project={project}
          connections={connections}
          automations={automations}
          onRemove={remove}
          onAddClick={() => setAddOpen(true)}
          onAddAutomation={() => setCreateAutoOpen(true)}
          onOpenAutomation={openAutomation}
          onOpenLogs={onOpenLogs}
        />
      )}

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        databases={databases}
        currentConnections={connections}
        sharingByDb={sharingByDb}
        onAdd={add}
      />

      <CreateAutomationDialog
        open={createAutoOpen}
        onOpenChange={setCreateAutoOpen}
        project={project}
        connections={connections}
        databases={databases}
        onCreate={createAutomation}
      />

      <AutomationDetailsDialog
        automation={detailsAuto}
        open={!!detailsAuto}
        onOpenChange={(v) => !v && setDetailsAuto(null)}
        onToggle={(a) => {
          toggleAutomation(a);
          setDetailsAuto((cur) => (cur && cur.id === a.id ? { ...cur, status: cur.status === "active" ? "paused" : "active" } : cur));
        }}
        onDelete={deleteAutomation}
      />
    </div>
  );
}