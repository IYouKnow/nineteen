import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { admin, permissions as permissionsApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PERM } from "@/lib/permissions";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Archive, ArchiveRestore, Plus, ShieldCheck, Shield, Pencil, Trash2, Star, KeyRound } from "lucide-react";

// The catalogue endpoint returns { groups, is_superuser }. Older builds returned
// a bare array, so accept both.
function useCatalog() {
  const { data } = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: () => permissionsApi.catalog(),
  });
  const groups = Array.isArray(data) ? data : data?.groups || [];
  return { catalog: groups, isSuperuser: !!data?.is_superuser };
}

// A stored wildcard such as "projects.*" satisfies every key in its group. The
// server only hands out wildcards it considers valid grants, so matching on the
// group id prefix is enough here.
function grantedKeys(granted, catalog) {
  const set = new Set();
  const list = granted || [];
  if (list.includes("*")) {
    for (const g of catalog) for (const p of g.permissions) set.add(p.key);
    return set;
  }
  const wildcards = list.filter((g) => g.endsWith(".*")).map((g) => g.slice(0, -2));
  for (const group of catalog) {
    for (const p of group.permissions) {
      if (list.includes(p.key) || wildcards.some((w) => w === group.id)) set.add(p.key);
    }
  }
  return set;
}

