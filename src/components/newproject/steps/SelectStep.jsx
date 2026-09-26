import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, Link2, Loader2, Star, Plug } from "lucide-react";
import { isImageSource } from "@/lib/newProject";
import SourceIcon from "@/components/newproject/SourceIcon";
import DockerHubBrowser from "@/components/newproject/DockerHubBrowser";
import ImageTagSelect from "@/components/newproject/ImageTagSelect";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_URL = import.meta.env.VITE_API_URL || "";

function getAuthHeaders() {
  const token = localStorage.getItem("nineteen_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// Per-provider presentation for the repository picker. Both GitHub and Gitea
// expose the same stored-integration shape (id, username, provider).
const PROVIDER_META = {
  github: {
    label: "GitHub",
    icon: "github",
    color: "#24292f",
    connectHint: "Grant read access to your repositories so you can pick one to deploy.",
  },
  gitea: {
    label: "Gitea",
    icon: "gitea",
    color: "#609966",
    connectHint: "Connect a self-hosted Gitea instance so you can pick one of its repositories.",
  },
};

// IntegrationPanel renders the connect prompt, account selector and searchable
// repository list for a single provider (GitHub or Gitea).
function IntegrationPanel({ providerId, selectedRepo, update, integrations, integrationsLoading, onConnect }) {
  const meta = PROVIDER_META[providerId];
  const [query, setQuery] = useState("");
  const [selectedAccount, setSelectedAccount] = useState(null);

  const providerIntegrations = useMemo(
    () => (integrations || []).filter((i) => i.provider === providerId),
    [integrations, providerId]
  );
  const connected = providerIntegrations.length > 0;

  useEffect(() => {
    setSelectedAccount(null);
  }, [providerId]);

  useEffect(() => {
    if (connected && !selectedAccount) setSelectedAccount(providerIntegrations[0].id);
  }, [connected, selectedAccount, providerIntegrations]);

  const { data: repos = [], isLoading: reposLoading } = useQuery({
    queryKey: ["integration-repos", selectedAccount],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/api/settings/integrations/repos?id=${selectedAccount}&per_page=50`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error("Failed to load repositories");
      return res.json();
    },
    enabled: !!selectedAccount,
    staleTime: 60000,
  });

  const filteredRepos = useMemo(() => {
    const list = repos || [];
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(
      (r) => r.full_name?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)
    );
  }, [repos, query]);

  const handleChangeAccount = (id) => {
    setSelectedAccount(id);
    update({ repo: null, integrationId: null });
  };

  const selectRepo = (repo) => update({ repo, integrationId: selectedAccount, provider: providerId });

  if (integrationsLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking {meta.label} connection…
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
          style={{ background: meta.color }}
        >
          <SourceIcon icon={meta.icon} color="transparent" size={24} />
        </div>
        <div>
          <p className="text-sm font-medium">Connect your {meta.label} account</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{meta.connectHint}</p>
        </div>
        <Button type="button" onClick={onConnect} className="gap-2">
          <Plug className="h-4 w-4" />
          Connect {meta.label}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="h-3.5 w-3.5" />
          </span>
          <span className="hidden text-sm font-medium sm:inline">Repositories</span>
        </div>
        <div className="flex items-center gap-2">
          {providerIntegrations.length > 1 ? (
            <Select
              value={selectedAccount != null ? String(selectedAccount) : undefined}
              onValueChange={(v) => handleChangeAccount(Number(v))}
            >
              <SelectTrigger className="h-8 w-auto min-w-[160px] gap-2 bg-card font-mono text-xs">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {providerIntegrations.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.label && a.label !== meta.label ? `${a.label} (@${a.username})` : `@${a.username}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="rounded-md border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground">
              @{providerIntegrations[0]?.username}
            </span>
          )}
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search repositories…"
          className="pl-9"
        />
      </div>
      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {reposLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repositories…
          </div>
        ) : filteredRepos.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No repositories found.</p>
        ) : (
          filteredRepos.map((repo) => {
            const active = selectedRepo === repo.full_name;
            return (
              <button
                key={repo.full_name}
                type="button"
                onClick={() => selectRepo(repo)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                  active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/40"
                )}
              >
                <FrameworkIcon framework={repo.framework} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-foreground">{repo.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{repo.description}</p>
                </div>
                <span className="hidden items-center gap-1 font-mono text-xs text-muted-foreground/60 sm:flex">
                  <Star className="h-3 w-3" /> {repo.stars}
                </span>
                {repo.private && (
                  <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground/60 sm:inline">
                    Private
                  </span>
                )}
                {active && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// PublicRepoPanel collects a public HTTPS clone URL.
function PublicRepoPanel({ source, update }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Repository URL</Label>
        <div className="relative mt-1.5">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={source.publicUrl}
            onChange={(e) => update({ publicUrl: e.target.value })}
            placeholder="https://github.com/acme/public-repo.git"
            className="pl-9 font-mono text-sm"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Any public Git clone URL — HTTPS only. We&apos;ll detect the framework automatically.
        </p>
      </div>
    </div>
  );
}

// DockerHubPanel lets the user pick a prebuilt image from the curated catalog
// or a live Docker Hub search, then choose a tag and fill in its env vars.
function DockerHubPanel({ source, update }) {
  const pick = (app) =>
    update({
      image: app.repository,
      imageTag: "latest",
      imageMeta: {
        name: app.name,
        description: app.description,
        port: app.port || 0,
      },
      env: (app.env || []).map((e) => ({
        key: e.key,
        label: e.label,
        value: e.default || "",
        secret: !!e.secret,
        required: !!e.required,
      })),
    });

  const setEnvValue = (key, value) =>
    update({ env: (source.env || []).map((e) => (e.key === key ? { ...e, value } : e)) });

  return (
    <div>
      <DockerHubBrowser
        selected={source.image}
        onPick={pick}
        emptyHint="No images matched your search."
      />

      {source.image && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 animate-slide-up">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{source.imageMeta?.name || source.image}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{source.image}</p>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Tag</Label>
              <ImageTagSelect
                image={source.image}
                value={source.imageTag}
                onChange={(v) => update({ imageTag: v })}
                className="h-8 w-40 font-mono text-xs"
              />
            </div>
          </div>

          {source.imageMeta?.description && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {source.imageMeta.description}
            </p>
          )}

          {source.env?.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Environment</p>
              {source.env.map((e) => (
                <div key={e.key} className="grid grid-cols-[1fr_1.2fr] items-center gap-2">
                  <span className="truncate font-mono text-xs text-foreground" title={e.key}>
                    {e.key}
                  </span>
                  <Input
                    type={e.secret ? "password" : "text"}
                    value={e.value}
                    onChange={(ev) => setEnvValue(e.key, ev.target.value)}
                    placeholder={e.required ? "required" : "optional"}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const HEADERS = {
  github: {
    title: "Choose a repository",
    subtitle: "Pick the repository you want to deploy from your connected account.",
  },
  gitea: {
    title: "Choose a repository",
    subtitle: "Pick the repository you want to deploy from your connected instance.",
  },
  public: {
    title: "Public repository",
    subtitle: "Paste any public Git clone URL — no account required.",
  },
  dockerhub: {
    title: "Choose an image",
    subtitle: "Pick a prebuilt image from the app store or search Docker Hub.",
  },
};

// SelectStep is the second wizard step: it renders the picker for whichever
// source was chosen in the previous step (repository, URL or container image).
export default function SelectStep({ source, setSource }) {
  const navigate = useNavigate();
  const update = (patch) => setSource((s) => ({ ...s, ...patch }));

  const { data: integrations = [], isLoading: integrationsLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/settings/integrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load integrations");
      return res.json();
    },
    staleTime: 30000,
  });

  const handleConnect = () => navigate("/settings/integrations");

  const header = HEADERS[source.type] || {
    title: "Choose your source",
    subtitle: "Select what you want to deploy.",
  };

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">{header.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{header.subtitle}</p>
      </header>

      {(source.type === "github" || source.type === "gitea") && (
        <IntegrationPanel
          providerId={source.type}
          selectedRepo={source.repo?.full_name}
          update={update}
          integrations={integrations}
          integrationsLoading={integrationsLoading}
          onConnect={handleConnect}
        />
      )}

      {source.type === "public" && <PublicRepoPanel source={source} update={update} />}

      {isImageSource(source) && <DockerHubPanel source={source} update={update} />}
    </div>
  );
}
