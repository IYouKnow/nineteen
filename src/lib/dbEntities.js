import * as api from "@/lib/api";

// Real entity adapters for the Databases feature. They implement the same
// interface the previous in-browser mock (db.entities.Database /
// db.entities.DatabaseConnection) exposed, but backed by the Nineteen API.
// This lets the existing Databases pages keep their calls unchanged.

const databaseEntity = {
  list: (sort, limit) => api.databases.list(sort, limit),
  get: (id) => api.databases.get(id),
  create: (data) => api.databases.create(data),
  update: (id, patch) => api.databases.update(id, patch),
  delete: (id) => api.databases.remove(id),
};

const connectionEntity = {
  list: (sort, limit) => api.dbConnections.list(sort, limit),
  filter: (filters = {}, sort, limit) => {
    if (filters.database_id) {
      return api.dbConnections.listForDatabase(filters.database_id, sort, limit);
    }
    return api.dbConnections.list(sort, limit, filters);
  },
  delete: (id, databaseId) => api.dbConnections.remove(databaseId, id),
  deleteMany: (filters = {}) => {
    if (filters.database_id) {
      return api.dbConnections.removeForDatabase(filters.database_id);
    }
    return Promise.resolve(0);
  },
  bulkCreate: (items = []) => {
    const byDb = {};
    for (const it of items) {
      if (!it.database_id) continue;
      (byDb[it.database_id] ||= []).push(it);
    }
    return Promise.all(
      Object.entries(byDb).map(([dbId, list]) => api.dbConnections.bulkCreate(dbId, list))
    ).then((arrs) => arrs.flat());
  },
};

export const dbEntities = {
  Database: databaseEntity,
  DatabaseConnection: connectionEntity,
};
