import { AlertTriangle, Check, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// EnvCheckSection lists the env vars a repository declares (from .env.example,
// Dockerfile, compose) alongside which ones are already saved, so the user
// fills in the gaps instead of guessing. Values are controlled by the parent
// via `values`/`onChange`; `savedKeys` marks keys that already have a value.
export default function EnvCheckSection({ required = [], values = {}, onChange, savedKeys = new Set() }) {
  if (!required || required.length === 0) return null;

  const missing = required.filter((r) => !savedKeys.has(r.key) && !String(values[r.key] || "").trim());
  const allSet = missing.length === 0;

  return (
    <div className="rounded-lg border border-border bg-muted/15 p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium">
          Environment variables
          <span className="ml-1.5 font-mono text-muted-foreground">
            {required.length - missing.length}/{required.length} set
          </span>
        </p>
        {allSet ? (
          <span className="ml-auto flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
            <Check className="h-3 w-3" /> complete
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            <AlertTriangle className="h-3 w-3" /> {missing.length} missing
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Detected from {[...new Set(required.map((r) => r.source).filter(Boolean))].join(", ") || "the repository"}.
        Fill in the missing values — they&apos;re saved to the project before deploying.
      </p>

      <div className="mt-3 space-y-2">
        {required.map((r) => {
          const saved = savedKeys.has(r.key);
          const filled = String(values[r.key] || "").trim().length > 0;
          const done = saved || filled;
          return (
            <div key={r.key} className="grid grid-cols-[1fr_1.4fr] items-center gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-foreground" title={r.key}>
                  {r.key}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      "rounded px-1 py-px font-medium",
                      r.required ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {r.required ? "required" : "optional"}
                  </span>
                  {done && (
                    <span className="flex items-center gap-0.5 text-success">
                      <Check className="h-3 w-3" /> set
                    </span>
                  )}
                </p>
              </div>
              {saved && !filled ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground">•••••••• (saved)</p>
              ) : (
                <Input
                  value={values[r.key] || ""}
                  onChange={(e) => onChange?.(r.key, e.target.value)}
                  placeholder={r.default ? `e.g. ${r.default}` : r.required ? "required" : "optional"}
                  className={cn(
                    "h-8 font-mono text-xs",
                    !done && r.required && "border-warning/40 focus-visible:ring-warning/30"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
