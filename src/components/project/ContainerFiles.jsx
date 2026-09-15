import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  ChevronRight,
  CornerLeftUp,
  Download,
  File,
  Folder,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/storage";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";

const ACTION_BTN =
  "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground";

function breadcrumb(path) {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

export default function ContainerFiles({ projectId }) {
  const [path, setPath] = useState("/");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["project-container-files", projectId, path],
    queryFn: () => api.projectFiles.containerList(projectId, path),
    enabled: !!projectId,
    retry: false,
  });

  const crumbs = useMemo(() => breadcrumb(path), [path]);
  const entries = data?.entries || [];

  const download = async (entry) => {
    try {
      const blob = await api.projectFiles.containerDownload(projectId, entry.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download failed", { description: e?.message });
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-muted/20 px-3 py-2">
        <HardDrive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <nav className="flex min-w-0 items-center gap-0.5 text-xs">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
              <button
                type="button"
                onClick={() => setPath(c.path)}
                className={cn(
                  "max-w-[10rem] truncate rounded px-1 font-mono transition-colors hover:text-foreground",
                  i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1.5 text-xs"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      <div className="max-h-[26rem] overflow-auto py-1">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            Loading container files…
          </p>
        ) : error ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">{error.message}</p>
        ) : (
          <>
            {path !== "/" && (
              <button
                type="button"
                onClick={() => setPath(path.slice(0, path.lastIndexOf("/")) || "/")}
                className="flex w-full items-center gap-1.5 py-1 pr-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                style={{ paddingLeft: 8 }}
              >
                <CornerLeftUp className="h-3.5 w-3.5" />
                <span className="font-mono">..</span>
              </button>
            )}
            {entries.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                This folder is empty.
              </p>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.path}
                  className={cn(
                    "group flex items-center gap-1.5 py-1 pr-2 text-xs transition-colors hover:bg-muted/40",
                    entry.type === "folder" && "cursor-pointer"
                  )}
                  style={{ paddingLeft: 8 }}
                  onClick={() => entry.type === "folder" && setPath(entry.path)}
                >
                  {entry.type === "folder" ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-foreground/90">{entry.name}</span>
                  <span className="ml-auto flex items-center gap-3 pl-3">
                    {entry.type !== "folder" && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                    <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                      {formatDate(entry.modified, "MMM d, yyyy")}
                    </span>
                    {entry.type !== "folder" && (
                      <button
                        type="button"
                        title="Download"
                        onClick={(e) => {
                          e.stopPropagation();
                          download(entry);
                        }}
                        className={cn(ACTION_BTN, "opacity-0 transition-opacity group-hover:opacity-100")}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
