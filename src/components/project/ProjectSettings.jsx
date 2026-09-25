import * as api from "@/lib/api";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import EnvVarEditor from "./EnvVarEditor";
import RuntimeControls from "./RuntimeControls";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, AlertTriangle, Loader2, Save } from "lucide-react";

export default function ProjectSettings({ project, envVars = [], environment, isProd = true, onVarAdd, onVarUpdate, onVarDelete }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [build, setBuild] = useState({ dockerfile_path: "", compose_path: "", build_context: "" });
  const [savingBuild, setSavingBuild] = useState(false);

  useEffect(() => {
    setBuild({
      dockerfile_path: project.dockerfile_path || "",
      compose_path: project.compose_path || "",
      build_context: project.build_context || "",
    });
  }, [project.id, project.dockerfile_path, project.compose_path, project.build_context]);

  const saveBuild = async () => {
    setSavingBuild(true);
    try {
      await api.projects.update(project.id, build);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Build settings saved", { description: "Applied on the next deployment." });
    } catch (e) {
      toast.error("Could not save build settings", { description: e?.message });
    } finally {
      setSavingBuild(false);
    }
  };

  const remove = async () => {
    await api.projects.delete(project.id);
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["deployments-recent"] });
    navigate("/projects");
  };

  return (
    <div className="space-y-8">
      <RuntimeControls project={project} />

      <div className="border-t border-border/60 pt-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground">Build settings</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            How this project is built. Changes apply to the next deployment.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Dockerfile path</Label>
              <Input
                value={build.dockerfile_path}
                onChange={(e) => setBuild((b) => ({ ...b, dockerfile_path: e.target.value }))}
                placeholder="Dockerfile"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Compose file path</Label>
              <Input
                value={build.compose_path}
                onChange={(e) => setBuild((b) => ({ ...b, compose_path: e.target.value }))}
                placeholder="docker-compose.yml"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Build context</Label>
              <Input
                value={build.build_context}
                onChange={(e) => setBuild((b) => ({ ...b, build_context: e.target.value }))}
                placeholder="empty = Dockerfile's folder"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={saveBuild} disabled={savingBuild} className="gap-1.5">
              {savingBuild ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save build settings
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 pt-6">
        <EnvVarEditor
          projectId={project.id}
          envVars={envVars}
          environment={environment}
          isProd={isProd}
          onAdd={onVarAdd}
          onUpdate={onVarUpdate}
          onDelete={onVarDelete}
        />
      </div>

      <div className="border-t border-border/60 pt-6">
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-foreground">Danger zone</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Deleting a project removes all deployments, environment variables and files. This cannot be undone.
              </p>
              <div className="mt-4">
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete project
                    </Button>
                  }
                  title={`Delete "${project.name}"?`}
                  description="This permanently removes the project and all associated data. This action cannot be undone."
                  confirmLabel="Delete project"
                  onConfirm={remove}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}