import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { generateBuildLog, levelClass } from "@/lib/buildLogs";
import { Copy, Check, Terminal } from "lucide-react";

export default function BuildLog({ deployment, project, autoStream = true, className }) {
  const framework = deployment.framework || project?.framework || "node";
  const repo = project?.repository || "acme/repo";
  const lines = generateBuildLog(framework, deployment.status, repo);

  const scrollRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const stream = autoStream && deployment.status === "building";
  const [visible, setVisible] = useState(stream ? 0 : lines.length);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible]);

  useEffect(() => {
    if (!stream) {
      setVisible(lines.length);
      return;
    }
    setVisible(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setVisible(i);
      if (i >= lines.length) clearInterval(id);
    }, 160);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment.id, deployment.status]);

  const handleCopy = () => {
    navigator.clipboard.writeText(lines.map((l) => l.text).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isBuilding = deployment.status === "building";

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
        {lines.slice(0, visible).map((line, i) => (
          <div key={i} className="flex gap-3">
            <span className="select-none text-muted-foreground/35">{line.time}</span>
            <span className={cn("whitespace-pre-wrap break-all", levelClass(line.level))}>
              {line.text}
            </span>
          </div>
        ))}
        {isBuilding && visible >= lines.length && (
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block h-3.5 w-2 animate-pulse bg-info" />
            <span className="text-info/80">streaming…</span>
          </div>
        )}
        {!isBuilding && visible >= lines.length && (
          <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2 text-xs text-muted-foreground/60">
            <span>— process exited —</span>
          </div>
        )}
      </div>
    </div>
  );
}