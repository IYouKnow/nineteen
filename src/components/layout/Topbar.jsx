import { Menu, Search, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name = "User") {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Topbar({ onMenu }) {
  const name = "User";
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
      <button
        onClick={onMenu}
        className="text-muted-foreground hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground/60">
        <span>nineteen@1.9.0</span>
        <span className="hidden sm:inline text-muted-foreground/30">·</span>
        <span className="hidden sm:inline">self-hosted</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button className="hidden items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:flex">
          <Search className="h-3.5 w-3.5" />
          <span>Search projects…</span>
          <kbd className="ml-3 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
            ⌘K
          </kbd>
        </button>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
          <Bell className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 py-1 pl-1 pr-2.5">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold",
              "bg-foreground text-background"
            )}
          >
            {initials("User")}
          </span>
          <span className="hidden max-w-[120px] truncate text-xs text-foreground/80 sm:inline">
            User
          </span>
        </div>
      </div>
    </header>
  );
}