import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { admin } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Ticket, Trash2, Copy, CheckCircle2, Link2 } from "lucide-react";

const ROLE_FALLBACK = ["member", "viewer", "admin"];

function inviteState(inv) {
  if (inv.revoked) return { label: "revoked", variant: "destructive" };
  if (inv.used) return { label: "used", variant: "secondary" };
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
    return { label: "expired", variant: "destructive" };
  }
  return { label: "active", variant: "outline" };
}

export default function AdminInvites() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("admin.invites.manage");
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({ role: "member", label: "", max_uses: 1, expires_at: "" });

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => admin.invites(),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => admin.roles(),
  });
  const roleNames = roles.length ? roles.map((r) => r.name) : ROLE_FALLBACK;

  const createInvite = useMutation({
    mutationFn: (payload) => admin.createInvite(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
      setCreated(data.code);
      setOpen(false);
      setForm({ role: "member", label: "", max_uses: 1, expires_at: "" });
      toast.success("Invite code created");
    },
    onError: (e) => toast.error("Creation failed", { description: e.message }),
  });

  const revokeInvite = useMutation({
    mutationFn: (id) => admin.revokeInvite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
      toast.success("Invite code revoked");
    },
    onError: (e) => toast.error("Revoke failed", { description: e.message }),
  });

  function copyCode(code) {
    navigator.clipboard?.writeText(code).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Could not copy")
    );
  }

  function copyInviteLink(code) {
    const url = `${window.location.origin}/login?invite=${encodeURIComponent(code)}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success("Invite link copied"),
      () => toast.error("Could not copy")
    );
  }

  return (
    <div className="space-y-6">
      {created && (
        <div className="rounded-md border border-success/50 bg-success/5 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Invite code created</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Share this code — it will only be shown in the list too, but copy it now.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{created}</code>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copyCode(created)}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copyInviteLink(created)}>
                  <Link2 className="h-3.5 w-3.5" /> Copy link
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>Dismiss</Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {invites.length} invite code{invites.length === 1 ? "" : "s"}
              </p>
            </div>
            {canManage && (
              <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> New Invite
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : invites.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No invite codes yet. Create one to let someone join.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((inv) => {
                  const state = inviteState(inv);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{inv.code}</code>
                          <button
                            onClick={() => copyCode(inv.code)}
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Copy code"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => copyInviteLink(inv.code)}
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Copy invite link"
                          >
                            <Link2 className="h-3 w-3" />
                          </button>
                        </div>
                        {inv.label && <div className="mt-0.5 text-xs text-muted-foreground">{inv.label}</div>}
                      </TableCell>
                      <TableCell className="capitalize">{inv.role}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.uses}/{inv.max_uses}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : "never"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.variant} className="capitalize">{state.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{inv.created_by || "—"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={!canManage || inv.revoked || revokeInvite.isPending}
                          onClick={() => revokeInvite.mutate(inv.id)}
                          title="Revoke"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create invite code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(role) => setForm((f) => ({ ...f, role }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleNames.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-label">Label (optional)</Label>
              <Input
                id="invite-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Alice"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invite-max">Max uses</Label>
                <Input
                  id="invite-max"
                  type="number"
                  min={1}
                  value={form.max_uses}
                  onChange={(e) => setForm((f) => ({ ...f, max_uses: Number(e.target.value) || 1 }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-expiry">Expires (optional)</Label>
                <Input
                  id="invite-expiry"
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={createInvite.isPending}
              onClick={() => createInvite.mutate(form)}
            >
              {createInvite.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
