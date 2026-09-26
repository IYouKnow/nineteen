import { GitBranch, Layers, Rocket, Globe, Ship, HardDrive, Tag, Zap } from "lucide-react";
import { SOURCES, TEMPLATES } from "@/lib/newProject";
import { getFramework, projectAddress } from "@/lib/devStatus";
import { strategySummary } from "@/lib/strategies";
import SourceIcon from "@/components/newproject/SourceIcon";
import TemplateIcon from "@/components/newproject/TemplateIcon";

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

export default function ReviewStep({ source, config, repository, buildLabel, isImage }) {
  const fw = getFramework(config.framework);
  const selectedSource = SOURCES.find((s) => s.id === source.type);
  const template = source.type === "template" ? TEMPLATES.find((t) => t.id === source.template) : null;
  const st = config.strategy || {};
  const strategyLabel =
    !st.type || st.type === "manual"
      ? "Manual only"
      : strategySummary({ ...st, strategy: st.type });

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
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Configuration</h3>
          <div className="rounded-lg border border-border bg-card px-4 py-1.5 divide-y divide-border">
            <Row icon={<Globe className="h-3.5 w-3.5" />} label="Project name" value={config.name || "—"} />
            {isImage ? (
              <Row icon={<Ship className="h-3.5 w-3.5" />} label="Image" value={<span className="font-mono text-xs">{repository}</span>} />
            ) : config.deployType === "release" && config.deployRef ? (
              <Row icon={<Tag className="h-3.5 w-3.5" />} label="Release" value={<span className="font-mono">{config.deployRef}</span>} />
            ) : (
              <Row icon={<GitBranch className="h-3.5 w-3.5" />} label="Branch" value={<span className="font-mono">{config.branch}</span>} />
            )}
            <Row icon={<Ship className="h-3.5 w-3.5" />} label="Build" value={<span className="font-mono text-xs">{buildLabel || "Dockerfile · auto-detected"}</span>} />
            <Row icon={<Layers className="h-3.5 w-3.5" />} label="Framework" value={fw.label} />
            <Row icon={<Zap className="h-3.5 w-3.5" />} label="Deploy strategy" value={strategyLabel} />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Storage</h3>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">Persistent storage</p>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  /data → /app/data
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Every project gets a folder that survives redeploys — ideal for a SQLite database or
                uploads.
              </p>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
          <Rocket className="h-4 w-4 text-primary" />
          <span className="text-muted-foreground">
            Your project will be deployed to{" "}
            <span className="font-mono text-foreground">{projectAddress(config)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}