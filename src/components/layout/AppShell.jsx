import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Eye } from "lucide-react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { useAuth } from "@/hooks/useAuth";

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { canWrite } = useAuth();
  const content = children ?? <Outlet />;
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenu={() => setMobileOpen(true)} />
        {!canWrite && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            You have read-only access — creating, editing and deleting is disabled.
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          {content}
        </main>
      </div>
    </div>
  );
}
