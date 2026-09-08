import { FileText, Image, Folder, File } from "lucide-react";
import { formatBytes } from "@/lib/storage";

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic mock objects so the browser tab renders meaningfully without a
// backend. Swap for real object listing once the API lands.
function generateObjects(bucket) {
  const seed = hash(bucket?.name || "bucket");
  const names = ["index.html", "logo.svg", "hero.jpg", "bundle.js", "manifest.json", "favicon.ico", "data.json"];
  return names.map((name, i) => {
    const base = bucket?.used_bytes ? bucket.used_bytes / names.length : 1024 * 1024;
    return {
      name,
      size: Math.max(1024, Math.floor((base / (i + 1)) * 1.7) % 3000000),
      modified: new Date(Date.now() - (seed % 90 + i * 8) * 86400000).toISOString(),
    };
  });
}

function ObjectIcon({ name }) {
  if (name.endsWith(".jpg") || name.endsWith(".png") || name.endsWith(".svg")) {
    return <Image className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
  }
  if (name.endsWith("/")) return <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
  if (name.endsWith(".html") || name.endsWith(".json")) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
}

export default function BucketObjects({ bucket }) {
  const objects = generateObjects(bucket);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Objects</h3>
        <span className="text-xs text-muted-foreground">{objects.length} objects</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-12 gap-2 border-b border-border/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          <span className="col-span-6">Name</span>
          <span className="col-span-3">Size</span>
          <span className="col-span-3">Modified</span>
        </div>
        {objects.map((o, i) => (
          <div
            key={o.name}
            className={`grid grid-cols-12 items-center gap-2 px-4 py-2.5 ${i > 0 ? "border-t border-border/40" : ""}`}
          >
            <div className="col-span-6 flex min-w-0 items-center gap-2">
              <ObjectIcon name={o.name} />
              <code className="truncate font-mono text-xs text-foreground">{o.name}</code>
            </div>
            <code className="col-span-3 font-mono text-[11px] text-muted-foreground">
              {formatBytes(o.size)}
            </code>
            <span className="col-span-3 text-[11px] text-muted-foreground">
              {new Date(o.modified).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
