import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { admin, permissions as permissionsApi } from "@/lib/api";
import { useAuth, permissionCovers } from "@/hooks/useAuth";
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
import { Plus, ShieldCheck, Shield, Pencil, Trash2, Star, KeyRound } from "lucide-react";

// Expand any wildcard grants into the exact keys the matrix renders.
function expandPermissions(granted, catalog) {
  const selected = new Set();
  for (const group of catalog) {
    for (const p of group.permissions) {
      if (granted.some((g) => permissionCovers(g, p.key))) selected.add(p.key);
    }
  }
  return selected;
}

function PermissionMatrix({ catalog, selected, onToggle, disabled }) {
  const allKeys = useMemo(
    () => catalog.flatMap((g) => g.permissions.map((p) => p.key)),
    [catalog]
  );

  function groupState(group) {
    const keys = group.permissions.map((p) => p.key);
    const on = keys.filter((k) => selected.has(k)).length;
    return { all: on === keys.length && keys.length > 0, some: on > 0 };
  }

  function toggleGroup(group, next) {
    const keys = group.permissions.map((p) => p.key);
    onToggle(keys, next);
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
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={state.all ? true : state.some ? "indeterminate" : false}
                  disabled={disabled}
                  onCheckedChange={(v) => toggleGroup(group, v === true)}
                />
                All
              </label>
            </div>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {group.permissions.map((p) => (
                <label
                  key={p.key}
                  className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                >
                  <Checkbox
                    checked={selected.has(p.key)}
                    disabled={disabled}
                    onCheckedChange={(v) => onToggle([p.key], v === true)}
                  />
                  <span className="truncate">{p.label}</span>
                  <code className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {p.key}
                  </code>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleDialog({ open, onOpenChange, role, catalog, onSaved }) {
  const isEdit = !!role;
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [isDefault, setIsDefault] = useState(!!role?.is_default);
  const [selected, setSelected] = useState(
    () => new Set(role ? expandPermissions(role.permissions || [], catalog) : [])
  );
  const [saving, setSaving] = useState(false);

  const superuser = role?.is_superuser;

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
        await admin.updateRole(role.id, {
          name: name.trim(),
          description: description.trim(),
          permissions: Array.from(selected),
          is_default: isDefault,
        });
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. developer"
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
              the matrix below is ignored.
            </div>
          )}

          {isEdit && !superuser && (
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
            <PermissionMatrix
              catalog={catalog}
              selected={selected}
              onToggle={toggle}
              disabled={false}
            />
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

function DeleteRoleDialog({ role, roles, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  const needsReplacement = (role.user_count || 0) > 0;

  async function remove() {
    if (needsReplacement && !replacement) {
      toast.error("Choose a replacement role");
      return;
    }
    try {
      await admin.deleteRole(role.id, needsReplacement ? Number(replacement) : undefined);
      toast.success("Role deleted");
      setOpen(false);
      onDeleted?.();
    } catch (e) {
      toast.error("Delete failed", { description: e.message });
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
            {needsReplacement ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This role is assigned to {role.user_count} user(s). Choose a role to move them to
                  before deleting.
                </p>
                <Select value={replacement} onValueChange={setReplacement}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select replacement role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This role is not assigned to any user.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminRoles() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("admin.roles.manage");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => admin.roles(),
  });
  const { data: catalog = [] } = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: () => permissionsApi.catalog(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-roles"] });

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
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
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
                    <TableCell className="text-muted-foreground">{role.user_count}</TableCell>
                    <TableCell>
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(role)}
                            title="Edit role"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!role.is_superuser && (
                            <DeleteRoleDialog
                              role={role}
                              roles={roles.filter((r) => r.id !== role.id)}
                              onDeleted={refresh}
                            />
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

      {creating && (
        <RoleDialog
          open={creating}
          onOpenChange={setCreating}
          role={null}
          catalog={catalog}
          onSaved={refresh}
        />
      )}
      {editing && (
        <RoleDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          role={editing}
          catalog={catalog}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
