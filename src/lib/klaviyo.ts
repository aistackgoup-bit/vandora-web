import { logger } from './logger';
import { supabase } from './supabase';

/**
 * Syncs a product to the Klaviyo Catalog through /api/klaviyo-sync,
 * which holds the private API key server-side.
 */
export const syncProductToKlaviyo = async (product: any) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/klaviyo-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session && { Authorization: `Bearer ${session.access_token}` }),
      },
      body: JSON.stringify({ product }),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) throw new Error(result.error || `Klaviyo sync failed (${res.status})`);

    logger.info(result.action === 'created' ? 'Producto creado en Klaviyo' : 'Producto actualizado en Klaviyo', {
      source: 'klaviyo_sync',
      metadata: { product_id: product.id },
    });
    return { success: true, action: result.action as 'created' | 'updated' };
  } catch (err: any) {
    logger.error('Error sincronizando con Klaviyo', err, {
      source: 'klaviyo_sync',
      metadata: { product_id: product.id },
    });
    return { success: false, error: err.message };
  }
};
