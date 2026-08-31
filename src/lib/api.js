const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

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
  create: (projectId, payload) =>
    doFetch(`/api/projects/${projectId}/deployments`, { method: "POST", body: JSON.stringify(payload) }),
};

export const integrations = {
  scanRepo: (repository, branch) =>
    doFetch(
      `/api/settings/integrations/scan?repo=${encodeURIComponent(repository)}&branch=${encodeURIComponent(branch || "")}`
    ),
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
