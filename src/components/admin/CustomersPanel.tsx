import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatPrice } from '../../lib/utils';
import { useSalesChannels, formatPhone, whatsappLink } from '../../lib/salesChannels';
import { Search, Download, X, Loader2, MessageCircle, Mail, Instagram, ChevronLeft, ChevronRight, Users, UserPlus, ShoppingBag, Repeat } from 'lucide-react';
import SalesChannelsEditor from './SalesChannelsEditor';

const PAGE_SIZE = 50;

const EVENT_LABELS: Record<string, string> = {
  order: 'Compra web',
  manual_sale: 'Venta registrada',
  whatsapp_contact: 'Contacto por WhatsApp',
  newsletter: 'Suscripción al boletín',
  abandoned_cart: 'Carrito abandonado',
  affiliate_application: 'Solicitud de afiliada',
  account: 'Creó su cuenta',
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Commas and parentheses would break PostgREST's or() filter syntax
const cleanSearch = (s: string) => s.replace(/[,()%*\\]/g, ' ').trim();

const CustomersPanel = () => {
  const { channels, labelOf, reload: reloadChannels } = useSalesChannels();
  const [view, setView] = useState<'customers' | 'channels'>('customers');
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missingSetup, setMissingSetup] = useState(false);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const [onlyBuyers, setOnlyBuyers] = useState(false);
  const [stats, setStats] = useState({ total: 0, newLast30: 0, buyers: 0, repeat: 0 });
  const [selected, setSelected] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  const buildQuery = (columns = '*', options?: { count?: 'exact'; head?: boolean }) => {
    let query = supabase.from('customer_summary').select(columns, options);
    const term = cleanSearch(search);
    if (term) {
      const digits = term.replace(/\D/g, '');
      const phoneTerm = digits.length >= 4 ? `,phone.ilike.%${digits.replace(/^0/, '')}%` : '';
      query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,instagram.ilike.%${term}%${phoneTerm}`);
    }
    if (channel) query = query.eq('first_channel', channel);
    if (onlyBuyers) query = query.gt('orders_count', 0);
    return query;
  };

  const fetchCustomers = async () => {
    setLoading(true);
    const { data, count, error } = await buildQuery('*', { count: 'exact' })
      .order('last_seen_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) {
      console.error('Error fetching customers:', error);
      setMissingSetup(/customer_summary|does not exist|schema cache/i.test(error.message));
    } else {
      setMissingSetup(false);
      setCustomers(data || []);
      setTotal(count || 0);
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const count = (q: any) => q.then((r: any) => r.count || 0);
    const base = () => supabase.from('customer_summary').select('id', { count: 'exact', head: true });
    const [all, fresh, buyers, repeat] = await Promise.all([
      count(base()),
      count(base().gte('created_at', since)),
      count(base().gt('orders_count', 0)),
      count(base().gt('orders_count', 1)),
    ]);
    setStats({ total: all, newLast30: fresh, buyers, repeat });
  };

  useEffect(() => {
    const t = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(t);
  }, [search, channel, onlyBuyers, page]);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search, channel, onlyBuyers]);

  const exportCsv = async () => {
    setExporting(true);
    const { data, error } = await buildQuery().order('last_seen_at', { ascending: false }).limit(10000);
    setExporting(false);
    if (error || !data) return alert('No se pudo exportar: ' + error?.message);

    const header = ['nombre', 'telefono', 'email', 'instagram', 'canal_origen', 'fuente_origen', 'pedidos', 'total_gastado', 'primera_compra', 'ultima_compra', 'etiquetas', 'creado'];
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = data.map((c: any) => [
      c.full_name, c.phone, c.email, c.instagram, labelOf(c.first_channel), c.first_source, c.orders_count,
      c.total_spent, c.first_order_at, c.last_order_at, (c.tags || []).join('|'), c.created_at,
    ].map(escape).join(','));
    const blob = new Blob(['﻿' + [header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clientes-vandora-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (view === 'channels') {
    return (
      <div>
        <PanelHeader view={view} setView={setView} />
        <SalesChannelsEditor channels={channels} onChange={reloadChannels} />
      </div>
    );
  }

  return (
    <div>
      <PanelHeader view={view} setView={setView} />

      {missingSetup ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-6 text-sm">
          La base de clientes todavía no está creada. Ejecuta la migración
          <code className="mx-1 px-1 bg-white rounded">20261029010000_unified_customers.sql</code>
          en el editor SQL de Supabase y recarga esta página.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard icon={<Users className="h-5 w-5" />} label="Clientes" value={stats.total} />
            <StatCard icon={<UserPlus className="h-5 w-5" />} label="Nuevos (30 días)" value={stats.newLast30} />
            <StatCard icon={<ShoppingBag className="h-5 w-5" />} label="Con compras" value={stats.buyers} />
            <StatCard
              icon={<Repeat className="h-5 w-5" />}
              label="Recompran"
              value={stats.repeat}
              hint={stats.buyers ? `${Math.round((stats.repeat / stats.buyers) * 100)}% de compradoras` : undefined}
            />
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center">
            <div className="relative flex-1">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, teléfono, email o Instagram"
                className="w-full pl-9 pr-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-vandora-emerald outline-none"
              />
            </div>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm bg-white"
            >
              <option value="">Todos los canales</option>
              {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
              <input type="checkbox" checked={onlyBuyers} onChange={(e) => setOnlyBuyers(e.target.checked)} />
              Solo con compras
            </label>
            <button
              onClick={exportCsv}
              disabled={exporting}
              className="bg-white text-gray-700 px-4 py-2 rounded-md flex items-center justify-center border border-gray-300 hover:bg-gray-50 text-sm disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Exportar CSV
            </button>
          </div>

          <div className="bg-white rounded-lg shadow overflow-x-auto border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Cliente', 'Contacto', 'Llegó por', 'Pedidos', 'Total', 'Última actividad'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500 italic">No hay clientes con estos filtros.</td></tr>
                ) : customers.map((c) => (
                  <tr key={c.id} onClick={() => setSelected(c)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.full_name || <span className="text-gray-400 italic">Sin nombre</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      <div>{formatPhone(c.phone)}</div>
                      <div className="text-xs">{c.email}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 text-xs rounded-full bg-emerald-50 text-vandora-emerald">{labelOf(c.first_channel)}</span>
                      {c.first_source && <div className="text-xs text-gray-400 mt-1">{c.first_source}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{c.orders_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{formatPrice(Number(c.total_spent) || 0)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(c.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{total} clientes</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="p-2 rounded border disabled:opacity-40" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
              <span>Página {page + 1} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)} className="p-2 rounded border disabled:opacity-40" aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <CustomerDrawer
          customer={selected}
          labelOf={labelOf}
          onClose={() => setSelected(null)}
          onSaved={() => { fetchCustomers(); }}
        />
      )}
    </div>
  );
};

const PanelHeader = ({ view, setView }: { view: string; setView: (v: 'customers' | 'channels') => void }) => (
  <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h3 className="text-lg font-medium text-gray-900 border-l-4 border-vandora-emerald pl-3">Clientes</h3>
    <div className="flex bg-gray-100 rounded-lg p-1 text-sm">
      {([['customers', 'Clientes'], ['channels', 'Canales de venta']] as const).map(([key, label]) => (
        <button
          key={key}
          onClick={() => setView(key)}
          className={`px-4 py-1.5 rounded-md ${view === key ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500'}`}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
);

const StatCard = ({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase tracking-wide">{icon}{label}</div>
    <div className="text-2xl font-semibold text-gray-900 mt-2">{value.toLocaleString('es-EC')}</div>
    {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
  </div>
);

const CustomerDrawer = ({ customer, labelOf, onClose, onSaved }: {
  customer: any;
  labelOf: (k?: string | null) => string;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState({
    full_name: customer.full_name || '',
    instagram: customer.instagram || '',
    tags: (customer.tags || []).join(', '),
    notes: customer.notes || '',
  });
  const [events, setEvents] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('customer_events').select('*').eq('customer_id', customer.id)
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setEvents(data || []));
    supabase.from('orders').select('id, total, status, origin, created_at, items').eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setOrders(data || []));
  }, [customer.id]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('customers').update({
      full_name: form.full_name.trim() || null,
      instagram: form.instagram.trim().replace(/^@/, '') || null,
      tags: form.tags.split(',').map((t: string) => t.trim()).filter(Boolean),
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', customer.id);
    setSaving(false);
    if (error) return alert('No se pudo guardar: ' + error.message);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{customer.full_name || 'Sin nombre'}</h3>
            <p className="text-xs text-gray-500">Cliente desde {formatDate(customer.created_at)} · llegó por {labelOf(customer.first_channel)}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            {customer.phone && (
              <a href={whatsappLink(customer.phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-sm">
                <MessageCircle className="h-4 w-4" />{formatPhone(customer.phone)}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-sm">
                <Mail className="h-4 w-4" />{customer.email}
              </a>
            )}
            {customer.instagram && (
              <a href={`https://instagram.com/${customer.instagram}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink-50 text-pink-700 text-sm">
                <Instagram className="h-4 w-4" />@{customer.instagram}
              </a>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Pedidos</div><div className="font-semibold">{customer.orders_count}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Total</div><div className="font-semibold">{formatPrice(Number(customer.total_spent) || 0)}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Última compra</div><div className="font-semibold text-sm">{formatDate(customer.last_order_at)}</div></div>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-500">Nombre
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900" />
            </label>
            <label className="block text-xs font-medium text-gray-500">Instagram
              <input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@usuario" className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900" />
            </label>
            <label className="block text-xs font-medium text-gray-500">Etiquetas (separadas por coma)
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vip, talla M, mayorista" className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900" />
            </label>
            <label className="block text-xs font-medium text-gray-500">Notas
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900" />
            </label>
            <button onClick={save} disabled={saving} className="w-full bg-vandora-emerald text-white py-2 rounded-md text-sm hover:bg-emerald-800 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Pedidos</h4>
            {orders.length === 0 ? <p className="text-sm text-gray-400 italic">Todavía no ha comprado.</p> : (
              <ul className="divide-y border rounded-lg">
                {orders.map((o) => (
                  <li key={o.id} className="px-4 py-3 text-sm flex justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">#{String(o.id).slice(0, 8)} · {labelOf(o.origin)}</div>
                      <div className="text-xs text-gray-500">
                        {formatDate(o.created_at)} · {(o.items || []).map((i: any) => `${i.quantity}× ${i.name}${i.color ? ` (${i.color}${i.size ? `/${i.size}` : ''})` : ''}`).join(', ')}
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div>{formatPrice(Number(o.total) || 0)}</div>
                      <div className="text-xs text-gray-400">{o.status}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Historial</h4>
            <ol className="relative border-l border-gray-200 ml-2 space-y-4">
              {events.map((e) => (
                <li key={e.id} className="ml-4">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-vandora-emerald/70" />
                  <div className="text-sm text-gray-900">{EVENT_LABELS[e.event_type] || e.event_type.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-gray-500">
                    {formatDate(e.created_at)} · {labelOf(e.channel)}{e.source ? ` · ${e.source}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomersPanel;
