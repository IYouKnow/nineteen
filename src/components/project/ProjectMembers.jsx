import * as api from "@/lib/api";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, UserPlus, X, Crown } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer", desc: "Read-only access" },
  { value: "editor", label: "Editor", desc: "Deploy and manage files, env vars and volumes" },
  { value: "manager", label: "Manager", desc: "Editor access plus project settings" },
];

const ROLE_LABEL = {
  owner: "Owner",
  manager: "Manager",
  editor: "Editor",
  viewer: "Viewer",
};

function initials(name, username) {
  const base = (name || username || "?").trim();
  return base.slice(0, 1).toUpperCase();
}

export default function ProjectMembers({ project }) {
  const qc = useQueryClient();
  const { user, isSuperuser } = useAuth();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("viewer");
  const [suggestions, setSuggestions] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const canManage = !!project && (project.is_owner || project.access === "owner" || isSuperuser);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["project-members", project?.id],
    queryFn: () => api.projects.members.list(project.id),
    enabled: !!project?.id,
  });

  // Debounced username/email lookup for the share box.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.users
        .lookup(q)
        .then((r) => {
          if (!cancelled) setSuggestions(Array.isArray(r) ? r : []);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const memberIds = new Set(members.map((m) => m.user_id));
  const options = suggestions.filter((s) => !memberIds.has(s.id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project-members", project.id] });
    qc.invalidateQueries({ queryKey: ["project", project.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const add = async () => {
    const value = query.trim();
    if (!value) return;
    setAdding(true);
    try {
      await api.projects.members.add(project.id, { user: value, role });
      toast.success("Member added");
      setQuery("");
      setSuggestions([]);
      setRole("viewer");
      refresh();
    } catch (e) {
      toast.error(e?.message || "Failed to add member");
    } finally {
      setAdding(false);
    }
  };

  const changeRole = async (m, next) => {
    setBusyId(m.user_id);
    try {
      await api.projects.members.update(project.id, m.user_id, next);
      refresh();
    } catch (e) {
      toast.error(e?.message || "Failed to update role");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (m) => {
    try {
      await api.projects.members.remove(project.id, m.user_id);
      toast.success("Member removed");
      refresh();
    } catch (e) {
      toast.error(e?.message || "Failed to remove member");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">Members</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          People with access to this project. The owner can invite teammates and set what each
          person may do.
        </p>
      </div>

      {canManage && (
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="relative flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder="Search by username or email"
                className="bg-transparent"
              />
              {options.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                  {options.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setQuery(s.username);
                        setSuggestions([]);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                        {initials(s.display_name, s.username)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">
                          {s.display_name || s.username}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          @{s.username}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={add} disabled={adding || !query.trim()} className="gap-2">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Add
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ROLE_OPTIONS.find((r) => r.value === role)?.desc}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : members.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No members yet.</p>
        ) : (
          members.map((m, i) => {
            const isOwner = m.role === "owner";
            const isSelf = user?.id === m.user_id;
            return (
              <div
                key={m.user_id}
                className={`flex items-center gap-3 p-4 ${i > 0 ? "border-t border-border/60" : ""}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                  {initials(m.display_name, m.username)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {m.display_name || m.username}
                    </span>
                    {isSelf && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        You
                      </Badge>
                    )}
                  </div>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    @{m.username}
                  </span>
                </div>

                {isOwner ? (
                  <Badge variant="outline" className="gap-1">
                    <Crown className="h-3 w-3" /> Owner
                  </Badge>
                ) : canManage ? (
                  <Select
                    value={m.role}
                    onValueChange={(next) => changeRole(m, next)}
                    disabled={busyId === m.user_id}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline">{ROLE_LABEL[m.role] || m.role}</Badge>
                )}

                {canManage && !isOwner && (
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    }
                    title={`Remove ${m.display_name || m.username}?`}
                    description="They will immediately lose access to this project."
                    confirmLabel="Remove"
                    onConfirm={() => remove(m)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
