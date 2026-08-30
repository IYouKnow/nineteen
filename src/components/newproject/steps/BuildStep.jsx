import { useMemo, useState } from "react";
import { AlertTriangle, Check, Container, FileSearch, Layers, Loader2, Search, Ship } from "lucide-react";
import { FRAMEWORKS } from "@/lib/devStatus";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const selectCls =
  "mt-1.5 h-9 w-full rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

const MODES = [
  {
    id: "dockerfile",
    label: "Dockerfile",
    icon: Ship,
    desc: "Build a single image from a Dockerfile in the repository and run it.",
  },
  {
    id: "compose",
    label: "Docker Compose",
    icon: Container,
    desc: "Start the full stack defined in a Docker Compose file (app + services).",
  },
];

function FileBrowser({ files, selected, onPick, truncated }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
    return list.slice(0, 400);
  }, [files, query]);

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/15 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter files…"
          className="h-8 pl-9 font-mono text-xs"
        />
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No matching files.</p>
        ) : (
          filtered.map((f) => {
            const active = selected === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onPick(f)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
                  active
                    ? "bg-primary/10 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                )}
              >
                <span className="truncate">{f}</span>
                {active && <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />}
              </button>
            );
          })
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/70">
        {truncated
          ? "Very large repository — the list may be truncated, but detected build files above are complete."
          : `${files.length} file${files.length === 1 ? "" : "s"} in the repository`}
      </p>
    </div>
  );
}

export default function BuildStep({ config, setConfig, scan, scanLoading, scanError, scanTarget }) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const update = (patch) => setConfig((c) => ({ ...c, ...patch }));

  const dockerfiles = scan?.dockerfiles || [];
  const composeFiles = scan?.compose_files || [];
  const files = scan?.files || [];
  const truncated = !!scan?.truncated;

  const mode = config.dockerMode || "dockerfile";
  const candidates = mode === "compose" ? composeFiles : dockerfiles;
  const selected = mode === "compose" ? config.composePath : config.dockerfilePath;
  const pick = (p) => (mode === "compose" ? update({ composePath: p }) : update({ dockerfilePath: p }));

  const nothingFound = !scanLoading && !scanError && dockerfiles.length === 0 && composeFiles.length === 0;

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">How should it be built?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We scanned <span className="font-mono text-xs text-foreground">{scanTarget?.repo || "the repository"}</span>
          {scanTarget?.branch ? (
            <>
              {" "}on <span className="font-mono text-xs text-foreground">{scanTarget.branch}</span>
            </>
          ) : null}
          . Pick the build method and file.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => {
          const active = mode === m.id;
          const count = m.id === "compose" ? composeFiles.length : dockerfiles.length;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => update({ dockerMode: m.id })}
              className={cn(
                "rounded-lg border p-3 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <m.icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                  <p className="text-sm font-medium text-foreground">{m.label}</p>
                </div>
                {scan && !scanLoading && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      count > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {count} found
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {scanLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning repository files…
          </div>
        ) : scanError ? (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Couldn&apos;t scan this repository</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  It may be private and no GitHub account is connected. You can enter the build file
                  path manually below, or leave it empty and the server will search the repository
                  when deploying.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Dockerfile path</Label>
                    <Input
                      value={config.dockerfilePath}
                      onChange={(e) => update({ dockerfilePath: e.target.value, dockerMode: "dockerfile" })}
                      placeholder="e.g. docker/Dockerfile (empty = auto)"
                      className="mt-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Compose file path</Label>
                    <Input
                      value={config.composePath}
                      onChange={(e) => update({ composePath: e.target.value, dockerMode: "compose" })}
                      placeholder="e.g. stack/compose.yml (empty = auto)"
                      className="mt-1.5 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {candidates.length > 0 ? (
              <div>
                <Label className="text-xs">
                  {mode === "compose" ? "Compose file" : "Dockerfile"}
                </Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Select value={selected} onValueChange={pick}>
                    <SelectTrigger className="h-9 flex-1 gap-2 bg-card font-mono text-xs">
                      <SelectValue placeholder="Select a file" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {candidates.map((f) => (
                        <SelectItem key={f} value={f} className="font-mono text-xs">
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-2 whitespace-nowrap"
                    onClick={() => setBrowserOpen((v) => !v)}
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    {browserOpen ? "Hide all files" : "All files"}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Best matches first. The repository root is used as build context.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      No {mode === "compose" ? "Docker Compose file" : "Dockerfile"} detected
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {mode === "compose"
                        ? "Looked for docker-compose.yml, docker-compose.yaml, compose.yml and compose.yaml."
                        : "Looked for Dockerfile and *.Dockerfile variants in every folder."}{" "}
                      You can pick any file below, add one to the repository, or continue — the deploy
                      will fail with a clear message if nothing usable exists.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {(browserOpen || candidates.length === 0) && files.length > 0 && (
              <FileBrowser files={files} selected={selected} onPick={pick} truncated={truncated} />
            )}

            {nothingFound && (
              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This repository has no Dockerfile and no Docker Compose file. The deployment will
                  fail unless one is added — see{" "}
                  <a
                    href="https://docs.docker.com/get-started/docker-concepts/building-images/build-with-dockerfile/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline underline-offset-2"
                  >
                    writing a Dockerfile
                  </a>
                  .
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-5">
        <Label className="text-xs flex items-center gap-1">
          <Layers className="h-3 w-3" /> Runtime framework
        </Label>
        <select
          value={config.framework}
          onChange={(e) => update({ framework: e.target.value })}
          className={cn(selectCls)}
        >
          {Object.entries(FRAMEWORKS).map(([id, f]) => (
            <option key={id} value={id}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Used for the project icon and metadata — the actual build is always Docker.
        </p>
      </div>
    </div>
  );
}
