import { useState } from "react";
import { Hand, Zap, GitBranch, Tag, Rocket, Save, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
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

export default function ProjectStrategy({ project }) {
  const { toast } = useToast();
  const [strategy, setStrategy] = useState(project.auto_deploy ? "commit" : "manual");
  const [branch, setBranch] = useState(project.branch || "main");
  const [tagMode, setTagMode] = useState("pattern");
  const [tagPattern, setTagPattern] = useState("v*");
  const [preRelease, setPreRelease] = useState(false);
  const [saving, setSaving] = useState(false);

  const head = HEADERS[strategy];
  const HeadIcon = head.icon;
  const ex = buildExamples(strategy, branch, tagMode, preRelease);

  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast({ title: "Deployment strategy saved", description: "Your trigger configuration has been updated." });
    }, 600);
  };

  const deployNow = () => {
    toast({ title: "Deployment queued", description: "A new deployment has been triggered manually." });
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
                <Button variant="outline" size="sm" onClick={deployNow} className="gap-2">
                  <Play className="h-3.5 w-3.5" /> Deploy now
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

      <TriggerHistory />
    </div>
  );
}