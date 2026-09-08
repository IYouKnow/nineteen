import { cn } from "@/lib/utils";
import { getBucketProvider, getVolumeType } from "@/lib/storage";

const SIZES = { sm: 28, md: 36, lg: 44 };

export default function StorageTypeIcon({ kind, type, size = "md", className }) {
  const t = kind === "volume" ? getVolumeType(type) : getBucketProvider(type);
  const px = typeof size === "number" ? size : SIZES[size] ?? SIZES.md;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
        className
      )}
      style={{ width: px, height: px, background: t.color, fontSize: Math.round(px * 0.34) }}
    >
      {t.code}
    </div>
  );
}
