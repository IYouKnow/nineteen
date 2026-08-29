import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { sm: 32, md: 40, lg: 48 };

function Glyph({ icon, size }) {
  const g = Math.round(size * 0.5);
  const cls = "shrink-0";
  if (icon === "github") {
    return (
      <svg viewBox="0 0 24 24" width={g} height={g} fill="currentColor" className={cls} aria-hidden>
        <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.72-4.04-1.61-4.04-1.61-.55-1.38-1.34-1.75-1.34-1.75-1.09-.74.08-.73.08-.73 1.21.09 1.85 1.23 1.85 1.23 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.04 12.04 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z" />
      </svg>
    );
  }
  if (icon === "gitlab") {
    return (
      <svg viewBox="0 0 24 24" width={g} height={g} fill="currentColor" className={cls} aria-hidden>
        <path d="m23.6 9.59-.03-.08-3.27-8.54a.86.86 0 0 0-1.6 0l-2.2 5.74H7.5L5.3.97a.86.86 0 0 0-1.6 0L.43 9.5l-.03.08a6.1 6.1 0 0 0 2.2 7.06l.01.01.03.02 7.07 5.29 3.5 2.64 2.12-1.6 5.57-4.33.01-.01.03-.02a6.1 6.1 0 0 0 2.2-7.05Z" />
      </svg>
    );
  }
  if (icon === "gitea") {
    return (
      <svg viewBox="0 0 24 24" width={g} height={g} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
        <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" fill="currentColor" stroke="none" />
        <path d="M17 10h2.2a2.2 2.2 0 0 1 0 4.4H17" />
        <path d="M8 3.6c.7.7.7 1.4 0 2.1M11.5 3.6c.7.7.7 1.4 0 2.1" />
      </svg>
    );
  }
  return <Globe className={cn(cls)} style={{ width: g, height: g }} />;
}

export default function SourceIcon({ icon, color, size = "md", className }) {
  const px = typeof size === "number" ? size : SIZES[size] ?? SIZES.md;
  return (
    <div
      className={cn("flex items-center justify-center rounded-xl text-white shrink-0", className)}
      style={{ width: px, height: px, background: color }}
    >
      <Glyph icon={icon} size={px} />
    </div>
  );
}