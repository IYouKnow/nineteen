import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ZoomIn, ZoomOut, Maximize2, Plus, Workflow } from "lucide-react";
import CanvasNode from "./CanvasNode";
import { getRole } from "@/lib/architecture";
import { getFramework } from "@/lib/devStatus";
import { getAutomationType } from "@/lib/automations";

const W = 10000;
const ORIGIN = 5000;
const ROLE_STROKE = {
  info: "hsl(var(--info))",
  warning: "hsl(var(--warning))",
  success: "hsl(var(--success))",
  muted: "hsl(var(--muted-foreground))",
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const slug = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, "-");

function buildGraph(project, connections, automations = []) {
  const nodes = [
    {
      id: "app",
      kind: "app",
      label: project.name,
      sub: `${getFramework(project.framework).label} · application`,
      framework: project.framework,
      status: project.status,
    },
  ];
  const edges = [];
  const dbNode = {};

  for (const c of connections) {
    if (c.role === "backup") continue;
    const id = `db-${c.databaseId}`;
    dbNode[c.databaseId] = id;
    nodes.push({
      id,
      kind: "db",
      databaseId: c.databaseId,
      label: c.name,
      type: c.type,
      status: c.status,
      version: c.version,
      role: c.role,
      sharedWith: c.sharedWith || [],
      scope: c.scope,
      selectedTables: c.selectedTables,
    });
    edges.push({ id: `e-app-${c.id}`, from: "app", to: id, role: c.role, label: getRole(c.role).verb });
  }

  for (const c of connections) {
    if (c.role !== "backup") continue;
    const id = `db-${c.databaseId}`;
    nodes.push({
      id,
      kind: "db",
      databaseId: c.databaseId,
      label: c.name,
      type: c.type,
      status: c.status,
      version: c.version,
      role: "backup",
      scope: c.scope,
      selectedTables: c.selectedTables,
    });
    const src = c.backupOf && dbNode[c.backupOf.id];
    edges.push({ id: `e-bk-${c.id}`, from: src || "app", to: id, role: "backup", label: "backs up" });
  }

  for (const c of connections) {
    if (c.role !== "shared" || !c.sharedWith?.length) continue;
    const from = dbNode[c.databaseId];
    if (!from) continue;
    for (const p of c.sharedWith) {
      const id = `proj-${slug(p)}`;
      if (!nodes.find((n) => n.id === id)) nodes.push({ id, kind: "project", label: p });
      edges.push({ id: `e-sh-${c.id}-${slug(p)}`, from, to: id, role: "shared", label: "shared with" });
    }
  }

  const destRoleFor = (t) => (t === "cache" ? "cache" : t === "backup" || t === "db_backup" ? "backup" : "service");
  for (const a of automations) {
    const meta = getAutomationType(a.type);
    const srcId = a.sourceType === "application" ? "app" : `db-${a.sourceId}`;
    if (a.sourceType !== "application" && !nodes.find((n) => n.id === srcId)) {
      nodes.push({
        id: srcId,
        kind: "db",
        databaseId: a.sourceId,
        label: a.sourceName,
        type: a.sourceDbType,
        status: a.sourceStatus || "running",
        version: a.sourceVersion,
        role: "primary",
      });
    }
    const destId = `db-${a.destinationId}`;
    if (!nodes.find((n) => n.id === destId)) {
      nodes.push({
        id: destId,
        kind: "db",
        databaseId: a.destinationId,
        label: a.destinationName,
        type: a.destinationType,
        status: a.destinationStatus || "running",
        version: a.destinationVersion,
        role: destRoleFor(a.type),
      });
    }
    const actionId = `auto-${a.id}`;
    nodes.push({ id: actionId, kind: "automation", automationId: a.id, aIcon: meta.icon, label: meta.label, status: a.status });
    edges.push({ id: `e-a1-${a.id}`, from: srcId, to: actionId, role: a.type, label: "", auto: true });
    edges.push({ id: `e-a2-${a.id}`, from: actionId, to: destId, role: a.type, label: "", auto: true });
  }

  return { nodes, edges };
}

