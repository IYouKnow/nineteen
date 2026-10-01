import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import useEnvSync from "@/hooks/useEnvSync";
import performRecreate from "@/lib/recreate";
import { cn } from "@/lib/utils";

// ApplyRecreateButton re-runs the project's container from its current image
// with the saved env vars, ports and volumes — no rebuild. Uncovered state
// dirs are migrated automatically (see StateDirsWarning). Used in both the
// Files tab (migrate without touching env) and the env editor (apply after
// editing).
export default function ApplyRecreateButton({ projectId, className, showHint = false }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [applying, setApplying] = useState(false);
  const { sync, running, outOfSync } = useEnvSync(projectId);

  const applyRecreate = async () => {
    setApplying(true);
    try {
      await performRecreate(projectId, { qc, navigate });
    } finally {
      setApplying(false);
    }
  };

  return (
    <span className={cn("inline-flex flex-col items-end gap-1", className)}>
      <ConfirmDialog
        trigger={
          <Button
            size="sm"
            disabled={!running || applying}
            className="relative gap-2 bg-foreground text-background hover:bg-foreground/90 hover:text-background"
          >
            {applying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Apply &amp; recreate
            {outOfSync && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-card" />
            )}
          </Button>
        }
        title="Apply configuration?"
        description={`Recreates the container from the same image — no rebuild, no code changes. Takes seconds. Existing files in known state folders are migrated into volumes automatically; anything else written inside the container outside a volume will be lost.${sync?.missing_keys?.length ? ` ${sync.missing_keys.length} variable(s) differ from the running container.` : ""}`}
        confirmLabel={applying ? "Applying…" : "Apply & recreate"}
        onConfirm={applyRecreate}
      />
      {showHint && !running && (
        <span className="text-[11px] text-muted-foreground">
          The project isn&apos;t running — deploy to start it first.
        </span>
      )}
    </span>
  );
}
