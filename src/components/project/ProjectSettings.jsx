import db from '@/lib/db';
import * as api from "@/lib/api";

import { useQueryClient } from "@tanstack/react-query";

import { useNavigate } from "react-router-dom";
import EnvVarEditor from "./EnvVarEditor";
import MountEditor from "./MountEditor";
import RuntimeControls from "./RuntimeControls";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle } from "lucide-react";

export default function ProjectSettings({ project, envVars = [], mounts = [], environment, isProd = true, onVarAdd, onVarUpdate, onVarDelete }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const remove = async () => {
    await api.projects.delete(project.id);
    if (envVars.length) {
      await db.entities.EnvironmentVariable.deleteMany({ project_id: project.id });
    }
    if (mounts.length) {
      await db.entities.Mount.deleteMany({ project_id: project.id });
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["deployments-recent"] });
    navigate("/projects");
  };

  return (
    <div className="space-y-8">
      <RuntimeControls project={project} />

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
        <MountEditor projectId={project.id} mounts={mounts} />
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
                Deleting a project removes all deployments, environment variables and mounts. This cannot be undone.
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