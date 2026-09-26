import { useNavigate } from "react-router-dom";
import { Store, Sparkles } from "lucide-react";
import DockerHubBrowser from "@/components/newproject/DockerHubBrowser";
import { useAuth } from "@/hooks/useAuth";

export default function AppStore() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("projects.create");

  const install = (app) => {
    if (!canCreate) return;
    const params = new URLSearchParams({ image: app.repository });
    navigate(`/projects/new?${params.toString()}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">App Store</h1>
            <p className="text-sm text-muted-foreground">
              Launch a prebuilt Docker image in one click — no repository required.
            </p>
          </div>
        </div>
      </header>

      {!canCreate && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          You need permission to create projects to install an app.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <DockerHubBrowser
          onPick={install}
          emptyHint="No images matched your search."
        />
      </div>
    </div>
  );
}
