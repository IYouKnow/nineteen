import * as api from "@/lib/api";

// Real entity adapters for the Storage feature. They mirror the Databases
// adapters (dbEntities) and expose the same shape the pages expect.
//
// NOTE: the backend /api/storage/* routes are not implemented yet. Each call
// tries the API first and falls back to an in-memory store so the frontend is
// fully usable. Swap the fallback out when the Go handlers land.

const now = () => new Date().toISOString();

// --- in-memory store (temporary) ---
let buckets = [
  { id: 1, user_id: 1, name: "assets", slug: "assets", type: "s3", status: "ready", region: "fra1", size: 10, endpoint: "s3-assets.fra1.nineteen.app", port: 9000, access_key: "AKIA3XAMPLEKEY0001", object_count: 128, used_bytes: 3500000000, description: "Static assets for web projects.", created_date: "2026-08-02T10:14:00Z", updated_date: "2026-09-01T09:00:00Z" },
  { id: 2, user_id: 1, name: "backups", slug: "backups", type: "minio", status: "ready", region: "fra1", size: 50, endpoint: "s3-backups.fra1.nineteen.app", port: 9000, access_key: "AKIA3XAMPLEKEY0002", object_count: 2048, used_bytes: 12000000000, description: "Daily database snapshots.", created_date: "2026-07-19T08:30:00Z", updated_date: "2026-09-05T14:20:00Z" },
  { id: 3, user_id: 1, name: "media", slug: "media", type: "minio", status: "provisioning", region: "sfo1", size: 100, endpoint: "s3-media.sfo1.nineteen.app", port: 9000, access_key: "AKIA3XAMPLEKEY0003", object_count: 0, used_bytes: 0, description: "User uploads.", created_date: "2026-09-06T11:05:00Z", updated_date: "2026-09-06T11:05:00Z" },
];

let volumes = [
  { id: 1, user_id: 1, name: "postgres-data", slug: "postgres-data", type: "ext4", status: "attached", region: "fra1", size: 50, mount_path: "/data", description: "Primary data volume for the app database.", created_date: "2026-08-02T10:15:00Z", updated_date: "2026-09-01T09:00:00Z" },
  { id: 2, user_id: 1, name: "uploads", slug: "uploads", type: "btrfs", status: "available", region: "fra1", size: 100, mount_path: "/uploads", description: "Persistent uploads volume.", created_date: "2026-08-10T16:40:00Z", updated_date: "2026-08-10T16:40:00Z" },
  { id: 3, user_id: 1, name: "cache", slug: "cache", type: "xfs", status: "provisioning", region: "iad1", size: 10, mount_path: "/cache", description: "High-throughput cache volume.", created_date: "2026-09-06T12:10:00Z", updated_date: "2026-09-06T12:10:00Z" },
];

let connections = [
  { id: 1, user_id: 1, storage_id: 1, storage_type: "volume", project_id: 1, project_name: "example-app", mount_path: "/data", created_date: "2026-08-02T10:16:00Z" },
  { id: 2, user_id: 1, storage_id: 1, storage_type: "bucket", project_id: 1, project_name: "example-app", mount_path: "", created_date: "2026-08-02T10:16:00Z" },
];

let nextId = 100;

function sortLocal(list, sort = "-created_date") {
  let key = sort;
  let dir = 1;
  if (sort.startsWith("-")) {
    key = sort.slice(1);
    dir = -1;
  }
  return [...list].sort((a, b) => {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function createLocal(store, data) {
  const item = { id: ++nextId, user_id: 1, status: "provisioning", region: "fra1", created_date: now(), updated_date: now(), ...data };
  store.push(item);
  return item;
}

function updateLocal(store, id, patch) {
  const item = store.find((x) => x.id === Number(id));
  if (!item) throw new Error("Not found");
  Object.assign(item, patch, { updated_date: now() });
  return item;
}

function removeLocal(store, id) {
  const i = store.findIndex((x) => x.id === Number(id));
  if (i === -1) throw new Error("Not found");
  store.splice(i, 1);
  return { message: "Storage resource deleted" };
}

function findLocal(store, id) {
  const item = store.find((x) => x.id === Number(id));
  if (!item) throw new Error("Not found");
  return item;
}

function listConnections(filters) {
  const { storage_id, storage_type, project_id } = filters || {};
  return connections.filter((c) => {
    if (storage_id && c.storage_id !== Number(storage_id)) return false;
    if (storage_type && c.storage_type !== storage_type) return false;
    if (project_id && c.project_id !== Number(project_id)) return false;
    return true;
  });
}

// --- entity adapters ---

const bucketEntity = {
  list: (sort = "-created_date", limit = 100) =>
    api.storage.listBuckets(sort, limit).catch(() => sortLocal(buckets, sort).slice(0, limit)),
  get: (id) => api.storage.getBucket(id).catch(() => findLocal(buckets, id)),
  create: (data) => api.storage.createBucket(data).catch(() => createLocal(buckets, data)),
  update: (id, patch) => api.storage.updateBucket(id, patch).catch(() => updateLocal(buckets, id, patch)),
  remove: (id) => api.storage.removeBucket(id).catch(() => removeLocal(buckets, id)),
};

const volumeEntity = {
  list: (sort = "-created_date", limit = 100) =>
    api.storage.listVolumes(sort, limit).catch(() => sortLocal(volumes, sort).slice(0, limit)),
  get: (id) => api.storage.getVolume(id).catch(() => findLocal(volumes, id)),
  create: (data) => api.storage.createVolume(data).catch(() => createLocal(volumes, data)),
  update: (id, patch) => api.storage.updateVolume(id, patch).catch(() => updateLocal(volumes, id, patch)),
  remove: (id) => api.storage.removeVolume(id).catch(() => removeLocal(volumes, id)),
};

const connectionEntity = {
  list: (filters = {}) => api.storageConnections.list(filters).catch(() => listConnections(filters)),
  bulkCreate: (storageId, storageType, items = []) =>
    api.storageConnections.bulkCreate(storageId, storageType, items).catch(() => {
      const created = [];
      for (const it of items) {
        const c = {
          id: ++nextId,
          user_id: 1,
          storage_id: it.storage_id || Number(storageId),
          storage_type: it.storage_type || storageType,
          project_id: it.project_id,
          project_name: it.project_name || "",
          mount_path: it.mount_path || "",
          created_date: now(),
        };
        connections.push(c);
        created.push(c);
      }
      return created;
    }),
  remove: (storageId, storageType, connId) =>
    api.storageConnections.remove(storageId, storageType, connId).catch(() => {
      const i = connections.findIndex((c) => c.id === Number(connId));
      if (i === -1) throw new Error("Not found");
      connections.splice(i, 1);
      return { message: "Connection removed" };
    }),
  removeForStorage: (storageId, storageType) =>
    api.storageConnections.removeForStorage(storageId, storageType).catch(() => {
      connections = connections.filter((c) => !(c.storage_id === Number(storageId) && c.storage_type === storageType));
      return { deleted: 1 };
    }),
};

export const storageEntities = {
  Bucket: bucketEntity,
  Volume: volumeEntity,
  Connection: connectionEntity,
};
