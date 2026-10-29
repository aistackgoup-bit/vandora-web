import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { r2Storage } from '../../lib/storage';
import { PRESET_OPTIONS, ASPECT_OPTIONS, presetLabel, callStudio } from '../../lib/aiStudio';
import { Sparkles, Loader2, Upload, Check, X, Download, ShoppingBag, AlertCircle, ImageOff } from 'lucide-react';

const JOB_COLUMNS = 'id, product_id, color, preset, status, error, created_at, completed_at, credits_consumed';
const MAX_SOURCES = 5;
const POLL_MS = 6000;
// After this long without a callback, ask kie.ai directly (callbacks can't reach localhost/previews)
const REFRESH_AFTER_MS = 30000;

type Product = { id: string; name: string; colors?: { name: string; code?: string }[]; images?: any[] };

const imageUrl = (img: any) => (typeof img === 'string' ? img : img?.url);

const AiStudioPanel = ({ products, initialProductId, onProductsChanged }: {
  products: Product[];
  initialProductId?: string | null;
  onProductsChanged?: () => void;
}) => {
  const [productId, setProductId] = useState(initialProductId || '');
  const [color, setColor] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [preset, setPreset] = useState<string>(PRESET_OPTIONS[0].key);
  const [aspect, setAspect] = useState<string>(PRESET_OPTIONS[0].aspect);
  const [variations, setVariations] = useState(2);
  const [extra, setExtra] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [jobs, setJobs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [view, setView] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [onlyProduct, setOnlyProduct] = useState(false);
  const [missingSetup, setMissingSetup] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const product = products.find((p) => p.id === productId);

  useEffect(() => {
    if (initialProductId) setProductId(initialProductId);
  }, [initialProductId]);

  useEffect(() => {
    setColor(product?.colors?.[0]?.name || '');
    setSelected([]);
    setUploaded([]);
  }, [productId]);

  // Reference photos: the product's images for this color plus any uploaded for this run
  const sources = useMemo(() => {
    const own = (product?.images || [])
      .filter((img: any) => !color || !img?.color || img.color === color)
      .map(imageUrl)
      .filter(Boolean);
    return [...new Set([...uploaded, ...own])];
  }, [product, color, uploaded]);

  const load = async () => {
    const [jobsRes, imagesRes] = await Promise.all([
      supabase.from('image_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(60),
      supabase.from('generated_images').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    if (jobsRes.error || imagesRes.error) {
      const msg = (jobsRes.error || imagesRes.error)!.message;
      setMissingSetup(/image_jobs|generated_images|does not exist|schema cache/i.test(msg));
      return;
    }
    setMissingSetup(false);
    setJobs(jobsRes.data || []);
    setImages(imagesRes.data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const pendingJobs = jobs.filter((j) => ['queued', 'processing', 'finalizing'].includes(j.status));

  useEffect(() => {
    if (!pendingJobs.length) return;
    const timer = setInterval(async () => {
      const stale = pendingJobs.filter((j) => Date.now() - new Date(j.created_at).getTime() > REFRESH_AFTER_MS).map((j) => j.id);
      if (stale.length) await callStudio({ action: 'refresh', job_ids: stale }).catch(() => {});
      load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingJobs.map((j) => j.id).join()]);

  const toggleSource = (url: string) =>
    setSelected((cur) => cur.includes(url) ? cur.filter((u) => u !== url) : cur.length >= MAX_SOURCES ? cur : [...cur, url]);

  const uploadSource = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    const { url, error } = await r2Storage.uploadFile(file, 'products');
    setUploading(false);
    if (error || !url) return alert('No se pudo subir la foto: ' + (error?.message || ''));
    setUploaded((cur) => [url, ...cur]);
    setSelected((cur) => [url, ...cur].slice(0, MAX_SOURCES));
  };

  const generate = async () => {
    if (!product) return alert('Elige un producto.');
    if (!selected.length) return alert('Elige al menos una foto de referencia.');
    setSubmitting(true);
    try {
      await callStudio({
        action: 'create',
        product_id: product.id,
        color: color || null,
        preset,
        aspect_ratio: aspect,
        variations,
        extra: extra.trim() || undefined,
        source_urls: selected,
      });
      setView('pending');
      await load();
    } catch (err: any) {
      alert('No se pudo iniciar la generación: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (img: any, status: 'approved' | 'rejected') => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('generated_images')
      .update({ status, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString() })
      .eq('id', img.id);
    if (error) return alert('No se pudo guardar: ' + error.message);
    load();
  };

  const addToProduct = async (img: any) => {
    const target = products.find((p) => p.id === img.product_id);
    if (!target) return alert('El producto ya no existe.');
    const { data: fresh, error: readError } = await supabase.from('products').select('images, name').eq('id', target.id).single();
    if (readError) return alert('No se pudo leer el producto: ' + readError.message);
    const current = Array.isArray(fresh.images) ? fresh.images : [];
    if (current.some((i: any) => imageUrl(i) === img.url)) return;
    const entry = { url: img.url, alt: [fresh.name, img.color].filter(Boolean).join(' - '), ...(img.color && { color: img.color }) };
    const { error } = await supabase.from('products').update({ images: [...current, entry] }).eq('id', target.id);
    if (error) return alert('No se pudo añadir: ' + error.message);
    await supabase.from('generated_images').update({ added_to_product: true }).eq('id', img.id);
    onProductsChanged?.();
    load();
  };

  const productName = (id?: string) => products.find((p) => p.id === id)?.name || 'Producto eliminado';
  const visibleImages = images.filter((i) => i.status === view && (!onlyProduct || i.product_id === productId));
  const recentFailures = jobs.filter((j) => j.status === 'failed' && Date.now() - new Date(j.created_at).getTime() < 864e5 &&
    (!onlyProduct || j.product_id === productId));
  const counts = { pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
  images.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });

  if (missingSetup) {
    return (
      <div>
        <Header />
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-6 text-sm">
          El estudio todavía no está creado. Ejecuta la migración
          <code className="mx-1 px-1 bg-white rounded">20261029030000_ai_image_studio.sql</code>
          en Supabase y configura <code className="mx-1 px-1 bg-white rounded">KIE_API_KEY</code> en Vercel.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_1fr] gap-6">
        {/* Generation form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-5 h-fit">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-gray-500">Producto
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900 bg-white">
                <option value="">Elegir…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-500">Color
              <select value={color} onChange={(e) => { setColor(e.target.value); setSelected([]); }} disabled={!product?.colors?.length} className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900 bg-white disabled:bg-gray-50">
                {!product?.colors?.length && <option value="">Sin colores</option>}
                {product?.colors?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div>
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-xs font-medium text-gray-500">Fotos de referencia ({selected.length}/{MAX_SOURCES})</span>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="text-xs text-vandora-emerald flex items-center gap-1 disabled:opacity-50">
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Subir foto nueva
              </button>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { uploadSource(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {!product ? (
              <p className="text-sm text-gray-400 italic">Elige un producto para ver sus fotos.</p>
            ) : sources.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Este color no tiene fotos. Sube una foto de la prenda (con buena luz, de frente).</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {sources.map((url) => {
                  const on = selected.includes(url);
                  return (
                    <button key={url} type="button" onClick={() => toggleSource(url)} className={`relative aspect-square rounded-md overflow-hidden border-2 ${on ? 'border-vandora-emerald' : 'border-transparent'}`}>
                      <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      {on && <span className="absolute top-1 right-1 bg-vandora-emerald text-white rounded-full p-0.5"><Check className="h-3 w-3" /></span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <span className="text-xs font-medium text-gray-500">Plantilla</span>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {PRESET_OPTIONS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => { setPreset(p.key); setAspect(p.aspect); }}
                  className={`text-left p-3 rounded-md border text-sm ${preset === p.key ? 'border-vandora-emerald bg-emerald-50' : 'hover:border-gray-300'}`}
                >
                  <div className="font-medium text-gray-900">{p.label}</div>
                  <div className="text-xs text-gray-500">{p.use} · {p.aspect}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-gray-500">Formato
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900 bg-white">
                {ASPECT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-500">Variaciones
              <select value={variations} onChange={(e) => setVariations(Number(e.target.value))} className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900 bg-white">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          <label className="block text-xs font-medium text-gray-500">Indicaciones extra (opcional)
            <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} maxLength={1000} placeholder="Ej.: mostrar el abrigo abierto, sombra más suave…" className="mt-1 w-full border rounded-md p-2 text-sm text-gray-900" />
          </label>

          <button
            type="button"
            onClick={generate}
            disabled={submitting || !product || !selected.length}
            className="w-full bg-vandora-emerald text-white py-2.5 rounded-md flex items-center justify-center gap-2 hover:bg-emerald-800 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generar {variations > 1 ? `${variations} imágenes` : 'imagen'}
          </button>
          <p className="text-xs text-gray-400">Cada imagen consume créditos de kie.ai. Ninguna se publica sin tu aprobación.</p>
        </div>

        {/* Review gallery */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex bg-gray-100 rounded-lg p-1 text-sm">
              {([['pending', 'Por revisar'], ['approved', 'Aprobadas'], ['rejected', 'Descartadas']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setView(key)} className={`px-3 py-1.5 rounded-md ${view === key ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500'}`}>
                  {label}{counts[key] ? ` (${counts[key]})` : ''}
                </button>
              ))}
            </div>
            {product && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={onlyProduct} onChange={(e) => setOnlyProduct(e.target.checked)} />
                Solo {product.name}
              </label>
            )}
          </div>

          {view === 'pending' && recentFailures.length > 0 && (
            <div className="mb-4 space-y-2">
              {recentFailures.slice(0, 3).map((j) => (
                <div key={j.id} className="flex items-start gap-2 text-sm bg-red-50 text-red-800 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{productName(j.product_id)} · {presetLabel(j.preset)}: {j.error || 'la generación falló'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-4">
            {view === 'pending' && pendingJobs.filter((j) => !onlyProduct || j.product_id === productId).map((j) => (
              <div key={j.id} className="bg-white rounded-lg border border-dashed border-gray-300 aspect-[4/5] flex flex-col items-center justify-center text-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-vandora-emerald mb-3" />
                <div className="text-sm text-gray-700">{productName(j.product_id)}</div>
                <div className="text-xs text-gray-400">{presetLabel(j.preset)}{j.color ? ` · ${j.color}` : ''}</div>
                <div className="text-xs text-gray-400 mt-1">Generando… suele tardar menos de un minuto</div>
              </div>
            ))}

            {visibleImages.map((img) => (
              <div key={img.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                <a href={img.url} target="_blank" rel="noreferrer" className="block bg-gray-50">
                  <img src={img.url} alt={`${productName(img.product_id)} ${img.color || ''}`} className="w-full aspect-[4/5] object-contain" loading="lazy" />
                </a>
                <div className="p-3 flex-1 flex flex-col gap-2">
                  <div>
                    <div className="text-sm font-medium text-gray-900 truncate">{productName(img.product_id)}</div>
                    <div className="text-xs text-gray-500">{presetLabel(img.preset)}{img.color ? ` · ${img.color}` : ''}</div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    {img.status !== 'approved' && (
                      <button onClick={() => review(img, 'approved')} className="flex-1 inline-flex items-center justify-center gap-1 text-xs bg-vandora-emerald text-white rounded px-2 py-1.5"><Check className="h-3 w-3" /> Aprobar</button>
                    )}
                    {img.status === 'approved' && !img.added_to_product && (
                      <button onClick={() => addToProduct(img)} className="flex-1 inline-flex items-center justify-center gap-1 text-xs bg-vandora-emerald text-white rounded px-2 py-1.5"><ShoppingBag className="h-3 w-3" /> A la tienda</button>
                    )}
                    {img.added_to_product && <span className="flex-1 text-xs text-emerald-700 py-1.5 text-center">En la tienda</span>}
                    <a href={img.url} target="_blank" rel="noreferrer" download className="inline-flex items-center justify-center text-xs border rounded px-2 py-1.5 text-gray-700" title="Descargar"><Download className="h-3 w-3" /></a>
                    {img.status !== 'rejected' && !img.added_to_product && (
                      <button onClick={() => review(img, 'rejected')} className="inline-flex items-center justify-center text-xs border rounded px-2 py-1.5 text-gray-500 hover:text-red-600" title="Descartar"><X className="h-3 w-3" /></button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {visibleImages.length === 0 && !(view === 'pending' && pendingJobs.length) && (
            <div className="bg-white rounded-lg border p-12 text-center text-gray-400">
              <ImageOff className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">{view === 'pending' ? 'No hay imágenes por revisar.' : 'Nada por aquí todavía.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Header = () => (
  <div className="mb-4">
    <h3 className="text-lg font-medium text-gray-900 border-l-4 border-vandora-emerald pl-3">Estudio de fotos IA</h3>
    <p className="text-sm text-gray-500 mt-1 pl-4">Fotos con fondo limpio para anuncios y Marketplace a partir de una foto de la prenda (kie.ai).</p>
  </div>
);

export default AiStudioPanel;
