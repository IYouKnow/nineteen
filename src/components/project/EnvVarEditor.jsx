import * as api from "@/lib/api";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Plus, Trash2, Pencil, Eye, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import EmptyState from "@/components/dev/EmptyState";
import ConfirmDialog from "@/components/dev/ConfirmDialog";

export default function EnvVarEditor({ projectId, envVars = [], environment, isProd = true, onAdd, onUpdate, onDelete }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["envvars", String(projectId)] });

  const openAdd = () => {
    setEditing(null);
    setKey("");
    setValue("");
    setIsSecret(false);
    setError("");
    setOpen(true);
  };
  const openEdit = (v) => {
    setEditing(v);
    setKey(v.key);
    setValue("");
    setIsSecret(!!v.is_secret);
    setError("");
    setOpen(true);
  };

  const save = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    const payload = { key: trimmed, value, is_secret: isSecret };
    if (!isProd) {
      if (editing) onUpdate?.(editing.id, payload);
      else onAdd?.(payload);
      setOpen(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) await api.envVars.update(projectId, editing.id, payload);
      else await api.envVars.create(projectId, payload);
      invalidate();
      setOpen(false);
    } catch (e) {
      setError(e?.message || "Failed to save variable");
    } finally {
      setSaving(false);
    }
  };

  const remove = (v) => {
    if (!isProd) {
      onDelete?.(v.id);
      return;
    }
    api.envVars.remove(projectId, v.id).then(invalidate).catch(() => invalidate());
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Environment Variables</h3>
          <p className="text-xs text-muted-foreground">
            Injected into your runtime at deploy time.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd} className="gap-2">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <div className="mt-3">
        {envVars.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No environment variables"
            description="Add secrets and configuration to inject into your runtime."
            className="py-10"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="divide-y divide-border/60">
              {envVars.map((v) => (
                <div key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-1/3 min-w-0">
                    <p className="truncate font-mono text-sm text-foreground/90">{v.key}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block truncate font-mono text-sm text-muted-foreground">
                      {v.is_secret ? "••••••••••••" : v.value || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {v.has_value === false && !v.is_secret && (
                      <button
                        onClick={() => openEdit(v)}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        title="Set value"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(v)}
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
                      title="Delete environment variable?"
                      description={`"${v.key}" will be permanently removed from this project.`}
                      confirmLabel="Delete"
                      onConfirm={() => remove(v)}
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
            <DialogTitle>{editing ? "Edit variable" : "Add variable"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Key</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="DATABASE_URL"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Value</Label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={editing?.is_secret ? "Leave blank to keep the existing secret" : "postgres://…"}
                className="mt-1.5 font-mono"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Secret</p>
                <p className="text-xs text-muted-foreground">Masked everywhere — the value is write-only.</p>
              </div>
              <Switch checked={isSecret} onCheckedChange={setIsSecret} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !key.trim()}>
              {saving ? "Saving…" : "Save variable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}