import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useParams, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { formatPrice } from '../lib/utils';
import { Star, Truck, ShieldCheck, ArrowLeft, Minus, Plus, ChevronDown, ChevronUp, Clock, Eye, ShoppingBag, Play, X, Ruler, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProductCard from '../components/ProductCard';
import SEO from '../components/SEO';
import SizeGuideModal from '../components/SizeGuideModal';
import { useAnalytics } from '../context/AnalyticsContext';
import { logger } from '../lib/logger';
import { availableFor, useProductVariants } from '../lib/inventory';



const ProductDetailPage = () => {
  const { categoria, slug } = useParams<{ categoria: string; slug: string }>();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [product, setProduct] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [activeAccordion, setActiveAccordion] = useState<string | null>('details');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showVideo, setShowVideo] = useState(false);
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [shippingPolicy, setShippingPolicy] = useState<any>(null);
  const [refundPolicy, setRefundPolicy] = useState<any>(null);
  const [testimonials, setTestimonials] = useState<any[]>([]);
  const { trackStandardEvent } = useAnalytics();
  // null until loaded, or when per-variant inventory isn't installed (then product.stock is used)
  const { variants } = useProductVariants(product?.id);
  const unitsFor = (color: string, size: string) =>
    variants ? availableFor(variants, color, size) : (product?.stock ?? 0);

  // CRO States
  const [viewersCount, setViewersCount] = useState(12);
  const [timeLeft, setTimeLeft] = useState({ hours: 4, minutes: 59 });

  // Filtered media based on color
  const [filteredImages, setFilteredImages] = useState<any[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<any[]>([]);

  const toggleAccordion = (id: string) => {
    setActiveAccordion(activeAccordion === id ? null : id);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setViewersCount(prev => Math.max(5, prev + Math.floor(Math.random() * 3) - 1));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchProductData = async () => {
      // 1. Try exact match
      let { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      // 2. Fallback: Many old slugs mangled characters like 'ñ' into '-' 
      // while the new logic turns them into 'n'. If not found, try common fallbacks.
      if ((error || !data) && slug) {
        // Try replacing 'n' with '-' (covers 'paño' -> 'pa-o' vs 'pano')
        const fallbackSlug = slug.replace(/n/g, '-').replace(/--+/g, '-');
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('products')
          .select('*')
          .eq('slug', fallbackSlug)
          .maybeSingle();
        
        if (!fallbackError && fallbackData) {
          data = fallbackData;
          error = null;
        } else {
          // 3. Ultimate Fallback: Search all products in this category and find the closest match
          // by ignoring all non-alphanumeric characters
          const { data: catProducts } = await supabase
            .from('products')
            .select('*')
            .ilike('category', `%${categoria?.substring(0, 3)}%`);

          if (catProducts && catProducts.length > 0) {
            setProducts(catProducts);
            const strippedSlug = slug.replace(/[^a-z0-9]/g, '');
            const match = catProducts.find(p => {
              const pStripped = (p.slug || '').replace(/[^a-z0-9]/g, '');
              // Match if one string contains the other or they are very similar
              return pStripped === strippedSlug || 
                     pStripped === strippedSlug.replace(/n/g, '') ||
                     strippedSlug === pStripped.replace(/n/g, '');
            });

            if (match) {
              data = match;
              error = null;
            }
          }
        }
      }

      if (!error && data) {
        const parseJSON = (val: any) => {
          if (typeof val !== 'string') return val;
          try {
            const parsed = JSON.parse(val);
            return parsed && typeof parsed === 'object' ? parsed : val;
          } catch (e) {
            return val;
          }
        };

        // Normalize data
        const normalizedData = {
          ...data,
          images: Array.isArray(data.images) 
            ? data.images.map((img: any) => {
              const parsed = parseJSON(img);
              return typeof parsed === 'string' ? { url: parsed } : parsed;
            }) : [],
          colors: Array.isArray(data.colors) 
            ? data.colors.map((c: any) => {
              const parsed = parseJSON(c);
              return typeof parsed === 'object' && parsed !== null ? parsed : { name: String(c), code: '#CCCCCC' };
            }) : [],
          sizes: Array.isArray(data.sizes) ? data.sizes : [],
          videos: Array.isArray(data.videos) 
            ? data.videos.map((v: any) => {
              const parsed = parseJSON(v);
              return typeof parsed === 'string' ? { url: parsed } : parsed;
            }) : []
        };

        if (!normalizedData.image && normalizedData.images.length > 0) {
          normalizedData.image = normalizedData.images[0].url;
        }
        
        // Fetch Testimonials
        const { data: testData } = await supabase
          .from('product_testimonials')
          .select('*')
          .eq('product_id', data.id)
          .eq('is_approved', true)
          .order('created_at', { ascending: false });
        if (testData) setTestimonials(testData);

        if (normalizedData) {
          setProduct(normalizedData);
          if (normalizedData.sizes.length > 0) setSelectedSize(normalizedData.sizes[0]);
          if (normalizedData.colors.length > 0) setSelectedColor(normalizedData.colors[0].name);

          // Fetch shipping and refund policies for SEO schema
          const fetchPolicies = async () => {
            const { data: shipData } = await supabase.from('site_content').select('*').eq('section_key', 'page_shipping').single();
            const { data: refundData } = await supabase.from('site_content').select('*').eq('section_key', 'page_refund').single();
            if (shipData?.content) setShippingPolicy(shipData.content);
            if (refundData?.content) setRefundPolicy(refundData.content);
          };
          fetchPolicies();
        }
      } else {
        navigate('/tienda');
      }
    };
    fetchProductData();
  }, [slug, navigate]);

  // Track ViewContent
  useEffect(() => {
    if (product) {
      trackStandardEvent('ViewContent', {
        content_name: product.name,
        content_ids: [product.id],
        content_type: 'product',
        value: product.price,
        currency: 'USD',
        image_url: product.image
      }, `view-${product.id}-${Date.now()}`);
    }
  }, [product?.id]); // Wait for product

  // Update filtered media when color changes
  useEffect(() => {
    if (product) {
      // Images
      const allImages = Array.isArray(product.images) ? product.images : [];
      const images = allImages.filter((img: any) => !img.color || img.color === selectedColor);
      setFilteredImages(images.length > 0 ? images : allImages);

      // Videos
      const allVideos = Array.isArray(product.videos) ? product.videos : [];
      const vids = allVideos.filter((vid: any) => !vid.color || vid.color === selectedColor);
      setFilteredVideos(vids.length > 0 ? vids : allVideos);

      setActiveImageIndex(0);
    }
  }, [selectedColor, product]);

  // Auto-slide for mobile
  useEffect(() => {
    const interval = setInterval(() => {
      if (!showVideo && filteredImages.length > 1) {
        setActiveImageIndex(prev => (prev + 1) % filteredImages.length);
      }
    }, 4000); // 4 seconds
    return () => clearInterval(interval);
  }, [filteredImages.length, showVideo]);

  if (!product) return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;

  const selectedUnits = unitsFor(selectedColor, selectedSize);
  const soldOut = selectedUnits <= 0;

  const handleAddToCart = () => {
    if (soldOut) return;
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity: quantity,
      size: selectedSize,
      color: selectedColor
    });

    trackStandardEvent('AddToCart', {
      content_name: product.name,
      content_ids: [product.id],
      content_type: 'product',
      value: product.price * quantity,
      currency: 'USD',
      num_items: quantity,
      image_url: product.image
    }, `cart-${product.id}-${Date.now()}`);
  };

  const hasVideo = filteredVideos.length > 0;
  const activeVideo = filteredVideos[0];

  const nextImage = () => {
    setActiveImageIndex((prev) => (prev + 1) % filteredImages.length);
  };

  const prevImage = () => {
    setActiveImageIndex((prev) => (prev - 1 + filteredImages.length) % filteredImages.length);
  };

  const metaDescription = (product.description || '')
    .replace(/<[^>]*>?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Logic for Product Variants (ProductGroup)
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  
  const createProductSchema = (colorName?: string, sizeName?: string) => ({
    "@type": "Product",
    "name": `${product.name}${colorName ? ` - ${colorName}` : ''}${sizeName ? ` - ${sizeName}` : ''}`,
    "image": colorName ? (product.images.find((img: any) => img.color === colorName)?.url || product.image) : product.image,
    "description": metaDescription,
    "sku": `${product.sku || product.id}${colorName ? `-${colorName.replace(/\s+/g, '')}` : ''}${sizeName ? `-${sizeName}` : ''}`,
    "gtin13": product.gtin || undefined,
    "mpn": product.mpn || undefined,
    "brand": { "@type": "Brand", "name": product.brand || "Vandora" },
    "color": colorName || selectedColor || undefined,
    "size": sizeName || selectedSize || undefined,
    "material": product.material_simple || product.materials || undefined,
    "pattern": product.pattern || undefined,
    "audience": {
      "@type": "PeopleAudience",
      "suggestedGender": product.gender === 'female' ? "https://schema.org/Female" : 
                         product.gender === 'male' ? "https://schema.org/Male" : undefined,
      "suggestedAgeGroup": product.age_group || 'adult'
    },
    "category": product.google_product_category || product.category,
    "offers": {
      "@type": "Offer",
      "url": window.location.href,
      "priceCurrency": "USD",
      "price": product.sale_price || product.price,
      "priceValidUntil": new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
      "itemCondition": product.condition === 'used' ? "https://schema.org/UsedCondition" : 
                       product.condition === 'refurbished' ? "https://schema.org/RefurbishedCondition" : 
                       "https://schema.org/NewCondition",
      "availability": product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "EC",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnPeriod",
        "merchantReturnDays": product.return_days || (refundPolicy?.intro?.includes('15') ? 15 : 30),
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": "https://schema.org/FreeReturn"
      },
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": product.shipping_rate || (shippingPolicy?.shipping_line3?.includes('5.00') ? 5.00 : 0.00),
          "currency": "USD"
        },
        "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "EC" },
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 2, "unitCode": "DAY" },
          "transitTime": {
            "@type": "QuantitativeValue",
            "minValue": product.shipping_min_days || (shippingPolicy?.shipping_line2?.includes('2-3') ? 2 : 1),
            "maxValue": product.shipping_max_days || (shippingPolicy?.shipping_line2?.includes('3-5') ? 5 : 7),
            "unitCode": "DAY"
          }
        }
      }
    }
  });

  // Only publish ratings backed by real reviews: invented review markup violates
  // Google's structured-data policies and can get rich results or Merchant listings removed.
  const averageRating = testimonials.length > 0
    ? testimonials.reduce((acc: number, t: any) => acc + (t.rating || 5), 0) / testimonials.length
    : 0;
  const reviewSchema = testimonials.length > 0 ? {
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": averageRating.toFixed(1),
      "reviewCount": testimonials.length
    },
    "review": testimonials.slice(0, 5).map((t: any) => ({
      "@type": "Review",
      "author": { "@type": "Person", "name": t.user_name || "Cliente Satisfecho" },
      "reviewBody": t.comment,
      "datePublished": t.created_at || new Date().toISOString(),
      "reviewRating": { "@type": "Rating", "ratingValue": t.rating || 5 }
    }))
  } : {};

  const hasVariants = colors.length > 1 || sizes.length > 1;
  const productSchema: any = hasVariants ? {
    "@context": "https://schema.org/",
    "@type": "ProductGroup",
    "name": product.name,
    "description": metaDescription,
    "url": window.location.href,
    "brand": { "@type": "Brand", "name": product.brand || "Vandora" },
    "productGroupID": product.id,
    "variesBy": [
      ...(colors.length > 1 ? ["https://schema.org/color"] : []),
      ...(sizes.length > 1 ? ["https://schema.org/size"] : [])
    ],
    "hasVariant": (colors.length > 0 ? colors : [{ name: undefined }]).flatMap(c => 
      (sizes.length > 0 ? sizes : [undefined]).map(s => createProductSchema(c.name, s))
    ),
    ...reviewSchema,
    "datePublished": product.created_at || new Date().toISOString(),
    "dateModified": product.updated_at || product.created_at || new Date().toISOString()
  } : {
    "@context": "https://schema.org/",
    ...createProductSchema(),
    ...reviewSchema,
    "datePublished": product.created_at || new Date().toISOString(),
    "dateModified": product.updated_at || product.created_at || new Date().toISOString()
  };

  return (
    <div className="bg-white min-h-screen py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <SEO
        title={product.name}
        description={product.description}
        image={product.image}
        type="product"
        schema={productSchema}
        canonical={`${window.location.origin}/producto/${product.category.toLowerCase().replace(/\s+/g, '-')}/${product.slug || product.id}`}
      />

      <SizeGuideModal isOpen={isSizeGuideOpen} onClose={() => setIsSizeGuideOpen(false)} />

      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-gray-500 hover:text-vandora-emerald mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Image Gallery */}
          <div className="space-y-4">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-100 group">
              {showVideo && hasVideo ? (
                <div className="w-full h-full flex items-center justify-center bg-black">
                  {/* Placeholder for video player - in real app use <video> or iframe */}
                  <div className="text-white text-center">
                    <Play className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p>Reproduciendo video: {activeVideo?.url || 'N/A'}</p>
                    <button
                      onClick={() => setShowVideo(false)}
                      className="mt-4 text-sm underline hover:text-gray-300"
                    >
                      Volver a imágenes
                    </button>
                  </div>
                </div>
              ) : (
                <img 
                  src={filteredImages[activeImageIndex]?.url || product.image} 
                  alt={filteredImages[activeImageIndex]?.alt || `${product.name} - ${product.category} - Vandora - Vista ${activeImageIndex + 1}`} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="eager" // Principal image should be eager for LCP
                />
              )}

              {/* Mobile Arrows */}
              {!showVideo && filteredImages.length > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); prevImage(); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 p-2 rounded-full shadow-md lg:hidden"
                  >
                    <ArrowLeft className="h-4 w-4 text-gray-800" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); nextImage(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 p-2 rounded-full shadow-md lg:hidden"
                  >
                    <ArrowLeft className="h-4 w-4 text-gray-800 rotate-180" />
                  </button>
                </>
              )}

              {/* Image Navigation Dots (Mobile/Tablet) */}
              <div className="absolute bottom-4 left-0 right-0 flex justify-center space-x-2 lg:hidden">
                {filteredImages.map((_: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`w-2 h-2 rounded-full transition-colors ${activeImageIndex === idx ? 'bg-white' : 'bg-white/50'
                      }`}
                  />
                ))}
              </div>
            </div>

            {/* Thumbnail Gallery (Desktop) */}
            <div className="hidden lg:grid grid-cols-5 gap-4">
              {filteredImages.map((img: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => {
                    setActiveImageIndex(idx);
                    setShowVideo(false);
                  }}
                  className={`aspect-square rounded-md overflow-hidden border-2 transition-all ${activeImageIndex === idx && !showVideo ? 'border-vandora-emerald opacity-100' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                >
                  <img src={img.url} alt={`${product.name} - Miniatura ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
              {hasVideo && (
                <button
                  onClick={() => setShowVideo(true)}
                  className={`aspect-square rounded-md overflow-hidden border-2 flex items-center justify-center bg-gray-100 transition-all ${showVideo ? 'border-vandora-emerald' : 'border-transparent hover:bg-gray-200'
                    }`}
                >
                  <Play className="h-8 w-8 text-gray-600" />
                </button>
              )}
            </div>
          </div>

          {/* Product Info */}
          <div className="flex flex-col">
            <div className="mb-6">
              <h1 className="text-3xl sm:text-4xl font-serif text-gray-900 mb-2">{product.name}</h1>
              {product.sku && (
                <div className="flex items-center gap-2 mb-4">
                  <p className="text-xs text-gray-400 font-mono uppercase tracking-widest">SKU: {product.sku}</p>
                  <span className="text-gray-200">|</span>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                    Publicado: {new Date(product.created_at || Date.now()).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <div className="flex text-yellow-400">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`h-4 w-4 ${i < Math.round(averageRating) ? "fill-current" : "text-gray-300"}`} />
                    ))}
                  </div>
                  <span className="ml-2 text-sm text-gray-500 underline cursor-pointer hover:text-vandora-emerald">({testimonials.length} reseñas)</span>
                </div>

                {/* Social Proof */}
                <div className="flex items-center text-xs text-red-500 font-medium animate-pulse">
                  <Eye className="h-3 w-3 mr-1" />
                  {viewersCount} personas viendo ahora
                </div>
              </div>

              <p className="text-3xl font-medium text-vandora-emerald mb-4">{formatPrice(product.price)}</p>

              {/* Urgency/Scarcity */}
              {selectedUnits > 0 && selectedUnits <= 5 && (
                <div className="mb-6 bg-orange-50 border border-orange-100 rounded-md p-3 flex items-start">
                  <Clock className="h-5 w-5 text-orange-500 mr-2 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-orange-800 font-medium">
                      ¡Solo {selectedUnits === 1 ? 'queda 1 unidad' : `quedan ${selectedUnits} unidades`}{variants && (selectedColor || selectedSize) ? ' en esta talla y color' : ''}!
                    </p>
                    <p className="text-xs text-orange-600 mt-1">Ordena en las próximas {timeLeft.hours}h {timeLeft.minutes}m para recibirlo mañana.</p>
                  </div>
                </div>
              )}

              <div className="prose prose-sm text-gray-600 mb-8">
                <p className="whitespace-pre-line">{product.description}</p>
              </div>
            </div>

            {/* Selectors */}
            <div className="space-y-6 mb-8 bg-gray-50 p-6 rounded-lg border border-gray-100">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Color: <span className="text-gray-500 font-normal">{selectedColor}</span></h3>
                <div className="flex space-x-3">
                  {product.colors.map((color: any) => (
                    <button
                      key={color.name}
                      onClick={() => setSelectedColor(color.name)}
                      className={`w-10 h-10 rounded-full border-2 focus:outline-none transition-all ${selectedColor === color.name
                        ? 'border-vandora-emerald ring-2 ring-emerald-100 ring-offset-2 scale-110'
                        : 'border-gray-200 hover:border-gray-300 hover:scale-105'
                        }`}
                      style={{ backgroundColor: color.code }}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-medium text-gray-900">Talla</h3>
                  <button
                    onClick={() => setIsSizeGuideOpen(true)}
                    className="text-xs text-vandora-emerald underline flex items-center hover:text-emerald-800"
                  >
                    <Ruler className="h-3 w-3 mr-1" />
                    Guía de Tallas
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {product.sizes.map((size: string) => {
                    const unavailable = variants !== null && unitsFor(selectedColor, size) <= 0;
                    return (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        title={unavailable ? 'Agotada en este color' : undefined}
                        className={`min-w-[3rem] h-12 px-3 flex items-center justify-center border rounded-md text-sm font-medium transition-all ${selectedSize === size
                          ? 'border-vandora-emerald text-vandora-emerald bg-white shadow-sm ring-1 ring-vandora-emerald'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                          } ${unavailable ? 'line-through text-gray-300 bg-gray-50' : ''}`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Cantidad</h3>
                <div className="flex items-center w-32 border border-gray-300 rounded-md bg-white">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="p-3 hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
                    disabled={quantity <= 1}
                    aria-label="Disminuir cantidad"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="flex-1 text-center font-medium text-gray-900 select-none">{quantity}</span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="p-3 hover:bg-gray-50 text-gray-600 transition-colors"
                    aria-label="Aumentar cantidad"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col space-y-4 mb-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={handleAddToCart}
                  disabled={soldOut}
                  className="w-full bg-gradient-to-r from-vandora-emerald to-emerald-800 text-white py-4 px-8 rounded-xl hover:shadow-2xl transition-all font-bold shadow-emerald-200/50 active:scale-[0.98] flex items-center justify-center text-sm uppercase tracking-[0.15em] order-last sm:order-first group disabled:from-gray-300 disabled:to-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
                >
                  <ShoppingBag className="h-5 w-5 mr-2 group-hover:rotate-12 transition-transform" />
                  {soldOut ? 'Agotado' : 'Añadir al Carrito'}
                </button>
                <a
                  href={`https://wa.me/593900000000?text=Hola! Estoy interesada en el producto: ${product.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-white text-[#25D366] border border-[#25D366]/30 py-4 px-8 rounded-xl hover:bg-[#25D366] hover:text-white transition-all font-bold shadow-sm flex items-center justify-center text-sm uppercase tracking-[0.15em]"
                >
                  <MessageCircle className="h-5 w-5 mr-2" />
                  Consultar WhatsApp
                </a>
              </div>

              {/* Free Shipping Progress */}
              <div className="bg-emerald-50 rounded-md p-3 text-center text-sm text-emerald-800 border border-emerald-100">
                <span className="font-medium">¡Envío Gratis!</span> en pedidos superiores a $100.
                {product.price * quantity < 100 && (
                  <span className="block text-xs mt-1 text-emerald-600">
                    Agrega {formatPrice(100 - (product.price * quantity))} más para calificar.
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-8 mt-4">
              <div className="flex flex-col items-center text-center p-4 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="bg-vandora-emerald/5 p-3 rounded-full mb-3">
                  <Truck className="h-6 w-6 text-vandora-emerald" />
                </div>
                <h4 className="text-[10px] font-bold text-gray-900 uppercase tracking-widest mb-1">Envío Rápido</h4>
                <p className="text-[9px] text-gray-500 leading-tight">Entrega certificada en 2-3 días hábiles.</p>
              </div>
              <div className="flex flex-col items-center text-center p-4 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="bg-vandora-gold/5 p-3 rounded-full mb-3">
                  <ShieldCheck className="h-6 w-6 text-vandora-gold" />
                </div>
                <h4 className="text-[10px] font-bold text-gray-900 uppercase tracking-widest mb-1">Garantía Vandora</h4>
                <p className="text-[9px] text-gray-500 leading-tight">Tu satisfacción es nuestra prioridad #1.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Product Information Accordion */}
        <div className="mt-16 border-t border-gray-200 pt-10">
          <div className="max-w-4xl mx-auto space-y-4">
            {['Detalles', 'Materiales', 'Cuidados'].map((section) => (
              <div key={section} className="border-b border-gray-200 pb-4">
                <button
                  onClick={() => toggleAccordion(section.toLowerCase())}
                  className="flex w-full items-center justify-between py-4 text-left text-lg font-medium text-gray-900 hover:text-vandora-emerald transition-colors group"
                >
                  {section}
                  {activeAccordion === section.toLowerCase() ? (
                    <ChevronUp className="h-5 w-5 text-gray-500 group-hover:text-vandora-emerald" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500 group-hover:text-vandora-emerald" />
                  )}
                </button>
                <AnimatePresence>
                  {activeAccordion === section.toLowerCase() && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 text-gray-600 leading-relaxed">
                        {section === 'Detalles' && (product.details || 'Sin detalles adicionales.')}
                        {section === 'Materiales' && (product.materials || 'Información de materiales no disponible.')}
                        {section === 'Cuidados' && (product.care || 'Información de cuidados no disponible.')}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-16 border-t border-gray-200 pt-10">
          <h2 className="text-2xl font-serif text-gray-900 mb-8 text-center">Reseñas de Clientes</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.length === 0 ? (
              <div className="col-span-full text-center py-12 text-gray-500 italic">
                Aún no hay reseñas para este producto. ¡Sé la primera en compartir tu experiencia!
              </div>
            ) : (
              testimonials.map((review) => (
                <div key={review.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full">
                  <div className="flex items-center mb-4">
                    <div className="flex text-yellow-400 mr-2">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`h-4 w-4 ${i < review.rating ? 'fill-current' : 'text-gray-200'}`} />
                      ))}
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                      {new Date(review.created_at).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <h4 className="font-bold text-gray-900 mb-2">{review.user_name}</h4>
                  <p className="text-gray-600 text-sm italic mb-4 flex-grow">"{review.comment}"</p>
                  
                  {review.size_info && (
                    <div className="mb-4 p-2 bg-emerald-50 rounded-lg border border-emerald-100/50">
                      <p className="text-[10px] text-emerald-800 font-medium">
                        <Ruler className="inline h-3 w-3 mr-1 mb-0.5" /> {review.size_info}
                      </p>
                    </div>
                  )}

                  {((review.images && review.images.length > 0) || (review.videos && review.videos.length > 0)) && (
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                      {review.images?.map((img: string, idx: number) => (
                        <div key={idx} className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-gray-100">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                      {review.videos?.map((vid: any, idx: number) => (
                        <div key={idx} className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center">
                          <Play className="h-4 w-4 text-gray-400" />
                          <div className="absolute inset-0 bg-black/10"></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recommended Products */}
        <div className="mt-16 border-t border-gray-200 pt-10">
          <h2 className="text-2xl font-serif text-gray-900 mb-8 text-center">También te podría gustar</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {products.filter(p => p.id !== product.id).slice(0, 4).map((relatedProduct) => (
              <ProductCard key={relatedProduct.id} {...relatedProduct} />
            ))}
          </div>
        </div>
      </div>

      {/* Sticky Mobile Add to Cart */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 lg:hidden z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex gap-4">
          <div className="flex flex-col justify-center">
            <span className="text-xs text-gray-500">Total:</span>
            <span className="font-bold text-vandora-emerald">{formatPrice(product.price * quantity)}</span>
          </div>
          <button
            onClick={handleAddToCart}
            disabled={soldOut}
            className="flex-1 bg-vandora-emerald text-white py-3 rounded-md font-medium shadow-sm active:scale-[0.98] transition-transform disabled:bg-gray-300"
          >
            {soldOut ? 'Agotado' : 'Añadir al Carrito'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailPage;

