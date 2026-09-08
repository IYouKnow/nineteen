import { storageEntities } from "@/lib/storageEntities";
import * as api from "@/lib/api";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Link2, Loader2 } from "lucide-react";
import FrameworkIcon from "@/components/dev/FrameworkIcon";

export default function ConnectStorageDialog({ storage, kind, open, onOpenChange, connectedIds = [] }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState([]);
  const [mountPath, setMountPath] = useState("/data");
  const [saving, setSaving] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
    enabled: open,
  });

  const available = projects.filter((p) => !connectedIds.includes(p.id));
  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    setSaving(true);
    try {
      const chosen = projects.filter((p) => selected.includes(p.id));
      await storageEntities.Connection.bulkCreate(
        storage.id,
        kind,
        chosen.map((p) => ({
          storage_id: storage.id,
          storage_type: kind,
          project_id: p.id,
          project_name: p.name,
          mount_path: kind === "volume" ? mountPath : "",
        }))
      );
      qc.invalidateQueries({ queryKey: ["storage-connections", storage.id] });
      qc.invalidateQueries({ queryKey: ["storage-connections-all"] });
      qc.invalidateQueries({ queryKey: ["storage", kind === "bucket" ? "buckets" : "volumes"] });
      setSelected([]);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Connect {kind} to {storage?.name}
          </DialogTitle>
          <DialogDescription>
            Select projects that should use this {kind}. A {kind} can be shared across multiple projects.
          </DialogDescription>
        </DialogHeader>
        {kind === "volume" && (
          <div className="space-y-1.5">
            <Label htmlFor="mount-path">Mount path</Label>
            <Input
              id="mount-path"
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              placeholder="/data"
              className="bg-card font-mono"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : available.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              All projects are already connected.
            </p>
          ) : (
            available.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
              >
                <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                <FrameworkIcon framework={p.framework} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {p.repository || "no repository"}
                  </p>
                </div>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || selected.length === 0} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Connect {selected.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
