import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Hand, Zap, GitBranch, Tag, Rocket, Save, Loader2, Play, Webhook,
  Copy, CheckCircle2, AlertTriangle, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";
import StrategyCard from "./StrategyCard";
import TriggerHistory from "./TriggerHistory";

const STRATEGIES = [
  { id: "manual", icon: Hand, title: "Manual", description: "Deployments only run when you click Deploy. Full control over every release." },
  { id: "commit", icon: Zap, title: "Every Commit", description: "A deployment is created automatically for every commit pushed to your branch." },
  { id: "branch", icon: GitBranch, title: "Branch", description: "Automatically deploy whenever a commit lands on a selected branch." },
  { id: "tag", icon: Tag, title: "Tag", description: "Deploy when a matching Git tag is created. Ideal for versioned releases." },
  { id: "release", icon: Rocket, title: "Release", description: "Deploy when a GitHub release is published. Tied to your release workflow." },
];

const HEADERS = {
  manual: { icon: Hand, title: "Manual deployments", hint: "No automatic triggers — you ship when you're ready." },
  commit: { icon: Zap, title: "Every commit", hint: "Each push to your branch triggers a new deployment." },
  branch: { icon: GitBranch, title: "Branch trigger", hint: "Deploys whenever a commit is pushed to the watched branch." },
  tag: { icon: Tag, title: "Tag trigger", hint: "Deploys when a matching Git tag is created." },
  release: { icon: Rocket, title: "Release trigger", hint: "Deploys when a GitHub release is published." },
};

const BRANCHES = ["main", "develop", "staging", "release"];

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function buildExamples(strategy, branch, tagMode, preRelease) {
  switch (strategy) {
    case "manual":
      return [{ text: "Clicking Deploy in the dashboard", match: true }];
    case "commit":
      return [
        { text: `feat: dark mode  →  ${branch}`, match: true },
        { text: `fix: typo  →  ${branch}`, match: true },
        { text: "push to develop", match: false },
      ];
    case "branch":
      return [
        { text: `any commit on ${branch}`, match: true },
        { text: "commit on develop", match: false },
      ];
    case "tag":
      return tagMode === "any"
        ? [{ text: "v1.4.0", match: true }, { text: "hotfix-01", match: true }, { text: "nightly", match: true }]
        : [{ text: "v1.4.0", match: true }, { text: "v2.0.0", match: true }, { text: "nightly", match: false }];
    case "release":
      return [
        { text: "Release v1.4.0 published", match: true },
        { text: "Release v1.4.1 published", match: true },
        { text: "Release v2.0.0-beta", match: preRelease },
      ];
    default:
      return [];
  }
}

function ExampleRow({ text, match }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">{text}</code>
      <span className={cn("shrink-0 text-xs", match ? "text-success" : "text-muted-foreground/50")}>
        {match ? "triggers" : "ignored"}
      </span>
    </div>
  );
}

