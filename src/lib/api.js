const API_URL = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  const token = localStorage.getItem("nineteen_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function doFetch(url, options = {}) {
  const res = await fetch(`${API_URL}${url}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

export const projects = {
  list: () => doFetch("/api/projects"),
  get: (id) => doFetch(`/api/projects/${id}`),
  create: (payload) => doFetch("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  update: (id, patch) => doFetch(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  delete: (id) => doFetch(`/api/projects/${id}`, { method: "DELETE" }),
  action: (id, action) =>
    doFetch(`/api/projects/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) }),
  resources: (id) => doFetch(`/api/projects/${id}/resources`),
  buildFile: (id) => doFetch(`/api/projects/${id}/buildfile`),
  buildFileSave: (id, payload) =>
    doFetch(`/api/projects/${id}/buildfile`, { method: "PUT", body: JSON.stringify(payload) }),
  buildFileReset: (id) => doFetch(`/api/projects/${id}/buildfile`, { method: "DELETE" }),
  resourcesStreamUrl: (id) => {
    const token = localStorage.getItem("nineteen_token") || "";
    return `${API_URL}/api/projects/${id}/resources/stream?token=${encodeURIComponent(token)}`;
  },
};

export const deployments = {
  list: (projectId) => doFetch(`/api/projects/${projectId}/deployments`),
  recent: () => doFetch("/api/deployments"),
  get: (id) => doFetch(`/api/deployments/${id}`),
  logs: (id) => doFetch(`/api/deployments/${id}/logs`),
  cancel: (id) => doFetch(`/api/deployments/${id}/cancel`, { method: "POST" }),
  create: (projectId, payload) =>
    doFetch(`/api/projects/${projectId}/deployments`, { method: "POST", body: JSON.stringify(payload) }),
};

export const integrations = {
  scanRepo: (repository, branch) =>
    doFetch(
      `/api/settings/integrations/scan?repo=${encodeURIComponent(repository)}&branch=${encodeURIComponent(branch || "")}`
    ),
  port: (repository, branch, file) =>
    doFetch(
      `/api/settings/integrations/port?repo=${encodeURIComponent(repository)}&branch=${encodeURIComponent(branch || "")}&file=${encodeURIComponent(file)}`
    ),
};

export const databases = {
  list: (order = "-created_date", limit = 100) => {
    const params = new URLSearchParams();
    if (order) params.set("order", order);
    if (limit) params.set("limit", String(limit));
    return doFetch(`/api/databases?${params.toString()}`);
  },
  get: (id) => doFetch(`/api/databases/${id}`),
  create: (payload) => doFetch("/api/databases", { method: "POST", body: JSON.stringify(payload) }),
  update: (id, patch) => doFetch(`/api/databases/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  remove: (id) => doFetch(`/api/databases/${id}`, { method: "DELETE" }),
  action: (id, action) =>
    doFetch(`/api/databases/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) }),
};

export const dbConnections = {
  list: (order = "-created_date", limit = 200, filters = {}) => {
    const params = new URLSearchParams();
    if (order) params.set("order", order);
    if (limit) params.set("limit", String(limit));
    if (filters.database_id) params.set("database_id", String(filters.database_id));
    if (filters.project_id) params.set("project_id", String(filters.project_id));
    return doFetch(`/api/database-connections?${params.toString()}`);
  },
  listForDatabase: (databaseId, order = "-created_date", limit = 200) => {
    const params = new URLSearchParams();
    if (order) params.set("order", order);
    if (limit) params.set("limit", String(limit));
    return doFetch(`/api/databases/${databaseId}/connections?${params.toString()}`);
  },
  bulkCreate: (databaseId, items) =>
    doFetch(`/api/databases/${databaseId}/connections`, { method: "POST", body: JSON.stringify(items) }),
  remove: (databaseId, connId) =>
    doFetch(`/api/databases/${databaseId}/connections/${connId}`, { method: "DELETE" }),
  removeForDatabase: (databaseId) =>
    doFetch(`/api/databases/${databaseId}/connections`, { method: "DELETE" }),
};

export const runtimeLogs = {
  list: (projectId, { after, limit } = {}) => {
    const params = new URLSearchParams();
    if (after) params.set("after", after);
    if (limit) params.set("limit", limit);
    const qs = params.toString();
    return doFetch(`/api/projects/${projectId}/runtime-logs${qs ? `?${qs}` : ""}`);
  },
  streamUrl: (projectId) => {
    const token = localStorage.getItem("nineteen_token") || "";
    return `${API_URL}/api/projects/${projectId}/runtime-logs/stream?token=${encodeURIComponent(token)}`;
  },
};

export const envVars = {
  list: (projectId) => doFetch(`/api/projects/${projectId}/env-vars`),
  create: (projectId, payload) =>
    doFetch(`/api/projects/${projectId}/env-vars`, { method: "POST", body: JSON.stringify(payload) }),
  update: (projectId, id, payload) =>
    doFetch(`/api/projects/${projectId}/env-vars/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  remove: (projectId, id) => doFetch(`/api/projects/${projectId}/env-vars/${id}`, { method: "DELETE" }),
};

export const update = {
  status: () => doFetch("/api/update"),
  poll: () => doFetch("/api/update/status"),
  start: (version) =>
    doFetch("/api/update", { method: "POST", body: JSON.stringify(version ? { version } : {}) }),
  rollback: () => doFetch("/api/update/rollback", { method: "POST" }),
  logs: () => doFetch("/api/update/logs"),
  logsStreamUrl: () => {
    const token = localStorage.getItem("nineteen_token") || "";
    return `${API_URL}/api/update/logs/stream?token=${encodeURIComponent(token)}`;
  },
};
