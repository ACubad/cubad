"use client";

import { useLang } from "@/lib/i18n";
import type { ChartSpec } from "@/lib/types";
import { Md } from "./Md";

const PALETTE = ["#0e5a6d", "#a13a31", "#955f14", "#2f7d4f", "#5b4a9e", "#b05c8a"];

const W = 680;
const H = 420;
const M = { top: 20, right: 24, bottom: 56, left: 70 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;

function niceTicks(min: number, max: number, count = 6): number[] {
  if (min === max) {
    max = min + 1;
    min = min - 1;
  }
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = span / count / step0;
  const step = step0 * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 1e6; v += step) {
    ticks.push(Math.round(v * 1e9) / 1e9);
  }
  return ticks;
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const sparse = hi - lo > 3;
  for (let e = lo; e <= hi; e++) {
    for (const m of sparse ? [1] : [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= min / 1.001 && v <= max * 1.001) ticks.push(v);
    }
  }
  return ticks;
}

function fmt(v: number): string {
  if (v === 0) return "0";
  const av = Math.abs(v);
  if (av >= 1e6) return `${v / 1e6}M`;
  if (av >= 10000) return `${Math.round(v / 1000)}k`;
  if (av < 0.01) return v.toExponential(0);
  return String(Math.round(v * 1000) / 1000);
}

