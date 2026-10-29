import React, { useState } from 'react';
import { formatPrice } from '../../lib/utils';

export type ChartWeek = {
  week: string;                        // YYYY-MM-DD (Monday)
  byChannel: Record<string, number>;   // revenue per channel
  kind: 'past' | 'current' | 'forecast';
  forecast?: { value: number; low: number; high: number };
};

type Series = { key: string; label: string; color: string };

const HEIGHT = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
const BAR_MAX = 24;
const GAP = 2;

const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 2) * 2 * p;
};

// Bar with a 4px rounded top and a square base
const roundedTop = (x: number, top: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
};

const shortWeek = (w: string) => {
  const [, m, d] = w.split('-').map(Number);
  return `${d}/${m}`;
};

// Stacked weekly revenue by channel, followed by forecast weeks (outlined bar + 80% range).
const WeeklySalesChart = ({ weeks, series }: { weeks: ChartWeek[]; series: Series[] }) => {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const totals = weeks.map((w) => w.kind === 'forecast' ? (w.forecast?.high || 0) : Object.values(w.byChannel).reduce((a, b) => a + b, 0));
  const yMax = niceMax(Math.max(...totals, 0));
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const band = plotW / Math.max(weeks.length, 1);
  const barW = Math.min(BAR_MAX, band * 0.7);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const labelEvery = Math.ceil(weeks.length / 12);
  const firstForecast = weeks.findIndex((w) => w.kind === 'forecast');

  const hovered = hover != null ? weeks[hover] : null;
  const hoveredTotal = hovered ? Object.values(hovered.byChannel).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label="Ventas semanales por canal y proyección">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#6b7280">
              {t >= 1000 ? `$${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : `$${Math.round(t)}`}
            </text>
          </g>
        ))}

        {firstForecast > 0 && (
          <g>
            <rect x={PAD.left + firstForecast * band} y={PAD.top} width={plotW - firstForecast * band} height={plotH} fill="#f9fafb" />
            <text x={PAD.left + firstForecast * band + 6} y={PAD.top + 12} fontSize="11" fill="#6b7280">Proyección</text>
          </g>
        )}

        {weeks.map((w, i) => {
          const cx = PAD.left + band * i + band / 2;
          const x = cx - barW / 2;
          if (w.kind === 'forecast' && w.forecast) {
            const f = w.forecast;
            return (
              <g key={w.week} opacity={hover == null || hover === i ? 1 : 0.5}>
                <line x1={cx} x2={cx} y1={y(f.high)} y2={y(f.low)} stroke="#9ca3af" strokeWidth={1.5} />
                <line x1={cx - 5} x2={cx + 5} y1={y(f.high)} y2={y(f.high)} stroke="#9ca3af" strokeWidth={1.5} />
                <line x1={cx - 5} x2={cx + 5} y1={y(f.low)} y2={y(f.low)} stroke="#9ca3af" strokeWidth={1.5} />
                <path d={roundedTop(x, y(f.value), barW, Math.max(y(0) - y(f.value), 1))}
                  fill="url(#forecast-hatch)" stroke="#064e3b" strokeWidth={1.5} />
              </g>
            );
          }
          // Stack in fixed series order from the baseline; a 2px surface gap sits under every
          // segment above the first, and only the top segment gets the rounded data-end
          let base = 0;
          const segments = series.map((s) => {
            const v = w.byChannel[s.key] || 0;
            if (v <= 0) return null;
            const top = y(base + v);
            const bottom = y(base) - (base > 0 ? GAP : 0);
            base += v;
            return { s, top, h: Math.max(bottom - top, 1) };
          }).filter(Boolean) as { s: Series; top: number; h: number }[];
          return (
            <g key={w.week} opacity={hover == null || hover === i ? (w.kind === 'current' ? 0.55 : 1) : 0.4}>
              {segments.map((seg, k) => k === segments.length - 1
                ? <path key={seg.s.key} d={roundedTop(x, seg.top, barW, seg.h)} fill={seg.s.color} />
                : <rect key={seg.s.key} x={x} y={seg.top} width={barW} height={seg.h} fill={seg.s.color} />)}
            </g>
          );
        })}

        {weeks.map((w, i) => (i % labelEvery === 0 || w.kind !== 'past') && (
          <text key={w.week} x={PAD.left + band * i + band / 2} y={HEIGHT - 8} textAnchor="middle" fontSize="10" fill="#6b7280">
            {w.kind === 'current' ? 'Esta sem.' : shortWeek(w.week)}
          </text>
        ))}

        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeWidth={1} />

        {/* Hit targets: the full band height, wider than the bar */}
        {weeks.map((w, i) => (
          <rect key={`hit-${w.week}`} x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} />
        ))}

        <defs>
          <pattern id="forecast-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#ecfdf5" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#6ee7b7" strokeWidth="2" />
          </pattern>
        </defs>
      </svg>

      {hovered && (
        <div
          className="absolute top-2 pointer-events-none bg-white border border-gray-200 shadow-lg rounded-md px-3 py-2 text-xs min-w-[11rem] z-10"
          style={{ left: `${Math.min(Math.max(((PAD.left + band * hover! + band / 2) / width) * 100, 10), 72)}%` }}
        >
          <div className="font-medium text-gray-900 mb-1">
            Semana del {shortWeek(hovered.week)}{hovered.kind === 'current' ? ' (en curso)' : hovered.kind === 'forecast' ? ' (proyección)' : ''}
          </div>
          {hovered.kind === 'forecast' && hovered.forecast ? (
            <div className="text-gray-700">
              {formatPrice(hovered.forecast.value)}
              <div className="text-gray-500">rango {formatPrice(hovered.forecast.low)} – {formatPrice(hovered.forecast.high)}</div>
            </div>
          ) : (
            <>
              {series.filter((s) => hovered.byChannel[s.key]).map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 text-gray-700">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                  <span>{formatPrice(hovered.byChannel[s.key])}</span>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-gray-100 mt-1 pt-1 font-medium text-gray-900">
                <span>Total</span><span>{formatPrice(hoveredTotal)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default WeeklySalesChart;
