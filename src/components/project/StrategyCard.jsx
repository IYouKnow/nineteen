import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export default function StrategyCard({ option, selected, onSelect }) {
  const { id, icon: Icon, title, description, badge } = option;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "group relative flex flex-col rounded-lg border p-4 text-left transition-all",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-foreground/20 hover:bg-muted/30"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
            selected
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-muted/30 text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {selected ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        ) : (
          <span className="h-5 w-5 rounded-full border border-border" />
        )}
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      {badge && (
        <span className="mt-3 inline-flex w-fit rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}