import { useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  Database,
  Download,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { formatBytes } from "@/lib/storage";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTION_BTN =
  "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground";

function sortChildren(children = []) {
  return [...children].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function flatten(node, expanded, depth, out) {
  out.push({ node, depth });
  if (node.type === "folder" && expanded.has(node.path)) {
    sortChildren(node.children).forEach((child) => flatten(child, expanded, depth + 1, out));
  }
}

function summarize(node) {
  if (!node) return { files: 0, size: 0 };
  if (node.type === "file") return { files: 1, size: node.size || 0 };
  return (node.children || []).reduce(
    (acc, child) => {
      const next = summarize(child);
      return { files: acc.files + next.files, size: acc.size + next.size };
    },
    { files: 0, size: 0 }
  );
}

function findNode(node, path) {
  if (!node) return null;
  if (node.path === path) return node;
  for (const child of node.children || []) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function nodeIcon(node, expanded) {
  if (node.type === "folder") return expanded ? FolderOpen : Folder;
  const name = node.name.toLowerCase();
  if (/\.(sqlite3?|db)$/.test(name)) return Database;
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(name)) return ImageIcon;
  if (/\.(zip|tar|gz|tgz|rar|7z)$/.test(name)) return Archive;
  if (/\.(json|ya?ml|toml|xml)$/.test(name)) return FileJson;
  if (/\.(js|jsx|ts|tsx|css|html|sh|py|go|rs)$/.test(name)) return FileCode2;
  if (/\.(csv|xlsx?|md|txt|log)$/.test(name)) return FileText;
  return File;
}

function FileRow({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  onDownload,
  onUpload,
}) {
  const isFolder = node.type === "folder";
  const Icon = nodeIcon(node, expanded);

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 py-1 pr-2 text-xs transition-colors hover:bg-muted/40",
        selected && "bg-muted/50"
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={() => onSelect(node.path)}
    >
      {isFolder ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}

      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-foreground/90">{node.name}</span>

      <span className="ml-auto flex items-center gap-3 pl-3">
        {!isFolder && (
          <span className="font-mono text-[11px] text-muted-foreground">{formatBytes(node.size)}</span>
        )}
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
          {formatDate(node.modified, "MMM d, yyyy")}
        </span>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {isFolder ? (
            <button
              type="button"
              title={`Upload to ${node.path}`}
              onClick={(e) => {
                e.stopPropagation();
                onUpload(node.path);
              }}
              className={ACTION_BTN}
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              title="Download"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(node);
              }}
              className={ACTION_BTN}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              onRename(node);
            }}
            className={ACTION_BTN}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <ConfirmDialog
            trigger={
              <button
                type="button"
                title="Delete"
                onClick={(e) => e.stopPropagation()}
                className={cn(ACTION_BTN, "hover:bg-destructive/10 hover:text-destructive")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            }
            title={`Delete ${isFolder ? "folder" : "file"}?`}
            description={`"${node.name}" will be permanently removed.`}
            confirmLabel="Delete"
            onConfirm={() => onDelete(node.path)}
          />
        </span>
      </span>
    </div>
  );
}

export default function FileTree({
  tree,
  onUpload,
  onCreateFolder,
  onRename,
  onDelete,
  onDownload,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedPath, setSelectedPath] = useState(tree?.path || null);
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState("");
  const [folderParent, setFolderParent] = useState(null);
  const [folderName, setFolderName] = useState("");
  const inputRef = useRef(null);
  const targetRef = useRef(tree?.path || null);

  const rows = useMemo(() => {
    if (!tree) return [];
    const out = [];
    sortChildren(tree.children).forEach((child) => flatten(child, expanded, 0, out));
    return out;
  }, [tree, expanded]);

  const stats = useMemo(() => summarize(tree), [tree]);

  const selectedNode = selectedPath ? findNode(tree, selectedPath) : null;
  const uploadTarget = selectedNode?.type === "folder" ? selectedNode.path : tree?.path;

  const toggle = (path) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const pickFiles = (targetPath) => {
    targetRef.current = targetPath || tree?.path;
    inputRef.current?.click();
  };

  const handleFiles = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    onUpload?.(targetRef.current || tree.path, files);
  };

  const startRename = (node) => {
    setRenaming(node);
    setDraft(node.name);
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = draft.trim();
    if (name && name !== renaming.name) onRename?.(renaming.path, name);
    setRenaming(null);
  };

  const startCreateFolder = (parentPath) => {
    setFolderParent(parentPath || tree?.path || "");
    setFolderName("");
  };

  const commitCreateFolder = () => {
    const name = folderName.trim();
    if (name) onCreateFolder?.(folderParent, name);
    setFolderParent(null);
  };

  if (!tree) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-muted/20 px-3 py-2">
        <HardDrive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <code className="truncate font-mono text-xs font-medium text-foreground">{tree.path}</code>
        <span className="text-[11px] text-muted-foreground">
          {stats.files} file{stats.files === 1 ? "" : "s"} · {formatBytes(stats.size)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            title={`New folder in ${uploadTarget}`}
            onClick={() => startCreateFolder(uploadTarget)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New folder
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            title={`Upload to ${uploadTarget}`}
            onClick={() => pickFiles(uploadTarget)}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </Button>
        </div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={handleFiles} />
      </div>

      <div className="max-h-[26rem] overflow-auto py-1">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">This folder is empty.</p>
        ) : (
          rows.map(({ node, depth }) => (
            <FileRow
              key={node.path}
              node={node}
              depth={depth}
              expanded={expanded.has(node.path)}
              selected={selectedPath === node.path}
              onToggle={toggle}
              onSelect={setSelectedPath}
              onRename={startRename}
              onDelete={onDelete}
              onDownload={onDownload}
              onUpload={pickFiles}
            />
          ))
        )}
      </div>

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs">Name</Label>
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitRename()}
              className="mt-1.5 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={commitRename} disabled={!draft.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderParent !== null} onOpenChange={(open) => !open && setFolderParent(null)}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs">Name</Label>
            <Input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitCreateFolder()}
              placeholder="uploads"
              className="mt-1.5 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderParent(null)}>
              Cancel
            </Button>
            <Button onClick={commitCreateFolder} disabled={!folderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
