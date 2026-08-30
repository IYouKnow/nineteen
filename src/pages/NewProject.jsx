import * as api from "@/lib/api";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ArrowLeft, ArrowRight, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildRepository, sourceReady, TEMPLATES } from "@/lib/newProject";
import Stepper from "@/components/newproject/Stepper";
import SourceStep from "@/components/newproject/steps/SourceStep";
import BuildStep from "@/components/newproject/steps/BuildStep";
import InfrastructureStep from "@/components/newproject/steps/InfrastructureStep";
import ConfigurationStep from "@/components/newproject/steps/ConfigurationStep";
import ReviewStep from "@/components/newproject/steps/ReviewStep";

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
  const [stepId, setStepId] = useState("source");
  const [source, setSource] = useState(emptySource);
  const [services, setServices] = useState([]);
  const [config, setConfig] = useState({
    name: "",
    branch: "main",
    framework: "node",
    region: "fra1",
    instance: "nano",
    autoDeploy: true,
    dockerMode: "dockerfile",
    dockerfilePath: "",
    composePath: "",
  });
  const [creating, setCreating] = useState(false);
  const prefilledRef = useRef(false);

  // Repositories we can scan for build files (GitHub source, or a public
  // github.com URL).
  const scanTarget = useMemo(() => {
    if (source.type === "github" && source.repo?.full_name) {
      return { repo: source.repo.full_name, branch: source.repo.branch || "main" };
    }
    if (source.type === "public" && source.publicUrl) {
      const m = source.publicUrl
        .trim()
        .match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
      if (m) return { repo: `${m[1]}/${m[2]}`, branch: "" };
    }
    return null;
  }, [source]);

  const { data: scan, isLoading: scanLoading, isError: scanError } = useQuery({
    queryKey: ["repo-scan", scanTarget?.repo, scanTarget?.branch],
    queryFn: () => api.integrations.scanRepo(scanTarget.repo, scanTarget.branch),
    enabled: !!scanTarget,
    staleTime: 60000,
    retry: false,
  });

  const scannable = !!scanTarget;
  const scanRepo = scanTarget?.repo || "";

  const STEPS = useMemo(() => {
    const steps = [{ id: "source", label: "Source" }];
    if (scannable) steps.push({ id: "build", label: "Build" });
    steps.push(
      { id: "infra", label: "Infrastructure" },
      { id: "config", label: "Configuration" },
      { id: "review", label: "Review" }
    );
    return steps;
  }, [scannable]);

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.id === stepId));
  const activeStep = STEPS[stepIndex].id;

  // Reset build selections when the target repository changes.
  useEffect(() => {
    setConfig((c) => ({ ...c, dockerMode: "dockerfile", dockerfilePath: "", composePath: "" }));
    prefilledRef.current = false;
  }, [scanRepo]);

  // Preselect the best build file once a scan lands.
  useEffect(() => {
    if (!scan || prefilledRef.current) return;
    prefilledRef.current = true;
    if (scan.dockerfiles?.length > 0) {
      setConfig((c) =>
        c.dockerfilePath ? c : { ...c, dockerMode: "dockerfile", dockerfilePath: scan.dockerfiles[0] }
      );
    } else if (scan.compose_files?.length > 0) {
      setConfig((c) =>
        c.composePath ? c : { ...c, dockerMode: "compose", composePath: scan.compose_files[0] }
      );
    }
  }, [scan]);

  // Prefill name & framework when a GitHub repo is selected.
  useEffect(() => {
    if (source.repo && !config.name) {
      setConfig((c) => ({
        ...c,
        name: source.repo.full_name.split("/")[1],
        framework: source.repo.framework,
        branch: source.repo.branch || "main",
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

  const buildReady = () => {
    if (scanError || !scan) return true; // manual entry / auto fallback
    const list = config.dockerMode === "compose" ? scan.compose_files : scan.dockerfiles;
    if (!list || list.length === 0) return true; // nothing to select — warned
    return !!(config.dockerMode === "compose" ? config.composePath : config.dockerfilePath);
  };

  const canContinue =
    activeStep === "source"
      ? sourceReady(source)
      : activeStep === "build"
      ? buildReady()
      : activeStep === "config"
      ? config.name.trim().length > 0
      : true;

  const goNext = () => setStepId(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id);
  const goBack = () => setStepId(STEPS[Math.max(stepIndex - 1, 0)].id);

  const repository = buildRepository(source);
  const template = source.type === "template" ? TEMPLATES.find((t) => t.id === source.template) : null;
  const sourceLabel = template
    ? `Template · ${template.label}`
    : source.type === "github"
    ? source.repo?.full_name || "GitHub"
    : repository || "—";

  const buildLabel = !scannable
    ? "Dockerfile · auto-detected at deploy time"
    : config.dockerMode === "compose"
    ? `Docker Compose${config.composePath ? ` · ${config.composePath}` : ""}`
    : `Dockerfile${config.dockerfilePath ? ` · ${config.dockerfilePath}` : " · auto-detected"}`;

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
        build_strategy: scannable ? config.dockerMode : "detect",
        dockerfile_path: scannable && config.dockerMode === "dockerfile" ? config.dockerfilePath : "",
        compose_path: scannable && config.dockerMode === "compose" ? config.composePath : "",
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
          <Stepper steps={STEPS} current={stepIndex} />
        </div>

        <div className="px-6 py-6">
          {activeStep === "source" && <SourceStep source={source} setSource={setSource} />}
          {activeStep === "build" && (
            <BuildStep
              config={config}
              setConfig={setConfig}
              scan={scan}
              scanLoading={scanLoading}
              scanError={scanError}
              scanTarget={scanTarget}
            />
          )}
          {activeStep === "infra" && <InfrastructureStep services={services} setServices={setServices} />}
          {activeStep === "config" && (
            <ConfigurationStep
              config={config}
              setConfig={setConfig}
              sourceLabel={sourceLabel}
              buildLabel={buildLabel}
            />
          )}
          {activeStep === "review" && (
            <ReviewStep
              source={source}
              services={services}
              config={config}
              repository={repository}
              buildLabel={buildLabel}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={stepIndex === 0}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground/60">
              Step {stepIndex + 1} of {STEPS.length}
            </span>
            {stepIndex < STEPS.length - 1 ? (
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