export function Chart({ spec }: { spec: ChartSpec }) {
  const { bi } = useLang();

  const allPts = spec.series.flatMap((s) => s.points);
  if (allPts.length === 0) return null;

  const xs = allPts.map((p) => p[0]);
  const ys = allPts.map((p) => p[1]);

  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys, 0);
  let yMax = Math.max(...ys);

  if (spec.logX) {
    const pos = xs.filter((v) => v > 0);
    xMin = Math.min(...pos);
    xMax = Math.max(...pos);
  }
  if (spec.logY) {
    const pos = ys.filter((v) => v > 0);
    yMin = Math.min(...pos);
    yMax = Math.max(...pos);
  }

  // padding
  if (!spec.logX) {
    const hasBars = spec.series.some((s) => s.kind === "bar");
    const pad = (xMax - xMin || 1) * (hasBars ? 0.08 : 0.04);
    xMin = hasBars ? Math.max(0, xMin - pad) : xMin - pad;
    xMax = xMax + pad;
  } else {
    xMin = xMin / 1.15;
    xMax = xMax * 1.15;
  }
  if (!spec.logY) {
    yMax = yMax + (yMax - yMin || 1) * 0.08;
  } else {
    yMin = yMin / 1.3;
    yMax = yMax * 1.3;
  }

  const sx = (v: number) =>
    M.left +
    (spec.logX
      ? ((Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * IW
      : ((v - xMin) / (xMax - xMin)) * IW);
  const sy = (v: number) =>
    M.top +
    IH -
    (spec.logY
      ? ((Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * IH
      : ((v - yMin) / (yMax - yMin)) * IH);

  const xTicks = spec.logX ? logTicks(xMin, xMax) : niceTicks(xMin, xMax, 7);
  const yTicks = spec.logY ? logTicks(yMin, yMax) : niceTicks(yMin, yMax, 6);

  // default bar width: 80% of the smallest gap between consecutive x values
  const barSeries = spec.series.filter((s) => s.kind === "bar");
  let defaultBarW = IW / 12;
  if (barSeries.length > 0) {
    const bx = [...new Set(barSeries.flatMap((s) => s.points.map((p) => p[0])))].sort(
      (a, b) => a - b
    );
    if (bx.length > 1) {
      let gap = Infinity;
      for (let i = 1; i < bx.length; i++) gap = Math.min(gap, bx[i] - bx[i - 1]);
      defaultBarW = Math.abs(sx(xMin + gap) - sx(xMin)) * 0.85;
    }
  }

  return (
    <figure className="w-full">
      <figcaption className="mb-1 text-sm font-medium text-ink-soft">
        {bi(spec.title)}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={bi(spec.title)}
        className="w-full rounded-xl border border-line bg-card"
      >
        {/* grid + ticks */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={sy(v)}
              y2={sy(v)}
              stroke="#e8e2d2"
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={sy(v) + 4}
              textAnchor="end"
              fontSize={12}
              fill="#8a97a0"
            >
              {fmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line
              x1={sx(v)}
              x2={sx(v)}
              y1={M.top}
              y2={H - M.bottom}
              stroke="#f0ebdd"
              strokeWidth={1}
            />
            <text
              x={sx(v)}
              y={H - M.bottom + 18}
              textAnchor="middle"
              fontSize={12}
              fill="#8a97a0"
            >
              {fmt(v)}
            </text>
          </g>
        ))}

        {/* axes */}
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke="#1c2b33" strokeWidth={1.4} />
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="#1c2b33" strokeWidth={1.4} />

        {/* axis labels */}
        <text x={M.left + IW / 2} y={H - 10} textAnchor="middle" fontSize={13} fill="#52626b">
          {spec.xLabel}
        </text>
        <text
          x={16}
          y={M.top + IH / 2}
          textAnchor="middle"
          fontSize={13}
          fill="#52626b"
          transform={`rotate(-90 16 ${M.top + IH / 2})`}
        >
          {spec.yLabel}
        </text>

        {/* series */}
        {spec.series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          if (s.kind === "bar") {
            return (
              <g key={s.name}>
                {s.points.map(([x, y], i) => {
                  const bw = spec.barWidths?.[i]
                    ? Math.abs(sx(xMin + spec.barWidths[i]) - sx(xMin)) * 0.95
                    : defaultBarW;
                  const y0 = sy(Math.max(0, yMin));
                  return (
                    <rect
                      key={i}
                      x={sx(x) - bw / 2}
                      y={sy(y)}
                      width={bw}
                      height={Math.max(0, y0 - sy(y))}
                      fill={color}
                      fillOpacity={0.75}
                      stroke={color}
                    />
                  );
                })}
              </g>
            );
          }
          const d = s.points
            .map(([x, y], i) => `${i === 0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
            .join(" ");
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
              {s.points.map(([x, y], i) => (
                <circle key={i} cx={sx(x)} cy={sy(y)} r={3} fill={color} />
              ))}
            </g>
          );
        })}

        {/* annotations */}
        {spec.annotations?.map((a, i) => (
          <g key={i}>
            <line
              x1={M.left}
              x2={sx(a.x)}
              y1={sy(a.y)}
              y2={sy(a.y)}
              stroke="#a13a31"
              strokeWidth={1.2}
              strokeDasharray="5 4"
            />
            <line
              x1={sx(a.x)}
              x2={sx(a.x)}
              y1={sy(a.y)}
              y2={H - M.bottom}
              stroke="#a13a31"
              strokeWidth={1.2}
              strokeDasharray="5 4"
            />
            <circle cx={sx(a.x)} cy={sy(a.y)} r={5} fill="#a13a31" fillOpacity={0.9} />
            <text
              x={Math.min(sx(a.x) + 8, W - M.right - 4)}
              y={sy(a.y) - 8}
              fontSize={12.5}
              fontWeight={600}
              fill="#a13a31"
            >
              {bi(a.label)}
            </text>
          </g>
        ))}
      </svg>

      {/* legend */}
      {spec.series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          {spec.series.map((s, si) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: PALETTE[si % PALETTE.length] }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      {/* drawing instructions + interpretation */}
      {(spec.howToDraw || spec.whatItShows) && (
        <div className="mt-3 space-y-2">
          {spec.howToDraw && (
            <details className="group rounded-xl border border-amber/25 bg-amber-soft px-4 py-2.5">
              <summary className="cursor-pointer list-none text-[13px] font-semibold uppercase tracking-wide text-amber">
                ✏️ {bi({ tr: "Bu grafik nasıl çizilir?", en: "How to draw this graph" })}
              </summary>
              <div className="mt-2 border-t border-amber/20 pt-2">
                <Md className="text-sm">{bi(spec.howToDraw)}</Md>
              </div>
            </details>
          )}
          {spec.whatItShows && (
            <details className="group rounded-xl border border-deniz/25 bg-deniz-soft px-4 py-2.5">
              <summary className="cursor-pointer list-none text-[13px] font-semibold uppercase tracking-wide text-deniz">
                👁 {bi({ tr: "Bu grafik ne anlatıyor?", en: "What this graph shows" })}
              </summary>
              <div className="mt-2 border-t border-deniz/20 pt-2">
                <Md className="text-sm">{bi(spec.whatItShows)}</Md>
              </div>
            </details>
          )}
        </div>
      )}
    </figure>
  );
}
