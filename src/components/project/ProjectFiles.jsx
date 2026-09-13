import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { HardDrive } from "lucide-react";
import EmptyState from "@/components/dev/EmptyState";
import FileTree from "@/components/project/FileTree";
import * as api from "@/lib/api";

export default function ProjectFiles({ projectId }) {
  const qc = useQueryClient();

  const { data: tree, isLoading } = useQuery({
    queryKey: ["project-files", projectId],
    queryFn: () => api.projectFiles.list(projectId),
    enabled: !!projectId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-files", projectId] });

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

  const handleCreateFolder = async (parentPath, name) => {
    try {
      await api.projectFiles.createFolder(projectId, parentPath, name);
      toast.success("Folder created", { description: name });
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
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-medium">Project folder</h3>
        <p className="text-xs text-muted-foreground">
          This project's persistent folder, mounted at <code className="font-mono">/app/data</code>.
          Its files survive redeploys.
        </p>
      </div>

      {isLoading ? (
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
          description="This project's persistent folder could not be loaded."
          className="py-10"
        />
      )}
    </div>
  );
}
