const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Plus, Trash2, Pencil, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import EmptyState from "@/components/dev/EmptyState";
import ConfirmDialog from "@/components/dev/ConfirmDialog";

export default function MountEditor({ projectId, mounts = [] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [type, setType] = useState("volume");
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setName("");
    setSource("");
    setDestination("");
    setType("volume");
    setOpen(true);
  };
  const openEdit = (m) => {
    setEditing(m);
    setName(m.name);
    setSource(m.source || "");
    setDestination(m.destination || "");
    setType(m.type || "volume");
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await db.entities.Mount.update(editing.id, { name, source, destination, type });
      } else {
        await db.entities.Mount.create({ project_id: projectId, name, source, destination, type });
      }
      qc.invalidateQueries({ queryKey: ["mounts", projectId] });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m) => {
    await db.entities.Mount.delete(m.id);
    qc.invalidateQueries({ queryKey: ["mounts", projectId] });
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Mounts</h3>
          <p className="text-xs text-muted-foreground">
            Persistent volumes and bind mounts attached to the runtime.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd} className="gap-2">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <div className="mt-3">
        {mounts.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title="No mounts configured"
            description="Attach a persistent volume or bind mount to preserve data across deploys."
            className="py-10"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="divide-y divide-border/60">
              {mounts.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/30">
                    <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground/90">{m.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {m.source || "—"} → {m.destination || "—"}
                    </p>
                  </div>
                  <span className="hidden rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                    {m.type}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => openEdit(m)}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <ConfirmDialog
                      trigger={
                        <button className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                      title="Remove mount?"
                      description={`"${m.name}" will be detached from this project.`}
                      confirmLabel="Remove"
                      onConfirm={() => remove(m)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit mount" : "Add mount"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="data-volume"
                className="mt-1.5 font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Source</Label>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="/data"
                  className="mt-1.5 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Destination</Label>
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="/app/data"
                  className="mt-1.5 font-mono"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {["volume", "bind"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
                      type === t
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save mount"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}