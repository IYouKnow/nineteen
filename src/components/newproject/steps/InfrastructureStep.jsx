const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { Check, Sparkles, Database } from "lucide-react";
import { DATABASES } from "@/lib/newProject";
import ServiceIcon from "@/components/newproject/ServiceIcon";
import { cn } from "@/lib/utils";

export default function InfrastructureStep({ services, setServices }) {
  const toggle = (id) =>
    setServices((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Add infrastructure</h2>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Optional
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Select databases and services to provision alongside your project. You can change these later.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DATABASES.map((db) => {
          const active = services.includes(db.id);
          return (
            <button
              key={db.id}
              type="button"
              onClick={() => toggle(db.id)}
              className={cn(
                "group relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20"
              )}
            >
              <div className="flex items-start justify-between">
                <ServiceIcon color={db.color} />
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  )}
                >
                  {active && <Check className="h-3 w-3" />}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{db.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{db.description}</p>
              </div>
              <div className="mt-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
                <Database className="h-3 w-3" /> Managed & backed up
              </div>
            </button>
          );
        })}
      </div>

      {services.length > 0 && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-muted/15 px-4 py-3 text-sm animate-slide-up">
          <span className="font-medium text-foreground">{services.length} selected</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {DATABASES.filter((d) => services.includes(d.id)).map((d) => d.label).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}