import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";

// useEnvSync reports live drift vs. the running container: which saved values
// the container doesn't have yet, and which known state dirs sit on the
// ephemeral filesystem. Shared by the env editor and the files tab so both
// show the same Apply/migrate state.
export default function useEnvSync(projectId, { enabled = true } = {}) {
  const { data: sync } = useQuery({
    queryKey: ["env-sync", String(projectId)],
    queryFn: () => api.projects.envSync(projectId),
    enabled: !!projectId && enabled,
    refetchInterval: 15000,
    retry: false,
  });
  const running = !!sync?.running;
  const outOfSync = !!sync && !sync.in_sync;
  const uncovered = (sync?.state_dirs || []).filter((d) => !d.covered);
  // Keys actually present in the running container (names only, never values),
  // so a name that was never saved — a typo, or an image-provided var — is
  // visible next to the project's own vars.
  const effectiveKeys = sync?.effective_keys || [];
  return { sync, running, outOfSync, uncovered, effectiveKeys };
}
