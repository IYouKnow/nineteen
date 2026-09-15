import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Webhook,
  Copy,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  GitCommitHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import * as api from "@/lib/api";
import EmptyState from "@/components/dev/EmptyState";
import StrategyRow from "./StrategyRow";
import StrategyFormModal from "./StrategyFormModal";
import TriggerHistory from "./TriggerHistory";

const PROVIDER_LABELS = { github: "GitHub", gitea: "Gitea", gitlab: "GitLab" };

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || "Git";
}

// The GitHub events the project webhook must subscribe to for its enabled rules.
function subscribedEvents(triggers) {
  const set = new Set();
  for (const t of triggers) {
    if (t.enabled === false) continue;
    if (t.strategy === "commit" || t.strategy === "branch") set.add("push");
    else if (t.strategy === "tag") {
      set.add("push");
      set.add("create");
    } else if (t.strategy === "release") set.add("release");
  }
  return ["push", "create", "release"].filter((e) => set.has(e));
}

function WebhookPanel({ data, triggers }) {
  const [copied, setCopied] = useState(false);

  if (triggers.length === 0) return null;

  if (!data?.public_base_url) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">A public base URL is required</p>
            <p className="text-xs text-muted-foreground">
              GitHub cannot deliver webhooks to <code className="font-mono">localhost</code>. Add the domain or
              public IP that reaches this server in Settings → Integrations, then save a strategy again.
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

  const copy = async () => {
    if (!data?.webhook_url) return;
    try {
      await navigator.clipboard.writeText(data.webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const events = subscribedEvents(triggers);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
            <Webhook className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium">GitHub webhook</p>
            <p className="text-xs text-muted-foreground">
              One hook serves every strategy on this project; events are verified by signature.
            </p>
          </div>
        </div>
        {data.registered ? (
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
          <Input readOnly value={data.webhook_url || ""} className="bg-card font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={copy} title="Copy URL">
            {copied ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {data.webhook_error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{data.webhook_error}</p>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground/70">
        Subscribed events: {events.length ? events.join(", ") : "none"}. Content type{" "}
        <code className="font-mono">application/json</code>; the secret is managed automatically.
      </p>
    </div>
  );
}

function ProviderWebhookNotice({ provider, triggers }) {
  if (triggers.length === 0) return null;
  const label = providerLabel(provider);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
          <Webhook className="h-4 w-4" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium">{label} webhook</p>
          <p className="text-xs text-muted-foreground">
            This project is hosted on {label}, so the GitHub webhook is not used. Automatic
            deployments require a {label} webhook, which isn't configured yet — strategies are saved
            but won't fire automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ProjectStrategy({ project }) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const provider = project.provider || "github";
  const isGitHub = provider === "github";

  const { data, isLoading } = useQuery({
    queryKey: ["triggers", project.id],
    queryFn: () => api.projects.triggers.list(project.id),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events", project.id],
    queryFn: () => api.projects.events(project.id),
    refetchInterval: 10000,
  });

  const triggers = data?.triggers || [];

  const lastEventByTrigger = useMemo(() => {
    const map = {};
    for (const e of events) {
      if (e.trigger_id != null && !(e.trigger_id in map)) map[e.trigger_id] = e;
    }
    return map;
  }, [events]);

  const webhook = data
    ? {
        registered: data.registered,
        webhook_url: data.webhook_url,
        public_base_url: data.public_base_url,
        webhook_error: data.webhook_error,
      }
    : null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["triggers", project.id] });
    qc.invalidateQueries({ queryKey: ["project", project.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setModalOpen(true);
  };

  const toggle = async (t, enabled) => {
    setBusyId(t.id);
    try {
      const res = await api.projects.triggers.update(project.id, t.id, {
        strategy: t.strategy,
        branch: t.branch,
        tag_mode: t.tag_mode,
        tag_pattern: t.tag_pattern,
        pre_release: t.pre_release,
        enabled,
      });
      qc.setQueryData(["triggers", project.id], res);
      refresh();
      if (res?.webhook_error) {
        toast.error("Saved with a warning", { description: res.webhook_error });
      }
    } catch (e) {
      toast.error("Update failed", { description: e?.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t) => {
    setBusyId(t.id);
    try {
      const res = await api.projects.triggers.remove(project.id, t.id);
      qc.setQueryData(["triggers", project.id], res);
      refresh();
      toast.success("Strategy deleted");
    } catch (e) {
      toast.error("Delete failed", { description: e?.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Deployment strategies</h3>
          <p className="text-xs text-muted-foreground">
            Add rules that trigger deployments automatically. With none, deploys run manually.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-2">
          <Plus className="h-3.5 w-3.5" /> Add strategy
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Loading strategies…
        </div>
      ) : triggers.length === 0 ? (
        <EmptyState
          icon={GitCommitHorizontal}
          title="No automatic strategies"
          description="Deployments run manually from the Deployments tab. Add a strategy to deploy on commits, tags or releases."
          action={
            <Button onClick={openAdd} size="sm" className="gap-2">
              <Plus className="h-3.5 w-3.5" /> Add strategy
            </Button>
          }
          className="py-12"
        />
      ) : (
        <div className="space-y-3">
          {triggers.map((t) => (
            <StrategyRow
              key={t.id}
              trigger={t}
              webhook={isGitHub ? webhook : null}
              showWebhook={isGitHub}
              lastEvent={lastEventByTrigger[t.id]}
              busy={busyId === t.id}
              onEdit={openEdit}
              onToggle={toggle}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {isGitHub ? (
        <WebhookPanel data={webhook} triggers={triggers} />
      ) : (
        <ProviderWebhookNotice provider={provider} triggers={triggers} />
      )}

      <TriggerHistory events={events} triggers={triggers} />

      <StrategyFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        project={project}
        trigger={editing}
        onSaved={(res) => {
          if (res) qc.setQueryData(["triggers", project.id], res);
          refresh();
        }}
      />
    </div>
  );
}
