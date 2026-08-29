import { DB_TYPES } from "@/lib/databases";

const demoUser = {
  id: "user-demo",
  name: "Avery Stone",
  email: "avery@nineteen.app",
  role: "admin",
};

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

const minutesAgo = (n) => isoAgo(n * minute);
const hoursAgo = (n) => isoAgo(n * hour);
const daysAgo = (n) => isoAgo(n * day);
const clone = (value) => JSON.parse(JSON.stringify(value));

function sortRecords(records, sort) {
  if (!sort) return [...records];
  const desc = String(sort).startsWith("-");
  const field = desc ? String(sort).slice(1) : String(sort);
  return [...records].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    const ad = Date.parse(av);
    const bd = Date.parse(bv);
    let diff = 0;
    if (!Number.isNaN(ad) && !Number.isNaN(bd)) diff = ad - bd;
    else if (typeof av === "number" && typeof bv === "number") diff = av - bv;
    else diff = String(av ?? "").localeCompare(String(bv ?? ""));
    return desc ? -diff : diff;
  });
}

function limitRecords(records, limit) {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? records.slice(0, n) : records;
}

function normalizeMatchValue(value) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return value;
}

function matchesFilters(record, filters = {}) {
  const entries = Object.entries(filters || {});
  return entries.every(([key, expected]) => {
    if (expected == null) return true;
    const actual = record[key];
    if (Array.isArray(expected)) return expected.includes(actual);
    return String(actual ?? "") === String(expected);
  });
}

function makeProject(data) {
  return {
    auto_deploy: true,
    branch: "main",
    created_date: daysAgo(14),
    description: "",
    domain: "",
    framework: "node",
    id: "",
    instance_type: "nano",
    last_deployed_at: hoursAgo(6),
    name: "",
    region: "fra1",
    repository: "",
    slug: "",
    status: "idle",
    updated_date: hoursAgo(1),
    ...data,
  };
}

function makeDatabase(data) {
  const type = DB_TYPES[data.type] || DB_TYPES.postgresql;
  return {
    color: type.color,
    created_date: daysAgo(21),
    database_name: "app",
    description: "",
    host: "",
    id: "",
    instance_size: "small",
    port: type.port,
    region: "fra1",
    status: "running",
    type: "postgresql",
    updated_date: hoursAgo(2),
    username: "app",
    version: type.defaultVersion,
    ...data,
  };
}

function makeDeployment(data) {
  return {
    author: "team",
    branch: "main",
    commit_message: "Initial deploy",
    commit_sha: "0000000",
    created_date: hoursAgo(4),
    duration: 32,
    framework: "node",
    id: "",
    project_id: "",
    project_name: "",
    status: "ready",
    trigger: "git",
    url: "",
    ...data,
  };
}

