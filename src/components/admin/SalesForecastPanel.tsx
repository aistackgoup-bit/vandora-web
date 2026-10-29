import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatPrice } from '../../lib/utils';
import { forecastWeekly, weekStart, addWeeks } from '../../lib/forecast';
import { useSalesChannels, formatPhone, whatsappLink } from '../../lib/salesChannels';
import { variantLabel } from '../../lib/inventory';
import WeeklySalesChart, { ChartWeek } from './WeeklySalesChart';
import { Loader2, TrendingUp, TrendingDown, Minus, MessageCircle } from 'lucide-react';

// Categorical slots, assigned to channels in their configured order (color follows the channel)
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOR = '#9ca3af';
const RANGES = [8, 12, 26, 52];
const LEAD_TIME_KEY = 'vandora_lead_time_days';

type Row = { week: string; channel: string; source: string | null; orders: number; revenue: number; units: number; new_customer_orders: number; returning_orders: number };

const sum = (rows: Row[], k: keyof Row) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const pctChange = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

// PostgREST returns at most 1000 rows per request
const fetchAll = async (from: string) => {
  const out: Row[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase.from('sales_weekly').select('*').gte('week', from)
      .order('week').range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...((data || []) as Row[]).map((r) => ({ ...r, week: String(r.week).slice(0, 10), revenue: Number(r.revenue) })));
    if (!data || data.length < 1000) break;
  }
  return out;
};

