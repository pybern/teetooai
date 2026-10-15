"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { fmt, fmtCompact } from "@/lib/engine/format";
import type { ChartDatum, ChartSpec, NumberFormat, SeriesSpec } from "@/lib/types";

const PALETTE = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#fb923c", "#4ade80", "#e879f9"];
const AXIS = { fontSize: 11, fill: "#94a3b8" };
const GRID = "rgba(148,163,184,0.12)";

const colorOf = (s: SeriesSpec, i: number) => s.color ?? PALETTE[i % PALETTE.length];

type TooltipEntry = { dataKey?: string | number; value?: number | string | null; color?: string; payload?: ChartDatum };

function ChartTooltip({
  active,
  payload,
  label,
  spec,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  spec: ChartSpec;
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(spec.series.map((s) => [s.key, s]));
  const rows = payload.filter((p) => byKey.has(String(p.dataKey)) && p.value !== null && p.value !== undefined);
  const datum = payload[0]?.payload;
  const title = spec.type === "scatter" || spec.type === "treemap" || spec.type === "donut" ? String(datum?.label ?? label ?? "") : String(label ?? datum?.label ?? "");
  const band = spec.band && datum && typeof datum[spec.band.lowKey] === "number" && typeof datum[spec.band.highKey] === "number";
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
      {title && <div className="mb-1 font-medium text-slate-100">{title}</div>}
      {(spec.type === "treemap" || spec.type === "donut") && datum ? (
        <div className="flex items-center gap-2 text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ background: String(datum.__color ?? PALETTE[0]) }} />
          {fmt(Number(datum[spec.series[0].key]), spec.series[0].format ?? spec.format)}
          {datum.group && datum.group !== datum.label ? <span className="text-slate-500">· {String(datum.group)}</span> : null}
        </div>
      ) : (
        rows.map((p, i) => {
          const s = byKey.get(String(p.dataKey))!;
          return (
            <div key={i} className="flex items-center justify-between gap-4 text-slate-300">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: String(datum?.__color ?? p.color ?? s.color ?? PALETTE[i]) }} />
                {s.label}
              </span>
              <span className="font-mono text-slate-100">{fmt(Number(p.value), s.format ?? spec.format)}</span>
            </div>
          );
        })
      )}
      {band && datum && (
        <div className="mt-1 text-slate-500">
          90% range: {fmt(Number(datum[spec.band!.lowKey]), spec.format)} – {fmt(Number(datum[spec.band!.lowKey]) + Number(datum[spec.band!.highKey]), spec.format)}
        </div>
      )}
    </div>
  );
}

const tick = (f?: NumberFormat) => (v: number) => fmtCompact(v, f);

function categoryInterval(n: number): number | "preserveStartEnd" {
  return n > 24 ? Math.ceil(n / 10) - 1 : "preserveStartEnd";
}

