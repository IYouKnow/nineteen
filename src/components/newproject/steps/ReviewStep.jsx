import { Check, GitBranch, Cpu, MapPin, Layers, Rocket, Globe, Server } from "lucide-react";
import { DATABASES, SOURCES, TEMPLATES } from "@/lib/newProject";
import { INSTANCE_TYPES, REGIONS, getFramework } from "@/lib/devStatus";
import SourceIcon from "@/components/newproject/SourceIcon";
import TemplateIcon from "@/components/newproject/TemplateIcon";
import { cn } from "@/lib/utils";

function Row({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
        {icon}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="ml-auto text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function ReviewStep({ source, services, config, repository }) {
  const fw = getFramework(config.framework);
  const region = REGIONS.find((r) => r.id === config.region);
  const instance = INSTANCE_TYPES.find((t) => t.id === config.instance);
  const selectedSource = SOURCES.find((s) => s.id === source.type);
  const template = source.type === "template" ? TEMPLATES.find((t) => t.id === source.template) : null;

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">Review and create</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirm your setup before deploying.
        </p>
      </header>

      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Source</h3>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              {template ? (
                <>
                  <TemplateIcon template={template} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{template.label}</p>
                    <p className="text-xs text-muted-foreground">New project from template</p>
                  </div>
                </>
              ) : (
                <>
                  <SourceIcon icon={selectedSource?.icon} color={selectedSource?.color} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{selectedSource?.label}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{repository}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Infrastructure</h3>
          <div className="rounded-lg border border-border bg-card p-4">
            {services.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Server className="h-4 w-4" /> No additional services
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {DATABASES.filter((d) => services.includes(d.id)).map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                    {d.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Configuration</h3>
          <div className="rounded-lg border border-border bg-card px-4 py-1.5 divide-y divide-border">
            <Row icon={<Globe className="h-3.5 w-3.5" />} label="Project name" value={config.name || "—"} />
            <Row icon={<GitBranch className="h-3.5 w-3.5" />} label="Branch" value={<span className="font-mono">{config.branch}</span>} />
            <Row icon={<Layers className="h-3.5 w-3.5" />} label="Framework" value={fw.label} />
            <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Region" value={`${region?.flag} ${region?.label}`} />
            <Row icon={<Cpu className="h-3.5 w-3.5" />} label="Instance" value={`${instance?.label} · ${instance?.cpu}`} />
            <Row icon={<Check className="h-3.5 w-3.5" />} label="Auto-deploy" value={config.autoDeploy ? "Enabled" : "Disabled"} />
          </div>
        </section>

        <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
          <Rocket className="h-4 w-4 text-primary" />
          <span className="text-muted-foreground">
            Your project will be deployed to{" "}
            <span className="font-mono text-foreground">{(config.name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.fra1.nineteen.app</span>
          </span>
        </div>
      </div>
    </div>
  );
}