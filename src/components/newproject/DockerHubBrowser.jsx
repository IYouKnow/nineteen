import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { Check, Download, Loader2, Search, Star, BadgeCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StoreBrowser } from "@/components/newproject/AppStoreBrowser";

// useDebounced returns value after it has stopped changing for `delay` ms.
function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Docker Hub no longer returns repository logos, and a server started before
// the curated catalog was updated may omit logo_url. Fall back to the
// community dashboard-icons set so featured cards always render an icon.
const ICON_SLUG_OVERRIDES = {
  httpd: "apache",
  postgres: "postgresql",
  mongo: "mongodb",
  "portainer/portainer-ce": "portainer",
  "vaultwarden/server": "vaultwarden",
};

function fallbackLogo(repository) {
  const repo = repository || "";
  if (!repo) return "";
  const name = repo.split("/").pop();
  const slug = ICON_SLUG_OVERRIDES[repo] || ICON_SLUG_OVERRIDES[name] || name;
  return `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${slug}.png`;
}

// normalize maps a featured app or a Docker Hub search result into the shape the
// browser renders and the parent consumes.
function normalize(item, featured) {
  if (featured) {
    return {
      repository: item.repository,
      name: item.name,
      description: item.description,
      category: item.category,
      logo_url: item.logo_url || fallbackLogo(item.repository),
      port: item.port,
      env: item.env || [],
      is_official: true,
      star_count: item.star_count,
      pull_count: item.pull_count,
      last_updated: item.last_updated,
    };
  }
  return {
    repository: item.repository,
    name: item.name,
    description: item.description,
    category: item.category || null,
    logo_url: item.logo_url,
    port: item.port || 0,
    env: item.env || [],
    is_official: item.is_official,
    star_count: item.star_count,
    pull_count: item.pull_count,
    last_updated: item.last_updated,
  };
}

function compactNumber(n) {
  if (!n) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function AppCard({ app, active, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick(app)}
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border p-3.5 text-left transition-all",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 text-sm font-semibold text-muted-foreground">
        {app.logo_url ? (
          <img src={app.logo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          app.name?.charAt(0)?.toUpperCase() || "?"
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">{app.name}</p>
          {app.is_official && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-info" />}
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground/70">{app.repository}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {app.description || "No description."}
        </p>
        {(app.star_count > 0 || app.pull_count > 0) && (
          <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px] text-muted-foreground/60">
            {app.star_count > 0 && (
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3" /> {compactNumber(app.star_count)}
              </span>
            )}
            {app.pull_count > 0 && (
              <span className="flex items-center gap-1">
                <Download className="h-3 w-3" /> {compactNumber(app.pull_count)}
              </span>
            )}
          </div>
        )}
      </div>
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          active ? "border-primary bg-primary text-primary-foreground" : "border-border"
        )}
      >
        {active && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

// DockerHubBrowser renders the curated featured catalog plus a live Docker Hub
// search. It is shared by the New Project source step ("select") and the
// standalone app store ("store").
export default function DockerHubBrowser({
  onPick,
  selected,
  emptyHint,
  variant = "select",
  canInstall = true,
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 350);
  const searching = debounced.trim().length > 0;

  const { data: featured = [], isLoading: featuredLoading } = useQuery({
    queryKey: ["dockerhub-featured"],
    queryFn: api.dockerhub.featured,
    staleTime: 5 * 60 * 1000,
  });

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["dockerhub-search", debounced],
    queryFn: () => api.dockerhub.search(debounced, 25),
    enabled: searching,
    staleTime: 60 * 1000,
    retry: false,
  });

  const featuredList = useMemo(() => featured.map((f) => normalize(f, true)), [featured]);
  const resultList = useMemo(() => results.map((r) => normalize(r, false)), [results]);

  const loading = searching ? isFetching : featuredLoading;

  if (variant === "store") {
    return (
      <StoreBrowser
        query={query}
        setQuery={setQuery}
        debounced={debounced}
        searching={searching}
        loading={loading}
        featured={featuredList}
        results={resultList}
        onInstall={onPick}
        canInstall={canInstall}
        emptyHint={emptyHint}
      />
    );
  }

  const list = searching ? resultList : featuredList;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Docker Hub images…"
          className="pl-9"
        />
      </div>

      <div className="mb-2 mt-3 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {searching ? `Results for “${debounced}”` : "Featured apps"}
        </p>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid max-h-80 gap-2.5 overflow-y-auto sm:grid-cols-2">
        {list.map((app) => (
          <AppCard
            key={app.repository}
            app={app}
            active={selected === app.repository}
            onPick={onPick}
          />
        ))}
        {!loading && list.length === 0 && (
          <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
            {emptyHint || "No images found."}
          </p>
        )}
      </div>
    </div>
  );
}
