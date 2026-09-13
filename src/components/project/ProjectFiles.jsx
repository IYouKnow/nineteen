import { useEffect, useState } from "react";
import { toast } from "sonner";

import { HardDrive } from "lucide-react";
import EmptyState from "@/components/dev/EmptyState";
import FileTree from "@/components/project/FileTree";
import {
  getFolderTree,
  uploadFiles,
  renameNode,
  deleteNode,
  downloadNode,
} from "@/lib/projectFiles";

export default function ProjectFiles({ folder }) {
  const [tree, setTree] = useState(null);

  useEffect(() => {
    if (folder) setTree(getFolderTree(folder));
    else setTree(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.id]);

  if (!folder) {
    return (
      <EmptyState
        icon={HardDrive}
        title="Folder not available"
        description="This project's persistent folder could not be found."
        className="py-10"
      />
    );
  }

  const handleUpload = (parentPath, files) => {
    setTree(uploadFiles(folder, parentPath, files));
    toast.success(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"}`, {
      description: parentPath,
    });
  };
  const handleRename = (path, newName) => {
    setTree(renameNode(folder, path, newName));
    toast.success("Renamed", { description: newName });
  };
  const handleDelete = (path) => {
    setTree(deleteNode(folder, path));
    toast.success("Deleted", { description: path });
  };
  const handleDownload = (node) => {
    downloadNode(node);
    toast.success(`Downloading ${node.name}`);
  };

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-medium">Project folder</h3>
        <p className="text-xs text-muted-foreground">
          This project's persistent folder. Its files survive redeploys.
        </p>
      </div>

      <FileTree
        key={folder.id}
        tree={tree}
        onUpload={handleUpload}
        onRename={handleRename}
        onDelete={handleDelete}
        onDownload={handleDownload}
      />
    </div>
  );
}
