import { NavLink, useNavigate } from "react-router-dom";
import { Boxes, LayoutDashboard, FolderGit2, Database, Plus, X, Server, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderGit2, end: false },
  { to: "/databases", label: "Databases", icon: Database, end: false },
];

function NavItem({ to, label, icon: Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ mobileOpen, onClose }) {
  const navigate = useNavigate();
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
              <Boxes className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight text-foreground">nineteen</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground md:hidden cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Workspace
          </p>
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          <p className="px-2.5 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
            System
          </p>
          <NavItem to="/settings" label="Settings" icon={Settings} end={false} />
          <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground">
            <Server className="h-4 w-4 shrink-0" />
            <span>Activity</span>
            <span className="ml-auto rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              soon
            </span>
          </div>
        </nav>

        <div className="p-3">
          <Button
            onClick={() => navigate("/projects/new")}
            className="w-full justify-start gap-2 bg-foreground text-background hover:bg-foreground/90"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>

        <div className="space-y-3 border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 rounded-md border border-sidebar-border bg-muted/20 px-2.5 py-2 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-build-pulse rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="text-muted-foreground">Cluster</span>
            <span className="ml-auto font-mono text-foreground/80">fra1 · healthy</span>
          </div>
        </div>
      </aside>
    </>
  );
}