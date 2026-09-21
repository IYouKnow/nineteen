import { NavLink, Outlet } from "react-router-dom";
import { Users, Ticket, Boxes, Server, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/invites", label: "Invites", icon: Ticket },
  { to: "/admin/resources", label: "Resources", icon: Boxes },
  { to: "/admin/system", label: "System", icon: Server },
  { to: "/admin/audit", label: "Audit Log", icon: ScrollText },
];

export default function AdminLayout() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Instance administration — users, access and system health
          </p>
        </div>
      </div>

      <nav className="mt-6 flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
