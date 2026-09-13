import { Zap, GitBranch, Tag, Rocket } from "lucide-react";

export const STRATEGY_TYPES = [
  {
    id: "commit",
    icon: Zap,
    title: "Every Commit",
    description: "Deploy automatically for every commit pushed to a branch.",
  },
  {
    id: "branch",
    icon: GitBranch,
    title: "Branch",
    description: "Deploy whenever a commit lands on the watched branch.",
  },
  {
    id: "tag",
    icon: Tag,
    title: "Tag",
    description: "Deploy when a matching Git tag is created. Ideal for versioned releases.",
  },
  {
    id: "release",
    icon: Rocket,
    title: "Release",
    description: "Deploy when a GitHub release is published. Tied to your release workflow.",
  },
];

export const BRANCHES = ["main", "develop", "staging", "release"];

export function strategyMeta(id) {
  return STRATEGY_TYPES.find((s) => s.id === id) || STRATEGY_TYPES[0];
}

export function strategySummary(t) {
  const branch = t.branch || "main";
  switch (t.strategy) {
    case "commit":
      return `Every commit on ${branch}`;
    case "branch":
      return `Commits on ${branch}`;
    case "tag":
      return t.tag_mode === "any" ? "Any tag" : `Tags matching ${t.tag_pattern || "v*"}`;
    case "release":
      return t.pre_release ? "Releases, including pre-releases" : "Published releases";
    default:
      return "";
  }
}

export function buildExamples(strategy, branch, tagMode, preRelease) {
  switch (strategy) {
    case "commit":
      return [
        { text: `feat: dark mode  →  ${branch}`, match: true },
        { text: `fix: typo  →  ${branch}`, match: true },
        { text: "push to develop", match: false },
      ];
    case "branch":
      return [
        { text: `any commit on ${branch}`, match: true },
        { text: "commit on develop", match: false },
      ];
    case "tag":
      return tagMode === "any"
        ? [
            { text: "v1.4.0", match: true },
            { text: "hotfix-01", match: true },
            { text: "nightly", match: true },
          ]
        : [
            { text: "v1.4.0", match: true },
            { text: "v2.0.0", match: true },
            { text: "nightly", match: false },
          ];
    case "release":
      return [
        { text: "Release v1.4.0 published", match: true },
        { text: "Release v1.4.1 published", match: true },
        { text: "Release v2.0.0-beta", match: preRelease },
      ];
    default:
      return [];
  }
}
