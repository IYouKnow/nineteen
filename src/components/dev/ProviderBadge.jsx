import { cn } from "@/lib/utils";

const PROVIDERS = {
  github: { label: "GitHub", color: "#24292f" },
  gitea: { label: "Gitea", color: "#609966" },
  gitlab: { label: "GitLab", color: "#fc6d26" },
};

function Glyph({ icon }) {
  if (icon === "github") {
    return (
      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="currentColor" aria-hidden>
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
    );
  }
  if (icon === "gitea") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" fill="currentColor" stroke="none" />
        <path d="M17 10h2.2a2.2 2.2 0 0 1 0 4.4H17" />
        <path d="M8 3.6c.7.7.7 1.4 0 2.1M11.5 3.6c.7.7.7 1.4 0 2.1" />
      </svg>
    );
  }
  if (icon === "gitlab") {
    return (
      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="currentColor" aria-hidden>
        <path d="m23.6 9.59-.03-.08-3.27-8.54a.86.86 0 0 0-1.6 0l-2.2 5.74H7.5L5.3.97a.86.86 0 0 0-1.6 0L.43 9.5l-.03.08a6.1 6.1 0 0 0 2.2 7.06l.01.01.03.02 7.07 5.29 3.5 2.64 2.12-1.6 5.57-4.33.01-.01.03-.02a6.1 6.1 0 0 0 2.2-7.05Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M8.5 6h5a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ProviderBadge labels the source control a project's repository comes from
// (GitHub, Gitea, GitLab, or a generic Git source).
export default function ProviderBadge({ provider, className }) {
  const key = (provider || "").toLowerCase();
  const cfg = PROVIDERS[key] || { label: "Git", color: "#64748b" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        className
      )}
      style={{ color: cfg.color, borderColor: `${cfg.color}33`, backgroundColor: `${cfg.color}12` }}
      title={cfg.label}
    >
      <Glyph icon={key} />
      {cfg.label}
    </span>
  );
}
