// Shared constants and helpers for the New Project wizard.

export type SourceId = "dockerhub" | "github" | "public" | "gitea" | "gitlab" | "template";

export interface SourceOption {
  id: SourceId;
  label: string;
  icon: string;
  color: string;
  description: string;
  disabled?: boolean;
}

export const SOURCES: SourceOption[] = [
  {
    id: "dockerhub",
    label: "Docker Hub",
    icon: "docker",
    color: "#2496ed",
    description: "Browse the app store and run a prebuilt image — no code required.",
  },
  {
    id: "github",
    label: "GitHub Personal",
    icon: "github",
    color: "#24292f",
    description: "Connect your GitHub account and select from your repositories.",
  },
  {
    id: "public",
    label: "Public Git Repository",
    icon: "public",
    color: "#334155",
    description: "Deploy from any public Git URL — no account connection required.",
  },
  {
    id: "gitea",
    label: "Gitea",
    icon: "gitea",
    color: "#609966",
    description: "Connect a self-hosted Gitea instance and select from its repositories.",
  },
];

export interface DatabaseOption {
  id: string;
  label: string;
  color: string;
  description: string;
  embedded?: boolean;
}

export const DATABASES: DatabaseOption[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    color: "#4169e1",
    description: "Powerful relational database with JSON & extension support.",
  },
  {
    id: "mysql",
    label: "MySQL",
    color: "#00758f",
    description: "Popular open-source relational database.",
  },
  {
    id: "mariadb",
    label: "MariaDB",
    color: "#003545",
    description: "Community-driven MySQL fork, drop-in compatible.",
  },
  {
    id: "redis",
    label: "Redis",
    color: "#dc382d",
    description: "In-memory data store for caching and queues.",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    color: "#47a248",
    description: "Document database for flexible schemas.",
  },
  {
    id: "sqlite",
    label: "SQLite",
    color: "#00657e",
    description: "Embedded file-based database — bundled with your app, no server to provision.",
    embedded: true,
  },
];

export interface Template {
  id: string;
  label: string;
  code: string;
  framework: string;
  color: string;
  description: string;
  generator: string;
}

// Ready-made starter templates. `framework` maps to the runtime framework used
// by the existing build system; `generator` is an opaque id a backend can later
// resolve to a real project generator / repository creation mechanism.
export const TEMPLATES: Template[] = [
  { id: "nextjs", label: "Next.js", code: "N", framework: "nextjs", color: "#f8f9fa", description: "Full-stack React framework with SSR, routing & API routes.", generator: "template:nextjs" },
  { id: "vite-react", label: "Vite + React", code: "V", framework: "vite", color: "#646cff", description: "Fast SPA starter with Vite, React and hot module reload.", generator: "template:vite-react" },
  { id: "react", label: "React", code: "Re", framework: "vite", color: "#61dafb", description: "Classic single-page React app, built and served statically.", generator: "template:react" },
  { id: "vue", label: "Vue", code: "Vu", framework: "vite", color: "#42b883", description: "Progressive Vue 3 starter with the Composition API.", generator: "template:vue" },
  { id: "nuxt", label: "Nuxt", code: "Nu", framework: "node", color: "#00dc82", description: "Intuitive Vue framework with SSR and file-based routing.", generator: "template:nuxt" },
  { id: "node", label: "Node.js", code: "No", framework: "node", color: "#5fa04e", description: "Minimal Express / Fastify API server template.", generator: "template:node" },
  { id: "python", label: "Python", code: "Py", framework: "python", color: "#ffd54f", description: "Flask or FastAPI-style Python service starter.", generator: "template:python" },
  { id: "go", label: "Go", code: "Go", framework: "docker", color: "#00add8", description: "Compiled Go HTTP service with a containerized runtime.", generator: "template:go" },
  { id: "docker", label: "Docker", code: "D", framework: "docker", color: "#2496ed", description: "Bring-your-own Dockerfile — we build and run the image.", generator: "template:docker" },
];

// Repo is the subset of a provider repository the wizard reads.
export interface Repo {
  full_name: string;
  branch?: string;
  framework?: string;
  description?: string;
  stars?: number;
  private?: boolean;
}

