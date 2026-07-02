"use client";

import { useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { GraphStory as Story, StoryElement } from "@/lib/types";
import { Md } from "./Md";

const COLORS: Record<string, string> = {
  ink: "#1c2b33",
  deniz: "#0e5a6d",
  clay: "#a13a31",
  amber: "#955f14",
  moss: "#2f7d4f",
  faint: "#8a97a0",
};

const W = 680;
const H = 460;
const M = { top: 24, right: 24, bottom: 48, left: 56 };

function niceTicks(min: number, max: number, count = 6): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = span / count / step0;
  const step = step0 * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) {
    ticks.push(Math.round(v * 1e9) / 1e9);
  }
  return ticks;
}

export function GraphStory({ story }: { story: Story }) {
  const { t, bi } = useLang();
  const [frame, setFrame] = useState(0);

  const showAxes = story.showAxes !== false;
  const [xMin, xMax] = story.xDomain;
  const [yMin, yMax] = story.yDomain;

  // inner box, optionally aspect-preserving
  const { ix, iy, iw, ih } = useMemo(() => {
    let iw = W - M.left - M.right;
    let ih = H - M.top - M.bottom;
    let ix = M.left;
    let iy = M.top;
    if (story.square) {
      const dataRatio = (xMax - xMin) / (yMax - yMin || 1);
      if (iw / ih > dataRatio) {
        const w2 = ih * dataRatio;
        ix += (iw - w2) / 2;
        iw = w2;
      } else {
        const h2 = iw / dataRatio;
        iy += (ih - h2) / 2;
        ih = h2;
      }
    }
    return { ix, iy, iw, ih };
  }, [story.square, xMin, xMax, yMin, yMax]);

  const sx = (v: number) => ix + ((v - xMin) / (xMax - xMin || 1)) * iw;
  const sy = (v: number) => iy + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

  // visible elements at current frame (accumulate adds, honor removes)
  const visible = useMemo(() => {
    const els: { el: StoryElement; addedAt: number }[] = [];
    for (let f = 0; f <= frame && f < story.frames.length; f++) {
      for (const el of story.frames[f].add ?? []) {
        els.push({ el, addedAt: f });
      }
      for (const id of story.frames[f].remove ?? []) {
        const idx = els.findIndex((e) => e.el.id === id);
        if (idx >= 0) els.splice(idx, 1);
      }
    }
    return els;
  }, [story, frame]);

  const total = story.frames.length;
  const cur = story.frames[Math.min(frame, total - 1)];

  const renderEl = ({ el, addedAt }: { el: StoryElement; addedAt: number }, i: number) => {
    const color = COLORS[el.color ?? "deniz"];
    const isNew = addedAt === frame;
    const cls = isNew ? "rise-in" : "";
    const sw = el.width ?? 2;
    const dash = el.dash ? "6 5" : undefined;
    switch (el.type) {
      case "point":
        return (
          <g key={i} className={cls}>
            <circle cx={sx(el.x!)} cy={sy(el.y!)} r={4.5} fill={color} />
            {el.label && (
              <text x={sx(el.x!) + 7} y={sy(el.y!) - 7} fontSize={el.size ?? 13} fontWeight={600} fill={color}>
                {el.label}
              </text>
            )}
          </g>
        );
      case "line":
        return (
          <line key={i} className={cls} x1={sx(el.x1!)} y1={sy(el.y1!)} x2={sx(el.x2!)} y2={sy(el.y2!)}
            stroke={color} strokeWidth={sw} strokeDasharray={dash} strokeLinecap="round" />
        );
      case "arrow": {
        const x1 = sx(el.x1!), y1 = sy(el.y1!), x2 = sx(el.x2!), y2 = sy(el.y2!);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const a1 = ang + Math.PI * 0.85, a2 = ang - Math.PI * 0.85, r = 9;
        return (
          <g key={i} className={cls}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
            <path d={`M${x2},${y2} L${x2 + r * Math.cos(a1)},${y2 + r * Math.sin(a1)} M${x2},${y2} L${x2 + r * Math.cos(a2)},${y2 + r * Math.sin(a2)}`}
              stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
          </g>
        );
      }
      case "polyline":
      case "polygon": {
        const pts = (el.points ?? []).map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
        const Tag = el.type === "polygon" ? "polygon" : "polyline";
        return (
          <Tag key={i} className={cls} points={pts} stroke={color} strokeWidth={sw}
            strokeDasharray={dash} strokeLinejoin="round"
            fill={el.type === "polygon" && el.fill ? color : "none"}
            fillOpacity={el.type === "polygon" && el.fill ? 0.14 : undefined} />
        );
      }
      case "text":
        return (
          <text key={i} className={cls} x={sx(el.x!)} y={sy(el.y!)} fontSize={el.size ?? 13.5}
            fontWeight={600} fill={color} textAnchor="middle">
            {el.text ? bi(el.text) : el.label}
          </text>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-2xl border border-deniz/25 bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-deniz-deep">✏️ {bi(story.title)}</p>
        <span className="shrink-0 font-mono text-xs text-ink-faint">
          {Math.min(frame + 1, total)}/{total}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={bi(story.title)}
        className="w-full rounded-xl border border-line-soft bg-paper">
        {showAxes && (
          <>
            {niceTicks(yMin, yMax).map((v) => (
              <g key={`y${v}`}>
                <line x1={ix} x2={ix + iw} y1={sy(v)} y2={sy(v)} stroke="#eae4d4" strokeWidth={1} />
                <text x={ix - 7} y={sy(v) + 4} textAnchor="end" fontSize={11.5} fill="#8a97a0">{v}</text>
              </g>
            ))}
            {niceTicks(xMin, xMax).map((v) => (
              <g key={`x${v}`}>
                <line x1={sx(v)} x2={sx(v)} y1={iy} y2={iy + ih} stroke="#f0ebdd" strokeWidth={1} />
                <text x={sx(v)} y={iy + ih + 16} textAnchor="middle" fontSize={11.5} fill="#8a97a0">{v}</text>
              </g>
            ))}
            <line x1={ix} x2={ix} y1={iy} y2={iy + ih} stroke="#1c2b33" strokeWidth={1.3} />
            <line x1={ix} x2={ix + iw} y1={iy + ih} y2={iy + ih} stroke="#1c2b33" strokeWidth={1.3} />
            {story.xLabel && (
              <text x={ix + iw / 2} y={H - 8} textAnchor="middle" fontSize={12.5} fill="#52626b">{story.xLabel}</text>
            )}
            {story.yLabel && (
              <text x={14} y={iy + ih / 2} textAnchor="middle" fontSize={12.5} fill="#52626b"
                transform={`rotate(-90 14 ${iy + ih / 2})`}>{story.yLabel}</text>
            )}
          </>
        )}
        {visible.map(renderEl)}
      </svg>

      <div className="mt-3 rounded-xl bg-wash px-4 py-2.5 text-sm leading-relaxed text-ink" key={frame}>
        <div className="rise-in">
          <Md>{bi(cur.caption)}</Md>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => setFrame((f) => Math.max(0, f - 1))} disabled={frame === 0}
          className="rounded-full border border-line bg-card px-4 py-1.5 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40">
          ←
        </button>
        <div className="flex gap-1.5">
          {story.frames.map((_, i) => (
            <button key={i} onClick={() => setFrame(i)} aria-label={`frame ${i + 1}`}
              className={`h-2 w-2 rounded-full transition-colors ${i === frame ? "bg-deniz" : i < frame ? "bg-deniz/40" : "bg-line"}`} />
          ))}
        </div>
        <button onClick={() => setFrame((f) => Math.min(total - 1, f + 1))} disabled={frame >= total - 1}
          className="rounded-full bg-deniz px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-40">
          {frame >= total - 1 ? "✓" : t("nextStep").split(" ")[0] === "Next" ? "Next →" : "İleri →"}
        </button>
      </div>
    </div>
  );
}
