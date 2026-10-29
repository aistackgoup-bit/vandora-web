import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SalesChannel } from '../../lib/salesChannels';
import { Plus } from 'lucide-react';

// Channels offered when registering a sale. Inactive ones stay valid for past orders.
const SalesChannelsEditor = ({ channels, onChange }: { channels: SalesChannel[]; onChange: () => void }) => {
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (op: PromiseLike<{ error: any }>) => {
    setBusy(true);
    const { error } = await op;
    setBusy(false);
    if (error) return alert('No se pudo guardar: ' + error.message);
    onChange();
  };

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (channels.some((c) => c.key === key)) return alert('Ese canal ya existe.');
    const sort_order = Math.max(0, ...channels.filter((c) => c.key !== 'otro').map((c) => c.sort_order)) + 10;
    setNewLabel('');
    run(supabase.from('sales_channels').insert({ key, label, active: true, sort_order }));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-w-2xl">
      <div className="p-4 border-b text-sm text-gray-500">
        Los canales activos aparecen al registrar una venta. Desactivar uno no afecta los pedidos que ya lo usan.
      </div>
      <ul className="divide-y">
        {channels.map((c) => (
          <li key={c.key} className="px-4 py-3 flex items-center gap-3">
            <input
              defaultValue={c.label}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.label &&
                run(supabase.from('sales_channels').update({ label: e.target.value.trim() }).eq('key', c.key))}
              className="flex-1 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-2 py-1 text-sm"
            />
            <code className="text-xs text-gray-400">{c.key}</code>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={c.active}
                disabled={busy || c.key === 'web'}
                onChange={(e) => run(supabase.from('sales_channels').update({ active: e.target.checked }).eq('key', c.key))}
              />
              Activo
            </label>
          </li>
        ))}
      </ul>
      <div className="p-4 border-t flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Nuevo canal, p. ej. TikTok Shop"
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={add} disabled={busy} className="bg-vandora-emerald text-white px-4 py-2 rounded-md text-sm flex items-center disabled:opacity-50">
          <Plus className="h-4 w-4 mr-1" /> Agregar
        </button>
      </div>
    </div>
  );
};

export default SalesChannelsEditor;