// ImageEnvVar is one environment variable supplied with a prebuilt image.
export interface ImageEnvVar {
  key: string;
  label?: string;
  value: string;
  secret?: boolean;
  required?: boolean;
}

// ImageMeta carries display metadata for a chosen Docker Hub image.
export interface ImageMeta {
  name?: string;
  description?: string;
  port?: number;
}

// Source is the wizard's source-selection state.
export interface Source {
  type: SourceId | null;
  template: string | null;
  repo: Repo | null;
  integrationId: number | null;
  publicUrl: string;
  gitlabHost: string;
  gitlabToken: string;
  gitlabProject: string;
  image: string | null;
  imageTag: string;
  imageMeta: ImageMeta | null;
  env: ImageEnvVar[];
}

// Detect the runtime framework from a scanned repository file list. Uses only
// file paths (the scan returns names, not contents). Returns a FRAMEWORKS id or
// null when nothing confident is found.
export function detectFrameworkFromFiles(files: string[] | null | undefined): string | null {
  if (!files || files.length === 0) return null;
  const lower = files.map((f) => f.toLowerCase());
  const hasBase = (base: string) => lower.some((f) => f === base || f.endsWith("/" + base));
  const any = (re: RegExp) => lower.some((f) => re.test(f));

  // Go services are containerized by convention.
  if (hasBase("go.mod")) return "docker";

  // Python services.
  if (
    any(
      /(^|\/)(requirements\.txt|pyproject\.toml|pipfile(\..*)?|setup\.py|setup\.cfg|poetry\.lock)$/i
    )
  )
    return "python";

  // JS/TS ecosystem — Narrow frameworks by their config files first.
  if (hasBase("package.json")) {
    if (any(/(^|\/)next\.config\./i)) return "nextjs";
    if (any(/(^|\/)astro\.config\./i)) return "astro";
    if (any(/(^|\/)remix\.config\./i)) return "remix";
    if (any(/(^|\/)vite\.config\./i)) return "vite";
    return "node";
  }

  // Static sites with no build tooling.
  if (hasBase("index.html")) return "static";

  // Dockerfile / Compose-only repos.
  if (
    any(/dockerfile($|\.)/i) ||
    any(/(^|\/)(docker-compose\.ya?ml|compose\.ya?ml)$/i)
  )
    return "docker";

  return null;
}

// sourceChosen reports whether the user has picked a source in the first wizard
// step (enough to advance to the detail step). Templates are chosen inline, so
// they only count once a template is selected.
export function sourceChosen(source: Pick<Source, "type" | "template">): boolean {
  if (!source.type) return false;
  if (source.type === "template") return !!source.template;
  return true;
}

export function sourceReady(source: Source): boolean {
  switch (source.type) {
    case "template":
      return !!source.template;
    case "dockerhub":
      return !!source.image;
    case "github":
    case "gitea":
      return !!source.repo;
    case "public":
      return source.publicUrl.trim().length > 0;
    case "gitlab":
      return source.gitlabHost.trim().length > 0 && source.gitlabProject.trim().length > 0;
    default:
      return false;
  }
}

export function buildRepository(source: Source): string {
  if (source.type === "template") return "";
  if (source.type === "dockerhub") return imageRef(source);
  if (source.type === "github" || source.type === "gitea") return source.repo?.full_name || "";
  if (source.type === "public") return source.publicUrl.trim();
  const host = source.gitlabHost.trim().replace(/\/+$/, "");
  const project = source.gitlabProject.trim().replace(/^\/+/, "");
  return `${host}/${project}`;
}

// isImageSource reports whether a source runs a prebuilt image (no repo/build).
export function isImageSource(source: Source | null | undefined): boolean {
  return source?.type === "dockerhub";
}

// imageRef composes the full image reference from the selected repository and
// tag, e.g. "nginx:1.27".
export function imageRef(source: Source): string {
  if (!source.image) return "";
  return source.imageTag ? `${source.image}:${source.imageTag}` : source.image;
}
