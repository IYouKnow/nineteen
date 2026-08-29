import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 text-[11px] rounded-md",
  md: "h-9 w-9 text-sm rounded-lg",
};

export default function TemplateIcon({ template, size = "md", className }) {
  if (!template) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center border font-mono font-semibold leading-none",
        SIZES[size],
        className
      )}
      style={{
        color: template.color,
        borderColor: `${template.color}44`,
        backgroundColor: `${template.color}14`,
      }}
      title={template.label}
    >
      {template.code}
    </span>
  );
}