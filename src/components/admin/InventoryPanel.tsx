import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatPrice } from '../../lib/utils';
import { adjustInventory, variantLabel, REASON_LABELS, InventoryReason } from '../../lib/inventory';
import { Search, Loader2, Plus, ClipboardCheck, ArrowRightLeft, History, X, Package, AlertTriangle, PackageX, Boxes, Sparkles } from 'lucide-react';

type Row = {
  id: string;
  product_id: string;
  product_name: string;
  category: string | null;
  price: number;
  color: string;
  size: string;
  stock: number;
  low_stock_threshold: number;
  active: boolean;
  is_pool: boolean;
  sold_30d: number;
  days_of_cover: number | null;
};

type Action = { mode: 'restock' | 'count' | 'transfer'; row: Row } | { mode: 'history'; row: Row } | null;

const statusOf = (r: Row) => {
  if (r.stock < 0) return 'oversold';
  if (r.is_pool) return r.stock > 0 ? 'pool' : 'ok';
  if (r.stock === 0) return 'out';
  if (r.stock <= r.low_stock_threshold) return 'low';
  return 'ok';
};

const STATUS_STYLE: Record<string, string> = {
  oversold: 'text-red-700 bg-red-50',
  out: 'text-red-600 bg-red-50',
  low: 'text-amber-700 bg-amber-50',
  pool: 'text-blue-700 bg-blue-50',
  ok: 'text-gray-900',
};

