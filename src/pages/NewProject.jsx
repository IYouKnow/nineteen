import * as api from "@/lib/api";
import { resolveProjectPort } from "@/lib/devStatus";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ArrowLeft, ArrowRight, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildRepository, sourceReady, TEMPLATES } from "@/lib/newProject";
import Stepper from "@/components/newproject/Stepper";
import SourceStep from "@/components/newproject/steps/SourceStep";
import VersionStep from "@/components/newproject/steps/VersionStep";
import BuildStep from "@/components/newproject/steps/BuildStep";
import InfrastructureStep from "@/components/newproject/steps/InfrastructureStep";
import StrategyStep from "@/components/newproject/steps/StrategyStep";
import ConfigurationStep from "@/components/newproject/steps/ConfigurationStep";
import ReviewStep from "@/components/newproject/steps/ReviewStep";

const emptySource = {
  type: null,
  template: null,
  repo: null,
  integrationId: null,
  publicUrl: "",
  gitlabHost: "https://gitlab.com",
  gitlabToken: "",
  gitlabProject: "",
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
    port: "",
    dockerMode: "dockerfile",
    dockerfilePath: "",
    composePath: "",
    buildContext: "",
    deployType: "branch",
    deployRef: "",
    strategy: {
      type: "manual",
      branch: "",
      tag_mode: "pattern",
      tag_pattern: "v*",
      pre_release: false,
    },
  });
  const [creating, setCreating] = useState(false);
  const prefilledRef = useRef(false);
  const autoNameRef = useRef("");

  // Repositories we can scan for build files (GitHub/Gitea source, or a public
  // github.com URL).
  const repoSource = useMemo(() => {
    if ((source.type === "github" || source.type === "gitea") && source.repo?.full_name) {
      return {
        repo: source.repo.full_name,
        branch: source.repo.branch || "main",
        provider: source.type,
        integrationId: source.integrationId,
      };
    }
    if (source.type === "public" && source.publicUrl) {
      const m = source.publicUrl
        .trim()
        .match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
      if (m) return { repo: `${m[1]}/${m[2]}`, branch: "", provider: "github", integrationId: null };
    }
    return null;
  }, [source]);

  // Deployable versions of the selected repository (releases and git tags).
  // Used to offer deploying a tagged version instead of building the branch.
  const { data: versions = [], isLoading: versionsLoading, isError: versionsError } = useQuery({
    queryKey: ["repo-versions", repoSource?.repo, repoSource?.provider, repoSource?.integrationId],
    queryFn: () =>
      api.integrations.versions(repoSource.repo, repoSource.provider, repoSource.integrationId),
    enabled: !!repoSource,
    staleTime: 60000,
    retry: false,
  });

  // The ref the build-file scan runs against: the release tag when deploying a
  // release, otherwise the repository branch.
  const effectiveBranch =
    config.deployType === "release" && config.deployRef ? config.deployRef : repoSource?.branch || "";

  const scanTarget = useMemo(
    () => (repoSource ? { ...repoSource, branch: effectiveBranch } : null),
    [repoSource, effectiveBranch]
  );

  const { data: scan, isLoading: scanLoading, isError: scanError } = useQuery({
    queryKey: ["repo-scan", scanTarget?.repo, scanTarget?.branch, scanTarget?.provider, scanTarget?.integrationId],
    queryFn: () =>
      api.integrations.scanRepo(
        scanTarget.repo,
        scanTarget.branch,
        scanTarget.provider,
        scanTarget.integrationId
      ),
    enabled: !!scanTarget,
    staleTime: 60000,
    retry: false,
  });

  const scannable = !!scanTarget;
  const scanRepo = scanTarget?.repo || "";
  const repository = buildRepository(source);
  const hasRepo = source.type !== "template" && !!repository;
  const isRelease = config.deployType === "release" && !!config.deployRef;

  const STEPS = useMemo(() => {
    const steps = [{ id: "source", label: "Source" }];
    if (scannable) steps.push({ id: "version", label: "Version" });
    if (scannable) steps.push({ id: "build", label: "Build" });
    steps.push({ id: "infra", label: "Infrastructure" });
    if (hasRepo) steps.push({ id: "strategy", label: "Strategy" });
    steps.push(
      { id: "config", label: "Configuration" },
      { id: "review", label: "Review" }
    );
    return steps;
  }, [scannable, hasRepo]);

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.id === stepId));
  const activeStep = STEPS[stepIndex].id;

  // Reset build selections when the target repository or ref changes.
  useEffect(() => {
    setConfig((c) => ({ ...c, dockerMode: "dockerfile", dockerfilePath: "", composePath: "", port: "" }));
    prefilledRef.current = false;
  }, [scanRepo, effectiveBranch]);

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
    // Pre-fill a fixed port detected from the Dockerfile's EXPOSE directive,
    // but never clobber a port the user has already chosen.
    if (scan.port > 0) {
      setConfig((c) => (c.port ? c : { ...c, port: String(scan.port) }));
    }
  }, [scan]);

  // Prefill name & framework when a GitHub repo is selected. When the user
  // switches repos we keep the name in sync (test -> hello), but never clobber
  // a name the user has typed themselves.
  useEffect(() => {
    if (!source.repo) return;
    const repoName = source.repo.full_name.split("/")[1];
    const shouldSetName = !config.name || config.name === autoNameRef.current;
    if (shouldSetName) autoNameRef.current = repoName;
    setConfig((c) => ({
      ...c,
      name: shouldSetName ? repoName : c.name,
      framework: source.repo.framework,
      branch: source.repo.branch || "main",
    }));
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
      : activeStep === "version"
      ? config.deployType !== "release" || !!config.deployRef
      : activeStep === "build"
      ? buildReady()
      : activeStep === "config"
      ? config.name.trim().length > 0
      : true;

  const goNext = () => setStepId(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id);
  const goBack = () => setStepId(STEPS[Math.max(stepIndex - 1, 0)].id);

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
    : `Dockerfile${config.dockerfilePath ? ` · ${config.dockerfilePath}` : " · auto-detected"}${
        config.buildContext ? ` (context: ${config.buildContext})` : ""
      }`;

  const handleCreate = async () => {
    if (!config.name.trim()) return;
    setCreating(true);
    try {
      const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const repoProvider = source.type === "github" || source.type === "gitea";
      const framework = repoProvider && source.repo ? source.repo.framework : config.framework;
      const strategyType = config.strategy?.type || "manual";
      const wantsStrategy = strategyType !== "manual";
      const project = await api.projects.create({
        name: config.name,
        slug,
        status: "building",
        framework,
        repository,
        branch: config.branch,
        provider:
          source.type === "gitea"
            ? "gitea"
            : source.type === "github"
            ? "github"
            : source.type === "gitlab"
            ? "gitlab"
            : "git",
        integration_id: source.integrationId ?? null,
        domain: `${slug}.fra1.nineteen.app`,
        auto_deploy: false,
        last_deployed_at: new Date().toISOString(),
        port: resolveProjectPort(config),
        build_strategy: scannable ? config.dockerMode : "detect",
        dockerfile_path: scannable && config.dockerMode === "dockerfile" ? config.dockerfilePath : "",
        compose_path: scannable && config.dockerMode === "compose" ? config.composePath : "",
        build_context: scannable && config.dockerMode === "dockerfile" ? config.buildContext : "",
        deploy_type: isRelease ? "release" : "branch",
        deploy_ref: isRelease ? config.deployRef : "",
      });
      // Create the chosen automatic deployment strategy. Non-fatal: a failed
      // webhook registration must not block the initial deployment.
      if (wantsStrategy) {
        try {
          await api.projects.triggers.create(project.id, {
            strategy: strategyType,
            branch: config.strategy?.branch || config.branch,
            tag_mode: config.strategy?.tag_mode || "pattern",
            tag_pattern: config.strategy?.tag_pattern || "v*",
            pre_release: !!config.strategy?.pre_release,
            enabled: true,
          });
        } catch (e) {
          console.error("Failed to create deployment strategy", e);
        }
      }
      const deployment = await api.deployments.create(project.id, {
        commit_message: isRelease ? `Release ${config.deployRef}` : "Initial production deployment",
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
          {activeStep === "version" && (
            <VersionStep
              config={config}
              setConfig={setConfig}
              versions={versions}
              loading={versionsLoading}
              error={versionsError}
              repoLabel={scanRepo}
              branch={repoSource?.branch}
            />
          )}
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
          {activeStep === "infra" && (
            <InfrastructureStep services={services} setServices={setServices} />
          )}
          {activeStep === "strategy" && (
            <StrategyStep config={config} setConfig={setConfig} branch={config.branch} />
          )}
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