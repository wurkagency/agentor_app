'use client';

import '@xyflow/react/dist/style.css';
import { manifestFor, type Entity } from '@agentor/connectors';
import type { Finding, FlowDefinition, Route } from '@agentor/flows';
import { cn, ConnectorLogo, Icon, ModeBadge } from '@agentor/ui';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { routeLabel, type ConnMap } from './model';

interface NodeData extends Record<string, unknown> {
  nodeId: string;
  role: 'source' | 'destination';
  connectionId: string;
  def: FlowDefinition;
  conns: ConnMap;
  findings: Finding[];
  selectedRouteId: string | null;
  readOnly: boolean;
}

const NODE_W = 220;
const PORT_H = 30;
const HEAD_H = 56;

function nodeHeight(def: FlowDefinition, conns: ConnMap, nodeId: string) {
  const n = def.nodes.find((x) => x.id === nodeId);
  const m = n ? manifestFor(conns[n.connectionId]?.connectorId ?? '') : null;
  const ports = n?.role === 'source' ? (m?.outputs.length ?? 1) : (m?.inputs.length ?? 1);
  return HEAD_H + ports * PORT_H + 8;
}

function FlowNodeView({ data }: NodeProps<Node<NodeData>>) {
  const t = useTranslations('editor');
  const tm = useTranslations('mode');
  const c = data.conns[data.connectionId];
  const m = c ? manifestFor(c.connectorId) : null;
  const ports = data.role === 'source' ? (m?.outputs ?? []) : (m?.inputs ?? []);
  const routes = data.def.routes.filter(
    (r) => (data.role === 'source' ? r.from : r.to) === data.nodeId,
  );
  const errors = data.findings.filter(
    (f) =>
      f.severity === 'error' &&
      (f.nodeId === data.nodeId || routes.some((r) => r.id === f.routeId)),
  ).length;
  const warnings = data.findings.filter(
    (f) => f.severity === 'warning' && routes.some((r) => r.id === f.routeId),
  ).length;
  return (
    <div
      className={cn(
        'relative rounded-md bg-surface shadow-card box-border',
        errors > 0 && 'shadow-ring-error-2',
      )}
      style={{ width: NODE_W }}
    >
      {(errors > 0 || warnings > 0) && (
        <span
          className={cn(
            'absolute -right-2 -top-2 grid size-5 place-items-center rounded-full text-micro font-semibold',
            errors > 0 ? 'bg-error-fg text-white' : 'border border-warn-fg bg-warn-bg text-warn-fg',
          )}
          aria-label={t('nodeFindings', { count: errors + warnings })}
        >
          {errors + warnings}
        </span>
      )}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3 shadow-hairline-b">
        {m && <ConnectorLogo connector={{ name: m.name, logoUrl: m.logo }} size={24} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-table font-semibold">{m?.name}</span>
          <span className="truncate text-micro text-fg-2">{c?.name}</span>
        </div>
        <span
          className={cn('size-2 rounded-full', c?.status === 'broken' ? 'bg-error-fg' : 'bg-ok-fg')}
          aria-label={c?.status === 'broken' ? t('connectionBroken') : t('connectionOk')}
        />
      </div>
      <ul className="m-0 list-none p-0 py-1">
        {ports.map((p) => {
          const own = routes.filter(
            (r) => (data.role === 'source' ? r.entity : r.targetEntity) === p.entity,
          );
          const route = own[0];
          const selected = own.some((r) => r.id === data.selectedRouteId);
          return (
            <li
              key={p.entity}
              className={cn(
                'relative flex items-center justify-between gap-2 px-3 text-micro',
                selected && 'bg-row-hover font-semibold',
                own.length === 0 && 'text-fg-2',
              )}
              style={{ height: PORT_H }}
            >
              {data.role === 'destination' && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`in:${p.entity}`}
                  isConnectable={!data.readOnly}
                  className="!size-2.5 !border-2 !border-white !bg-fg-1"
                />
              )}
              <span className="font-medium">{p.label}</span>
              {data.role === 'destination' ? (
                route ? (
                  <ModeBadge mode={route.mode} small>
                    {route.paused ? t('pausedShort') : tm(route.mode)}
                  </ModeBadge>
                ) : (
                  <span className="text-fg-2">{t('free')}</span>
                )
              ) : own.length > 1 ? (
                <span className="text-fg-2">{t('routesCount', { count: own.length })}</span>
              ) : null}
              {data.role === 'source' && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`out:${p.entity}`}
                  isConnectable={!data.readOnly}
                  className="!size-2.5 !border-2 !border-white !bg-fg-1"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface EdgeData extends Record<string, unknown> {
  route: Route;
  label: string;
  selected: boolean;
  hasError: boolean;
  onSelect: (id: string) => void;
}

function RouteEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const t = useTranslations('editor');
  const [path, lx, ly] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  if (!data) return null;
  const r = data.route;
  const dash = r.paused ? '2 6' : r.mode === 'test' ? '6 5' : undefined;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: data.selected
            ? 'var(--color-primary)'
            : data.hasError
              ? 'var(--color-error-fg)'
              : 'var(--color-fg-2)',
          strokeWidth: data.selected ? 4 : 1.5,
          strokeDasharray: dash,
          opacity: r.paused ? 0.6 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => data.onSelect(r.id)}
          aria-label={t('selectRoute', { route: data.label })}
          aria-pressed={data.selected}
          className={cn(
            'nodrag nopan pointer-events-auto absolute grid size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 p-0',
            data.hasError ? 'bg-error-bg text-error-fg' : 'bg-transparent',
          )}
          style={{ left: lx, top: ly }}
        >
          {data.hasError ? (
            <Icon icon={CircleAlert} size={14} />
          ) : (
            <span className="size-2 rounded-full bg-white shadow-ring-chip" />
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { flow: FlowNodeView };
const edgeTypes = { route: RouteEdge };

export interface CanvasProps {
  def: FlowDefinition;
  conns: ConnMap;
  findings: Finding[];
  selectedRouteId: string | null;
  readOnly: boolean;
  onSelectRoute: (id: string | null) => void;
  onConnect: (from: string, entity: Entity, to: string, targetEntity: Entity) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
}

/** Default layout: the source left, destinations stacked on the right (auto-layout, §5.1). */
export function autoLayout(def: FlowDefinition, conns: ConnMap) {
  const out: Record<string, { x: number; y: number }> = {};
  const dests = def.nodes.filter((n) => n.role === 'destination');
  let y = 0;
  for (const d of dests) {
    out[d.id] = { x: 420, y };
    y += nodeHeight(def, conns, d.id) + 32;
  }
  const src = def.nodes.find((n) => n.role === 'source');
  if (src)
    out[src.id] = { x: 0, y: Math.max(0, (y - 32) / 2 - nodeHeight(def, conns, src.id) / 2) };
  return out;
}

/** ELK layered layout, left to right; positions the user dragged are kept (§5.1). */
async function elkLayout(def: FlowDefinition, conns: ConnMap) {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '32',
      'elk.layered.spacing.nodeNodeBetweenLayers': '200',
    },
    children: def.nodes.map((n) => ({
      id: n.id,
      width: NODE_W,
      height: nodeHeight(def, conns, n.id),
    })),
    edges: def.routes.map((r) => ({ id: r.id, sources: [r.from], targets: [r.to] })),
  });
  return Object.fromEntries(
    (graph.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
  );
}

function CanvasInner(props: CanvasProps) {
  const t = useTranslations('editor');
  const { fitView } = useReactFlow();
  const fallback = useMemo(() => autoLayout(props.def, props.conns), [props.def, props.conns]);
  const [elk, setElk] = useState<Record<string, { x: number; y: number }> | null>(null);
  const shape =
    props.def.nodes.map((n) => n.id).join(',') +
    '|' +
    props.def.routes.map((r) => `${r.from}>${r.to}`).join(',');
  useEffect(() => {
    let alive = true;
    void elkLayout(props.def, props.conns)
      .then((l) => alive && setElk(l))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Re-layout only when nodes or connections between them change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  const layout = elk ?? fallback;
  const [zoom, setZoom] = useState(1);

  const nodes: Node<NodeData>[] = props.def.nodes.map((n) => ({
    id: n.id,
    type: 'flow',
    position: n.position ?? layout[n.id] ?? { x: 0, y: 0 },
    draggable: !props.readOnly,
    data: {
      nodeId: n.id,
      role: n.role,
      connectionId: n.connectionId,
      def: props.def,
      conns: props.conns,
      findings: props.findings,
      selectedRouteId: props.selectedRouteId,
      readOnly: props.readOnly,
    },
  }));
  const edges: Edge<EdgeData>[] = props.def.routes.map((r) => ({
    id: r.id,
    type: 'route',
    source: r.from,
    target: r.to,
    sourceHandle: `out:${r.entity}`,
    targetHandle: `in:${r.targetEntity}`,
    data: {
      route: r,
      label: routeLabel(props.def, props.conns, r),
      selected: r.id === props.selectedRouteId,
      hasError: props.findings.some((f) => f.routeId === r.id && f.severity === 'error'),
      onSelect: props.onSelectRoute,
    },
  }));

  // Fit again when the layout arrives or the pane resizes (the inspector opens and closes).
  const paneWidth = useStore((s) => s.width);
  useEffect(() => {
    const id = setTimeout(() => void fitView({ padding: 0.2, duration: 0 }), 50);
    return () => clearTimeout(id);
  }, [props.def.nodes.length, elk, paneWidth, fitView]);

  // Incompatible ports are refused while dragging: only same entity, source → destination.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const from = String(c.sourceHandle ?? '').replace('out:', '');
      const to = String(c.targetHandle ?? '').replace('in:', '');
      const exists = props.def.routes.some(
        (r) =>
          r.from === c.source && r.to === c.target && r.entity === from && r.targetEntity === to,
      );
      return from === to && !exists;
    },
    [props.def.routes],
  );

  return (
    <div className="relative size-full" role="application" aria-label={t('canvasLabel')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={!props.readOnly}
        isValidConnection={isValidConnection}
        onConnect={(c) => {
          if (!c.source || !c.target) return;
          props.onConnect(
            c.source,
            String(c.sourceHandle).replace('out:', '') as Entity,
            c.target,
            String(c.targetHandle).replace('in:', '') as Entity,
          );
        }}
        onEdgeClick={(_e, edge) => props.onSelectRoute(edge.id)}
        onPaneClick={() => props.onSelectRoute(null)}
        onNodeDragStop={(_e, n) =>
          props.onMoveNode(n.id, Math.round(n.position.x), Math.round(n.position.y))
        }
        onMove={(_e, vp) => setZoom(vp.zoom)}
        fitView
      >
        <Background gap={16} size={1} color="var(--color-border-strong)" />
        <Controls showInteractive={false} position="bottom-left" aria-label={t('zoom')} />
      </ReactFlow>
      <div className="pointer-events-none absolute left-4 top-4 flex gap-4 rounded-full bg-surface px-4 py-1.5 text-micro text-fg-1 shadow-sm">
        <span>— {t('legend.live')}</span>
        <span>- - - {t('legend.test')}</span>
        <span>· · · {t('legend.paused')}</span>
      </div>
      <span className="sr-only" aria-live="polite">
        {t('zoomLevel', { pct: Math.round(zoom * 100) })}
      </span>
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