export default function ArchitectureCanvas({ project, connections, automations, onRemove, onAddClick, onAddAutomation, onOpenAutomation, onOpenLogs }) {
  const navigate = useNavigate();
  const viewportRef = useRef(null);
  const interaction = useRef({ mode: null });
  const fittedRef = useRef(false);
  const [transform, setTransform] = useState({ s: 1, tx: 0, ty: 0 });
  const [positions, setPositions] = useState({});
  const [selected, setSelected] = useState(null);

  const { nodes, edges } = useMemo(() => buildGraph(project, connections, automations), [project, connections, automations]);

  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      if (!next["app"]) next["app"] = { x: 0, y: 0 };
      const appEdges = edges.filter((e) => e.from === "app");
      const n = appEdges.length || 1;
      let i = 0;
      for (const e of appEdges) {
        if (!next[e.to]) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          next[e.to] = { x: Math.cos(a) * 260, y: Math.sin(a) * 260 };
        }
        i++;
      }
      for (const e of edges) {
        if (e.role === "backup" && !next[e.to]) {
          const s = next[e.from] || { x: 260, y: 0 };
          const len = Math.hypot(s.x, s.y) || 1;
          next[e.to] = { x: s.x + (s.x / len) * 210, y: s.y + (s.y / len) * 210 };
        }
      }
      for (const e of edges) {
        if (e.role === "shared" && e.from !== "app" && !next[e.to]) {
          const d = next[e.from] || { x: 260, y: 0 };
          next[e.to] = { x: d.x + 170, y: d.y + ((i++ % 3) - 1) * 70 };
        }
      }
      // any remaining unpositioned resource nodes (e.g. automation-only dbs)
      nodes.forEach((node) => {
        if (node.id !== "app" && node.kind !== "automation" && !next[node.id]) {
          const a = (i++ / Math.max(1, nodes.length)) * Math.PI * 2;
          next[node.id] = { x: Math.cos(a) * 360, y: Math.sin(a) * 360 };
        }
      });
      // automation action nodes sit at the midpoint between source and destination
      nodes.forEach((node) => {
        if (node.kind === "automation" && !next[node.id]) {
          const ie = edges.find((e) => e.to === node.id);
          const oe = edges.find((e) => e.from === node.id);
          const s = ie && next[ie.from];
          const d = oe && next[oe.to];
          if (s && d) next[node.id] = { x: (s.x + d.x) / 2, y: (s.y + d.y) / 2 };
          else next[node.id] = next[ie?.from] || { x: 300, y: 0 };
        }
      });
      return next;
    });
  }, [nodes, edges]);

  const fit = () => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pts = nodes.map((n) => positions[n.id]).filter(Boolean);
    if (!pts.length) {
      setTransform({ s: 1, tx: r.width / 2, ty: r.height / 2 });
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 120;
    const maxX = Math.max(...xs) + 120;
    const minY = Math.min(...ys) - 70;
    const maxY = Math.max(...ys) + 70;
    const w = maxX - minX;
    const h = maxY - minY;
    const s2 = clamp(Math.min((r.width - 120) / w, (r.height - 120) / h), 0.3, 1.2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setTransform({ s: s2, tx: r.width / 2 - cx * s2, ty: r.height / 2 - cy * s2 });
  };

  // initial center
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTransform({ s: 1, tx: r.width / 2, ty: r.height / 2 });
  }, []);

  // auto-fit once nodes are laid out
  useEffect(() => {
    if (fittedRef.current) return;
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || Object.keys(positions).length === 0) return;
    fittedRef.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  // wheel zoom (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const s2 = clamp(t.s * factor, 0.3, 2.5);
        const wx = (cx - t.tx) / t.s;
        const wy = (cy - t.ty) / t.s;
        return { s: s2, tx: cx - wx * s2, ty: cy - wy * s2 };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onViewportDown = (e) => {
    if (e.target.closest?.("[data-node]")) return;
    interaction.current = { mode: "pan", sx: e.clientX, sy: e.clientY, tx: transform.tx, ty: transform.ty, moved: false };
    viewportRef.current.setPointerCapture(e.pointerId);
    setSelected(null);
  };

  const onNodeDown = (e, node) => {
    e.stopPropagation();
    const p = positions[node.id] || { x: 0, y: 0 };
    interaction.current = { mode: "node", id: node.id, sx: e.clientX, sy: e.clientY, px: p.x, py: p.y, moved: false };
    viewportRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    const it = interaction.current;
    if (!it.mode) return;
    const dx = e.clientX - it.sx;
    const dy = e.clientY - it.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) it.moved = true;
    if (it.mode === "pan") {
      setTransform((t) => ({ ...t, tx: it.tx + dx, ty: it.ty + dy }));
    } else if (it.mode === "node") {
      const nx = it.px + dx / transform.s;
      const ny = it.py + dy / transform.s;
      setPositions((p) => ({ ...p, [it.id]: { x: nx, y: ny } }));
    }
  };

  const onUp = (e) => {
    const it = interaction.current;
    if (it.mode === "node" && !it.moved) {
      const node = nodes.find((n) => n.id === it.id);
      if (node?.kind === "automation" && onOpenAutomation) onOpenAutomation(node.automationId);
      else setSelected(it.id);
    }
    interaction.current = { mode: null };
    try {
      viewportRef.current.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const zoomBy = (f) => {
    const el = viewportRef.current;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    setTransform((t) => {
      const s2 = clamp(t.s * f, 0.3, 2.5);
      const wx = (cx - t.tx) / t.s;
      const wy = (cy - t.ty) / t.s;
      return { s: s2, tx: cx - wx * s2, ty: cy - wy * s2 };
    });
  };

  const openNode = (node) => {
    if (node.kind === "db") navigate(`/databases/${node.databaseId}`);
    else if (node.kind === "automation" && onOpenAutomation) onOpenAutomation(node.automationId);
    else if (node.kind === "app" && onOpenLogs) onOpenLogs();
  };
  const removeNode = (node) => {
    const conn = connections.find((c) => c.databaseId === node.databaseId);
    if (conn) onRemove(conn);
  };

  return (
    <div
      ref={viewportRef}
      className="relative h-[600px] touch-none select-none overflow-hidden rounded-lg border border-border bg-card/30"
      onPointerDown={onViewportDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <div className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-30" />

      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${transform.tx}px,${transform.ty}px) scale(${transform.s})`, transformOrigin: "0 0" }}
      >
        <svg
          style={{ position: "absolute", left: -ORIGIN, top: -ORIGIN, width: W, height: W, pointerEvents: "none", overflow: "visible" }}
          viewBox={`${-ORIGIN} ${-ORIGIN} ${W} ${W}`}
        >
          {edges.map((edge) => {
            const a = positions[edge.from];
            const b = positions[edge.to];
            if (!a || !b) return null;
            const isAuto = edge.auto;
            const stroke = isAuto
              ? "hsl(var(--warning))"
              : ROLE_STROKE[getRole(edge.role).tone] || "hsl(var(--border))";
            return (
              <line
                key={edge.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={1.5}
                strokeDasharray={isAuto || edge.role === "backup" ? "5 5" : undefined}
                opacity={0.7}
              />
            );
          })}
        </svg>

        {edges.map((edge) => {
          if (!edge.label) return null;
          const a = positions[edge.from];
          const b = positions[edge.to];
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <div
              key={edge.id}
              className="absolute"
              style={{ left: mx, top: my, transform: "translate(-50%,-50%)", pointerEvents: "none" }}
            >
              <span className="whitespace-nowrap rounded-full border border-border bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                {edge.label}
              </span>
            </div>
          );
        })}

        {nodes.map((node) => {
          const p = positions[node.id];
          if (!p) return null;
          return (
            <div
              key={node.id}
              data-node
              className="absolute animate-fade-in"
              style={{ left: p.x, top: p.y, transform: "translate(-50%,-50%)" }}
              onPointerDown={(e) => onNodeDown(e, node)}
              onDoubleClick={() => openNode(node)}
            >
              <CanvasNode node={node} selected={selected === node.id} onOpen={openNode} onRemove={removeNode} onOpenLogs={onOpenLogs} />
            </div>
          );
        })}
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.15)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="px-1 text-[10px] tabular-nums text-muted-foreground">{Math.round(transform.s * 100)}%</span>
          <button
            type="button"
            onClick={() => zoomBy(1.15)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fit}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Fit to viewport"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
        <button
          type="button"
          onClick={onAddAutomation}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 text-xs font-medium text-warning shadow-sm hover:bg-warning/20"
        >
          <Workflow className="h-3.5 w-3.5" /> Automate
        </button>
      </div>

      {connections.length === 0 && automations.length === 0 && (
        <div className="absolute inset-x-0 bottom-6 flex justify-center">
          <div className="max-w-xs rounded-lg border border-dashed border-border bg-background/85 px-5 py-4 text-center shadow-sm">
            <p className="text-sm font-medium text-foreground">No infrastructure connected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a database, cache or backup to map how your app connects to its services.
            </p>
            <button
              type="button"
              onClick={onAddClick}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Add service
            </button>
          </div>
        </div>
      )}
    </div>
  );
}