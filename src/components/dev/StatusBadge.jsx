import { cn } from "@/lib/utils";
import { getStatus, TONES } from "@/lib/devStatus";

export default function StatusBadge({ status, kind = "project", className, withDot = true }) {
  const cfg = getStatus(status, kind);
  const tone = TONES[cfg.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        tone.badge,
        className
      )}
    >
      {withDot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone.dot,
            cfg.pulse && "animate-build-pulse"
          )}
        />
      )}
      {cfg.label}
    </span>
  );
}