import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { HardDrive, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import EmptyState from "@/components/dev/EmptyState";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import FileTree from "@/components/project/FileTree";
import ContainerFiles from "@/components/project/ContainerFiles";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";

function VolumesTable({ volumes, onAdd, onRemove }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Volumes</span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            mounted on every deploy
          </span>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add volume
        </Button>
      </div>

      {volumes.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          No volumes yet. Add one to persist a folder across deploys.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <span className="col-span-3">Name</span>
            <span className="col-span-5">Host folder</span>
            <span className="col-span-3">Container</span>
            <span className="col-span-1" />
          </div>
          {volumes.map((v) => (
            <div key={v.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-xs">
              <span className="col-span-3 truncate font-medium text-foreground/90">{v.name}</span>
              <code
                className="col-span-5 truncate font-mono text-[11px] text-muted-foreground"
                title={v.host_dir || v.host_path}
              >
                {v.host_dir || v.host_path}
              </code>
              <code className="col-span-3 truncate font-mono text-[11px] text-foreground/90">
                {v.container_path}
              </code>
              <div className="col-span-1 flex justify-end">
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      title="Remove volume"
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  }
                  title="Remove volume?"
                  description={`"${v.name}" will no longer be mounted. Its files stay on disk.`}
                  confirmLabel="Remove"
                  onConfirm={() => onRemove(v)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectFiles({ projectId }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [hostPath, setHostPath] = useState("");
  const [containerPath, setContainerPath] = useState("/app/data");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("persistent");

  const { data: volumes = [] } = useQuery({
    queryKey: ["project-volumes", projectId],
    queryFn: () => api.projectVolumes.list(projectId),
    enabled: !!projectId,
  });

  const { data: tree, isLoading } = useQuery({
    queryKey: ["project-files", projectId],
    queryFn: () => api.projectFiles.list(projectId),
    enabled: !!projectId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-volumes", projectId] });
    qc.invalidateQueries({ queryKey: ["project-files", projectId] });
  };

  const openAdd = () => {
    setName("");
    setHostPath("");
    setContainerPath("/app/data");
    setAddOpen(true);
  };

  const createVolume = async () => {
    if (!name.trim() || !containerPath.trim()) return;
    setSaving(true);
    try {
      await api.projectVolumes.create(projectId, {
        name: name.trim(),
        host_path: hostPath.trim(),
        container_path: containerPath.trim(),
      });
      toast.success("Volume added", { description: `${name.trim()} → ${containerPath.trim()}` });
      setAddOpen(false);
      invalidate();
    } catch (e) {
      toast.error("Could not add volume", { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const removeVolume = async (v) => {
    try {
      await api.projectVolumes.remove(projectId, v.id);
      toast.success("Volume removed", { description: v.name });
      invalidate();
    } catch (e) {
      toast.error("Could not remove volume", { description: e?.message });
    }
  };

  const handleUpload = async (parentPath, files) => {
    try {
      await api.projectFiles.upload(projectId, parentPath, files);
      toast.success(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"}`, {
        description: parentPath,
      });
      invalidate();
    } catch (e) {
      toast.error("Upload failed", { description: e?.message });
    }
  };

  const handleCreateFolder = async (parentPath, folderName) => {
    try {
      await api.projectFiles.createFolder(projectId, parentPath, folderName);
      toast.success("Folder created", { description: folderName });
      invalidate();
    } catch (e) {
      toast.error("Could not create folder", { description: e?.message });
    }
  };

  const handleRename = async (path, newName) => {
    try {
      await api.projectFiles.rename(projectId, path, newName);
      toast.success("Renamed", { description: newName });
      invalidate();
    } catch (e) {
      toast.error("Could not rename", { description: e?.message });
    }
  };

  const handleDelete = async (path) => {
    try {
      await api.projectFiles.remove(projectId, path);
      toast.success("Deleted", { description: path });
      invalidate();
    } catch (e) {
      toast.error("Could not delete", { description: e?.message });
    }
  };

  const handleDownload = async (node) => {
    try {
      const blob = await api.projectFiles.download(projectId, node.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = node.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download failed", { description: e?.message });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Project folder</h3>
        <p className="text-xs text-muted-foreground">
          Persistent folders on the host, mounted into the container on every deploy. Files here
          survive redeploys.
        </p>
      </div>

      <VolumesTable volumes={volumes} onAdd={openAdd} onRemove={removeVolume} />

      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/20 p-0.5 text-xs">
        {[
          { id: "persistent", label: "Persistent folder" },
          { id: "container", label: "Container" },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-md px-2.5 py-1 transition-colors",
              mode === m.id
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "container" ? (
        <ContainerFiles projectId={projectId} />
      ) : isLoading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-xs text-muted-foreground">
          Loading files…
        </div>
      ) : tree ? (
        <FileTree
          key={projectId}
          tree={tree}
          onUpload={handleUpload}
          onCreateFolder={handleCreateFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          onDownload={handleDownload}
        />
      ) : (
        <EmptyState
          icon={HardDrive}
          title="Folder not available"
          description="This project's folder could not be loaded."
          className="py-10"
        />
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle>Add volume</DialogTitle>
            <DialogDescription>
              A host folder mapped to a path inside the container.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="uploads"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Host folder</Label>
              <Input
                value={hostPath}
                onChange={(e) => setHostPath(e.target.value)}
                placeholder="uploads (defaults to the name)"
                className="mt-1.5 font-mono"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Relative to this project's folder.
              </p>
            </div>
            <div>
              <Label className="text-xs">Container path</Label>
              <Input
                value={containerPath}
                onChange={(e) => setContainerPath(e.target.value)}
                placeholder="/app/data"
                className="mt-1.5 font-mono"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                The path your app writes to inside the container.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createVolume} disabled={saving || !name.trim() || !containerPath.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add volume"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
