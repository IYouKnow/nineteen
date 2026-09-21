import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { admin } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { Trash2, ShieldCheck, UserX, UserCheck } from "lucide-react";

const ROLES = ["admin", "member", "viewer"];

export default function AdminUsers() {
  const qc = useQueryClient();
  const { user: me } = useAuth();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => admin.users(),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, patch }) => admin.updateUser(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User updated");
    },
    onError: (e) => toast.error("Update failed", { description: e.message }),
  });

  const deleteUser = useMutation({
    mutationFn: (id) => admin.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User deleted");
    },
    onError: (e) => toast.error("Delete failed", { description: e.message }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {users.length} account{users.length === 1 ? "" : "s"} on this instance
            </p>
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
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[160px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = me?.id === u.id;
                  const disabled = u.status === "disabled";
                  return (
                    <TableRow key={u.id} className={disabled ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="font-medium text-foreground">{u.display_name || u.username}</div>
                        <div className="text-xs text-muted-foreground">
                          @{u.username} · {u.email}
                          {isSelf && <span className="ml-1 text-foreground/70">(you)</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          disabled={isSelf || updateUser.isPending}
                          onValueChange={(role) => updateUser.mutate({ id: u.id, patch: { role } })}
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {disabled ? (
                          <Badge variant="destructive">disabled</Badge>
                        ) : (
                          <Badge variant="outline" className="text-success">active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.project_count}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSelf || updateUser.isPending}
                            onClick={() =>
                              updateUser.mutate({
                                id: u.id,
                                patch: { status: disabled ? "active" : "disabled" },
                              })
                            }
                            title={disabled ? "Enable account" : "Disable account"}
                          >
                            {disabled ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                          </Button>
                          <ConfirmDialog
                            title={`Delete ${u.username}?`}
                            description="This soft-deletes the account: sign-in is blocked and the user is hidden, but their data is kept."
                            confirmLabel="Delete"
                            onConfirm={() => deleteUser.mutate(u.id)}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                disabled={isSelf}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
