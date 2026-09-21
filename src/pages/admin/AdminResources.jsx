import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { admin } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { FolderGit2, Database, Play, Square, RotateCw, Trash2 } from "lucide-react";

function statusVariant(status) {
  if (status === "running" || status === "ready") return "outline";
  if (status === "error" || status === "failed") return "destructive";
  return "secondary";
}

function ActionButtons({ onAction, onDelete, pending, showRestart = true }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending} onClick={() => onAction("start")} title="Start">
        <Play className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending} onClick={() => onAction("stop")} title="Stop">
        <Square className="h-3.5 w-3.5" />
      </Button>
      {showRestart && (
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending} onClick={() => onAction("restart")} title="Restart">
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
      )}
      <ConfirmDialog
        title="Delete resource?"
        description="This removes the container and its record. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onDelete}
        trigger={
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={pending} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
    </div>
  );
}

export default function AdminResources() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-resources"],
    queryFn: () => admin.resources(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-resources"] });

  const projectAction = useMutation({
    mutationFn: ({ id, action }) => admin.projectAction(id, action),
    onSuccess: invalidate,
    onError: (e) => toast.error("Action failed", { description: e.message }),
  });
  const deleteProject = useMutation({
    mutationFn: (id) => admin.deleteProject(id),
    onSuccess: () => { invalidate(); toast.success("Project deleted"); },
    onError: (e) => toast.error("Delete failed", { description: e.message }),
  });
  const databaseAction = useMutation({
    mutationFn: ({ id, action }) => admin.databaseAction(id, action),
    onSuccess: invalidate,
    onError: (e) => toast.error("Action failed", { description: e.message }),
  });
  const deleteDatabase = useMutation({
    mutationFn: (id) => admin.deleteDatabase(id),
    onSuccess: () => { invalidate(); toast.success("Database deleted"); },
    onError: (e) => toast.error("Delete failed", { description: e.message }),
  });

  const projects = data?.projects || [];
  const databases = data?.databases || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{projects.length} project{projects.length === 1 ? "" : "s"} across all users</p>
          </div>
          {projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No projects.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead className="w-[170px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.slug}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.owner || `#${p.user_id}`}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(p.status)} className="capitalize">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {p.repository || "—"}
                    </TableCell>
                    <TableCell>
                      <ActionButtons
                        pending={projectAction.isPending || deleteProject.isPending}
                        onAction={(action) => projectAction.mutate({ id: p.id, action })}
                        onDelete={() => deleteProject.mutate(p.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{databases.length} database{databases.length === 1 ? "" : "s"} across all users</p>
          </div>
          {databases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No databases.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Database</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[170px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {databases.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{d.name}</div>
                      <div className="text-xs text-muted-foreground">{d.slug}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.owner || `#${d.user_id}`}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{d.type}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(d.status)} className="capitalize">{d.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <ActionButtons
                        pending={databaseAction.isPending || deleteDatabase.isPending}
                        onAction={(action) => databaseAction.mutate({ id: d.id, action })}
                        onDelete={() => deleteDatabase.mutate(d.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
