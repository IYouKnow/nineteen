import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Network, Plus, Trash2, Loader2, Star } from "lucide-react";
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
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";

// ProjectPorts manages the container ports a project publishes on the host.
// Each mapping is container → host; the primary mapping backs the project URL.
// Changes take effect on Apply & recreate or the next deployment.
export default function ProjectPorts({ project }) {
  const projectId = project?.id;
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [containerPort, setContainerPort] = useState("");
  const [hostPort, setHostPort] = useState("");
  const [label, setLabel] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: ports = [] } = useQuery({
    queryKey: ["project-ports", projectId],
    queryFn: () => api.projectPorts.list(projectId),
    enabled: !!projectId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-ports", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const openAdd = () => {
    setContainerPort("");
    setHostPort("");
    setLabel("");
    setIsPrimary(ports.length === 0);
    setAddOpen(true);
  };

  const create = async () => {
    const cp = Number(containerPort);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 65535) {
      toast.error("Enter a container port between 1 and 65535");
      return;
    }
    let hp = null;
    if (hostPort.trim() !== "") {
      hp = Number(hostPort);
      if (!Number.isFinite(hp) || hp <= 0 || hp > 65535) {
        toast.error("Enter a host port between 1 and 65535, or leave it blank");
        return;
      }
    }
    setSaving(true);
    try {
      await api.projectPorts.create(projectId, {
        container_port: cp,
        host_port: hp,
        label: label.trim(),
        is_primary: isPrimary,
      });
      toast.success("Port added", { description: `container ${cp}` });
      setAddOpen(false);
      invalidate();
    } catch (e) {
      toast.error("Could not add port", { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    try {
      await api.projectPorts.remove(projectId, p.id);
      toast.success("Port removed");
      invalidate();
    } catch (e) {
      toast.error("Could not remove port", { description: e?.message });
    }
  };

  const makePrimary = async (p) => {
    if (p.is_primary) return;
    try {
      await api.projectPorts.update(projectId, p.id, { is_primary: true });
      invalidate();
    } catch (e) {
      toast.error("Could not update port", { description: e?.message });
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Network className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Ports</span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            published on the host · applied on Apply or the next deploy
          </span>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add port
        </Button>
      </div>

      {ports.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          No explicit ports. The image's detected port is published automatically. Add a mapping to
          expose extra ports (e.g. Gitea's 22 and 3000).
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <span className="col-span-3">Container</span>
            <span className="col-span-3">Host</span>
            <span className="col-span-4">Label</span>
            <span className="col-span-2 text-right">Actions</span>
          </div>
          {ports.map((p) => (
            <div key={p.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-xs">
              <code className="col-span-3 font-mono text-[11px] text-foreground/90">
                {p.container_port}/{p.protocol || "tcp"}
              </code>
              <code className="col-span-3 font-mono text-[11px] text-muted-foreground">
                {p.host_port || "auto"}
              </code>
              <span className="col-span-4 flex items-center gap-1.5 truncate text-muted-foreground">
                {p.label || "—"}
                {p.is_primary && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    primary
                  </span>
                )}
              </span>
              <div className="col-span-2 flex items-center justify-end gap-1">
                <button
                  type="button"
                  title={p.is_primary ? "Already the primary port" : "Make primary"}
                  onClick={() => makePrimary(p)}
                  disabled={p.is_primary}
                  className={cn(
                    "rounded p-1.5 transition-colors",
                    p.is_primary
                      ? "text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", p.is_primary && "fill-current")} />
                </button>
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      title="Remove port"
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  }
                  title="Remove port?"
                  description={`Container port ${p.container_port} will no longer be published.`}
                  confirmLabel="Remove"
                  onConfirm={() => remove(p)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle>Add port</DialogTitle>
            <DialogDescription>
              Publish a container port on the host. Leave the host port blank to auto-assign one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Container port</Label>
                <Input
                  value={containerPort}
                  onChange={(e) => setContainerPort(e.target.value)}
                  placeholder="3000"
                  inputMode="numeric"
                  className="mt-1.5 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Host port</Label>
                <Input
                  value={hostPort}
                  onChange={(e) => setHostPort(e.target.value)}
                  placeholder="auto"
                  inputMode="numeric"
                  className="mt-1.5 font-mono"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="web, ssh, api…"
                className="mt-1.5"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Use this port for the project URL
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={saving || !containerPort.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add port"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
