import * as api from "@/lib/api";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ArrowLeft, ArrowRight, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildRepository, sourceReady, TEMPLATES } from "@/lib/newProject";
import Stepper from "@/components/newproject/Stepper";
import SourceStep from "@/components/newproject/steps/SourceStep";
import InfrastructureStep from "@/components/newproject/steps/InfrastructureStep";
import ConfigurationStep from "@/components/newproject/steps/ConfigurationStep";
import ReviewStep from "@/components/newproject/steps/ReviewStep";

const STEPS = [
  { id: "source", label: "Source" },
  { id: "infra", label: "Infrastructure" },
  { id: "config", label: "Configuration" },
  { id: "review", label: "Review" },
];

const emptySource = {
  type: null,
  template: null,
  repo: null,
  publicUrl: "",
  gitlabHost: "https://gitlab.com",
  gitlabToken: "",
  gitlabProject: "",
  giteaHost: "",
  giteaToken: "",
  giteaProject: "",
};

export default function NewProject() {
  const navigate = useNavigate();
const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState(emptySource);
  const [services, setServices] = useState([]);
  const [config, setConfig] = useState({
    name: "",
    branch: "main",
    framework: "node",
    region: "fra1",
    instance: "nano",
    autoDeploy: true,
    buildStrategy: "detect",
  });
  const [creating, setCreating] = useState(false);

  // Prefill name & framework when a GitHub repo is selected.
  useEffect(() => {
    if (source.repo && !config.name) {
      setConfig((c) => ({
        ...c,
        name: source.repo.full_name.split("/")[1],
        framework: source.repo.framework,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.repo]);

  // Apply the selected template's runtime framework as the default.
  useEffect(() => {
    if (source.type === "template" && source.template) {
      const t = TEMPLATES.find((x) => x.id === source.template);
      if (t) setConfig((c) => ({ ...c, framework: t.framework }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.template]);

  const canContinue =
    step === 0 ? sourceReady(source) : step === 2 ? config.name.trim().length > 0 : true;

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const repository = buildRepository(source);
  const template = source.type === "template" ? TEMPLATES.find((t) => t.id === source.template) : null;
  const sourceLabel = template
    ? `Template · ${template.label}`
    : source.type === "github"
    ? source.repo?.full_name || "GitHub"
    : repository || "—";

  const handleCreate = async () => {
    if (!config.name.trim()) return;
    setCreating(true);
    try {
      const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const framework = source.type === "github" && source.repo ? source.repo.framework : config.framework;
      const project = await api.projects.create({
        name: config.name,
        slug,
        status: "building",
        framework,
        repository,
        branch: config.branch,
        domain: `${slug}.fra1.nineteen.app`,
        auto_deploy: config.autoDeploy,
        last_deployed_at: new Date().toISOString(),
        region: config.region,
        instance_type: config.instance,
        build_strategy: config.buildStrategy,
      });
      const deployment = await api.deployments.create(project.id, {
        commit_message: "Initial production deployment",
        branch: config.branch,
        author: "you",
        trigger: "manual",
      });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["deployments-recent"] });
      navigate(`/projects/${project.id}/deployments/${deployment.id}`);
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <button
        onClick={() => navigate("/projects")}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to projects
      </button>

      <h1 className="text-2xl font-semibold tracking-tight">New Project</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose the building blocks of your application, then deploy.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Stepper steps={STEPS} current={step} />
        </div>

        <div className="px-6 py-6">
          {step === 0 && <SourceStep source={source} setSource={setSource} />}
          {step === 1 && <InfrastructureStep services={services} setServices={setServices} />}
          {step === 2 && <ConfigurationStep config={config} setConfig={setConfig} sourceLabel={sourceLabel} />}
          {step === 3 && (
            <ReviewStep source={source} services={services} config={config} repository={repository} />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={step === 0}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground/60">
              Step {step + 1} of {STEPS.length}
            </span>
            {step < STEPS.length - 1 ? (
              <Button onClick={goNext} disabled={!canContinue} className="gap-2">
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={creating} className="gap-2">
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deploying…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Deploy Project
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}