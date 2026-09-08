// Storage resource metadata for the Storage area.
// Storage is a first-class infrastructure resource, independent of projects,
// and comes in two flavours:
//   - Buckets: S3-compatible object storage (e.g. S3, MinIO)
//   - Volumes: persistent disks that can be mounted into one or more projects
//
// Both follow the same first-class pattern as the Databases feature.

export const BUCKET_PROVIDERS = {
  s3: { label: "S3 Compatible", code: "S3", color: "#f59e0b", port: 9000, scheme: "s3", description: "AWS S3-compatible object storage bucket.", defaultSize: "10" },
  minio: { label: "MinIO", code: "Mi", color: "#f5484b", port: 9000, scheme: "s3", description: "Self-hosted MinIO object storage bucket.", defaultSize: "10" },
};

export const BUCKET_PROVIDER_LIST = Object.entries(BUCKET_PROVIDERS).map(([id, v]) => ({ id, ...v }));

export const BUCKET_SIZES = [
  { id: "5", label: "5 GB", value: 5, price: "$2" },
  { id: "10", label: "10 GB", value: 10, price: "$4" },
  { id: "50", label: "50 GB", value: 50, price: "$12" },
  { id: "100", label: "100 GB", value: 100, price: "$20" },
];

export const VOLUME_TYPES = {
  ext4: { label: "ext4", code: "Ex", color: "#7c3aed", description: "Default Linux filesystem, broad compatibility." },
  xfs: { label: "XFS", code: "Xf", color: "#0ea5e9", description: "High-performance, scalable filesystem." },
  btrfs: { label: "Btrfs", code: "Bt", color: "#16a34a", description: "Copy-on-write with snapshot support." },
};

export const VOLUME_TYPE_LIST = Object.entries(VOLUME_TYPES).map(([id, v]) => ({ id, ...v }));

export const VOLUME_SIZES = [
  { id: "10", label: "10 GB", value: 10, price: "$1" },
  { id: "50", label: "50 GB", value: 50, price: "$5" },
  { id: "100", label: "100 GB", value: 100, price: "$10" },
  { id: "500", label: "500 GB", value: 500, price: "$40" },
];

export function getBucketProvider(id) {
  return BUCKET_PROVIDERS[id] || BUCKET_PROVIDERS.s3;
}

export function getVolumeType(id) {
  return VOLUME_TYPES[id] || VOLUME_TYPES.ext4;
}

// Builds a display-only endpoint for a bucket (no secrets exposed).
export function buildBucketEndpoint(bucket) {
  if (!bucket) return "";
  const p = getBucketProvider(bucket.type);
  const host = bucket.endpoint || `s3-${(bucket.slug || bucket.name || "bucket").toLowerCase()}.fra1.nineteen.app`;
  const port = bucket.port || p.port;
  return `${p.scheme}://${host}:${port}/${bucket.name || "bucket"}`;
}

// Formats a byte count into a human-readable string.
export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const n = bytes / Math.pow(1024, i);
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