const InventoryPanel = ({ onGeneratePhotos }: { onGeneratePhotos?: (productId: string) => void }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingSetup, setMissingSetup] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'out' | 'low' | 'pool'>('all');
  const [action, setAction] = useState<Action>(null);

  const load = async () => {
    const { data, error } = await supabase.from('inventory_overview').select('*').order('product_name').order('color').order('size');
    if (error) {
      console.error('Error loading inventory:', error);
      setMissingSetup(/inventory_overview|does not exist|schema cache/i.test(error.message));
    } else {
      setMissingSetup(false);
      setRows((data || []) as Row[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Inactive combinations are hidden unless they still hold units that need moving
  const visible = rows.filter((r) => r.active || r.stock !== 0);

  const stats = useMemo(() => {
    const sellable = visible.filter((r) => !r.is_pool);
    return {
      units: visible.reduce((acc, r) => acc + Math.max(r.stock, 0), 0),
      value: visible.reduce((acc, r) => acc + Math.max(r.stock, 0) * (Number(r.price) || 0), 0),
      out: sellable.filter((r) => r.active && r.stock <= 0).length,
      low: sellable.filter((r) => r.active && r.stock > 0 && r.stock <= r.low_stock_threshold).length,
      pool: visible.filter((r) => r.is_pool).reduce((acc, r) => acc + Math.max(r.stock, 0), 0),
    };
  }, [rows]);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = visible.filter((r) => {
      if (term && !`${r.product_name} ${r.color} ${r.size} ${r.category || ''}`.toLowerCase().includes(term)) return false;
      const s = statusOf(r);
      if (filter === 'attention') return ['oversold', 'out', 'low'].includes(s) && (r.sold_30d > 0 || s === 'oversold');
      if (filter === 'out') return s === 'out' || s === 'oversold';
      if (filter === 'low') return s === 'low';
      if (filter === 'pool') return s === 'pool';
      return true;
    });
    const map = new Map<string, Row[]>();
    filtered.forEach((r) => map.set(r.product_id, [...(map.get(r.product_id) || []), r]));
    return [...map.values()];
  }, [rows, search, filter]);

  if (missingSetup) {
    return (
      <div>
        <Header />
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-6 text-sm">
          El inventario por color y talla todavía no está creado. Ejecuta la migración
          <code className="mx-1 px-1 bg-white rounded">20261029020000_inventory_variants.sql</code>
          en el editor SQL de Supabase y recarga esta página.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Stat icon={<Boxes className="h-5 w-5" />} label="Unidades" value={stats.units.toLocaleString('es-EC')} />
        <Stat icon={<Package className="h-5 w-5" />} label="Valor a precio de venta" value={formatPrice(stats.value)} />
        <Stat icon={<PackageX className="h-5 w-5" />} label="Variantes agotadas" value={stats.out} onClick={() => setFilter('out')} />
        <Stat icon={<AlertTriangle className="h-5 w-5" />} label="Stock bajo" value={stats.low} onClick={() => setFilter('low')} />
        <Stat icon={<ArrowRightLeft className="h-5 w-5" />} label="Sin asignar" value={stats.pool} hint="Repártelo por color y talla" onClick={() => setFilter('pool')} />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto, color, talla o categoría"
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-vandora-emerald outline-none"
          />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="all">Todo</option>
          <option value="attention">Reponer (se vende y está bajo)</option>
          <option value="out">Agotado</option>
          <option value="low">Stock bajo</option>
          <option value="pool">Sin asignar</option>
        </select>
      </div>

      {loading ? (
        <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-lg border p-12 text-center text-gray-500 italic">No hay variantes con estos filtros.</div>
      ) : (
        <div className="space-y-4">
          {groups.map((variants) => (
            <div key={variants[0].product_id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
              <div className="px-4 py-3 border-b bg-gray-50 flex justify-between items-center">
                <div>
                  <span className="font-medium text-gray-900">{variants[0].product_name}</span>
                  {variants[0].category && <span className="ml-2 text-xs text-gray-400">{variants[0].category}</span>}
                </div>
                <div className="flex items-center gap-3">
                  {onGeneratePhotos && (
                    <button
                      type="button"
                      onClick={() => onGeneratePhotos(variants[0].product_id)}
                      className="inline-flex items-center gap-1 text-xs text-vandora-emerald hover:underline"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Generar fotos
                    </button>
                  )}
                  <span className="text-sm text-gray-500">{variants.reduce((a, v) => a + Math.max(v.stock, 0), 0)} uds.</span>
                </div>
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2 text-left font-medium">Variante</th>
                    <th className="px-4 py-2 text-right font-medium">Stock</th>
                    <th className="px-4 py-2 text-right font-medium hidden sm:table-cell">Vendidas 30 días</th>
                    <th className="px-4 py-2 text-right font-medium hidden sm:table-cell">Alcanza para</th>
                    <th className="px-4 py-2 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {variants.map((r) => {
                    const s = statusOf(r);
                    return (
                      <tr key={r.id} className={!r.active ? 'opacity-60' : ''}>
                        <td className="px-4 py-2 min-w-[8rem]">
                          {variantLabel(r)}
                          {!r.active && <span className="ml-2 text-xs text-gray-400">(ya no se ofrece)</span>}
                          {r.is_pool && <div className="text-xs text-gray-400 hidden sm:block">Stock anterior sin color/talla. Se usa si la variante pedida no tiene unidades.</div>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className={`inline-block min-w-[2.5rem] px-2 py-0.5 rounded font-semibold ${STATUS_STYLE[s]}`}>{r.stock}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 hidden sm:table-cell">{r.sold_30d || '—'}</td>
                        <td className="px-4 py-2 text-right text-gray-600 hidden sm:table-cell">
                          {r.stock <= 0 && !r.is_pool ? <span className="text-red-600">agotado</span> : r.days_of_cover == null ? '—' : `${r.days_of_cover} días`}
                        </td>
                        <td className="px-2 sm:px-4 py-2 text-right whitespace-nowrap">
                          <IconButton title="Entrada de mercadería" onClick={() => setAction({ mode: 'restock', row: r })}><Plus className="h-4 w-4" /></IconButton>
                          <IconButton title="Ajustar por conteo" onClick={() => setAction({ mode: 'count', row: r })}><ClipboardCheck className="h-4 w-4" /></IconButton>
                          {(r.is_pool || !r.active) && r.stock > 0 && (
                            <IconButton title="Mover a otra variante" onClick={() => setAction({ mode: 'transfer', row: r })}><ArrowRightLeft className="h-4 w-4" /></IconButton>
                          )}
                          <IconButton title="Historial" onClick={() => setAction({ mode: 'history', row: r })}><History className="h-4 w-4" /></IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {action && action.mode === 'history' && <HistoryDrawer row={action.row} onClose={() => setAction(null)} />}
      {action && action.mode !== 'history' && (
        <MovementModal
          mode={action.mode}
          row={action.row}
          targets={rows.filter((r) => r.product_id === action.row.product_id && r.id !== action.row.id && r.active && !r.is_pool)}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); load(); }}
        />
      )}
    </div>
  );
};

const Header = () => (
  <div className="mb-4">
    <h3 className="text-lg font-medium text-gray-900 border-l-4 border-vandora-emerald pl-3">Inventario</h3>
    <p className="text-sm text-gray-500 mt-1 pl-4">Stock por color y talla. Baja solo con cada venta de cualquier canal y vuelve si el pedido se cancela.</p>
  </div>
);

const Stat = ({ icon, label, value, hint, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) => (
  <button type="button" onClick={onClick} disabled={!onClick} className="text-left bg-white rounded-lg shadow-sm border border-gray-200 p-4 enabled:hover:border-vandora-emerald transition-colors">
    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase tracking-wide">{icon}{label}</div>
    <div className="text-2xl font-semibold text-gray-900 mt-2">{value}</div>
    {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
  </button>
);

const IconButton = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" title={title} aria-label={title} onClick={onClick} className="p-1.5 sm:p-2 text-gray-500 hover:text-vandora-emerald hover:bg-emerald-50 rounded">
    {children}
  </button>
);

const MovementModal = ({ mode, row, targets, onClose, onDone }: {
  mode: 'restock' | 'count' | 'transfer';
  row: Row;
  targets: Row[];
  onClose: () => void;
  onDone: () => void;
}) => {
  const [quantity, setQuantity] = useState(mode === 'count' ? String(row.stock) : '');
  const [reason, setReason] = useState<InventoryReason>(mode === 'restock' ? 'restock' : 'adjustment');
  const [target, setTarget] = useState(targets[0]?.id || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const titles = { restock: 'Entrada de mercadería', count: 'Ajustar por conteo', transfer: 'Mover unidades a otra variante' };
  const qty = parseInt(quantity, 10);
  const delta = mode === 'count' ? qty - row.stock : qty;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Number.isNaN(qty) || (mode !== 'count' && qty <= 0)) return alert('Ingresa una cantidad válida.');
    if (mode === 'transfer' && (!target || qty > row.stock)) return alert('Elige una variante y no muevas más de lo disponible.');
    setSaving(true);
    try {
      if (mode === 'transfer') {
        await adjustInventory(row.id, -qty, 'transfer', note || `Hacia ${variantLabel(targets.find((t) => t.id === target)!)}`);
        await adjustInventory(target, qty, 'transfer', note || `Desde ${variantLabel(row)}`);
      } else if (delta !== 0) {
        await adjustInventory(row.id, delta, reason, note);
      }
      onDone();
    } catch (err: any) {
      alert('No se pudo guardar: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={submit} className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{titles[mode]}</h3>
            <p className="text-sm text-gray-500">{row.product_name} · {variantLabel(row)} · stock actual {row.stock}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        {mode === 'transfer' && (
          <label className="block text-sm text-gray-700">Hacia
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full border rounded-md p-2 bg-white">
              {targets.map((t) => <option key={t.id} value={t.id}>{variantLabel(t)} (stock {t.stock})</option>)}
            </select>
          </label>
        )}

        <label className="block text-sm text-gray-700">
          {mode === 'count' ? 'Unidades contadas' : 'Cantidad'}
          <input type="number" min={mode === 'count' ? undefined : 1} value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus className="mt-1 w-full border rounded-md p-2" />
        </label>
        {mode === 'count' && !Number.isNaN(qty) && delta !== 0 && (
          <p className={`text-sm ${delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>Se registrará un ajuste de {delta > 0 ? '+' : ''}{delta}.</p>
        )}

        {mode === 'count' && (
          <label className="block text-sm text-gray-700">Motivo
            <select value={reason} onChange={(e) => setReason(e.target.value as InventoryReason)} className="mt-1 w-full border rounded-md p-2 bg-white">
              {(['adjustment', 'return', 'damage'] as const).map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </select>
          </label>
        )}

        <label className="block text-sm text-gray-700">Nota (opcional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'restock' ? 'Proveedor, factura…' : ''} className="mt-1 w-full border rounded-md p-2" />
        </label>

        <button type="submit" disabled={saving} className="w-full bg-vandora-emerald text-white py-2.5 rounded-md hover:bg-emerald-800 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  );
};

const HistoryDrawer = ({ row, onClose }: { row: Row; onClose: () => void }) => {
  const [moves, setMoves] = useState<any[] | null>(null);

  useEffect(() => {
    supabase.from('inventory_movements').select('*').eq('variant_id', row.id).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setMoves(data || []));
  }, [row.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <div>
            <h3 className="font-semibold text-gray-900">Historial</h3>
            <p className="text-xs text-gray-500">{row.product_name} · {variantLabel(row)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        {moves === null ? (
          <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div>
        ) : moves.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 italic">Sin movimientos.</p>
        ) : (
          <ul className="divide-y">
            {moves.map((m) => (
              <li key={m.id} className="px-6 py-3 flex justify-between gap-4 text-sm">
                <div>
                  <div className="text-gray-900">{REASON_LABELS[m.reason] || m.reason}{m.channel ? ` · ${m.channel}` : ''}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(m.created_at).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })}
                    {m.order_id && ` · pedido #${String(m.order_id).slice(0, 8)}`}
                  </div>
                  {m.note && <div className="text-xs text-gray-400">{m.note}</div>}
                </div>
                <span className={`font-semibold ${m.quantity_change > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {m.quantity_change > 0 ? '+' : ''}{m.quantity_change}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default InventoryPanel;
