import { Database } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { sm: 32, md: 40, lg: 48 };

export default function ServiceIcon({ color, size = "md", className }) {
  const px = typeof size === "number" ? size : SIZES[size] ?? SIZES.md;
  const g = Math.round(px * 0.5);
  return (
    <div
      className={cn("flex items-center justify-center rounded-xl text-white shrink-0", className)}
      style={{ width: px, height: px, background: color }}
    >
      <Database style={{ width: g, height: g }} />
    </div>
  );
}