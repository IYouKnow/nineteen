import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { admin } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertCircle, CheckCircle2, Loader2, Lock, Network, Search, ShieldAlert, Terminal,
} from "lucide-react";

function Chips({ items, empty = "none" }) {
  if (!items || items.length === 0) {
    return <span className="text-sm text-muted-foreground">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <Badge key={v} variant="secondary" className="font-mono text-xs">{v}</Badge>
      ))}
    </div>
  );
}

function ResolveProbe({ initial }) {
  const [host, setHost] = useState("github.com");
  const probe = useMutation({ mutationFn: (h) => admin.environment(h) });
  const result = probe.data?.resolve || initial;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="github.com"
          className="h-9 max-w-xs font-mono text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") probe.mutate(host); }}
        />
        <Button size="sm" variant="outline" disabled={probe.isPending} onClick={() => probe.mutate(host)}>
          {probe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ml-2">Test lookup</span>
        </Button>
      </div>

      {result && (
        <div className="flex items-start gap-2 text-sm">
          {result.ok ? (
            <>
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span className="text-muted-foreground">
                <span className="font-mono text-foreground">{result.host}</span> resolved in {result.duration_ms}ms —{" "}
                <span className="font-mono text-foreground">{result.addresses.join(", ")}</span>
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="text-muted-foreground">
                <span className="font-mono text-foreground">{result.host}</span> failed —{" "}
                <span className="text-destructive">{result.error}</span>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminEnvironment() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-environment"],
    queryFn: () => admin.environment(),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const variables = data?.variables || [];
  const dns = data?.dns || {};
  const noUpstreams = (dns.upstreams || []).length === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Name resolution</CardTitle>
          </div>
          <CardDescription>
            How this container resolves external hostnames. Upstream resolvers come from the host's
            resolv.conf or an explicit <span className="font-mono">dns:</span> config
            (<span className="font-mono">NINETEEN_DNS</span> / <span className="font-mono">NINETEEN_DNS_FALLBACK</span>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {noUpstreams && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="text-muted-foreground">
                <span className="font-medium text-destructive">No upstream resolvers.</span> The embedded
                resolver at <span className="font-mono">127.0.0.11</span> has nothing to forward to, so every
                external lookup fails. Set <span className="font-mono">dns:</span> on the container or fix the
                host's <span className="font-mono">/etc/resolv.conf</span>.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Upstream resolvers</p>
              <Chips items={dns.upstreams} empty="none — lookups will fail" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Nameservers in effect</p>
              <Chips items={dns.nameservers} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Search domains</p>
              <Chips items={dns.search_domains} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Options</p>
              <Chips items={dns.options} />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <ResolveProbe initial={data?.resolve} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Environment variables</CardTitle>
          </div>
          <CardDescription>
            The environment this container was started with, read-only. Secret values are never shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variable</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">/etc/resolv.conf</CardTitle>
          <CardDescription>The exact resolver configuration Docker wrote into this container.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {dns.resolv_conf || "(unreadable)"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
