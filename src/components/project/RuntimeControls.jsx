import * as api from "@/lib/api";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { FolderTree, Plug2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const POLICIES = [
  { value: "unless-stopped", label: "Unless stopped", hint: "Restart automatically after a reboot unless you stopped it yourself." },
  { value: "always", label: "Always", hint: "Always restart, even after a manual stop or a reboot." },
  { value: "on-failure", label: "On failure", hint: "Restart only when the container exits with an error." },
  { value: "no", label: "Never", hint: "Never restart automatically — start it manually." },
];

export default function RuntimeControls({ project }) {
  const qc = useQueryClient();

  const [policy, setPolicy] = useState(project.restart_policy || "unless-stopped");
  const [retries, setRetries] = useState(project.restart_retries ?? "");
  const [workDir, setWorkDir] = useState(project.working_dir || "");

  useEffect(() => {
    setPolicy(project.restart_policy || "unless-stopped");
    setRetries(project.restart_retries ?? "");
    setWorkDir(project.working_dir || "");
  }, [project.id, project.restart_policy, project.restart_retries, project.working_dir]);

  const updateConfig = async (field, value) => {
    await api.projects.update(project.id, { [field]: value });
    qc.invalidateQueries({ queryKey: ["project", project.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const changePolicy = async (value) => {
    setPolicy(value);
    if (value !== "on-failure") setRetries("");
    await updateConfig("restart_policy", value);
  };

  const saveRetries = (raw) => {
    const v = String(raw).replace(/[^0-9]/g, "");
    setRetries(v);
    updateConfig("restart_retries", v ? Number(v) : null);
  };

  const saveWorkDir = (raw) => {
    const v = raw.trim();
    setWorkDir(v);
    updateConfig("working_dir", v);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Runtime</h3>
        <p className="text-xs text-muted-foreground">Configure the public port, working directory and how the container restarts.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Plug2 className="h-3.5 w-3.5" />
            Public port
          </label>
          <Input
            defaultValue={project.port || ""}
            inputMode="numeric"
            onBlur={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              e.target.value = v;
              updateConfig("port", v ? Number(v) : null);
            }}
            placeholder="auto (random)"
            className="mt-2 h-9 rounded-md font-mono text-sm"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Set a fixed port to match an app that expects one (e.g. 38427).
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            Restart policy
          </label>
          <Select value={policy} onValueChange={changePolicy}>
            <SelectTrigger className="mt-2 h-9 gap-2 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POLICIES.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-sm">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {policy === "on-failure" && (
            <Input
              value={retries}
              inputMode="numeric"
              onChange={(e) => setRetries(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={(e) => saveRetries(e.target.value)}
              placeholder="max retries (optional)"
              className="mt-2 h-9 rounded-md font-mono text-sm"
            />
          )}
          <ul className="mt-3 space-y-1.5">
            {POLICIES.map((p) => (
              <li key={p.value} className="flex gap-2 text-[11px] leading-snug">
                <span className={cn("w-24 shrink-0 font-medium", p.value === policy ? "text-foreground" : "text-muted-foreground")}>
                  {p.label}
                </span>
                <span className="text-muted-foreground">{p.hint}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FolderTree className="h-3.5 w-3.5" />
            Working directory
          </label>
          <Input
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            onBlur={(e) => saveWorkDir(e.target.value)}
            placeholder="empty = image default"
            className="mt-2 h-9 rounded-md font-mono text-sm"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Directory the container starts in (<span className="font-mono">docker run -w</span>). Set an absolute path such as{" "}
            <span className="font-mono">/workspace</span> so apps like code-server open it. Applied on Apply or the next deployment.
          </p>
        </div>
      </div>
    </div>
  );
}