function makeConnection(data) {
  const selectedTables = Array.isArray(data.selectedTables)
    ? data.selectedTables
    : String(data.selected_tables || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

  return {
    backupOf: null,
    created_date: hoursAgo(12),
    databaseId: data.database_id || data.databaseId || "",
    database_name: data.database_name || data.databaseName || "",
    database_type: data.database_type || data.databaseType || "",
    host: data.host || "",
    id: data.id || "",
    name: data.name || data.database_name || "",
    port: data.port || "",
    projectId: data.project_id || data.projectId || "",
    project_name: data.project_name || data.projectName || "",
    role: data.role || "primary",
    scope: data.scope || "all",
    selectedTables,
    selected_tables: data.selected_tables || selectedTables.join(","),
    status: data.status || "running",
    type: data.type || data.database_type || "",
    version: data.version || "",
    ...data,
  };
}

function makeEnvVar(data) {
  return {
    created_date: daysAgo(2),
    id: "",
    is_secret: false,
    key: "",
    project_id: "",
    updated_date: hoursAgo(1),
    value: "",
    ...data,
  };
}

function makeMount(data) {
  return {
    created_date: daysAgo(3),
    destination: "/app/data",
    id: "",
    name: "",
    project_id: "",
    source: "/data",
    type: "volume",
    updated_date: hoursAgo(1),
    ...data,
  };
}

function seedState() {
  const projects = [
    makeProject({
      id: "proj-atlas-commerce",
      name: "Atlas Commerce",
      slug: "atlas-commerce",
      status: "running",
      framework: "nextjs",
      repository: "acme/atlas-commerce",
      branch: "main",
      domain: "atlas-commerce.nineteen.app",
      region: "fra1",
      instance_type: "small",
      description: "Investor-ready storefront with search, checkout and customer accounts.",
      auto_deploy: true,
      created_date: daysAgo(18),
      updated_date: hoursAgo(3),
      last_deployed_at: minutesAgo(42),
    }),
    makeProject({
      id: "proj-pulse-analytics",
      name: "Pulse Analytics",
      slug: "pulse-analytics",
      status: "building",
      framework: "vite",
      repository: "acme/pulse-analytics",
      branch: "release",
      domain: "pulse-analytics.nineteen.app",
      region: "sfo1",
      instance_type: "micro",
      description: "Product analytics workspace for growth, ops and investor reporting.",
      auto_deploy: true,
      created_date: daysAgo(12),
      updated_date: minutesAgo(8),
      last_deployed_at: hoursAgo(2),
    }),
    makeProject({
      id: "proj-beacon-api",
      name: "Beacon API",
      slug: "beacon-api",
      status: "running",
      framework: "node",
      repository: "acme/beacon-api",
      branch: "main",
      domain: "api.beacon.nineteen.app",
      region: "fra1",
      instance_type: "medium",
      description: "Webhook router, auth service and event ingestion API.",
      auto_deploy: false,
      created_date: daysAgo(21),
      updated_date: hoursAgo(1),
      last_deployed_at: hoursAgo(5),
    }),
    makeProject({
      id: "proj-northstar-crm",
      name: "Northstar CRM",
      slug: "northstar-crm",
      status: "idle",
      framework: "remix",
      repository: "acme/northstar-crm",
      branch: "main",
      domain: "crm.nineteen.app",
      region: "iad1",
      instance_type: "small",
      description: "Internal CRM for customer success, pipeline tracking and investor diligence.",
      auto_deploy: true,
      created_date: daysAgo(8),
      updated_date: hoursAgo(6),
      last_deployed_at: daysAgo(2),
    }),
  ];

  const databases = [
    makeDatabase({
      id: "db-atlas-postgres",
      name: "Atlas Postgres",
      type: "postgresql",
      status: "running",
      version: "16.2",
      region: "fra1",
      instance_size: "medium",
      host: "db-atlas-postgres.fra1.nineteen.app",
      port: 5432,
      database_name: "app",
      username: "app",
      description: "Primary transactional database shared across customer-facing services.",
      created_date: daysAgo(24),
      updated_date: hoursAgo(2),
    }),
    makeDatabase({
      id: "db-atlas-redis",
      name: "Atlas Redis",
      type: "redis",
      status: "running",
      version: "7.2",
      region: "fra1",
      instance_size: "small",
      host: "db-atlas-redis.fra1.nineteen.app",
      port: 6379,
      database_name: "0",
      username: "cache",
      description: "Caching, rate limits and background job coordination.",
      created_date: daysAgo(24),
      updated_date: hoursAgo(2),
    }),
    makeDatabase({
      id: "db-analytics-warehouse",
      name: "Analytics Warehouse",
      type: "mysql",
      status: "running",
      version: "8.4",
      region: "sfo1",
      instance_size: "small",
      host: "db-analytics-warehouse.sfo1.nineteen.app",
      port: 3306,
      database_name: "warehouse",
      username: "analytics",
      description: "Event warehouse powering dashboards and revenue reporting.",
      created_date: daysAgo(15),
      updated_date: hoursAgo(4),
    }),
    makeDatabase({
      id: "db-crm-core",
      name: "CRM Core",
      type: "mongodb",
      status: "running",
      version: "7.0",
      region: "iad1",
      instance_size: "large",
      host: "db-crm-core.iad1.nineteen.app",
      port: 27017,
      database_name: "crm",
      username: "crm",
      description: "Flexible customer profile store and activity feed.",
      created_date: daysAgo(10),
      updated_date: hoursAgo(5),
    }),
    makeDatabase({
      id: "db-billing-archive",
      name: "Billing Archive",
      type: "mariadb",
      status: "stopped",
      version: "11.2",
      region: "fra1",
      instance_size: "nano",
      host: "db-billing-archive.fra1.nineteen.app",
      port: 3306,
      database_name: "billing",
      username: "billing",
      description: "Legacy billing archive and audit snapshots.",
      created_date: daysAgo(30),
      updated_date: daysAgo(3),
    }),
  ];

  const deployments = [
    makeDeployment({
      id: "dep-atlas-001",
      project_id: "proj-atlas-commerce",
      project_name: "Atlas Commerce",
      framework: "nextjs",
      commit_sha: "8f31c8a1d3e4b5c6d7e8f90123456789abcdef01",
      commit_message: "Improve checkout conversion flow",
      branch: "main",
      author: "Maya",
      trigger: "git",
      duration: 34,
      status: "ready",
      created_date: minutesAgo(42),
      url: "https://atlas-commerce.nineteen.app",
    }),
    makeDeployment({
      id: "dep-atlas-002",
      project_id: "proj-atlas-commerce",
      project_name: "Atlas Commerce",
      framework: "nextjs",
      commit_sha: "7c21b0f1a2c3d4e5f67890123456789abcdef012",
      commit_message: "Add product recommendations",
      branch: "main",
      author: "Maya",
      trigger: "git",
      duration: 29,
      status: "ready",
      created_date: hoursAgo(7),
    }),
    makeDeployment({
      id: "dep-pulse-001",
      project_id: "proj-pulse-analytics",
      project_name: "Pulse Analytics",
      framework: "vite",
      commit_sha: "2c44b1d9e8f7a6b5c4d3123456789abcdef01234",
      commit_message: "Ship executive dashboard refresh",
      branch: "release",
      author: "Noah",
      trigger: "git",
      duration: 41,
      status: "building",
      created_date: minutesAgo(18),
    }),
    makeDeployment({
      id: "dep-pulse-002",
      project_id: "proj-pulse-analytics",
      project_name: "Pulse Analytics",
      framework: "vite",
      commit_sha: "1d2e3f4a5b6c7d8e9f0123456789abcdef012345",
      commit_message: "Improve cohort retention queries",
      branch: "release",
      author: "Noah",
      trigger: "manual",
      duration: 38,
      status: "ready",
      created_date: hoursAgo(4),
    }),
    makeDeployment({
      id: "dep-beacon-001",
      project_id: "proj-beacon-api",
      project_name: "Beacon API",
      framework: "node",
      commit_sha: "3e4f5a6b7c8d9e0f123456789abcdef012345678",
      commit_message: "Harden webhook signature verification",
      branch: "main",
      author: "Avery",
      trigger: "git",
      duration: 27,
      status: "ready",
      created_date: hoursAgo(5),
    }),
    makeDeployment({
      id: "dep-beacon-002",
      project_id: "proj-beacon-api",
      project_name: "Beacon API",
      framework: "node",
      commit_sha: "9a8b7c6d5e4f3a2b1c0d123456789abcdef01235",
      commit_message: "Fix replay protection edge case",
      branch: "main",
      author: "Avery",
      trigger: "manual",
      duration: 31,
      status: "error",
      created_date: daysAgo(1),
    }),
    makeDeployment({
      id: "dep-crm-001",
      project_id: "proj-northstar-crm",
      project_name: "Northstar CRM",
      framework: "remix",
      commit_sha: "6a7b8c9d0e1f23456789abcdef0123456789abcd",
      commit_message: "Refine pipeline scoring model",
      branch: "main",
      author: "Riley",
      trigger: "git",
      duration: 35,
      status: "ready",
      created_date: hoursAgo(8),
    }),
  ];

  const connections = [
    makeConnection({
      id: "conn-001",
      database_id: "db-atlas-postgres",
      project_id: "proj-atlas-commerce",
      database_name: "Atlas Postgres",
      database_type: "postgresql",
      project_name: "Atlas Commerce",
      scope: "all",
      selected_tables: "",
      name: "Atlas Postgres",
      type: "postgresql",
      version: "16.2",
      host: "db-atlas-postgres.fra1.nineteen.app",
      port: 5432,
      created_date: daysAgo(9),
      role: "primary",
    }),
    makeConnection({
      id: "conn-002",
      database_id: "db-atlas-redis",
      project_id: "proj-atlas-commerce",
      database_name: "Atlas Redis",
      database_type: "redis",
      project_name: "Atlas Commerce",
      scope: "all",
      selected_tables: "",
      name: "Atlas Redis",
      type: "redis",
      version: "7.2",
      host: "db-atlas-redis.fra1.nineteen.app",
      port: 6379,
      created_date: daysAgo(9),
      role: "cache",
    }),
    makeConnection({
      id: "conn-003",
      database_id: "db-atlas-postgres",
      project_id: "proj-beacon-api",
      database_name: "Atlas Postgres",
      database_type: "postgresql",
      project_name: "Beacon API",
      scope: "tables",
      selected_tables: "users,events,api_keys",
      name: "Atlas Postgres",
      type: "postgresql",
      version: "16.2",
      host: "db-atlas-postgres.fra1.nineteen.app",
      port: 5432,
      created_date: daysAgo(7),
      role: "primary",
    }),
    makeConnection({
      id: "conn-004",
      database_id: "db-atlas-postgres",
      project_id: "proj-northstar-crm",
      database_name: "Atlas Postgres",
      database_type: "postgresql",
      project_name: "Northstar CRM",
      scope: "tables",
      selected_tables: "users,projects,deployments",
      name: "Atlas Postgres",
      type: "postgresql",
      version: "16.2",
      host: "db-atlas-postgres.fra1.nineteen.app",
      port: 5432,
      created_date: daysAgo(6),
      role: "shared",
    }),
    makeConnection({
      id: "conn-005",
      database_id: "db-analytics-warehouse",
      project_id: "proj-pulse-analytics",
      database_name: "Analytics Warehouse",
      database_type: "mysql",
      project_name: "Pulse Analytics",
      scope: "tables",
      selected_tables: "events,sessions,users",
      name: "Analytics Warehouse",
      type: "mysql",
      version: "8.4",
      host: "db-analytics-warehouse.sfo1.nineteen.app",
      port: 3306,
      created_date: daysAgo(11),
      role: "primary",
    }),
    makeConnection({
      id: "conn-006",
      database_id: "db-atlas-redis",
      project_id: "proj-pulse-analytics",
      database_name: "Atlas Redis",
      database_type: "redis",
      project_name: "Pulse Analytics",
      scope: "all",
      selected_tables: "",
      name: "Atlas Redis",
      type: "redis",
      version: "7.2",
      host: "db-atlas-redis.fra1.nineteen.app",
      port: 6379,
      created_date: daysAgo(8),
      role: "shared",
    }),
    makeConnection({
      id: "conn-007",
      database_id: "db-crm-core",
      project_id: "proj-northstar-crm",
      database_name: "CRM Core",
      database_type: "mongodb",
      project_name: "Northstar CRM",
      scope: "all",
      selected_tables: "",
      name: "CRM Core",
      type: "mongodb",
      version: "7.0",
      host: "db-crm-core.iad1.nineteen.app",
      port: 27017,
      created_date: daysAgo(5),
      role: "primary",
    }),
  ];

  const envVars = [
    makeEnvVar({ id: "env-001", project_id: "proj-atlas-commerce", key: "NODE_ENV", value: "production", is_secret: false, created_date: daysAgo(6) }),
    makeEnvVar({ id: "env-002", project_id: "proj-atlas-commerce", key: "DATABASE_URL", value: "postgres://app:********@db-atlas-postgres.fra1.nineteen.app:5432/app", is_secret: true, created_date: daysAgo(6) }),
    makeEnvVar({ id: "env-003", project_id: "proj-atlas-commerce", key: "STRIPE_KEY", value: "sk_live_demo_123", is_secret: true, created_date: daysAgo(6) }),
    makeEnvVar({ id: "env-004", project_id: "proj-atlas-commerce", key: "LOG_LEVEL", value: "info", is_secret: false, created_date: daysAgo(6) }),
    makeEnvVar({ id: "env-005", project_id: "proj-pulse-analytics", key: "VITE_API_URL", value: "https://api.beacon.nineteen.app", is_secret: false, created_date: daysAgo(4) }),
    makeEnvVar({ id: "env-006", project_id: "proj-pulse-analytics", key: "VITE_MIXPANEL_KEY", value: "mixpanel-demo-key", is_secret: false, created_date: daysAgo(4) }),
    makeEnvVar({ id: "env-007", project_id: "proj-pulse-analytics", key: "SENTRY_DSN", value: "https://demo@sentry.io/123", is_secret: false, created_date: daysAgo(4) }),
    makeEnvVar({ id: "env-008", project_id: "proj-beacon-api", key: "PORT", value: "8080", is_secret: false, created_date: daysAgo(7) }),
    makeEnvVar({ id: "env-009", project_id: "proj-beacon-api", key: "JWT_SECRET", value: "demo-secret", is_secret: true, created_date: daysAgo(7) }),
    makeEnvVar({ id: "env-010", project_id: "proj-beacon-api", key: "REDIS_URL", value: "redis://db-atlas-redis.fra1.nineteen.app:6379/0", is_secret: false, created_date: daysAgo(7) }),
    makeEnvVar({ id: "env-011", project_id: "proj-northstar-crm", key: "CRM_ENV", value: "prod", is_secret: false, created_date: daysAgo(3) }),
    makeEnvVar({ id: "env-012", project_id: "proj-northstar-crm", key: "DATABASE_URL", value: "mongodb://crm:********@db-crm-core.iad1.nineteen.app:27017/crm", is_secret: true, created_date: daysAgo(3) }),
    makeEnvVar({ id: "env-013", project_id: "proj-northstar-crm", key: "AUTH_DOMAIN", value: "auth.nineteen.app", is_secret: false, created_date: daysAgo(3) }),
  ];

  const mounts = [
    makeMount({ id: "mount-001", project_id: "proj-atlas-commerce", name: "product-images", source: "/data/products", destination: "/app/public/products", type: "volume", created_date: daysAgo(9) }),
    makeMount({ id: "mount-002", project_id: "proj-beacon-api", name: "webhook-buffer", source: "/var/lib/beacon", destination: "/srv/beacon", type: "volume", created_date: daysAgo(6) }),
    makeMount({ id: "mount-003", project_id: "proj-northstar-crm", name: "crm-exports", source: "/data/exports", destination: "/app/exports", type: "bind", created_date: daysAgo(4) }),
  ];

  return { projects, databases, deployments, connections, envVars, mounts };
}

function createStore() {
  const state = seedState();

  const findById = (collection, id) => state[collection].find((item) => item.id === id);

  const hydrateConnection = (record) => {
    if (!record) return null;
    const database = state.databases.find((d) => d.id === (record.database_id || record.databaseId));
    const project = state.projects.find((p) => p.id === (record.project_id || record.projectId));
    const selectedTables = Array.isArray(record.selectedTables)
      ? record.selectedTables
      : String(record.selected_tables || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

    return {
      ...clone(record),
      databaseId: record.database_id || record.databaseId || database?.id || "",
      database_id: record.database_id || record.databaseId || database?.id || "",
      databaseName: record.database_name || record.databaseName || database?.name || "",
      database_name: record.database_name || record.databaseName || database?.name || "",
      databaseType: record.database_type || record.databaseType || database?.type || "",
      database_type: record.database_type || record.databaseType || database?.type || "",
      host: database?.host || record.host || "",
      name: database?.name || record.name || "",
      port: database?.port || record.port || "",
      projectId: record.project_id || record.projectId || project?.id || "",
      project_id: record.project_id || record.projectId || project?.id || "",
      projectName: record.project_name || record.projectName || project?.name || "",
      project_name: record.project_name || record.projectName || project?.name || "",
      scope: record.scope || "all",
      selectedTables,
      selected_tables: selectedTables.join(","),
      status: database?.status || record.status || "running",
      type: database?.type || record.type || record.database_type || "",
      version: database?.version || record.version || "",
    };
  };

  const hydrateDeployment = (record) => {
    if (!record) return null;
    const project = state.projects.find((p) => p.id === record.project_id);
    return {
      ...clone(record),
      framework: record.framework || project?.framework || "node",
      project_name: record.project_name || project?.name || "",
    };
  };

  const makeEntityApi = (collection, options = {}) => ({
    list: async (sort, limit) => {
      const records = sortRecords(state[collection], sort ?? "-created_date");
      const hydrated = options.hydrate ? records.map(options.hydrate) : records.map(clone);
      return limitRecords(hydrated, limit);
    },
    get: async (id) => {
      const record = findById(collection, id);
      if (!record) return null;
      return clone(options.hydrate ? options.hydrate(record) : record);
    },
    filter: async (filters = {}, sort, limit) => {
      const records = state[collection].filter((record) => matchesFilters(record, filters));
      const ordered = sortRecords(records, sort ?? "-created_date");
      const hydrated = options.hydrate ? ordered.map(options.hydrate) : ordered.map(clone);
      return limitRecords(hydrated, limit);
    },
    create: async (data = {}) => {
      const record = options.create ? options.create(data, state) : { ...data };
      state[collection] = [record, ...state[collection]];
      return clone(options.hydrate ? options.hydrate(record) : record);
    },
    update: async (id, patch = {}) => {
      const current = findById(collection, id);
      if (!current) return null;
      const next = options.update ? options.update(current, patch, state) : { ...current, ...patch };
      const updated = { ...next, updated_date: new Date().toISOString() };
      state[collection] = state[collection].map((record) => (record.id === id ? updated : record));
      return clone(options.hydrate ? options.hydrate(updated) : updated);
    },
    delete: async (id) => {
      state[collection] = state[collection].filter((record) => record.id !== id);
      if (options.afterDelete) options.afterDelete(id, state);
      return true;
    },
    deleteMany: async (filters = {}) => {
      const before = state[collection].length;
      state[collection] = state[collection].filter((record) => !matchesFilters(record, filters));
      if (options.afterDeleteMany) options.afterDeleteMany(filters, state);
      return before - state[collection].length;
    },
    bulkCreate: async (items = []) => {
      const created = items.map((item) => {
        const record = options.create ? options.create(item, state) : { ...item };
        state[collection] = [record, ...state[collection]];
        return clone(options.hydrate ? options.hydrate(record) : record);
      });
      return created;
    },
  });

  const projectApi = makeEntityApi("projects", {
    create: (data) => makeProject({
      id: data.id || `proj-${Date.now()}`,
      ...data,
      created_date: data.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
      last_deployed_at: data.last_deployed_at || new Date().toISOString(),
    }),
    afterDelete: (id, currentState) => {
      currentState.deployments = currentState.deployments.filter((d) => d.project_id !== id);
      currentState.connections = currentState.connections.filter((c) => c.project_id !== id);
      currentState.envVars = currentState.envVars.filter((v) => v.project_id !== id);
      currentState.mounts = currentState.mounts.filter((m) => m.project_id !== id);
    },
  });

  const deploymentApi = makeEntityApi("deployments", {
    hydrate: hydrateDeployment,
    create: (data, currentState) => makeDeployment({
      id: data.id || `dep-${Date.now()}`,
      project_id: data.project_id || data.projectId || "",
      project_name:
        data.project_name ||
        currentState.projects.find((p) => p.id === (data.project_id || data.projectId || ""))?.name ||
        "",
      framework: data.framework || currentState.projects.find((p) => p.id === (data.project_id || data.projectId || ""))?.framework || "node",
      status: data.status || "building",
      created_date: data.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
      ...data,
    }),
  });

  const databaseApi = makeEntityApi("databases", {
    create: (data) => makeDatabase({
      id: data.id || `db-${Date.now()}`,
      ...data,
      created_date: data.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
    }),
    afterDelete: (id, currentState) => {
      currentState.connections = currentState.connections.filter((c) => c.database_id !== id);
    },
  });

  const connectionApi = makeEntityApi("connections", {
    hydrate: hydrateConnection,
    create: (data, currentState) => {
      const database = currentState.databases.find((d) => d.id === (data.database_id || data.databaseId));
      const project = currentState.projects.find((p) => p.id === (data.project_id || data.projectId));
      return makeConnection({
        id: data.id || `conn-${Date.now()}`,
        database_id: data.database_id || data.databaseId || database?.id || "",
        project_id: data.project_id || data.projectId || project?.id || "",
        database_name: data.database_name || data.databaseName || database?.name || "",
        database_type: data.database_type || data.databaseType || database?.type || "",
        project_name: data.project_name || data.projectName || project?.name || "",
        scope: data.scope || "all",
        selected_tables: data.selected_tables || (Array.isArray(data.selectedTables) ? data.selectedTables.join(",") : ""),
        role: data.role || "primary",
        name: data.name || database?.name || "",
        type: data.type || database?.type || "",
        version: data.version || database?.version || "",
        host: data.host || database?.host || "",
        port: data.port || database?.port || "",
        status: data.status || database?.status || "running",
        created_date: data.created_date || new Date().toISOString(),
        backupOf: data.backupOf || null,
      });
    },
  });

  const envVarApi = makeEntityApi("envVars", {
    create: (data) => makeEnvVar({
      id: data.id || `env-${Date.now()}`,
      ...data,
      created_date: data.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
    }),
  });

  const mountApi = makeEntityApi("mounts", {
    create: (data) => makeMount({
      id: data.id || `mount-${Date.now()}`,
      ...data,
      created_date: data.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
    }),
  });

  return {
    auth: {
      isAuthenticated: async () => true,
      me: async () => clone(demoUser),
      loginViaEmailPassword: async () => ({ user: clone(demoUser), token: "demo-token" }),
      loginWithProvider: async () => ({ user: clone(demoUser), token: "demo-token" }),
      register: async () => ({ user: clone(demoUser), token: "demo-token" }),
      verifyOtp: async () => ({ user: clone(demoUser), token: "demo-token" }),
      setToken: () => {},
      resendOtp: async () => ({ ok: true }),
      resetPasswordRequest: async () => ({ ok: true }),
      resetPassword: async () => ({ ok: true }),
      logout: () => {
        window.location.href = "/";
      },
      redirectToLogin: () => {
        window.location.href = "/";
      },
    },
    entities: {
      Project: projectApi,
      Deployment: deploymentApi,
      Database: databaseApi,
      DatabaseConnection: connectionApi,
      EnvironmentVariable: envVarApi,
      Mount: mountApi,
    },
    integrations: {
      Core: {
        UploadFile: async () => ({ file_url: "" }),
      },
    },
  };
}

const db = createStore();

globalThis.__B44_DB__ = db;

export default db;
