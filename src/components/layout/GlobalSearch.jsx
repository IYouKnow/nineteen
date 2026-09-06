import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FolderGit2, Database } from "lucide-react";

import db from "@/lib/db";
import * as api from "@/lib/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export default function GlobalSearch({ open, onOpenChange }) {
  const navigate = useNavigate();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
    enabled: open,
  });

  const { data: databases = [] } = useQuery({
    queryKey: ["databases"],
    queryFn: () => db.entities.Database.list("-created_date", 100),
    enabled: open,
  });

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  function go(path) {
    onOpenChange(false);
    navigate(path);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects and databases…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Projects">
          {projects.map((p) => (
            <CommandItem key={p.id} value={`project:${p.name}:${p.repository}`} onSelect={() => go(`/projects/${p.id}`)}>
              <FolderGit2 className="text-muted-foreground" />
              <span>{p.name}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {p.repository || "no repository"}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Databases">
          {databases.map((d) => (
            <CommandItem key={d.id} value={`database:${d.name}:${d.type}`} onSelect={() => go(`/databases/${d.id}`)}>
              <Database className="text-muted-foreground" />
              <span>{d.name}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{d.type}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
