// Mock filesystem contents for a project's persistent folder.
//
// The tree is generated deterministically from the project folder so it renders
// meaningfully without a backend, then held in memory for the session. Every
// access goes through this module, so a real "list files" API can replace it
// later without touching the UI.

const trees = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickMany(rng, pool, count) {
  const remaining = [...pool];
  const out = [];
  for (let i = 0; i < count && remaining.length; i += 1) {
    out.push(remaining.splice(Math.floor(rng() * remaining.length), 1)[0]);
  }
  return out;
}

const SQLITE_FILES = ["app.sqlite", "cache.sqlite", "sessions.db", "analytics.sqlite3", "backup.db"];
const IMAGE_FILES = ["hero.jpg", "logo.svg", "avatar.png", "banner.webp", "photo-01.jpg", "photo-02.png"];
const DOC_FILES = ["receipt.pdf", "contract.pdf", "form.docx", "report.pdf", "summary.xlsx"];
const LOG_FILES = ["app.log", "error.log", "access.log", "debug.log", "audit.log"];
const CODE_FILES = ["bundle.js", "styles.css", "index.html", "manifest.json"];
const DATA_FILES = ["customers.csv", "orders.csv", "data.csv", "report.json"];
const DEFAULT_FILES = ["README.md", "config.json", "notes.txt", ...DATA_FILES];

const FOLDER_POOL = ["assets", "private", "exports", "invoices", "thumbnails", "archive", "tmp", "cache"];

const SIZE_RANGES = {
  db: [65536, 12000000],
  upload: [8192, 4000000],
  log: [1024, 800000],
  default: [256, 1500000],
};

function makeFile(name, path, rng, base, kind = "default") {
  const [min, max] = SIZE_RANGES[kind] || SIZE_RANGES.default;
  return {
    name,
    path,
    type: "file",
    size: Math.floor(min + rng() * (max - min)),
    modified: new Date(base + Math.floor(rng() * 90) * 86400000).toISOString(),
  };
}

function makeFolder(name, path, rng, base, children = []) {
  return {
    name,
    path,
    type: "folder",
    modified: new Date(base + Math.floor(rng() * 60) * 86400000).toISOString(),
    children,
  };
}

function uniquePush(nodes, node) {
  if (nodes.some((n) => n.name === node.name)) return;
  nodes.push(node);
}

// Fills a folder with a few nested subfolders and loose files.
function fillFolder(folder, rng, base, depth) {
  if (depth < 3) {
    const count = 1 + Math.floor(rng() * 2);
    pickMany(rng, FOLDER_POOL, count).forEach((name) => {
      const path = `${folder.path}/${name}`;
      const child = makeFolder(name, path, rng, base, []);
      fillFolder(child, rng, base, depth + 1);
      uniquePush(folder.children, child);
    });
  }
  const count = 2 + Math.floor(rng() * 3);
  pickMany(rng, [...CODE_FILES, ...DOC_FILES, ...DEFAULT_FILES], count).forEach((name) => {
    uniquePush(folder.children, makeFile(name, `${folder.path}/${name}`, rng, base));
  });
}

