import { useNavigate } from "react-router-dom";
import { BadgeCheck, Search, Sparkles, Store, Zap } from "lucide-react";
import DockerHubBrowser from "@/components/newproject/DockerHubBrowser";
import { useAuth } from "@/hooks/useAuth";
import { PERM } from "@/lib/permissions";

const HERO_FEATURES = [
  { icon: Zap, label: "One-click deploy" },
  { icon: BadgeCheck, label: "Official images" },
  { icon: Search, label: "Live Docker Hub search" },
];

export default function AppStore() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERM.PROJECTS_CREATE);

  const install = (app) => {
    if (!canCreate) return;
    const params = new URLSearchParams({ image: app.repository });
    navigate(`/projects/new?${params.toString()}`);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">App Store</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Launch a prebuilt Docker image in one click — no repository required. Browse
              curated apps or search Docker Hub.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {HERO_FEATURES.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  <Icon className="h-3.5 w-3.5 text-primary" /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {!canCreate && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          You need permission to create projects to install an app.
        </div>
      )}

      <div className="mt-8">
        <DockerHubBrowser
          variant="store"
          onPick={install}
          canInstall={canCreate}
          emptyHint="No images matched your search."
        />
      </div>
    </div>
  );
}