const SalesForecastPanel = () => {
  const { channels, labelOf } = useSalesChannels();
  const [range, setRange] = useState(12);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactivate, setReactivate] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [leadTime, setLeadTime] = useState(() => {
    try { return Number(localStorage.getItem(LEAD_TIME_KEY)) || 21; } catch { return 21; }
  });

  const currentWeek = weekStart(new Date());
  const firstWeek = addWeeks(currentWeek, -range);          // first complete week in range
  const prevFirstWeek = addWeeks(firstWeek, -range);

  useEffect(() => {
    setRows(null);
    fetchAll(prevFirstWeek)
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(/sales_weekly|does not exist|schema cache/i.test(e.message) ? 'missing' : e.message));
  }, [range]);

  useEffect(() => {
    const now = Date.now();
    supabase.from('customer_summary').select('id, full_name, phone, email, orders_count, total_spent, last_order_at, last_order_channel')
      .gt('orders_count', 0)
      .lte('last_order_at', new Date(now - 45 * 864e5).toISOString())
      .gte('last_order_at', new Date(now - 150 * 864e5).toISOString())
      .order('total_spent', { ascending: false })
      .limit(12)
      .then(({ data }) => setReactivate(data || []));
    supabase.from('inventory_overview').select('id, product_name, color, size, stock, sold_30d, is_pool, active')
      .gt('sold_30d', 0)
      .then(({ data }) => setInventory(data || []));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LEAD_TIME_KEY, String(leadTime)); } catch { /* private mode */ }
  }, [leadTime]);

  const series = useMemo(() => {
    const known = channels.map((c, i) => ({ key: c.key, label: c.label, color: SERIES_COLORS[i] || OTHER_COLOR }));
    const extra = ([...new Set((rows || []).map((r) => r.channel))] as string[]).filter((k) => !known.some((s) => s.key === k));
    return [...known, ...extra.map((k) => ({ key: k, label: labelOf(k), color: OTHER_COLOR }))];
  }, [channels, rows]);

  const model = useMemo(() => {
    if (!rows) return null;
    const inRange = rows.filter((r) => r.week >= firstWeek && r.week < currentWeek);
    const previous = rows.filter((r) => r.week >= prevFirstWeek && r.week < firstWeek);
    const current = rows.filter((r) => r.week === currentWeek);

    const weekList = Array.from({ length: range }, (_, i) => addWeeks(firstWeek, i));
    const weeklyTotals = weekList.map((w) => sum(inRange.filter((r) => r.week === w), 'revenue'));
    // Use all complete history we fetched (up to 2× range) for a steadier forecast
    const history = Array.from({ length: range * 2 }, (_, i) => addWeeks(prevFirstWeek, i))
      .map((w) => sum(rows.filter((r) => r.week === w), 'revenue'));
    const firstSale = history.findIndex((v) => v > 0);
    const forecast = forecastWeekly(firstSale >= 0 ? history.slice(firstSale) : [], 4);

    const byChannel = (list: Row[]) => {
      const out: Record<string, number> = {};
      list.forEach((r) => { out[r.channel] = (out[r.channel] || 0) + r.revenue; });
      return out;
    };

    const chartWeeks: ChartWeek[] = [
      ...weekList.map((w) => ({ week: w, kind: 'past' as const, byChannel: byChannel(inRange.filter((r) => r.week === w)) })),
      { week: currentWeek, kind: 'current' as const, byChannel: byChannel(current) },
      ...forecast.points.map((p, i) => ({ week: addWeeks(currentWeek, i + 1), kind: 'forecast' as const, byChannel: {}, forecast: p })),
    ];

    const channelRows = series.map((s) => {
      const now = inRange.filter((r) => r.channel === s.key);
      const before = previous.filter((r) => r.channel === s.key);
      return {
        ...s,
        revenue: sum(now, 'revenue'),
        orders: sum(now, 'orders'),
        newOrders: sum(now, 'new_customer_orders'),
        change: pctChange(sum(now, 'revenue'), sum(before, 'revenue')),
      };
    }).filter((c) => c.revenue > 0 || c.orders > 0);

    const sources: Record<string, number> = {};
    inRange.filter((r) => r.channel === 'web').forEach((r) => {
      const k = r.source || 'sin_dato';
      sources[k] = (sources[k] || 0) + r.revenue;
    });

    const revenue = sum(inRange, 'revenue');
    const orders = sum(inRange, 'orders');
    const identified = sum(inRange, 'new_customer_orders') + sum(inRange, 'returning_orders');
    return {
      chartWeeks,
      forecast,
      weeklyTotals,
      revenue,
      orders,
      aov: orders ? revenue / orders : 0,
      repeatShare: identified ? (sum(inRange, 'returning_orders') / identified) * 100 : null,
      revenueChange: pctChange(revenue, sum(previous, 'revenue')),
      ordersChange: pctChange(orders, sum(previous, 'orders')),
      next4: forecast.points.reduce((a, p) => ({ value: a.value + p.value, low: a.low + p.low, high: a.high + p.high }), { value: 0, low: 0, high: 0 }),
      channelRows,
      sources: Object.entries(sources).sort((a, b) => b[1] - a[1]),
    };
  }, [rows, series, range]);

  // Units to order so stock covers the supplier lead time plus ~30 days of sales
  const reorder = useMemo(() => inventory
    .filter((v) => v.active && !v.is_pool)
    .map((v) => {
      const daily = v.sold_30d / 30;
      const daysLeft = daily > 0 ? Math.max(v.stock, 0) / daily : Infinity;
      return { ...v, daysLeft, suggested: Math.max(Math.ceil(daily * (leadTime + 30) - Math.max(v.stock, 0)), 0) };
    })
    .filter((v) => v.daysLeft <= leadTime && v.suggested > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 12), [inventory, leadTime]);

  if (error === 'missing') {
    return (
      <div>
        <Header range={range} setRange={setRange} />
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-6 text-sm">
          Falta la vista de ventas. Ejecuta la migración
          <code className="mx-1 px-1 bg-white rounded">20261029040000_sales_reporting.sql</code> en Supabase.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header range={range} setRange={setRange} />
      {error && <div className="mb-4 bg-red-50 text-red-800 rounded-md p-3 text-sm">No se pudieron cargar las ventas: {error}</div>}

      {!model ? (
        <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <Kpi label={`Ventas (${range} sem.)`} value={formatPrice(model.revenue)} change={model.revenueChange} />
            <Kpi label="Pedidos" value={model.orders.toLocaleString('es-EC')} change={model.ordersChange} />
            <Kpi label="Ticket promedio" value={formatPrice(model.aov)} />
            <Kpi label="Pedidos de clientas que vuelven" value={model.repeatShare == null ? '—' : `${Math.round(model.repeatShare)}%`} />
            <div className="col-span-2 lg:col-span-1 bg-emerald-50 rounded-lg border border-emerald-100 p-4">
              <div className="text-xs uppercase tracking-wide text-emerald-800">Próximas 4 semanas</div>
              <div className="text-2xl font-semibold text-emerald-900 mt-2">{model.forecast.method === 'none' ? '—' : formatPrice(model.next4.value)}</div>
              {model.forecast.method !== 'none' && (
                <div className="text-xs text-emerald-700 mt-1">
                  rango probable {formatPrice(model.next4.low)} – {formatPrice(model.next4.high)}
                  {model.forecast.method === 'average' && ' · poco historial: promedio simple'}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h4 className="text-sm font-semibold text-gray-900">Ventas semanales por canal</h4>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {series.filter((s) => model.channelRows.some((c) => c.key === s.key)).map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                ))}
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-emerald-900 bg-emerald-50" />Proyección</span>
              </div>
            </div>
            {/* Keeps axis text legible on phones: the chart scrolls sideways instead of shrinking */}
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="min-w-[560px]">
                <WeeklySalesChart weeks={model.chartWeeks} series={series} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              La proyección usa las semanas completas con suavizado exponencial y tendencia amortiguada; la línea gris es el rango donde cayó ~80% de las semanas pasadas.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
              <h4 className="text-sm font-semibold text-gray-900 px-4 pt-4 pb-2">Por canal</h4>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2 text-left font-medium">Canal</th>
                    <th className="px-4 py-2 text-right font-medium">Ventas</th>
                    <th className="px-4 py-2 text-right font-medium">Participación</th>
                    <th className="px-4 py-2 text-right font-medium">Pedidos</th>
                    <th className="px-4 py-2 text-right font-medium">Ticket</th>
                    <th className="px-4 py-2 text-right font-medium">Clientas nuevas</th>
                    <th className="px-4 py-2 text-right font-medium">vs. período anterior</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {model.channelRows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 italic">Sin ventas en este período.</td></tr>
                  )}
                  {model.channelRows.map((c) => (
                    <tr key={c.key}>
                      <td className="px-4 py-2"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />{c.label}</span></td>
                      <td className="px-4 py-2 text-right text-gray-900">{formatPrice(c.revenue)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{model.revenue ? `${Math.round((c.revenue / model.revenue) * 100)}%` : '—'}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{c.orders}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{formatPrice(c.orders ? c.revenue / c.orders : 0)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{c.newOrders}</td>
                      <td className="px-4 py-2 text-right"><Change value={c.change} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-1">Ventas web por origen</h4>
              <p className="text-xs text-gray-400 mb-3">Según UTM, clic de anuncio o sitio de procedencia.</p>
              {model.sources.length === 0 ? <p className="text-sm text-gray-400 italic">Sin ventas web en este período.</p> : (
                <ul className="space-y-2">
                  {model.sources.slice(0, 8).map(([src, rev]) => {
                    const max = model.sources[0][1] || 1;
                    return (
                      <li key={src} className="text-sm">
                        <div className="flex justify-between text-gray-700">
                          <span>{src === 'sin_dato' ? 'Sin dato (antes del seguimiento)' : src.replace(/_/g, ' ')}</span>
                          <span>{formatPrice(rev)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded mt-1"><div className="h-1.5 rounded bg-[#2a78d6]" style={{ width: `${(rev / max) * 100}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h4 className="text-sm font-semibold text-gray-900">Clientas para reactivar</h4>
              <p className="text-xs text-gray-400 mb-3">Compraron hace 45 a 150 días y no han vuelto. Ordenadas por lo que han gastado.</p>
              {reactivate.length === 0 ? <p className="text-sm text-gray-400 italic">Nadie en esta ventana por ahora.</p> : (
                <ul className="divide-y">
                  {reactivate.map((c) => (
                    <li key={c.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="text-gray-900 truncate">{c.full_name || c.email || formatPhone(c.phone)}</div>
                        <div className="text-xs text-gray-500">
                          {c.orders_count} {c.orders_count === 1 ? 'pedido' : 'pedidos'} · {formatPrice(Number(c.total_spent))} · última {Math.round((Date.now() - new Date(c.last_order_at).getTime()) / 864e5)} días ({labelOf(c.last_order_channel)})
                        </div>
                      </div>
                      {c.phone && (
                        <a href={whatsappLink(c.phone)} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 rounded-full px-3 py-1.5">
                          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Reponer pronto</h4>
                  <p className="text-xs text-gray-400 mb-3">Variantes que se acaban antes de que llegue un pedido nuevo, al ritmo de los últimos 30 días.</p>
                </div>
                <label className="text-xs text-gray-500 flex items-center gap-2">
                  Reposición tarda
                  <input type="number" min={1} max={120} value={leadTime} onChange={(e) => setLeadTime(Math.max(1, Number(e.target.value) || 1))} className="w-14 border rounded px-2 py-1 text-gray-900" />
                  días
                </label>
              </div>
              {reorder.length === 0 ? <p className="text-sm text-gray-400 italic">Nada urgente con este plazo.</p> : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase">
                      <th className="py-1 text-left font-medium">Variante</th>
                      <th className="py-1 text-right font-medium">Stock</th>
                      <th className="py-1 text-right font-medium">Alcanza</th>
                      <th className="py-1 text-right font-medium">Pedir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reorder.map((v) => (
                      <tr key={v.id}>
                        <td className="py-2 pr-2"><div className="text-gray-900">{v.product_name}</div><div className="text-xs text-gray-500">{variantLabel(v)}</div></td>
                        <td className="py-2 text-right text-gray-700">{v.stock}</td>
                        <td className={`py-2 text-right ${v.daysLeft < 7 ? 'text-red-600' : 'text-amber-700'}`}>{v.stock <= 0 ? 'agotado' : `${Math.round(v.daysLeft)} días`}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">{v.suggested}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const Header = ({ range, setRange }: { range: number; setRange: (n: number) => void }) => (
  <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
    <div>
      <h3 className="text-lg font-medium text-gray-900 border-l-4 border-vandora-emerald pl-3">Ventas y previsión</h3>
      <p className="text-sm text-gray-500 mt-1 pl-4">Todos los canales juntos: web, WhatsApp, Marketplace y los que registres a mano.</p>
    </div>
    <div className="flex bg-gray-100 rounded-lg p-1 text-sm">
      {RANGES.map((r) => (
        <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-md ${range === r ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500'}`}>
          {r} sem.
        </button>
      ))}
    </div>
  </div>
);

const Change = ({ value }: { value: number | null }) => {
  if (value == null) return <span className="text-gray-400">—</span>;
  const Icon = value > 1 ? TrendingUp : value < -1 ? TrendingDown : Minus;
  const color = value > 1 ? 'text-emerald-700' : value < -1 ? 'text-red-600' : 'text-gray-500';
  return <span className={`inline-flex items-center gap-1 ${color}`}><Icon className="h-3.5 w-3.5" />{value > 0 ? '+' : ''}{Math.round(value)}%</span>;
};

const Kpi = ({ label, value, change }: { label: string; value: string; change?: number | null }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
    <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
    <div className="text-2xl font-semibold text-gray-900 mt-2">{value}</div>
    {change !== undefined && <div className="text-xs mt-1"><Change value={change} /> <span className="text-gray-400">vs. anterior</span></div>}
  </div>
);

export default SalesForecastPanel;
