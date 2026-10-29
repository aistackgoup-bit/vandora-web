import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type SalesChannel = { key: string; label: string; active: boolean; sort_order: number };

// Used until the sales_channels table exists, and as labels for legacy order origins.
export const DEFAULT_CHANNELS: SalesChannel[] = [
  { key: 'web', label: 'Tienda web', active: true, sort_order: 10 },
  { key: 'whatsapp', label: 'WhatsApp', active: true, sort_order: 20 },
  { key: 'instagram', label: 'Instagram', active: true, sort_order: 30 },
  { key: 'facebook', label: 'Facebook', active: true, sort_order: 40 },
  { key: 'marketplace', label: 'Facebook Marketplace', active: true, sort_order: 50 },
  { key: 'tienda_fisica', label: 'Tienda física', active: false, sort_order: 60 },
  { key: 'calle', label: 'Venta en la calle', active: false, sort_order: 70 },
  { key: 'otro', label: 'Otro', active: true, sort_order: 99 },
];

export const useSalesChannels = () => {
  const [channels, setChannels] = useState<SalesChannel[]>(DEFAULT_CHANNELS);

  const reload = async () => {
    const { data, error } = await supabase.from('sales_channels').select('*').order('sort_order');
    if (!error && data?.length) setChannels(data as SalesChannel[]);
  };

  useEffect(() => {
    reload();
  }, []);

  const labelOf = (key?: string | null) =>
    channels.find((c) => c.key === key)?.label || (key ? key.replace(/_/g, ' ') : 'Sin canal');

  return { channels, activeChannels: channels.filter((c) => c.active), labelOf, reload };
};

// Shows Ecuadorian numbers the way they are dialed locally: +593991234567 -> 099 123 4567
export const formatPhone = (phone?: string | null) => {
  if (!phone) return '';
  const m = phone.match(/^\+5939(\d{2})(\d{3})(\d{3})$/);
  return m ? `09${m[1]} ${m[2]} ${m[3]}` : phone;
};

export const whatsappLink = (phone?: string | null) => (phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : '');
