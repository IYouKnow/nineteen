import { Check } from "lucide-react";
import { SOURCES } from "@/lib/newProject";
import SourceIcon from "@/components/newproject/SourceIcon";
import { cn } from "@/lib/utils";

export default function SourceStep({ source, setSource }) {
  const update = (patch) => setSource((s) => ({ ...s, ...patch }));

  // Changing the source clears any previous picker selection. Re-selecting the
  // current source is a no-op so a stray click can't wipe the user's choice.
  const selectSource = (id) => {
    if (source.type === id) return;
    update({
      type: id,
      template: null,
      repo: null,
      integrationId: null,
      publicUrl: "",
      image: null,
      imageTag: "latest",
      imageMeta: null,
      env: [],
    });
  };

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">Choose a source</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick where your project comes from — a Git repository or a prebuilt Docker image.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {SOURCES.map((s) => {
          const active = source.type === s.id;
          const disabled = !!s.disabled;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => selectSource(s.id)}
              className={cn(
                "group relative flex items-start gap-3 rounded-lg border p-4 text-left transition-all",
                disabled
                  ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
                  : active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
              )}
            >
              <SourceIcon icon={s.icon} color={disabled ? "#94a3b8" : s.color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{s.label}</p>
                  {disabled && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              </div>
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                )}
              >
                {active && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