function generateTree(folder) {
  const seed = hash(`${folder?.id || ""}:${folder?.name || ""}:${folder?.source || ""}`);
  const rng = mulberry32(seed);
  const source = folder?.source || "/data";
  const name = source.split("/").filter(Boolean).pop() || "data";
  const base = Date.parse(folder?.created_date) || Date.now() - 45 * 86400000;

  const root = makeFolder(name, source, rng, base, []);

  // uploads/ with year buckets, mirroring user-uploaded files.
  const uploads = makeFolder("uploads", `${source}/uploads`, rng, base, []);
  ["2023", "2024", "2025"].slice(0, 2 + Math.floor(rng() * 2)).forEach((year) => {
    const yearFolder = makeFolder(year, `${uploads.path}/${year}`, rng, base, []);
    const count = 2 + Math.floor(rng() * 3);
    pickMany(rng, [...IMAGE_FILES, ...DOC_FILES], count).forEach((fileName) => {
      yearFolder.children.push(makeFile(fileName, `${yearFolder.path}/${fileName}`, rng, base, "upload"));
    });
    uploads.children.push(yearFolder);
  });
  pickMany(rng, IMAGE_FILES, 1 + Math.floor(rng() * 2)).forEach((fileName) => {
    uploads.children.push(makeFile(fileName, `${uploads.path}/${fileName}`, rng, base, "upload"));
  });
  root.children.push(uploads);

  // data/ (or db/) holding the SQLite databases.
  const dbName = rng() > 0.5 ? "data" : "db";
  const dbFolder = makeFolder(dbName, `${source}/${dbName}`, rng, base, []);
  pickMany(rng, SQLITE_FILES, 2 + Math.floor(rng() * 3)).forEach((fileName) => {
    dbFolder.children.push(makeFile(fileName, `${dbFolder.path}/${fileName}`, rng, base, "db"));
  });
  root.children.push(dbFolder);

  // logs/
  const logs = makeFolder("logs", `${source}/logs`, rng, base, []);
  pickMany(rng, LOG_FILES, 1 + Math.floor(rng() * 2)).forEach((fileName) => {
    logs.children.push(makeFile(fileName, `${logs.path}/${fileName}`, rng, base, "log"));
  });
  root.children.push(logs);

  // A few extra nested folders for variety.
  pickMany(rng, FOLDER_POOL, Math.floor(rng() * 3)).forEach((folderName) => {
    const path = `${source}/${folderName}`;
    const child = makeFolder(folderName, path, rng, base, []);
    fillFolder(child, rng, base, 1);
    uniquePush(root.children, child);
  });

  // Loose files at the root, always including at least one SQLite database.
  pickMany(rng, SQLITE_FILES, 1).forEach((fileName) => {
    uniquePush(root.children, makeFile(fileName, `${source}/${fileName}`, rng, base, "db"));
  });
  pickMany(rng, ["README.md", "config.json", "data.csv", "notes.txt"], 2 + Math.floor(rng() * 2)).forEach(
    (fileName) => {
      uniquePush(root.children, makeFile(fileName, `${source}/${fileName}`, rng, base));
    }
  );

  return root;
}

function keyFor(folder) {
  return folder?.id || folder?.name || folder?.source || "folder";
}

function findNode(node, path) {
  if (!node) return null;
  if (node.path === path) return node;
  for (const child of node.children || []) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function findParent(node, path) {
  if (!node?.children) return null;
  if (node.children.some((c) => c.path === path)) return node;
  for (const child of node.children) {
    const found = findParent(child, path);
    if (found) return found;
  }
  return null;
}

function reindex(node, parentPath) {
  node.path = `${parentPath}/${node.name}`;
  (node.children || []).forEach((child) => reindex(child, node.path));
}

function uniqueName(existing, name) {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 1;
  while (existing.has(`${stem}-${i}${ext}`)) i += 1;
  return `${stem}-${i}${ext}`;
}

function mutate(folder, fn) {
  const key = keyFor(folder);
  if (!trees.has(key)) trees.set(key, generateTree(folder));
  const root = trees.get(key);
  fn(root);
  return clone(root);
}

export function getFolderTree(folder) {
  const key = keyFor(folder);
  if (!trees.has(key)) trees.set(key, generateTree(folder));
  return clone(trees.get(key));
}

export function uploadFiles(folder, parentPath, files) {
  return mutate(folder, (root) => {
    const parent = findNode(root, parentPath) || root;
    if (parent.type !== "folder") return;
    parent.children = parent.children || [];
    const existing = new Set(parent.children.map((c) => c.name));
    Array.from(files || []).forEach((file) => {
      const name = uniqueName(existing, file.name || "untitled");
      existing.add(name);
      parent.children.push({
        name,
        path: `${parent.path}/${name}`,
        type: "file",
        size: file.size || 0,
        modified: new Date().toISOString(),
      });
    });
  });
}

export function renameNode(folder, path, newName) {
  const trimmed = (newName || "").trim();
  if (!trimmed) return getFolderTree(folder);
  return mutate(folder, (root) => {
    const node = findNode(root, path);
    const parent = findParent(root, path);
    if (!node || !parent) return;
    const existing = new Set(parent.children.filter((c) => c !== node).map((c) => c.name));
    node.name = uniqueName(existing, trimmed);
    reindex(node, parent.path);
  });
}

export function deleteNode(folder, path) {
  return mutate(folder, (root) => {
    const parent = findParent(root, path);
    if (!parent) return;
    parent.children = parent.children.filter((c) => c.path !== path);
  });
}

// Demo download: no real file exists, so stream a placeholder with the name.
export function downloadNode(node) {
  if (!node || node.type !== "file") return;
  const content = `Demo file: ${node.path}\n\nPlaceholder content generated by the Nineteen demo filesystem.\n`;
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = node.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
