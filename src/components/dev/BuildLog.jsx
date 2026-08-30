import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deployments } from "@/lib/api";
import { cn } from "@/lib/utils";
import { levelClass } from "@/lib/buildLogs";
import { Copy, Check, Terminal, Loader2 } from "lucide-react";

function timeLabel(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
      d.getSeconds()
    ).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default function BuildLog({ deployment, className }) {
  const isBuilding = deployment.status === "building";

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["deployment-logs", deployment.id],
    queryFn: () => deployments.logs(deployment.id),
    refetchInterval: isBuilding ? 1500 : false,
  });

  const scrollRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs.length, isBuilding]);

  const lines = (logs || []).map((l) => ({
    time: timeLabel(l.timestamp),
    level: l.level,
    text: l.message,
  }));

  const handleCopy = () => {
    navigator.clipboard.writeText(lines.map((l) => l.text).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-background", className)}>
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3.5 py-2">
        <div className="flex items-center gap-2.5 font-mono text-xs text-muted-foreground">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          </span>
          <Terminal className="ml-1 h-3.5 w-3.5 text-muted-foreground/60" />
          <span>build.log</span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="terminal-surface h-[440px] overflow-auto p-4 font-mono text-[12.5px] leading-[1.65]"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 py-1 text-muted-foreground/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Starting build…
          </div>
        ) : lines.length === 0 ? (
          <div className="py-1 text-muted-foreground/70">
            {isBuilding ? "Waiting for build output…" : "No build output recorded."}
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="select-none text-muted-foreground/35">{line.time}</span>
              <span className={cn("whitespace-pre-wrap break-all", levelClass(line.level))}>
                {line.text}
              </span>
            </div>
          ))
        )}
        {isBuilding && !isLoading && (
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block h-3.5 w-2 animate-pulse bg-info" />
            <span className="text-info/80">streaming…</span>
          </div>
        )}
        {!isBuilding && !isLoading && lines.length > 0 && (
          <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2 text-xs text-muted-foreground/60">
            <span>— process exited —</span>
          </div>
        )}
      </div>
    </div>
  );
}
