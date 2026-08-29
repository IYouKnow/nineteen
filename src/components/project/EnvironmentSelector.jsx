import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getEnvType } from "@/lib/environments";

export default function EnvironmentSelector({ environments, selectedId, onSelect, onManage }) {
  const selected = environments.find((e) => e.id === selectedId) || environments[0];
  if (!selected) return null;
  const type = getEnvType(selected.type);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: type.color }} />
          <span className="max-w-[140px] truncate">{selected.name}</span>
          <span className="hidden text-muted-foreground/50 sm:inline">· {type.label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 border-border bg-popover">
        <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Environments
        </p>
        {environments.map((e) => {
          const t = getEnvType(e.type);
          const active = e.id === selected.id;
          return (
            <DropdownMenuItem key={e.id} onClick={() => onSelect(e.id)} className="gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
              <span className="flex-1 truncate text-sm">{e.name}</span>
              <span className="text-[10px] text-muted-foreground/60">{t.label}</span>
              {active && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem onClick={onManage} className="gap-2">
          <Settings2 className="h-3.5 w-3.5" /> Manage environments
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}