function WebhookPanel({ trigger, strategy }) {
  const [copied, setCopied] = useState(false);

  if (strategy === "manual") return null;

  const copy = async () => {
    if (!trigger?.webhook_url) return;
    try {
      await navigator.clipboard.writeText(trigger.webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!trigger?.public_base_url) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">A public base URL is required</p>
            <p className="text-xs text-muted-foreground">
              GitHub cannot deliver webhooks to <code className="font-mono">localhost</code>. Add the domain or
              public IP that reaches this server in Settings → Integrations, then save the strategy again.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1 gap-1.5">
              <Link to="/settings/integrations">
                Open Integrations <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
            <Webhook className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium">GitHub webhook</p>
            <p className="text-xs text-muted-foreground">Events are delivered to this URL and verified by signature.</p>
          </div>
        </div>
        {trigger.registered ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Registered
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Not registered
          </span>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Payload URL</label>
        <div className="flex items-center gap-2">
          <Input readOnly value={trigger.webhook_url || ""} className="bg-card font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={copy} title="Copy URL">
            {copied ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {trigger.webhook_error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{trigger.webhook_error}</p>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground/70">
        Subscribed events: {strategy === "release" ? "release" : strategy === "tag" ? "push, create" : "push"}. Content
        type <code className="font-mono">application/json</code>; the secret is managed automatically.
      </p>
    </div>
  );
}

export default function ProjectStrategy({ project }) {
  const qc = useQueryClient();
  const initialized = useRef(false);

  const [strategy, setStrategy] = useState(project.auto_deploy ? "commit" : "manual");
  const [branch, setBranch] = useState(project.branch || "main");
  const [tagMode, setTagMode] = useState("pattern");
  const [tagPattern, setTagPattern] = useState("v*");
  const [preRelease, setPreRelease] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const { data: trigger } = useQuery({
    queryKey: ["trigger", project.id],
    queryFn: () => api.projects.trigger(project.id),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events", project.id],
    queryFn: () => api.projects.events(project.id),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!trigger || initialized.current) return;
    initialized.current = true;
    setStrategy(trigger.strategy || "manual");
    setBranch(trigger.branch || project.branch || "main");
    setTagMode(trigger.tag_mode || "pattern");
    setTagPattern(trigger.tag_pattern || "v*");
    setPreRelease(!!trigger.pre_release);
    setEnabled(trigger.enabled !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const head = HEADERS[strategy] || HEADERS.manual;
  const HeadIcon = head.icon;
  const ex = buildExamples(strategy, branch, tagMode, preRelease);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.projects.saveTrigger(project.id, {
        strategy,
        branch,
        tag_mode: tagMode,
        tag_pattern: tagPattern,
        pre_release: preRelease,
        enabled,
      });
      qc.setQueryData(["trigger", project.id], res);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (res.webhook_error) {
        toast.error("Strategy saved with a warning", { description: res.webhook_error });
      } else {
        toast.success("Deployment strategy saved", {
          description: res.registered
            ? "Webhook registered with GitHub."
            : "Your trigger configuration has been updated.",
        });
      }
    } catch (e) {
      toast.error("Save failed", { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const deployNow = async () => {
    setDeploying(true);
    try {
      await api.deployments.create(project.id, {
        commit_message: "Manual deployment from Strategy tab",
        branch: project.branch || "main",
        author: "you",
        trigger: "manual",
      });
      qc.invalidateQueries({ queryKey: ["deployments", project.id] });
      qc.invalidateQueries({ queryKey: ["deployments-recent"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["events", project.id] });
      toast.success("Deployment queued", { description: "A new deployment has been triggered manually." });
    } catch (e) {
      toast.error("Deploy failed", { description: e?.message });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Deployment strategy</h3>
        <p className="text-xs text-muted-foreground">Choose what triggers a new deployment for this project.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STRATEGIES.map((opt) => (
            <StrategyCard key={opt.id} option={opt} selected={strategy === opt.id} onSelect={setStrategy} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
            <HeadIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium">{head.title}</p>
            <p className="text-xs text-muted-foreground">{head.hint}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            {strategy === "manual" && (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-3">
                <div>
                  <p className="text-sm text-foreground">No configuration needed</p>
                  <p className="text-xs text-muted-foreground">Use the Deploy button to ship changes.</p>
                </div>
                <Button variant="outline" size="sm" onClick={deployNow} disabled={deploying} className="gap-2">
                  {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Deploy now
                </Button>
              </div>
            )}

            {(strategy === "commit" || strategy === "branch") && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {strategy === "commit" ? "Branch" : "Watched branch"}
                </label>
                <select className={selectCls} value={branch} onChange={(e) => setBranch(e.target.value)}>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b} className="bg-card">
                      {b}
                    </option>
                  ))}
                </select>
                <p className="pt-1 text-xs text-muted-foreground/70">
                  {strategy === "commit"
                    ? `Every commit pushed to ${branch} will deploy automatically.`
                    : `Commits pushed to ${branch} will deploy automatically.`}
                </p>
              </div>
            )}

            {strategy === "tag" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Match</label>
                  <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                    {["any", "pattern"].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTagMode(m)}
                        className={cn(
                          "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                          tagMode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {m === "any" ? "Any tag" : "Pattern"}
                      </button>
                    ))}
                  </div>
                </div>
                {tagMode === "pattern" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Tag pattern</label>
                    <Input
                      value={tagPattern}
                      onChange={(e) => setTagPattern(e.target.value)}
                      className="bg-card font-mono"
                      placeholder="v*"
                    />
                    <p className="text-xs text-muted-foreground/70">
                      Glob pattern. <code className="font-mono">v*</code> matches tags starting with <code className="font-mono">v</code>.
                    </p>
                  </div>
                )}
              </>
            )}

            {strategy === "release" && (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-3">
                <div>
                  <p className="text-sm text-foreground">Include pre-releases</p>
                  <p className="text-xs text-muted-foreground">Also trigger on beta and rc releases.</p>
                </div>
                <Switch checked={preRelease} onCheckedChange={setPreRelease} />
              </div>
            )}

            {strategy !== "manual" && (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-3">
                <div>
                  <p className="text-sm text-foreground">Automatic deployments</p>
                  <p className="text-xs text-muted-foreground">Pause triggers without losing this configuration.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              What triggers a deployment
            </p>
            <div className="space-y-1.5">
              {ex.map((e, i) => (
                <ExampleRow key={i} text={e.text} match={e.match} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
          <p className="text-xs text-muted-foreground">Applies to future deployments only.</p>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save strategy
              </>
            )}
          </Button>
        </div>
      </div>

      <WebhookPanel trigger={trigger} strategy={strategy} />

      <TriggerHistory events={events} />
    </div>
  );
}
