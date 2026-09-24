import { useEffect } from "react";
import { GitBranch, Loader2, Tag } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ModeCard({ active, onClick, icon: Icon, title, desc, badge, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border p-4 text-left transition-all",
        disabled
          ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
          : active
            ? "border-primary bg-primary/5 ring-1 ring-primary"
            : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", active && !disabled ? "text-primary" : "text-muted-foreground")} />
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        {badge && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </button>
  );
}

// VersionStep asks the user what to deploy: a fixed, tagged version (a published
// release or a plain git tag) or a build of the latest repository code. When the
// repository has no releases or tags, only the repository build is offered.
export default function VersionStep({ config, setConfig, versions = [], loading, error, repoLabel, branch }) {
  const update = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const hasVersions = versions.length > 0;
  const mode = hasVersions && config.deployType === "release" ? "release" : "branch";
  const latest = versions[0]?.tag_name || "";
  const selectedVersion = versions.find((v) => v.tag_name === config.deployRef) || versions[0] || null;

  // Keep a concrete version selected once versions load (or when switching to
  // release mode), defaulting to the latest.
  useEffect(() => {
    if (mode === "release" && !config.deployRef && latest) {
      update({ deployRef: latest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, config.deployRef, latest]);

  // Fall back to a repository build when no versions exist.
  useEffect(() => {
    if (!hasVersions && config.deployType === "release") {
      update({ deployType: "branch", deployRef: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVersions, config.deployType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking for releases and tags…
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">What should we deploy?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasVersions ? (
            <>
              <span className="font-mono text-xs text-foreground">{repoLabel}</span> has tagged
              versions. Deploy a released or tagged version, or build the latest code from the
              repository.
            </>
          ) : error ? (
            <>
              We couldn&apos;t check{" "}
              <span className="font-mono text-xs text-foreground">{repoLabel}</span> for releases or
              tags — the latest code from the repository branch will be built.
            </>
          ) : (
            <>
              <span className="font-mono text-xs text-foreground">{repoLabel}</span> has no releases or
              tags — the latest code from the repository branch will be built.
            </>
          )}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={mode === "release"}
          disabled={!hasVersions}
          onClick={() => update({ deployType: "release", deployRef: config.deployRef || latest })}
          icon={Tag}
          title="Release / tag version"
          desc="Deploy a published release or a git tag — a fixed, versioned snapshot of your code."
          badge={hasVersions ? `${versions.length} available` : "none found"}
        />
        <ModeCard
          active={mode === "branch"}
          onClick={() => update({ deployType: "branch", deployRef: "" })}
          icon={GitBranch}
          title="Build from repo"
          desc="Build the latest commit from the repository branch. Updates on every deploy."
          badge={branch ? `branch ${branch}` : "default branch"}
        />
      </div>

      {mode === "release" && (
        <div className="mt-5 rounded-lg border border-border bg-muted/15 p-4 animate-slide-up">
          <Label className="text-xs">Version to deploy</Label>
          <Select
            value={config.deployRef || undefined}
            onValueChange={(v) => update({ deployRef: v })}
          >
            <SelectTrigger className="mt-1.5 h-9 gap-2 bg-card font-mono text-xs">
              <SelectValue placeholder="Select a release or tag" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {versions.map((v) => (
                <SelectItem key={v.tag_name} value={v.tag_name} className="font-mono text-xs">
                  {v.tag_name}
                  {v.name && v.name !== v.tag_name ? ` — ${v.name}` : ""}
                  {v.is_release ? "" : "  (tag)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedVersion && (
            <p className="mt-2 text-xs text-muted-foreground">
              {selectedVersion.is_release
                ? selectedVersion.published_at
                  ? `Release · published ${formatDate(selectedVersion.published_at)}`
                  : "Published release"
                : "Git tag"}
              {selectedVersion.prerelease ? " · pre-release" : ""}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            The deploy checks out{" "}
            <span className="font-mono text-foreground">{config.deployRef || latest}</span> and builds it.
          </p>
        </div>
      )}
    </div>
  );
}
