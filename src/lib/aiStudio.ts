import { supabase } from './supabase';

// Mirrors the PRESETS in api/_lib/kie.js (the prompts live on the server).
export const PRESET_OPTIONS = [
  { key: 'marketplace_blanco', label: 'Fondo blanco', use: 'Marketplace y catálogo', aspect: '1:1' },
  { key: 'estudio_neutro', label: 'Estudio neutro', use: 'Anuncios en el feed', aspect: '4:5' },
  { key: 'historia_vertical', label: 'Vertical con espacio', use: 'Historias y Reels', aspect: '9:16' },
  { key: 'plano_detalle', label: 'Flat lay', use: 'Feed y detalle de tela', aspect: '4:5' },
  { key: 'modelo_estudio', label: 'Con modelo', use: 'Anuncios con persona', aspect: '4:5' },
] as const;

export const ASPECT_OPTIONS = ['1:1', '4:5', '3:4', '9:16', '16:9', '2:3', '3:2'];

export const presetLabel = (key?: string | null) => PRESET_OPTIONS.find((p) => p.key === key)?.label || key || '';

export const callStudio = async (payload: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/kie-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session && { Authorization: `Bearer ${session.access_token}` }),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
};
