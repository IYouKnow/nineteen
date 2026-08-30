import db from '@/lib/db';

// Frontend-only environment model for projects.
// Environments are optional & configurable; every project starts with a single
// Production environment. Additional environments (Staging / Development / Custom)
// are held in local state and scoped per-environment data is mocked here.
//
// Structured so a backend developer can later promote environments + their
// per-env data (deployments, variables, connections) to real backend entities
// by tagging records with an `environment_id`, without changing the UI.

import { randomSha } from "@/lib/format";
import { inferRole } from "@/lib/architecture";

export const ENV_TYPES = [
  { id: "production", label: "Production", color: "#22c55e", deletable: false },
  { id: "staging", label: "Staging", color: "#3b82f6", deletable: true },
  { id: "development", label: "Development", color: "#f59e0b", deletable: true },
  { id: "custom", label: "Custom", color: "#a855f7", deletable: true },
];

export const PRODUCTION_ENV_ID = "env-production";
export const CREATEABLE_TYPES = ENV_TYPES.filter((t) => t.id !== "production");

export function getEnvType(id) {
  return ENV_TYPES.find((t) => t.id === id) || ENV_TYPES[3];
}

export function isProductionEnv(env) {
  return !env || env.id === PRODUCTION_ENV_ID || env.type === "production";
}

export function defaultEnvironments(project) {
  return [
    {
      id: PRODUCTION_ENV_ID,
      name: "Production",
      type: "production",
      branch: project?.branch || "main",
      status: project?.status || "idle",
    },
  ];
}

const VAR_BANK = [
  { key: "NODE_ENV", value: "production", is_secret: false },
  { key: "DATABASE_URL", value: "postgres://user:••••@db.local:5432/app", is_secret: true },
  { key: "REDIS_URL", value: "redis://cache.local:6379", is_secret: false },
  { key: "API_KEY", value: "sk_live_xxxxxxxxxxxx", is_secret: true },
  { key: "LOG_LEVEL", value: "info", is_secret: false },
  { key: "SENTRY_DSN", value: "https://abc@sentry.io/123", is_secret: false },
];

export function mockVariables(env) {
  const offset = (env?.id || "").length % VAR_BANK.length;
  const count = 3 + (offset % 2);
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = VAR_BANK[(i + offset) % VAR_BANK.length];
    out.push({ id: `var-${env.id}-${i}`, key: v.key, value: v.value, is_secret: v.is_secret });
  }
  return out;
}

const DEPLOY_MESSAGES = [
  "Initial deploy",
  "Update config",
  "Fix auth flow",
  "Bump dependencies",
  "Refactor API routes",
];

export function mockDeployments(env) {
  const out = [];
  const n = 2 + ((env?.id || "").length % 3);
  for (let i = 0; i < n; i++) {
    out.push({
      id: `dep-${env.id}-${i}`,
      status: "ready",
      commit_sha: randomSha(),
      commit_message: DEPLOY_MESSAGES[(i + (env?.id?.length || 0)) % DEPLOY_MESSAGES.length],
      branch: env?.branch || "main",
      author: "acme",
      trigger: i === 0 ? "manual" : "git",
      duration: 28 + i * 7,
      created_date: new Date(Date.now() - i * 5400000).toISOString(),
    });
  }
  return out;
}

// Build a derived mock connection (same shape the architecture/databases UIs use)
// from a real database resource chosen for this environment.
export function makeMockConnection(db, scope = "all", tables = []) {
  return {
    id: `conn-${db.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    databaseId: db.id,
    name: db.name,
    type: db.type,
    status: db.status || "running",
    version: db.version,
    role: inferRole(db.type, 1),
    scope,
    selectedTables: tables,
    isMock: true,
    db,
  };
}