import * as api from "@/lib/api";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, Container } from "lucide-react";
import useEnvSync from "@/hooks/useEnvSync";
import { cn } from "@/lib/utils";

// ContainerEnvPanel shows the environment keys actually present on the running
// container (read back from `docker inspect`, names only — never values) and
// cross-references them with the vars the repository declares. That makes a
// wrong name visible: e.g. a saved DB_ENCRYPTION_KEY_FILE shows up here while
// the repo-declared DB_ENCRYPTION_KEY is flagged as declared-but-absent.
export default function ContainerEnvPanel({ projectId, project }) {
  const [open, setOpen] = useState(false);
  const { running, effectiveKeys } = useEnvSync(projectId);

  const { data: requiredEnv } = useQuery({
    queryKey: ["required-env", String(projectId), ""],
    queryFn: () => api.projects.requiredEnv(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
    retry: false,
  });
  const declared = requiredEnv?.required || [];

  const present = new Set(effectiveKeys.map((k) => k.key));
  const declaredMissing = declared.filter((r) => !present.has(r.key));
  const composeDeclared = declared.filter((r) => r.source === "compose");
  const isComposeDeploy = project?.build_strategy === "compose" || !!project?.compose_path;
  const composeIgnored = !isComposeDeploy && composeDeclared.length > 0;

  const savedKeys = effectiveKeys.filter((k) => k.saved);
  const otherKeys = effectiveKeys.filter((k) => !k.saved);

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/15 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <Container className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">Container environment</span>
        <span className="font-mono text-xs text-muted-foreground">
          {running
            ? `${effectiveKeys.length} key${effectiveKeys.length === 1 ? "" : "s"}`
            : "not running"}
        </span>
        {declaredMissing.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            <AlertTriangle className="h-3 w-3" /> {declaredMissing.length} declared missing
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Effective variables on the running container. Names only — values are never shown.
          </p>

          {composeIgnored && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              docker-compose.yaml declares{" "}
              <span className="font-mono">{composeDeclared.map((r) => r.key).join(", ")}</span> —
              these are not applied when deploying from a Dockerfile. Set them in Environment
              Variables instead.
            </div>
          )}

          {declaredMissing.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              Declared by the repo but not present in the container:{" "}
              <span className="font-mono">{declaredMissing.map((r) => r.key).join(", ")}</span>. Check
              the variable names.
            </div>
          )}

          {!running ? (
            <p className="text-[11px] text-muted-foreground">
              The container is not running — start or deploy the project to see its environment.
            </p>
          ) : effectiveKeys.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No environment variables reported.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="divide-y divide-border/60">
                {[...savedKeys, ...otherKeys].map((k) => (
                  <div key={k.key} className="flex items-center gap-2 px-3 py-1.5">
                    {k.saved ? (
                      <Check className="h-3 w-3 shrink-0 text-success" />
                    ) : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
                    )}
                    <span
                      className={cn(
                        "truncate font-mono text-xs",
                        k.saved ? "text-foreground/90" : "text-muted-foreground"
                      )}
                      title={k.key}
                    >
                      {k.key}
                    </span>
                    {!k.saved && (
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                        from image
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
