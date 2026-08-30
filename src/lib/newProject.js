// Shared constants for the New Project wizard.

export const SOURCES = [
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
    id: "gitlab",
    label: "GitLab",
    icon: "gitlab",
    color: "#fc6d26",
    description: "Connect a GitLab.com or self-hosted GitLab instance.",
    disabled: true,
  },
  {
    id: "gitea",
    label: "Gitea",
    icon: "gitea",
    color: "#609966",
    description: "Lightweight, self-hosted Git service.",
    disabled: true,
  },
];

export const DATABASES = [
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

// Ready-made starter templates. `framework` maps to the runtime framework used
// by the existing build system; `generator` is an opaque id a backend can later
// resolve to a real project generator / repository creation mechanism.
export const TEMPLATES = [
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

export function sourceReady(source) {
  switch (source.type) {
    case "template":
      return !!source.template;
    case "github":
      return !!source.repo;
    case "public":
      return source.publicUrl.trim().length > 0;
    case "gitlab":
      return source.gitlabHost.trim().length > 0 && source.gitlabProject.trim().length > 0;
    case "gitea":
      return source.giteaHost.trim().length > 0 && source.giteaProject.trim().length > 0;
    default:
      return false;
  }
}

export function buildRepository(source) {
  if (source.type === "template") return "";
  if (source.type === "github") return source.repo?.full_name || "";
  if (source.type === "public") return source.publicUrl.trim();
  const host = (source.type === "gitlab" ? source.gitlabHost : source.giteaHost).trim().replace(/\/+$/, "");
  const project = (source.type === "gitlab" ? source.gitlabProject : source.giteaProject).trim().replace(/^\/+/, "");
  return `${host}/${project}`;
}