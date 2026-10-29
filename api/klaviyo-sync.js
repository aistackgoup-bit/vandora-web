import { getSettings, readBody, requireStaff } from './_lib/supabase.js';

// Syncs a product to the Klaviyo catalog server-side: the private key stays in Supabase/Vercel.
// It first tries to create the item. If it already exists (409), it updates it.

const SITE_URL = 'https://www.vandora.boutique';

const klaviyoHeaders = (key) => ({
  Authorization: `Klaviyo-API-Key ${key}`,
  accept: 'application/vnd.api+json',
  'content-type': 'application/vnd.api+json',
  revision: '2026-01-15',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req))) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { product } = readBody(req);
    if (!product?.id) return res.status(400).json({ error: 'Missing product' });

    const privateKey =
      process.env.KLAVIYO_PRIVATE_API_KEY ||
      (await getSettings(['klaviyo_private_api_key'])).klaviyo_private_api_key;
    if (!privateKey) return res.status(400).json({ success: false, error: 'Missing API Key' });

    const imageUrls = Array.isArray(product.images)
      ? product.images.map((img) => (typeof img === 'string' ? img : img?.url)).filter(Boolean)
      : [];
    const mainImage = imageUrls[0] || '';

    const attributes = {
      integration_type: '$custom',
      catalog_type: '$default',
      published: true,
      title: product.name,
      external_id: product.id,
      price: parseFloat(product.price) || 0,
      description: product.description || '',
      url: `${SITE_URL}/producto/${product.slug || product.id}`,
      image_full_url: mainImage,
      image_thumbnail_url: mainImage,
      images: imageUrls,
      custom_metadata: { category: product.category || 'General', sku: product.sku || product.id },
    };

    const createResponse = await fetch('https://a.klaviyo.com/api/catalog-items', {
      method: 'POST',
      headers: klaviyoHeaders(privateKey),
      body: JSON.stringify({
        data: {
          type: 'catalog-item',
          attributes,
          relationships: {
            categories: {
              data: [{ type: 'catalog-category', id: `$custom:::$default:::${product.category || 'General'}` }],
            },
          },
        },
      }),
    });

    if (createResponse.ok) return res.status(200).json({ success: true, action: 'created' });

    if (createResponse.status === 409) {
      const updateResponse = await fetch(
        `https://a.klaviyo.com/api/catalog-items/${encodeURIComponent(`$custom:::$default:::${product.id}`)}`,
        {
          method: 'PATCH',
          headers: klaviyoHeaders(privateKey),
          body: JSON.stringify({
            data: { type: 'catalog-item', id: `$custom:::$default:::${product.id}`, attributes: { ...attributes, integration_type: undefined, catalog_type: undefined, external_id: undefined } },
          }),
        }
      );
      if (updateResponse.ok) return res.status(200).json({ success: true, action: 'updated' });
      const err = await updateResponse.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: `Klaviyo update failed: ${updateResponse.status} ${JSON.stringify(err)}` });
    }

    const err = await createResponse.json().catch(() => ({}));
    return res.status(502).json({ success: false, error: `Klaviyo creation failed: ${createResponse.status} ${JSON.stringify(err)}` });
  } catch (error) {
    console.error('Klaviyo sync error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
