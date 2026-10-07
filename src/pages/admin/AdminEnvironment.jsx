import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { admin, update } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PERM } from "@/lib/permissions";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Lock, Save, ShieldAlert, Terminal } from "lucide-react";

const TERMINAL_STATES = ["success", "rolled_back", "failed"];

// The editable resolvers, shown as rows alongside the read-only environment
// variables. They are stored under these compose names but applied to the
// container as `docker --dns`, not as environment variables.
const DNS_FIELDS = [
  { key: "NINETEEN_DNS", field: "primary", placeholder: "1.1.1.1", note: "Primary resolver. Applied as docker --dns when Nineteen is rebuilt." },
  { key: "NINETEEN_DNS_FALLBACK", field: "fallback", placeholder: "8.8.8.8", note: "Fallback resolver, tried if the primary fails." },
];

// Owns the DNS editor's state and the rebuild-and-wait flow. Kept as a hook so
// the fields can live inside the shared card without that card owning pollers.
function useDnsSettings(data) {
  const [dns, setDns] = useState({ primary: "", fallback: "" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const initialized = useRef(false);
  const pollRef = useRef(null);
  const reloadRef = useRef(null);
  const editable = data?.editable || {};

  // Seed the form once from the server's current resolvers. Later refetches
  // must not clobber edits in progress.
  useEffect(() => {
    if (initialized.current || !data?.editable) return;
    initialized.current = true;
    const list = editable.dns || [];
    setDns({ primary: list[0] || "", fallback: list[1] || "" });
  }, [data, editable]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (reloadRef.current) clearTimeout(reloadRef.current);
    };
  }, []);

  const startPolling = useCallback(() => {
    let sawInProgress = false;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const st = await update.poll();
        if (st.state === "building" || st.state === "swapping") sawInProgress = true;
        if (sawInProgress && TERMINAL_STATES.includes(st.state)) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (st.state === "failed") {
            toast.error("Rebuild failed", { description: st.message });
            setApplying(false);
            return;
          }
          toast.success(
            st.state === "rolled_back" ? "Rolled back — configuration not applied" : "Configuration applied"
          );
          reloadRef.current = setTimeout(() => window.location.reload(), 3000);
        }
      } catch {
        /* ignore transient network errors while the container is being swapped */
      }
    }, 2000);
  }, []);

  const onConfirm = async () => {
    setApplying(true);
    try {
      await admin.saveEnvironment({
        dns: [dns.primary, dns.fallback].map((s) => String(s).trim()).filter(Boolean),
      });
      toast.info("Rebuilding Nineteen — it will restart briefly");
      startPolling();
    } catch (err) {
      toast.error("Could not apply configuration", { description: err.message });
      setApplying(false);
    }
  };

  const servedDns = editable.dns || [];
  const dirty = dns.primary !== (servedDns[0] || "") || dns.fallback !== (servedDns[1] || "");

  return { dns, setDns, dirty, applying, confirmOpen, setConfirmOpen, onConfirm, active: editable.active };
}

export default function AdminEnvironment() {
  const { hasPermission } = useAuth();
  const canApply = hasPermission(PERM.UPDATES_RUN);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-environment"],
    queryFn: () => admin.environment(),
  });

  const { dns: dnsEdit, setDns, dirty, applying, confirmOpen, setConfirmOpen, onConfirm, active } =
    useDnsSettings(data);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const variables = data?.variables || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Environment variables</CardTitle>
            </div>
            {active && <Badge variant="secondary">Custom configuration active</Badge>}
          </div>
          <CardDescription>
            The environment this container was started with, and the DNS resolvers it uses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variable</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DNS_FIELDS.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="font-mono text-xs text-foreground align-middle">{f.key}</TableCell>
                  <TableCell>
                    <Input
                      value={dnsEdit[f.field]}
                      onChange={(e) => setDns((d) => ({ ...d, [f.field]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="h-8 max-w-[220px] font-mono text-sm"
                      disabled={!canApply || applying}
                    />
                  </TableCell>
                  <TableCell className="hidden max-w-[320px] text-xs text-muted-foreground md:table-cell">
                    {f.note}
                  </TableCell>
                </TableRow>
              ))}
              {variables.map((v) => (
                <TableRow key={v.key}>
                  <TableCell className="font-mono text-xs text-foreground">{v.key}</TableCell>
                  <TableCell>
                    {!v.set ? (
                      <span className="text-xs text-muted-foreground">not set</span>
                    ) : v.secret ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Lock className="h-3.5 w-3.5" />
                        <span className="font-mono">{v.value}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-foreground break-all">{v.value || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[320px] text-xs text-muted-foreground md:table-cell">
                    {v.note}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {canApply ? (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldAlert className="h-4 w-4" />
                <span>Saving rebuilds Nineteen's container — the app restarts briefly.</span>
              </div>
              {applying && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Rebuilding…
                </span>
              )}
              <Button disabled={!dirty || applying} onClick={() => setConfirmOpen(true)}>
                <Save className="mr-1 h-4 w-4" />
                Save changes
              </Button>
            </div>
          ) : (
            <p className="border-t border-border pt-4 text-xs text-muted-foreground">
              Read-only — only the instance owner can change the resolvers.
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Rebuild Nineteen to apply?"
        description="Saving recreates Nineteen's own container so the new settings take effect. The web UI restarts briefly (a few seconds) and this page reloads. Hosted projects keep running."
        warning="If the new container fails its health check, Nineteen automatically rolls back to the current configuration."
        confirmLabel="Save and rebuild"
        destructive={false}
        onConfirm={onConfirm}
      />
    </div>
  );
}