export function ChartView({ spec, height }: { spec: ChartSpec; height?: number }) {
  const h = height ?? (spec.type === "hbar" ? Math.max(220, spec.data.length * 28 + 40) : spec.span === "full" ? 320 : 260);
  const tooltip = <Tooltip content={<ChartTooltip spec={spec} />} cursor={{ fill: "rgba(148,163,184,0.08)", stroke: "rgba(148,163,184,0.25)" }} />;
  const n = spec.data.length;

  const body = (() => {
    switch (spec.type) {
      case "area":
        return (
          <AreaChart data={spec.data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              {spec.series.map((s, i) => (
                <linearGradient key={s.key} id={`g-${spec.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={spec.xKey} tick={AXIS} tickLine={false} axisLine={false} interval={categoryInterval(n)} minTickGap={12} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(spec.format)} width={56} domain={["auto", "auto"]} />
            {tooltip}
            {spec.referenceY?.map((r) => (
              <ReferenceLine key={r.label} y={r.value} stroke="#64748b" strokeDasharray="4 4" label={{ value: r.label, fill: "#94a3b8", fontSize: 10, position: "insideTopRight" }} />
            ))}
            {spec.referenceX?.map((r) => (
              <ReferenceLine key={r.label} x={r.value} stroke="#fbbf24" strokeDasharray="3 3" label={{ value: r.label, fill: "#fbbf24", fontSize: 10, position: "insideTopLeft" }} />
            ))}
            {spec.series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s, i)} strokeWidth={2.2} fill={`url(#g-${spec.id}-${i})`} dot={n <= 16 ? { r: 2.5, fill: colorOf(s, i) } : false} activeDot={{ r: 4 }} />
            ))}
          </AreaChart>
        );
      case "line":
        return (
          <LineChart data={spec.data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={spec.xKey} tick={AXIS} tickLine={false} axisLine={false} interval={categoryInterval(n)} minTickGap={12} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(spec.format)} width={56} domain={["auto", "auto"]} />
            {tooltip}
            {spec.series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />}
            {spec.referenceY?.map((r) => (
              <ReferenceLine key={r.label} y={r.value} stroke="#64748b" strokeDasharray="4 4" />
            ))}
            {spec.series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s, i)} strokeWidth={2.2} dot={n <= 12 ? { r: 3 } : false} connectNulls strokeDasharray={s.dashed ? "6 4" : undefined} />
            ))}
          </LineChart>
        );
      case "bar":
        return (
          <BarChart data={spec.data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={spec.xKey} tick={AXIS} tickLine={false} axisLine={false} interval={categoryInterval(n)} minTickGap={6} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(spec.format)} width={56} />
            {tooltip}
            {spec.series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />}
            {spec.referenceY?.map((r) => (
              <ReferenceLine key={r.label} y={r.value} stroke="#64748b" strokeDasharray="4 4" label={{ value: r.label, fill: "#94a3b8", fontSize: 10, position: "insideTopRight" }} />
            ))}
            <ReferenceLine y={0} stroke="rgba(148,163,184,0.35)" />
            {spec.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s, i)} radius={[4, 4, 0, 0]} maxBarSize={48}>
                {spec.colorByKey && spec.series.length === 1 && spec.data.map((d, j) => <Cell key={j} fill={String(d[spec.colorByKey!] ?? colorOf(s, i))} />)}
                {n <= 8 && spec.series.length === 1 && (
                  <LabelList dataKey={s.key} position="top" formatter={(v: unknown) => fmtCompact(Number(v), s.format ?? spec.format)} style={{ fill: "#cbd5e1", fontSize: 11 }} />
                )}
              </Bar>
            ))}
          </BarChart>
        );
      case "hbar": {
        const s = spec.series[0];
        const longest = Math.max(...spec.data.map((d) => String(d[spec.xKey]).length));
        return (
          <BarChart data={spec.data} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(spec.format)} />
            <YAxis type="category" dataKey={spec.xKey} tick={{ ...AXIS, fill: "#cbd5e1" }} tickLine={false} axisLine={false} width={Math.min(170, Math.max(64, longest * 7))} interval={0} />
            {tooltip}
            <ReferenceLine x={0} stroke="rgba(148,163,184,0.35)" />
            <Bar dataKey={s.key} name={s.label} fill={colorOf(s, 0)} radius={[0, 4, 4, 0]} maxBarSize={22}>
              {spec.data.map((d, j) => (
                <Cell key={j} fill={String((spec.colorByKey && d[spec.colorByKey]) || colorOf(s, 0))} />
              ))}
              <LabelList dataKey={s.key} position="right" formatter={(v: unknown) => fmt(Number(v), s.format ?? spec.format)} style={{ fill: "#cbd5e1", fontSize: 11 }} />
            </Bar>
          </BarChart>
        );
      }
      case "donut": {
        const s = spec.series[0];
        const total = spec.data.reduce((a, d) => a + Number(d[s.key] ?? 0), 0);
        return (
          <PieChart>
            {tooltip}
            <Pie data={spec.data} dataKey={s.key} nameKey={spec.xKey} innerRadius="58%" outerRadius="88%" paddingAngle={1.5} stroke="none" cx="35%">
              {spec.data.map((d, j) => (
                <Cell key={j} fill={String(d.__color ?? PALETTE[j % PALETTE.length])} />
              ))}
            </Pie>
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: "#cbd5e1", maxWidth: "50%" }}
              formatter={(value: string, entry: { payload?: { value?: number } }) => (
                <span className="text-slate-300">
                  {value} <span className="text-slate-500">{total ? `${((Number(entry.payload?.value ?? 0) / total) * 100).toFixed(1)}%` : ""}</span>
                </span>
              )}
            />
          </PieChart>
        );
      }
      case "composed": {
        const hasRight = spec.series.some((s) => s.axis === "right");
        return (
          <ComposedChart data={spec.data} margin={{ top: 10, right: hasRight ? 4 : 12, left: 0, bottom: 0 }}>
            <defs>
              {spec.series.map((s, i) => (
                <linearGradient key={s.key} id={`cg-${spec.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={spec.xKey} tick={AXIS} tickLine={false} axisLine={false} interval={categoryInterval(n)} minTickGap={12} />
            <YAxis yAxisId="left" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(spec.format)} width={56} domain={["auto", "auto"]} />
            {hasRight && <YAxis yAxisId="right" orientation="right" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(spec.rightFormat)} width={52} domain={["auto", "auto"]} />}
            {tooltip}
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
            {spec.band && (
              <>
                <Area yAxisId="left" dataKey={spec.band.lowKey} stackId="band" stroke="none" fill="transparent" legendType="none" isAnimationActive={false} activeDot={false} />
                <Area yAxisId="left" dataKey={spec.band.highKey} stackId="band" stroke="none" fill="#fbbf24" fillOpacity={0.14} legendType="none" name="90% interval" activeDot={false} />
              </>
            )}
            {spec.referenceX?.map((r) => (
              <ReferenceLine key={r.label} yAxisId="left" x={r.value} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: r.label, fill: "#94a3b8", fontSize: 10, position: "insideTopLeft" }} />
            ))}
            {spec.series.map((s, i) => {
              const axis = s.axis === "right" ? "right" : "left";
              const c = colorOf(s, i);
              if (s.kind === "bar") return <Bar key={s.key} yAxisId={axis} dataKey={s.key} name={s.label} fill={c} radius={[4, 4, 0, 0]} maxBarSize={40} fillOpacity={0.85} />;
              if (s.kind === "area") return <Area key={s.key} yAxisId={axis} type="monotone" dataKey={s.key} name={s.label} stroke={c} strokeWidth={2.2} fill={`url(#cg-${spec.id}-${i})`} connectNulls={false} dot={false} />;
              if (s.kind === "scatter") return <Scatter key={s.key} yAxisId={axis} dataKey={s.key} name={s.label} fill={c} shape="circle" />;
              return <Line key={s.key} yAxisId={axis} type="monotone" dataKey={s.key} name={s.label} stroke={c} strokeWidth={2.4} strokeDasharray={s.dashed ? "6 4" : undefined} dot={n <= 16 ? { r: 3 } : false} connectNulls />;
            })}
          </ComposedChart>
        );
      }
      case "scatter": {
        const [sx, sy] = spec.series;
        const line = spec.highlightKey ? (JSON.parse(spec.highlightKey) as { x1: number; y1: number; x2: number; y2: number }) : null;
        return (
          <ScatterChart margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis type="number" dataKey="x" name={sx.label} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(sx.format)} domain={["auto", "auto"]} label={{ value: sx.label, position: "insideBottom", offset: -4, fill: "#64748b", fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name={sy.label} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tick(sy.format)} width={56} domain={["auto", "auto"]} />
            {tooltip}
            {line && (
              <ReferenceLine
                segment={[
                  { x: line.x1, y: line.y1 },
                  { x: line.x2, y: line.y2 },
                ]}
                stroke="#fbbf24"
                strokeDasharray="6 4"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              />
            )}
            <Scatter data={spec.data} fill={PALETTE[0]}>
              {spec.data.map((d, j) => (
                <Cell key={j} fill={String(d.__color ?? PALETTE[0])} />
              ))}
              {n <= 30 && <LabelList dataKey="label" position="top" style={{ fill: "#94a3b8", fontSize: 10 }} />}
            </Scatter>
          </ScatterChart>
        );
      }
      case "radar":
        return (
          <RadarChart data={spec.data} outerRadius="72%">
            <PolarGrid stroke={GRID} />
            <PolarAngleAxis dataKey={spec.xKey} tick={{ ...AXIS, fill: "#cbd5e1" }} />
            <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
            {tooltip}
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
            {spec.series.map((s, i) => (
              <Radar key={s.key} dataKey={s.key} name={s.label} stroke={colorOf(s, i)} fill={colorOf(s, i)} fillOpacity={s.key === "Median" ? 0.05 : 0.22} strokeWidth={2} strokeDasharray={s.key === "Median" ? "4 4" : undefined} />
            ))}
          </RadarChart>
        );
      case "treemap":
        return (
          <Treemap data={spec.data} dataKey={spec.series[0].key} nameKey={spec.xKey} stroke="#0b1020" isAnimationActive={false} content={<TreeCell format={spec.series[0].format ?? spec.format} />}>
            {tooltip}
          </Treemap>
        );
      default:
        return <div />;
    }
  })();

  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {body}
      </ResponsiveContainer>
    </div>
  );
}

type TreeCellProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  value?: number;
  depth?: number;
  __color?: string;
  payload?: { __color?: string };
  format?: NumberFormat;
};

function TreeCell(props: TreeCellProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, value, depth, format } = props;
  if (depth === 0) return null;
  const fill = props.__color ?? props.payload?.__color ?? PALETTE[0];
  const showName = width > 56 && height > 26;
  const showValue = width > 56 && height > 44;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={fill} fillOpacity={0.82} stroke="#0b1020" strokeWidth={2} />
      {showName && (
        <text x={x + 8} y={y + 18} fill="#0b1020" fontSize={12} fontWeight={600}>
          {String(name).length * 7 > width - 12 ? `${String(name).slice(0, Math.max(3, Math.floor((width - 16) / 7)))}…` : name}
        </text>
      )}
      {showValue && (
        <text x={x + 8} y={y + 34} fill="#0b1020" fillOpacity={0.75} fontSize={11}>
          {fmtCompact(Number(value), format)}
        </text>
      )}
    </g>
  );
}
