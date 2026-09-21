import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { admin } from "@/lib/api";
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
import { ScrollText, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 100;

const FILTERS = [
  { value: "all", label: "All events" },
  { value: "user.", label: "Auth / users" },
  { value: "admin.", label: "Admin actions" },
  { value: "http.", label: "Resource changes" },
];

function actionVariant(action) {
  if (action.includes("failed") || action.includes("blocked") || action.includes("delete")) return "destructive";
  if (action.startsWith("admin.")) return "default";
  if (action.startsWith("user.")) return "secondary";
  return "outline";
}

export default function AdminAudit() {
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);

  const { data: entries = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-audit", filter, offset],
    queryFn: () =>
      admin.audit({
        limit: PAGE_SIZE,
        offset,
        action: filter === "all" ? undefined : filter,
      }),
  });

  const canPrev = offset > 0;
  const canNext = entries.length === PAGE_SIZE;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {entries.length} event{entries.length === 1 ? "" : "s"}
                {canNext ? "+" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={filter}
                onValueChange={(v) => {
                  setFilter(v);
                  setOffset(0);
                }}
              >
                <SelectTrigger className="h-8 w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                Refresh
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No audit events.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant(e.action)} className="font-mono text-[11px]">
                        {e.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      {e.username || (e.user_id ? `#${e.user_id}` : "—")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.target_type ? `${e.target_type}${e.target_id ? ` #${e.target_id}` : ""}` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={e.details}>
                      {e.details || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.ip || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="mt-4 flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={!canPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">Offset {offset}</span>
            <Button variant="outline" size="sm" disabled={!canNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
              Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
