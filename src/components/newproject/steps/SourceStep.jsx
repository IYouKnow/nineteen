import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, Link2, Loader2, Star, Plug, Sparkles } from "lucide-react";
import { SOURCES, TEMPLATES } from "@/lib/newProject";
import SourceIcon from "@/components/newproject/SourceIcon";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import TemplateIcon from "@/components/newproject/TemplateIcon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

function getAuthHeaders() {
  const token = localStorage.getItem("nineteen_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function SourceStep({ source, setSource }) {
  const [query, setQuery] = useState("");
  const [selectedAccount, setSelectedAccount] = useState(null);
  const navigate = useNavigate();

  const update = (patch) => setSource((s) => ({ ...s, ...patch }));
  const selectSource = (id) => update({ type: id, template: null });
  const selectTemplate = (id) => update({ type: "template", template: id, repo: null, publicUrl: "" });

  const { data: integrations = [], isLoading: integrationsLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/settings/integrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load integrations");
      return res.json();
    },
    staleTime: 30000,
  });

  const githubIntegrations = useMemo(
    () => (integrations || []).filter((i) => i.provider === "github"),
    [integrations]
  );
  const connected = githubIntegrations.length > 0;

  useEffect(() => {
    if (connected && !selectedAccount) setSelectedAccount(githubIntegrations[0].id);
  }, [connected, selectedAccount, githubIntegrations]);

  const handleChangeAccount = (id) => {
    setSelectedAccount(id);
    update({ repo: null });
  };

  const handleConnect = () => navigate("/settings/integrations");

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

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">Where is your code?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a source for your project repository.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {SOURCES.map((s) => {
          const active = source.type === s.id;
          const disabled = !!s.disabled;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => selectSource(s.id)}
              className={cn(
                "group relative flex items-start gap-3 rounded-lg border p-4 text-left transition-all",
                disabled
                  ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
                  : active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
              )}
            >
              <SourceIcon icon={s.icon} color={disabled ? "#94a3b8" : s.color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{s.label}</p>
                  {disabled && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              </div>
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                )}
              >
                {active && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sub-panel per source */}
      {source.type && source.type !== "template" && (
        <div className="mt-5 rounded-lg border border-border bg-muted/15 p-4 animate-slide-up">
          {source.type === "github" && (
            <div>
              {integrationsLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking GitHub connection…
                </div>
              ) : !connected ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#24292f] text-white">
                    <SourceIcon icon="github" color="transparent" size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Connect your GitHub account</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                      Grant read access to your repositories so you can pick one to deploy.
                    </p>
                  </div>
                  <Button type="button" onClick={handleConnect} className="gap-2">
                    <Plug className="h-4 w-4" />
                    Connect GitHub
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-success">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span className="hidden text-sm font-medium sm:inline">Repositories</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {githubIntegrations.length > 1 ? (
                        <Select value={selectedAccount} onValueChange={handleChangeAccount}>
                          <SelectTrigger className="h-8 w-auto min-w-[160px] gap-2 bg-card font-mono text-xs">
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                          <SelectContent>
                            {githubIntegrations.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                @{a.username}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="rounded-md border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground">
                          @{githubIntegrations[0]?.username}
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
                        const active = source.repo?.full_name === repo.full_name;
                        return (
                          <button
                            key={repo.full_name}
                            type="button"
                            onClick={() => update({ repo })}
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
              )}
            </div>
          )}

          {source.type === "public" && (
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
          )}

        </div>
      )}

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <header className="mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Start from a template</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          No repository needed — we&apos;ll generate a fresh project from a ready-made starter.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => {
          const active = source.type === "template" && source.template === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled
              onClick={() => selectTemplate(t.id)}
              className={cn(
                "group relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-all",
                "cursor-not-allowed border-border bg-muted/20 opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <TemplateIcon template={t} />
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Coming soon
                  </span>
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {source.type === "template" && source.template && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/5 p-3.5 animate-slide-up">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Starting a{" "}
            <span className="font-medium text-foreground">
              {TEMPLATES.find((t) => t.id === source.template)?.label}
            </span>{" "}
            project from a template. A new repository will be generated for you — no existing code is imported.
          </p>
        </div>
      )}
    </div>
  );
}