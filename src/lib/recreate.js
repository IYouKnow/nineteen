import { toast } from "sonner";
import * as api from "@/lib/api";

// performRecreate runs the no-rebuild recreate action and handles the shared
// aftermath: cache invalidation, toasts and navigation to the history entry.
// Used by ApplyRecreateButton and the per-row Add & apply action alike, so a
// batch Apply and a one-click row apply behave identically.
export default async function performRecreate(projectId, { qc, navigate } = {}) {
  try {
    const dep = await api.projects.action(projectId, "recreate");
    qc?.invalidateQueries({ queryKey: ["deployments", projectId] });
    qc?.invalidateQueries({ queryKey: ["deployments-recent"] });
    qc?.invalidateQueries({ queryKey: ["project", projectId] });
    qc?.invalidateQueries({ queryKey: ["projects"] });
    qc?.invalidateQueries({ queryKey: ["env-sync", String(projectId)] });
    qc?.invalidateQueries({ queryKey: ["project-volumes", projectId] });
    toast.success("Configuration applied — same image, no rebuild");
    if (dep?.id) navigate?.(`/projects/${projectId}/deployments/${dep.id}`);
    return dep;
  } catch (e) {
    // The server returns the deployment id even on failure so the log is reachable.
    const depId = e?.deployment_id;
    qc?.invalidateQueries({ queryKey: ["deployments", projectId] });
    qc?.invalidateQueries({ queryKey: ["project", projectId] });
    if (depId) {
      toast.error("Recreate failed", { description: "Opening the deployment log." });
      navigate?.(`/projects/${projectId}/deployments/${depId}`);
    } else {
      toast.error("Could not apply configuration", { description: e?.message });
    }
    return null;
  }
}
