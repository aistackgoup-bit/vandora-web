import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Variant = {
  id: string;
  product_id: string;
  color: string;
  size: string;
  stock: number;
  low_stock_threshold: number;
  active: boolean;
};

export type InventoryReason = 'restock' | 'adjustment' | 'return' | 'damage' | 'transfer' | 'initial';

export const REASON_LABELS: Record<string, string> = {
  sale: 'Venta',
  cancel: 'Pedido cancelado',
  order_deleted: 'Pedido eliminado',
  restock: 'Entrada de mercadería',
  adjustment: 'Ajuste por conteo',
  return: 'Devolución',
  damage: 'Daño / pérdida',
  transfer: 'Reasignación',
  initial: 'Stock inicial',
};

// Orders store "Único"/"Única" for products without color or size (mirrors inventory_key in SQL).
export const inventoryKey = (raw?: string | null) => {
  const v = (raw || '').trim().toLowerCase();
  return ['', 'único', 'unico', 'única', 'unica', 'n/a', 'default'].includes(v) ? '' : v;
};

export const isPool = (v: { color: string; size: string }) => v.color === '' && v.size === '';

export const variantLabel = (v: { color: string; size: string }) =>
  isPool(v) ? 'Sin asignar' : [v.color, v.size].filter(Boolean).join(' / ') || 'Única';

export const adjustInventory = async (variantId: string, delta: number, reason: InventoryReason, note?: string) => {
  const { data, error } = await supabase.rpc('adjust_inventory', {
    p_variant_id: variantId,
    p_delta: delta,
    p_reason: reason,
    p_note: note || null,
  });
  if (error) throw error;
  return data as number;
};

// Units that can be sold for a color/size: its own stock, or the product's "sin asignar" pool.
export const availableFor = (variants: Variant[], color?: string, size?: string) => {
  const exact = variants.find((v) => v.active && !isPool(v) &&
    inventoryKey(v.color) === inventoryKey(color) && inventoryKey(v.size) === inventoryKey(size));
  const pool = variants.find(isPool);
  // A sale is taken from a single source (see inventory_consume), so the larger one is what can be sold
  return Math.max(exact?.stock || 0, pool?.stock || 0, 0);
};

// null = inventory tables not installed yet (migration pending): callers fall back to products.stock
export const useProductVariants = (productId?: string | null) => {
  const [variants, setVariants] = useState<Variant[] | null>(null);

  const reload = async () => {
    if (!productId) return setVariants(null);
    const { data, error } = await supabase.from('product_variants').select('*').eq('product_id', productId);
    setVariants(error ? null : (data as Variant[]));
  };

  useEffect(() => {
    reload();
  }, [productId]);

  return { variants, reload };
};
