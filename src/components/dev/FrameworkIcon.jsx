import { cn } from "@/lib/utils";
import { getFramework } from "@/lib/devStatus";

const SIZES = {
  sm: "h-6 w-6 text-[10px] rounded-md",
  md: "h-7 w-7 text-[11px] rounded-md",
  lg: "h-9 w-9 text-sm rounded-lg",
};

export default function FrameworkIcon({ framework, className, size = "md" }) {
  const fw = getFramework(framework);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center border font-mono font-semibold leading-none",
        SIZES[size],
        className
      )}
      style={{
        color: fw.color,
        borderColor: `${fw.color}33`,
        backgroundColor: `${fw.color}12`,
      }}
      title={fw.label}
    >
      {fw.code}
    </span>
  );
}