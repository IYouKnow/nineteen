import { useState } from "react";
import { Menu, Search, Bell, User, Settings, LogOut, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import GlobalSearch from "@/components/layout/GlobalSearch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const name = user?.display_name || user?.username || "User";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
      <button
        onClick={onMenu}
        className="text-muted-foreground hover:text-foreground md:hidden cursor-pointer"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground/60">
        <span>nineteen@0.3.2</span>
        <span className="hidden sm:inline text-muted-foreground/30">·</span>
        <span className="hidden sm:inline">self-hosted</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setSearchOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:flex cursor-pointer"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
          <kbd className="ml-3 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
            ⌘K
          </kbd>
        </button>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer">
          <Bell className="h-4 w-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md border border-border bg-muted/20 py-1 pl-1 pr-2.5 transition-colors hover:bg-muted/40 cursor-pointer">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold",
                  "bg-foreground text-background"
                )}
              >
                {initials(name)}
              </span>
              <span className="hidden max-w-[120px] truncate text-xs text-foreground/80 sm:inline">
                {name}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => { logout(); navigate("/login", { replace: true }); }}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
