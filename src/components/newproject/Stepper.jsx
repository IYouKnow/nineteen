import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Stepper({ steps, current }) {
  return (
    <div className="flex items-center">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s.id} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-3 h-px flex-1 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}