import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

// Repositories highlighted in the featured carousel, in display order.
const FEATURED_PICKS = [
  "nginx",
  "postgres",
  "redis",
  "grafana/grafana",
  "portainer/portainer-ce",
  "jellyfin/jellyfin",
  "gitea/gitea",
  "metabase/metabase",
];

function compactNumber(n) {
  if (!n) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// AppLogo renders an app's icon and gracefully falls back to its initial when
// the image is missing or fails to load.
function AppLogo({ app, size = "md", className }) {
  const [failed, setFailed] = useState(false);
  const showImage = app.logo_url && !failed;
  const sizes = {
    sm: "h-10 w-10 text-sm",
    md: "h-12 w-12 text-base",
    lg: "h-16 w-16 text-xl",
  };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white font-semibold text-muted-foreground",
        sizes[size],
        className
      )}
    >
      {showImage ? (
        <img
          src={app.logo_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1.5"
        />
      ) : (
        app.name?.charAt(0)?.toUpperCase() || "?"
      )}
    </span>
  );
}

function StoreAppCard({ app, onOpen }) {
  const hasMeta = app.star_count > 0 || app.pull_count > 0 || !!app.last_updated;
  return (
    <button
      type="button"
      onClick={() => onOpen(app)}
      className="group flex h-full w-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start gap-3">
        <AppLogo app={app} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-foreground">{app.name}</p>
            {app.is_official && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-info" aria-label="Official image" />
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground/70">{app.repository}</p>
          {app.category && (
            <Badge variant="secondary" className="mt-1.5 px-2 py-0 text-[10px] font-medium">
              {app.category}
            </Badge>
          )}
        </div>
      </div>

      <p className="mt-3 line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">
        {app.description || "No description provided."}
      </p>

      {hasMeta && (
        <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-2.5 font-mono text-[11px] text-muted-foreground/70">
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
          {app.last_updated && (
            <span className="ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" /> {timeAgo(app.last_updated)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

// AppDetailDialog shows the full metadata for an image and offers a one-click
// install that forwards the app to the caller.
function AppDetailDialog({ app, open, onOpenChange, onInstall, canInstall }) {
  if (!app) return null;
  const install = () => {
    onInstall(app);
    onOpenChange(false);
  };

  const stats = [];
  if (app.star_count > 0)
    stats.push({ icon: Star, label: "Stars", value: compactNumber(app.star_count) });
  if (app.pull_count > 0)
    stats.push({ icon: Download, label: "Pulls", value: compactNumber(app.pull_count) });
  if (app.last_updated)
    stats.push({ icon: Clock, label: "Updated", value: timeAgo(app.last_updated) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <AppLogo app={app} size="lg" />
            <div className="min-w-0 flex-1 pr-6">
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate text-lg">{app.name}</DialogTitle>
                {app.is_official && (
                  <BadgeCheck className="h-4 w-4 shrink-0 text-info" aria-label="Official image" />
                )}
              </div>
              <DialogDescription asChild>
                <p className="truncate font-mono text-xs text-muted-foreground/70">{app.repository}</p>
              </DialogDescription>
              {(app.category || app.is_official) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {app.category && (
                    <Badge variant="secondary" className="px-2 py-0 text-[10px] font-medium">
                      {app.category}
                    </Badge>
                  )}
                  {app.is_official && (
                    <Badge variant="outline" className="px-2 py-0 text-[10px] font-medium">
                      Official
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        {app.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{app.description}</p>
        )}

        {stats.length > 0 && (
          <div
            className={cn(
              "grid gap-2",
              stats.length === 1 ? "grid-cols-1" : stats.length === 2 ? "grid-cols-2" : "grid-cols-3"
            )}
          >
            {stats.map((s) => (
              <Stat key={s.label} icon={s.icon} label={s.label} value={s.value} />
            ))}
          </div>
        )}

        {app.port > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Exposed port</span>
            <span className="font-mono text-foreground">{app.port}</span>
          </div>
        )}

        {app.env?.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Environment variables</p>
            <div className="space-y-1.5">
              {app.env.map((e) => (
                <div key={e.key} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-foreground">{e.key}</span>
                  {e.secret && (
                    <ShieldCheck className="h-3 w-3 text-muted-foreground/60" aria-label="Secret" />
                  )}
                  {e.required ? (
                    <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                      required
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/60">optional</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={install} disabled={!canInstall}>
            <Boxes className="h-4 w-4" /> Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// FeaturedCarousel is a horizontally scrollable row of highlighted apps with
// arrow controls on either side. It tracks its scroll position so the arrows
// only appear when there is more content in that direction.
function FeaturedCarousel({ apps, onOpen }) {
  const scrollerRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [apps]);

  const scrollBy = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.8, 280);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  const arrowClass =
    "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted";

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth px-1 py-3"
      >
        {apps.map((app) => (
          <div key={app.repository} className="w-[270px] shrink-0">
            <StoreAppCard app={app} onOpen={onOpen} />
          </div>
        ))}
      </div>

      {!atStart && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className={cn(arrowClass, "-left-4")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {!atEnd && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className={cn(arrowClass, "-right-4")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// StoreBrowser renders the app-store experience: a search box, a featured
// carousel, category filters and a responsive grid of rich app cards.
export function StoreBrowser({
  query,
  setQuery,
  debounced,
  searching,
  loading,
  featured,
  results,
  onInstall,
  canInstall,
  emptyHint,
}) {
  const [category, setCategory] = useState("All");
  const [detail, setDetail] = useState(null);

  const categories = useMemo(() => {
    const set = new Set(featured.map((a) => a.category).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [featured]);

  const picks = useMemo(
    () => FEATURED_PICKS.map((r) => featured.find((a) => a.repository === r)).filter(Boolean),
    [featured]
  );

  const list = useMemo(() => {
    if (searching) return results;
    if (category === "All") return featured;
    return featured.filter((a) => a.category === category);
  }, [searching, results, featured, category]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Docker Hub images…"
          className="h-10 pl-9 pr-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {!searching && picks.length > 0 && (
        <section className="mt-7">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold tracking-tight">Featured</h2>
          </div>
          <FeaturedCarousel apps={picks} onOpen={setDetail} />
        </section>
      )}

      {!searching && categories.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                category === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 mt-6 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {searching ? `Results for “${debounced}”` : category === "All" ? "All apps" : category}
          {!loading && <span className="text-muted-foreground/60"> · {list.length}</span>}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((app) => (
          <StoreAppCard key={app.repository} app={app} onOpen={setDetail} />
        ))}
        {!loading && list.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
            {emptyHint || "No images found."}
          </p>
        )}
      </div>

      <AppDetailDialog
        app={detail}
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        onInstall={onInstall}
        canInstall={canInstall}
      />
    </div>
  );
}