function PermissionMatrix({ catalog, selected, onToggle, readOnly = false }) {
  const allKeys = useMemo(
    () => catalog.flatMap((g) => g.permissions.map((p) => p.key)),
    [catalog]
  );

  // A permission the caller does not hold can never be granted, so it is
  // disabled up front. Previously the whole matrix was editable and the server
  // refused the save, which meant a delegated manager could fill in a form that
  // could not possibly succeed.
  const isGrantable = (p) => readOnly || p.grantable !== false;

  function groupState(group) {
    const keys = group.permissions.filter(isGrantable).map((p) => p.key);
    if (keys.length === 0) return { all: false, some: false, blocked: true };
    const on = keys.filter((k) => selected.has(k)).length;
    return { all: on === keys.length, some: on > 0, blocked: false };
  }

  function toggleGroup(group, next) {
    const keys = group.permissions.filter(isGrantable).map((p) => p.key);
    if (keys.length) onToggle(keys, next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{selected.size} of {allKeys.length} permissions granted</span>
      </div>
      {catalog.map((group) => {
        const state = groupState(group);
        return (
          <div key={group.id} className="rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{group.label}</p>
                <p className="truncate text-xs text-muted-foreground">{group.description}</p>
              </div>
              {state.blocked ? (
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  none available to you
                </span>
              ) : (
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={state.all ? true : state.some ? "indeterminate" : false}
                    onCheckedChange={(v) => toggleGroup(group, v === true)}
                  />
                  All
                </label>
              )}
            </div>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {group.permissions.map((p) => {
                const grantable = isGrantable(p);
                return (
                  <label
                    key={p.key}
                    title={grantable ? undefined : "You don't hold this permission, so you can't grant it"}
                    className={
                      grantable
                        ? "flex cursor-pointer items-center gap-2 text-sm text-foreground"
                        : "flex cursor-not-allowed items-center gap-2 text-sm text-muted-foreground/50"
                    }
                  >
                    <Checkbox
                      checked={selected.has(p.key)}
                      disabled={!grantable}
                      onCheckedChange={(v) => onToggle([p.key], v === true)}
                    />
                    <span className="truncate">{p.label}</span>
                    <code className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">
                      {p.key}
                    </code>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleDialog({ open, onOpenChange, role, catalog, isSuperuser, onSaved }) {
  const isEdit = !!role;
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [isDefault, setIsDefault] = useState(!!role?.is_default);
  const [selected, setSelected] = useState(
    () => grantedKeys(role?.permissions || [], catalog)
  );
  const [saving, setSaving] = useState(false);

  const superuser = role?.is_superuser;
  // Setting the default role hands it to every new registration, so the server
  // reserves it for superusers. Hiding the control beats offering one that
  // fails on save.
  const canSetDefault = isSuperuser && !superuser && !role?.is_archived;

  // Resync when the underlying role changes while the dialog is open, so an
  // edit never silently reverts to a stale snapshot.
  useEffect(() => {
    if (!open) return;
    setName(role?.name || "");
    setDescription(role?.description || "");
    setIsDefault(!!role?.is_default);
    setSelected(grantedKeys(role?.permissions || [], catalog));
  }, [open, role, catalog]);

  function toggle(keys, next) {
    setSelected((prev) => {
      const copy = new Set(prev);
      for (const k of keys) {
        if (next) copy.add(k);
        else copy.delete(k);
      }
      return copy;
    });
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const patch = {
          name: name.trim(),
          description: description.trim(),
          permissions: Array.from(selected),
        };
        // Only send is_default when the caller may change it, so opening the
        // dialog as a delegated manager cannot clear the flag as a side effect
        // of saving an unrelated field.
        if (canSetDefault) patch.is_default = isDefault;
        await admin.updateRole(role.id, patch);
        toast.success("Role updated");
      } else {
        await admin.createRole({
          name: name.trim(),
          description: description.trim(),
          permissions: Array.from(selected),
        });
        toast.success("Role created");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(isEdit ? "Update failed" : "Creation failed", { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit role — ${role.name}` : "Create role"}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2 pr-1">
          {role?.is_archived && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              This role is archived. Nobody new can be given it, but existing members keep
              the access they already have. Restore it to assign it again.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. developer"
                // The superuser role is the root of trust and keeps a fixed
                // identity, so it is not renameable.
                disabled={superuser}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this role for?"
              />
            </div>
          </div>

          {superuser && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              This is the superuser role. It always has every permission (present and future);
              the matrix below is ignored. It cannot be renamed, archived or deleted.
            </div>
          )}

          {isEdit && !superuser && canSetDefault && (
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Default role</p>
                <p className="text-xs text-muted-foreground">
                  New registrations without an invite role get this role.
                </p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          )}

          {!superuser && (
            <PermissionMatrix catalog={catalog} selected={selected} onToggle={toggle} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// RoleMembersDialog shows exactly who holds a role, and moves them out of it.
// Moving people is an explicit action with its own permission check; it is not
// something that happens as a side effect of deleting the role.
function RoleMembersDialog({ open, onOpenChange, role, roles, onChanged }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["role-members", role?.id],
    queryFn: () => admin.roleMembers(role.id),
    enabled: open && !!role?.id,
  });

  useEffect(() => {
    if (open) setTarget("");
  }, [open, role?.id]);

  const candidates = useMemo(
    () => roles.filter((r) => r.id !== role?.id && !r.is_archived),
    [roles, role?.id]
  );

  async function move() {
    if (!target) {
      toast.error("Choose a role to move them to");
      return;
    }
    setBusy(true);
    try {
      const res = await admin.reassignRoleMembers(role.id, Number(target));
      toast.success(res?.message || "Members moved");
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not move members", { description: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Members of &quot;{role?.name}&quot;</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody holds this role. It can be deleted.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {members.length} account(s) hold this role. Move them elsewhere before deleting it.
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-foreground">{m.username}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{m.email}</span>
                  </li>
                ))}
              </ul>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Move members to…" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {members.length > 0 && (
            <Button disabled={busy || !target} onClick={move}>
              {busy ? "Moving…" : "Move members"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleDialog({ role, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasMembers = (role.user_count || 0) > 0;

  async function remove() {
    setBusy(true);
    try {
      await admin.deleteRole(role.id);
      toast.success("Role deleted");
      setOpen(false);
      onDeleted?.();
    } catch (e) {
      toast.error("Delete failed", { description: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
        title="Delete role"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete role &quot;{role.name}&quot;?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {hasMembers ? (
              <p className="text-sm text-muted-foreground">
                This role is still assigned to {role.user_count} user(s). Move them to another role
                first — a delete will not reassign anyone.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                This role is not assigned to any user.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy || hasMembers} onClick={remove}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminRoles() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERM.ADMIN_ROLES_MANAGE);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [membersOf, setMembersOf] = useState(null);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => admin.roles(),
  });
  const { catalog, isSuperuser } = useCatalog();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-roles"] });
    // The catalogue is annotated with what the caller may grant, so it changes
    // whenever roles do. It used to be left stale, which is why a newly granted
    // permission did not become assignable until a full page reload.
    qc.invalidateQueries({ queryKey: ["permission-catalog"] });
    qc.invalidateQueries({ queryKey: ["role-members"] });
  };

  const totalPermissions = catalog.reduce((n, g) => n + g.permissions.length, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {roles.length} role{roles.length === 1 ? "" : "s"} · {totalPermissions} permissions available
              </p>
            </div>
            {canManage && (
              <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> New Role
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead className="w-[130px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id} className={role.is_archived ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{role.name}</span>
                        {role.is_superuser && (
                          <Badge variant="default" className="gap-1">
                            <ShieldCheck className="h-3 w-3" /> superuser
                          </Badge>
                        )}
                        {role.is_default && (
                          <Badge variant="outline" className="gap-1">
                            <Star className="h-3 w-3" /> default
                          </Badge>
                        )}
                        {role.is_archived && (
                          <Badge variant="secondary" className="gap-1">
                            <Archive className="h-3 w-3" /> archived
                          </Badge>
                        )}
                      </div>
                      {role.description && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{role.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {role.is_superuser ? (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <KeyRound className="h-3.5 w-3.5" /> all
                        </span>
                      ) : (
                        `${role.permissions?.length || 0} granted`
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => setMembersOf(role)}
                      >
                        {role.user_count}
                      </button>
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          {role.user_count > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setMembersOf(role)}
                              title="View members"
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(role)}
                            title="Edit role"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!role.is_superuser &&
                            (role.is_archived ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Restore role"
                                onClick={async () => {
                                  try {
                                    await admin.updateRole(role.id, { is_archived: false });
                                    toast.success("Role restored");
                                    refresh();
                                  } catch (e) {
                                    toast.error("Restore failed", { description: e.message });
                                  }
                                }}
                              >
                                <ArchiveRestore className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Archive role (keeps current members)"
                                onClick={async () => {
                                  try {
                                    await admin.updateRole(role.id, { is_archived: true });
                                    toast.success(
                                      role.user_count > 0
                                        ? "Role archived; existing members keep their access"
                                        : "Role archived"
                                    );
                                    refresh();
                                  } catch (e) {
                                    toast.error("Archive failed", { description: e.message });
                                  }
                                }}
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            ))}
                          {!role.is_superuser && !role.is_archived && !role.is_default && (
                            <DeleteRoleDialog role={role} onDeleted={refresh} />
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RoleDialog
        open={creating}
        onOpenChange={setCreating}
        role={null}
        catalog={catalog}
        isSuperuser={isSuperuser}
        onSaved={refresh}
      />
      <RoleDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        role={editing}
        catalog={catalog}
        isSuperuser={isSuperuser}
        onSaved={refresh}
      />
      <RoleMembersDialog
        open={!!membersOf}
        onOpenChange={(o) => !o && setMembersOf(null)}
        role={membersOf}
        roles={roles}
        onChanged={refresh}
      />
    </div>
  );
}
