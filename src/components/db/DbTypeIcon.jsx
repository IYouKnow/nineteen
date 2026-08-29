import { cn } from "@/lib/utils";
import { getDbType } from "@/lib/databases";

const SIZES = { sm: 28, md: 36, lg: 44 };

export default function DbTypeIcon({ type, size = "md", className }) {
  const t = getDbType(type);
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