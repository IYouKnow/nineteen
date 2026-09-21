import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { Users, Ticket, Boxes, Server, ScrollText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const TABS = [
  { to: "/admin/users", label: "Users", icon: Users, permission: "admin.users.read" },
  { to: "/admin/invites", label: "Invites", icon: Ticket, permission: "admin.invites.read" },
  { to: "/admin/roles", label: "Roles", icon: ShieldCheck, permission: "admin.roles.read" },
  { to: "/admin/resources", label: "Resources", icon: Boxes, permission: "admin.resources.read" },
  { to: "/admin/system", label: "System", icon: Server, permission: "admin.system.read" },
  { to: "/admin/audit", label: "Audit Log", icon: ScrollText, permission: "admin.audit.read" },
];

export default function AdminLayout() {
  const { hasPermission } = useAuth();
  const location = useLocation();

  const tabs = TABS.filter((t) => hasPermission(t.permission));
  const current = tabs.find((t) => location.pathname.startsWith(t.to));

  // If the user opens a tab they can't read, send them to the first one they can.
  if (tabs.length > 0 && !current) {
    return <Navigate to={tabs[0].to} replace />;
  }

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
        {tabs.map((tab) => (
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
