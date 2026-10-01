import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, HardDrive, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import useEnvSync from "@/hooks/useEnvSync";
import performRecreate from "@/lib/recreate";
import * as api from "@/lib/api";

// StateDirsWarning lists the app's known state directories that live on the
// ephemeral filesystem. Each row offers staging ("Add", no restart) and
// one-click ("Add & apply", immediate recreate); the header Apply button
// batches everything into a single recreate. Adding beforehand is equally
// safe — an empty folder still gets migrated into on Apply.
export default function StateDirsWarning({ projectId }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busyKey, setBusyKey] = useState(null);
  const { uncovered } = useEnvSync(projectId);

  if (uncovered.length === 0) return null;

  const volumePayload = (dir) => {
    const hostSubdir = dir.host_subdir || `appdata/${dir.container_path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
    const name = hostSubdir.split("/").pop() || "appdata";
    return { name, host_path: hostSubdir, container_path: dir.container_path };
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project-volumes", projectId] });
    qc.invalidateQueries({ queryKey: ["env-sync", String(projectId)] });
  };

  const addVolumeFor = async (dir) => {
    const payload = volumePayload(dir);
    try {
      await api.projectVolumes.create(projectId, payload);
      refresh();
      toast.success("Volume added", { description: `${payload.host_path} → ${dir.container_path}. Apply to mount it.` });
    } catch (e) {
      toast.error("Could not add volume", { description: e?.message });
    }
  };

  const addAndApplyFor = async (dir) => {
    setBusyKey(dir.container_path);
    try {
      const payload = volumePayload(dir);
      await api.projectVolumes.create(projectId, payload);
      refresh();
      await performRecreate(projectId, { qc, navigate });
    } catch (e) {
      toast.error("Could not add volume", { description: e?.message });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">
          {uncovered.length} app director{uncovered.length === 1 ? "y lives" : "ies live"} on the ephemeral filesystem
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Apply or redeploy migrates what&apos;s there into a persistent volume automatically — or add one now.
        </p>
        <div className="mt-2 space-y-1.5">
          {uncovered.map((d) => {
            const busy = busyKey === d.container_path;
            return (
              <div key={d.container_path} className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={`${d.container_path} — ${d.reason}`}>
                  {d.container_path}
                  <span className="ml-1.5 font-sans text-muted-foreground">{d.reason}</span>
                </span>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busyKey} onClick={() => addVolumeFor(d)}>
                  <Plus className="h-3 w-3" />
                  Add
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 bg-foreground text-xs text-background hover:bg-foreground/90 hover:text-background"
                  disabled={!!busyKey}
                  onClick={() => addAndApplyFor(d)}
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Add &amp; apply
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
