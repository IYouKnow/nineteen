import { cn } from "@/lib/utils";
import { getStatus, TONES } from "@/lib/devStatus";

export default function StatusDot({ status, kind = "project", className }) {
  const cfg = getStatus(status, kind);
  const tone = TONES[cfg.tone];
  return (
    <span className={cn("relative inline-flex h-2 w-2 flex-shrink-0", className)}>
      <span
        className={cn(
          "inline-flex h-2 w-2 rounded-full",
          tone.dot,
          cfg.pulse && "animate-build-pulse"
        )}
      />
    </span>
  );
}