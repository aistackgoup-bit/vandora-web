import React, { useState, useEffect } from 'react';
import { useCart } from '../context/CartContext';
import { ecuadorLocations } from '../lib/ecuador';
import { formatPrice } from '../lib/utils';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAffiliateId } from '../components/AffiliateTracker';
import { CheckCircle, Truck, CreditCard, ShieldCheck, Lock, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import SEO from '../components/SEO';
import PhoneInput from '../components/PhoneInput';
import { useAnalytics } from '../context/AnalyticsContext';
import { getAttribution } from '../lib/attribution';

interface CheckoutSettings {
  fields: {
    firstName: { enabled: boolean; required: boolean; label: string };
    lastName: { enabled: boolean; required: boolean; label: string };
    phone: { enabled: boolean; required: boolean; label: string };
    email: { enabled: boolean; required: boolean; label: string };
    province: { enabled: boolean; required: boolean; label: string };
    city: { enabled: boolean; required: boolean; label: string };
    sector: { enabled: boolean; required: boolean; label: string };
    address: { enabled: boolean; required: boolean; label: string };
    reference: { enabled: boolean; required: boolean; label: string };
    company: { enabled: boolean; required: boolean; label: string };
    address2: { enabled: boolean; required: boolean; label: string };
    postalCode: { enabled: boolean; required: boolean; label: string };
  };
  paymentMethods: {
    transfer: boolean;
    cash: boolean;
    card: boolean;
  };
  transferDetails: string;
  banks: { name: string; details: string }[];
  shippingRules: {
    freeShippingThreshold: number;
    codCities: string[];
    freeShippingCities: string[];
  };
}

const DEFAULT_SETTINGS: CheckoutSettings = {
  fields: {
    firstName: { enabled: true, required: true, label: 'Nombres' },
    lastName: { enabled: true, required: true, label: 'Apellidos' },
    phone: { enabled: true, required: true, label: 'Teléfono / WhatsApp' },
    email: { enabled: true, required: true, label: 'Correo Electrónico' },
    province: { enabled: true, required: true, label: 'Provincia' },
    city: { enabled: true, required: true, label: 'Ciudad' },
    sector: { enabled: true, required: true, label: 'Sector / Barrio' },
    address: { enabled: true, required: true, label: 'Dirección Exacta' },
    reference: { enabled: true, required: true, label: 'Referencia' },
    company: { enabled: true, required: false, label: 'Empresa' },
    address2: { enabled: true, required: false, label: 'Apartamento / Suite' },
    postalCode: { enabled: false, required: false, label: 'Código Postal' },
  },

  paymentMethods: { transfer: true, cash: true, card: false },
  transferDetails: "Banco Pichincha\nCuenta Corriente: 1234567890\nNombre: Vandora Moda\nRUC: 1790000000001",
  banks: [
    { name: 'Banco Pichincha', details: 'Cuenta Corriente: 1234567890\nNombre: Vandora Moda\nRUC: 1790000000001' },
    { name: 'Banco Guayaquil', details: 'Cuenta Ahorros: 0987654321\nNombre: Vandora Moda\nRUC: 1790000000001' }
  ],
  shippingRules: { freeShippingThreshold: 100, codCities: ['Quito', 'Guayaquil', 'Cuenca'], freeShippingCities: [] },
};
const DEFAULT_FUNNEL_CONFIG = {
  order_bump: {
    product_id: '',
    title: '¡OFERTA ÚNICA! 🔥',
    description: 'Añade este complemento con descuento.',
    cta_text: 'SÍ, AGREGAR',
    accent_color: '#EAB308'
  }
};

const CheckoutPage = () => {
  const { items, total, clearCart } = useCart();
  const { user } = useAuth();
  const { trackStandardEvent } = useAnalytics();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<CheckoutSettings>(DEFAULT_SETTINGS);
  const [funnelConfig, setFunnelConfig] = useState(DEFAULT_FUNNEL_CONFIG);
  const [loadingSettings, setLoadingSettings] = useState(true);

  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    company: '',
    address: '',
    apartment: '',
    province: '',
    city: '',
    sector: '',
    reference: '',
    postalCode: '',
    phone: '',
    paymentMethod: '',
    selectedBank: ''
  });

  const [cities, setCities] = useState<string[]>([]);
  const [shippingCost, setShippingCost] = useState(5.00);
  const [isCodAvailable, setIsCodAvailable] = useState(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);

  const [bumpProduct, setBumpProduct] = useState<any>(null);
  const [isBumpAccepted, setIsBumpAccepted] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data: checkoutData } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'checkout_config')
          .single();

        if (checkoutData) {
          const mergedCheckoutSettings = {
            ...DEFAULT_SETTINGS,
            ...checkoutData.value,
            fields: { ...DEFAULT_SETTINGS.fields, ...checkoutData.value.fields },
            paymentMethods: { ...DEFAULT_SETTINGS.paymentMethods, ...checkoutData.value.paymentMethods },
            shippingRules: { ...DEFAULT_SETTINGS.shippingRules, ...checkoutData.value.shippingRules }
          };
          setSettings(mergedCheckoutSettings);
        }

        const { data: funnelData } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'funnel_config')
          .single();

        if (funnelData) {
          setFunnelConfig({ ...DEFAULT_FUNNEL_CONFIG, ...funnelData.value });
        }
      } catch (error) {
        console.error('Error loading checkout settings', error);
      } finally {
        setLoadingSettings(false);
      }
    };
    fetchSettings();
  }, []);

  // Track InitiateCheckout
  useEffect(() => {
    if (items.length > 0) {
      trackStandardEvent('InitiateCheckout', {
        content_ids: items.map(i => i.id),
        content_type: 'product',
        value: total,
        currency: 'USD',
        num_items: items.reduce((acc, i) => acc + i.quantity, 0),
        item_names: items.map(i => i.name),
        items: items.map(i => ({
          id: i.id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          image: i.image
        }))
      }, `initiate-${Date.now()}`);
    }
  }, []); // Only once on mount

  // Fetch user's last order for auto-fill
  useEffect(() => {
    const fetchLastOrder = async () => {
      if (user) {
        try {
          const { data, error } = await supabase
            .from('orders')
            .select('customer_name, customer_email, customer_phone, shipping_province, shipping_city, address, shipping_reference')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (data && !error) {
            const [firstName, ...lastNameParts] = data.customer_name.split(' ');
            const lastName = lastNameParts.join(' ');
            
            // Clean address to extract sector if possible
            const addressParts = data.address.split(', ');
            const sector = addressParts.length > 2 ? addressParts[addressParts.length - 3] : '';
            const mainAddress = addressParts[0];

            setFormData(prev => ({
              ...prev,
              firstName: firstName || prev.firstName,
              lastName: lastName || prev.lastName,
              email: data.customer_email || prev.email,
              phone: data.customer_phone || prev.phone,
              province: data.shipping_province || prev.province,
              city: data.shipping_city || prev.city,
              address: mainAddress || prev.address,
              sector: sector || prev.sector,
              reference: data.shipping_reference || prev.reference
            }));

            // Sync cities dropdown if province exists
            if (data.shipping_province) {
              const location = ecuadorLocations.find(loc => loc.province === data.shipping_province);
              if (location) setCities(location.cities);
            }
          }
        } catch (err) {
          console.warn('Error fetching last order for auto-fill:', err);
        }
      }
    };
    fetchLastOrder();
  }, [user]);

  useEffect(() => {
    const fetchBumpProduct = async () => {
      if (items.length > 0 && !loadingSettings) {
        let bumpProductId = '';
        
        try {
          // 1. Try product-specific bump
          const { data: mainProduct } = await supabase
            .from('products')
            .select('order_bump_product_id')
            .eq('id', items[0].id)
            .single();

          if (mainProduct && mainProduct.order_bump_product_id) {
            bumpProductId = mainProduct.order_bump_product_id;
          } else if (funnelConfig.order_bump.product_id) {
            // 2. Try global bump
            bumpProductId = funnelConfig.order_bump.product_id;
          }

          if (bumpProductId && !items.find(i => i.id === bumpProductId)) {
            const { data: bump } = await supabase
              .from('products')
              .select('*')
              .eq('id', bumpProductId)
              .single();

            if (bump) {
              setBumpProduct(bump);
            }
          }
        } catch (e) {
          console.error("Error fetching bump product", e);
        }
      }
    };
    fetchBumpProduct();
  }, [items, loadingSettings, funnelConfig]);

  useEffect(() => {
    if (!loadingSettings) {
      let cost = 5.00;
      const currentTotal = total + (isBumpAccepted && bumpProduct ? bumpProduct.price : 0);

      if (currentTotal >= settings.shippingRules.freeShippingThreshold) {
        cost = 0;
      } else if (settings.shippingRules.freeShippingCities.includes(formData.city)) {
        cost = 0;
      }
      setShippingCost(cost);

      const canCod = settings.shippingRules.codCities.length === 0 || settings.shippingRules.codCities.includes(formData.city);
      setIsCodAvailable(canCod);
      setShowPaymentMethods(!!formData.city);

      const availableMethods = [];
      if (settings.paymentMethods.transfer) availableMethods.push('transfer');
      if (settings.paymentMethods.cash && canCod) availableMethods.push('cash');

      if (availableMethods.length === 1 && !formData.paymentMethod) {
        setFormData(prev => ({ ...prev, paymentMethod: availableMethods[0] }));
      }

      if (formData.paymentMethod === 'cash' && !canCod) {
        setFormData(prev => ({ ...prev, paymentMethod: '' }));
      }
    }
  }, [formData.city, total, settings, loadingSettings, isBumpAccepted, bumpProduct]);

  const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const province = e.target.value;
    const location = ecuadorLocations.find(loc => loc.province === province);
    setCities(location ? location.cities : []);
    setFormData({ ...formData, province, city: '', paymentMethod: '' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  // Abandoned Cart Tracking Logic
  useEffect(() => {
    const trackCart = async () => {
      if ((formData.email || formData.phone) && items.length > 0) {
        try {
          // Identify existing record or create new one
          const { error } = await supabase
            .from('abandoned_carts')
            .upsert({
              customer_email: formData.email?.trim() || null,
              customer_phone: formData.phone?.trim() || null,
              cart_items: items,
              total_amount: total,
              updated_at: new Date().toISOString(),
              user_id: user?.id || null,
              status: 'pending'
            }, { 
              onConflict: 'customer_email,customer_phone'
            });

          if (error) {
            // Logs for debugging but don't show to user
            console.warn('Abandoned cart sync error:', error.message);
          }
        } catch (error) {
          // Fail silently to not interrupt UX
          console.warn('Abandoned cart tracking failed', error);
        }
      }
    };

    const timer = setTimeout(trackCart, 2000); // Debounce tracking
    return () => clearTimeout(timer);
  }, [formData.email, formData.phone, items, total, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.paymentMethod) {
      alert('Por favor selecciona un método de pago.');
      return;
    }

    if (formData.paymentMethod === 'transfer' && !formData.selectedBank) {
      alert('Por favor selecciona un banco para realizar la transferencia.');
      return;
    }

    const finalItems = [...items];
    if (isBumpAccepted && bumpProduct) {
      finalItems.push({
        id: bumpProduct.id,
        name: bumpProduct.name,
        price: bumpProduct.price,
        image: bumpProduct.images?.[0]?.url || bumpProduct.image,
        quantity: 1,
        size: 'Única',
        color: 'Único'
      });
    }

    const currentTotal = total + (isBumpAccepted && bumpProduct ? bumpProduct.price : 0);
    
    const orderData: any = {
      items: finalItems,
      total: currentTotal + shippingCost,
      shipping_cost: shippingCost,
      payment_method: formData.paymentMethod,
      bank: formData.selectedBank,
      customer_name: `${formData.firstName} ${formData.lastName}`,
      customer_email: formData.email,
      customer_phone: formData.phone,
      address: `${formData.address}${formData.apartment ? ', ' + formData.apartment : ''}, ${formData.sector}, ${formData.city}, ${formData.province}`,
      shipping_address: `${formData.address}${formData.apartment ? ', ' + formData.apartment : ''}, ${formData.sector}, ${formData.city}, ${formData.province}`,
      shipping_city: formData.city,
      shipping_province: formData.province,
      shipping_country: 'Ecuador',
      shipping_reference: formData.reference || '',
      province: formData.province,
      city: formData.city,
      status: 'pending',
      notes: '',
      created_at: new Date().toISOString(),
      user_id: user?.id || null,
      affiliate_id: getAffiliateId(),
      origin: 'web',
      attribution: getAttribution()
    };

    try {
      console.log('Checkout: Submitting order with user ID:', user?.id);
      console.log('Checkout: Order details:', orderData);

      let { data: orderResult, error: orderError } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();

      // Until the CRM migration adds orders.attribution, never lose a sale over it
      if (orderError && /attribution/.test(orderError.message || '')) {
        const { attribution, ...withoutAttribution } = orderData;
        ({ data: orderResult, error: orderError } = await supabase
          .from('orders')
          .insert([withoutAttribution])
          .select()
          .single());
      }

      if (orderError) {
        console.error('CRITICAL: Supabase Order Insertion Failed', {
          error: orderError,
          payload: orderData
        });
        throw new Error(orderError.message || 'Error al procesar el pedido en el servidor');
      }

      if (!orderResult) {
        throw new Error('El pedido se creó pero no se pudo recuperar la confirmación. Por favor contacta a soporte.');
      }

      // Affiliate Attribution Logic
      const affiliateCode = getAffiliateId();
      if (affiliateCode) {
        try {
          // 1. Find the affiliate by code
          const { data: affiliate } = await supabase
            .from('affiliates')
            .select('id, commission_rate')
            .eq('referral_code', affiliateCode)
            .eq('status', 'active')
            .maybeSingle();

          if (affiliate) {
            // 2. Calculate commission (default 10% if not set)
            const rate = affiliate.commission_rate || 10;
            const commissionAmount = (currentTotal * rate) / 100;

            // 3. Create referral record
            await supabase
              .from('affiliate_referrals')
              .insert([{
                affiliate_id: affiliate.id,
                order_id: orderResult.id,
                amount: commissionAmount,
                status: 'pending'
              }]);
            
            console.log('Affiliate referral created successfully');
          }
        } catch (affErr) {
          console.error('Error in affiliate attribution:', affErr);
          // Don't fail the whole order if attribution fails
        }
      }

      // Fix for profiles table - check by id if user is logged in, or don't try to sync if guest
      // Removed email_notifications as it doesn't exist in profiles schema
      try {
        if (user) {
          const { error: profileError } = await supabase
            .from('profiles')
            .update({ full_name: `${formData.firstName} ${formData.lastName}` })
            .eq('id', user.id);
          
          if (profileError) console.warn('Profile update failed:', profileError);
        }
      } catch (profileErr) {
        console.warn('Profile sync skipped:', profileErr);
      }

      // Clear abandoned cart entry if it exists
      if (formData.email || formData.phone) {
        await supabase
          .from('abandoned_carts')
          .delete()
          .or(`customer_email.eq.${formData.email},customer_phone.eq.${formData.phone}`);
      }

      clearCart();
      navigate('/upsell', { state: { order: orderResult } });
    } catch (err: any) {
      console.error('CRITICAL Order Submission Failure:', err);
      alert(`Hubo un problema al procesar tu pedido: ${err.message || 'Error desconocido'}. Por favor intenta de nuevo.`);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h2 className="text-2xl font-serif text-gray-900 mb-4">Tu carrito está vacío</h2>
        <button
          onClick={() => navigate('/tienda')}
          className="text-vandora-emerald hover:underline"
        >
          Volver a la tienda
        </button>
      </div>
    );
  }

  if (loadingSettings) {
    return <div className="min-h-screen flex items-center justify-center">Cargando checkout...</div>;
  }

  return (
    <div className="bg-gray-50 min-h-screen py-8 px-4 sm:px-6 lg:px-8">
      <SEO title="Finalizar Compra" description="Completa tu pedido de forma segura." />

      <div className="max-w-7xl mx-auto">
        <div className="flex justify-center mb-8 space-x-8 text-sm text-gray-500">
          <div className="flex items-center"><Lock className="w-4 h-4 mr-1 text-green-600" /> Pago Seguro</div>
          <div className="flex items-center"><Truck className="w-4 h-4 mr-1 text-green-600" /> Envío Garantizado</div>
          <div className="flex items-center"><ShieldCheck className="w-4 h-4 mr-1 text-green-600" /> Datos Protegidos</div>
        </div>

        {!user && (
          <div className="bg-vandora-emerald/5 border border-vandora-emerald/20 rounded-lg p-4 mb-8 flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-vandora-emerald/10 p-2 rounded-full mr-3">
                <CheckCircle className="h-5 w-5 text-vandora-emerald" />
              </div>
              <p className="text-sm text-gray-700">
                <span className="font-bold">¿Ya eres cliente?</span> Inicia sesión para usar tus datos guardados y finalizar más rápido.
              </p>
            </div>
            <Link 
              to="/iniciar-sesion" 
              className="text-vandora-emerald font-bold text-sm hover:underline border border-vandora-emerald px-4 py-2 rounded-md transition-colors hover:bg-vandora-emerald hover:text-white"
            >
              Iniciar sesión
            </Link>
          </div>
        )}

        {user && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-8 flex items-center">
            <div className="bg-emerald-100 p-2 rounded-full mr-3 text-emerald-600">
              <CheckCircle className="h-5 w-5" />
            </div>
            <p className="text-sm text-emerald-800">
              <span className="font-bold">¡Hola!</span> Hemos cargado los datos de tu último pedido para tu comodidad.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm p-6 sticky top-24 border border-gray-100">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Resumen del Pedido</h2>
              <div className="flow-root max-h-96 overflow-y-auto pr-2">
                <ul className="-my-4 divide-y divide-gray-200">
                  {items.map((item) => (
                    <li key={`${item.id}-${item.size}-${item.color}`} className="flex py-4">
                      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-gray-200">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="h-full w-full object-cover object-center"
                        />
                      </div>
                      <div className="ml-4 flex flex-1 flex-col">
                        <div>
                          <div className="flex justify-between text-base font-medium text-gray-900">
                            <h3>{item.name}</h3>
                            <p className="ml-4">{formatPrice(item.price * item.quantity)}</p>
                          </div>
                          <p className="mt-1 text-sm text-gray-500">{item.color} | {item.size}</p>
                        </div>
                        <div className="flex flex-1 items-end justify-between text-sm">
                          <p className="text-gray-500">Cant: {item.quantity}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-gray-200 mt-6 pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">Subtotal</p>
                  <p className="text-sm font-medium text-gray-900">{formatPrice(total)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">Envío</p>
                  <p className="text-sm font-medium text-gray-900">
                    {shippingCost === 0 ? <span className="text-green-600">GRATIS</span> : formatPrice(shippingCost)}
                  </p>
                </div>

                {shippingCost > 0 && (
                  <div className="bg-blue-50 p-3 rounded-md text-xs text-blue-700 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Te faltan {formatPrice(settings.shippingRules.freeShippingThreshold - total)} para envío gratis.
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                  <p className="text-xl font-bold text-gray-900">Total</p>
                  <p className="text-xl font-bold text-vandora-emerald">{formatPrice(total + (isBumpAccepted && bumpProduct ? bumpProduct.price : 0) + shippingCost)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Contacto</h2>
                  <span className="text-xs text-gray-500">Paso 1 de 3</span>
                </div>
                <div className="grid grid-cols-1 gap-y-6">
                  {settings.fields.email.enabled && (
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                        {settings.fields.email.label} {settings.fields.email.required && '*'}
                      </label>
                      <input
                        type="email"
                        name="email"
                        id="email"
                        required={settings.fields.email.required}
                        value={formData.email}
                        onChange={handleInputChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                        placeholder="tu@email.com"
                      />
                    </div>
                  )}
                  {settings.fields.phone.enabled && (
                    <PhoneInput
                      label={settings.fields.phone.label}
                      required={settings.fields.phone.required}
                      value={formData.phone}
                      onChange={(value) => setFormData({ ...formData, phone: value })}
                    />
                  )}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Dirección de Envío</h2>
                  <span className="text-xs text-gray-500">Paso 2 de 3</span>
                </div>
                <div className="grid grid-cols-1 gap-y-6 sm:grid-cols-2 sm:gap-x-4">
                  {settings.fields.firstName.enabled && (
                    <div>
                      <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                        {settings.fields.firstName.label} {settings.fields.firstName.required && '*'}
                      </label>
                      <input
                        type="text"
                        name="firstName"
                        id="firstName"
                        required={settings.fields.firstName.required}
                        value={formData.firstName}
                        onChange={handleInputChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                      />
                    </div>
                  )}
                  {settings.fields.lastName.enabled && (
                    <div>
                      <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                        {settings.fields.lastName.label} {settings.fields.lastName.required && '*'}
                      </label>
                      <input
                        type="text"
                        name="lastName"
                        id="lastName"
                        required={settings.fields.lastName.required}
                        value={formData.lastName}
                        onChange={handleInputChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                      />
                    </div>
                  )}

                  {settings.fields.province.enabled && (
                    <div>
                      <label htmlFor="province" className="block text-sm font-medium text-gray-700">
                        {settings.fields.province.label} {settings.fields.province.required && '*'}
                      </label>
                      <select
                        id="province"
                        name="province"
                        required={settings.fields.province.required}
                        value={formData.province}
                        onChange={handleProvinceChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                      >
                        <option value="">Seleccionar...</option>
                        {ecuadorLocations.map((loc) => (
                          <option key={loc.province} value={loc.province}>{loc.province}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {settings.fields.city.enabled && (
                    <div>
                      <label htmlFor="city" className="block text-sm font-medium text-gray-700">
                        {settings.fields.city.label} {settings.fields.city.required && '*'}
                      </label>
                      <select
                        id="city"
                        name="city"
                        required={settings.fields.city.required}
                        value={formData.city}
                        onChange={handleInputChange}
                        disabled={!formData.province}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border disabled:bg-gray-100"
                      >
                        <option value="">Seleccionar...</option>
                        {cities.map((city) => (
                          <option key={city} value={city}>{city}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {settings.fields.sector.enabled && (
                    <div className="sm:col-span-2">
                      <label htmlFor="sector" className="block text-sm font-medium text-gray-700">
                        {settings.fields.sector.label} {settings.fields.sector.required && '*'}
                      </label>
                      <input
                        type="text"
                        name="sector"
                        id="sector"
                        required={settings.fields.sector.required}
                        value={formData.sector}
                        onChange={handleInputChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                        placeholder="Ej: Norte, Cumbayá, Centro Histórico"
                      />
                    </div>
                  )}

                  {settings.fields.address.enabled && (
                    <div className="sm:col-span-2">
                      <label htmlFor="address" className="block text-sm font-medium text-gray-700">
                        {settings.fields.address.label} {settings.fields.address.required && '*'}
                      </label>
                      <input
                        type="text"
                        name="address"
                        id="address"
                        required={settings.fields.address.required}
                        value={formData.address}
                        onChange={handleInputChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                        placeholder="Calle principal y secundaria"
                      />
                    </div>
                  )}

                  {settings.fields.reference.enabled && (
                    <div className="sm:col-span-2">
                      <label htmlFor="reference" className="block text-sm font-medium text-gray-700">
                        {settings.fields.reference.label} {settings.fields.reference.required && '*'}
                      </label>
                      <input
                        type="text"
                        name="reference"
                        id="reference"
                        required={settings.fields.reference.required}
                        value={formData.reference}
                        onChange={handleInputChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-3 border"
                        placeholder="Ej: Frente a la farmacia, casa color blanco"
                      />
                    </div>
                  )}
                </div>
              </div>

              {showPaymentMethods ? (
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium text-gray-900">Método de Pago</h2>
                    <span className="text-xs text-gray-500">Paso 3 de 3</span>
                  </div>
                  <div className="space-y-4">
                    {settings.paymentMethods.transfer && (
                      <div
                        className={`border rounded-lg p-4 cursor-pointer transition-all ${formData.paymentMethod === 'transfer' ? 'border-vandora-emerald bg-emerald-50 ring-1 ring-vandora-emerald' : 'border-gray-200 hover:border-gray-300'}`}
                        onClick={() => setFormData({ ...formData, paymentMethod: 'transfer' })}
                      >
                        <div className="flex items-center">
                          <input
                            id="transfer"
                            name="paymentMethod"
                            type="radio"
                            value="transfer"
                            checked={formData.paymentMethod === 'transfer'}
                            onChange={handleInputChange}
                            className="h-4 w-4 border-gray-300 text-vandora-emerald focus:ring-vandora-emerald"
                          />
                          <label htmlFor="transfer" className="ml-3 block text-sm font-medium text-gray-900 cursor-pointer">
                            Transferencia Bancaria
                          </label>
                        </div>
                        {formData.paymentMethod === 'transfer' && (
                          <div className="mt-3 ml-7">
                            <p className="text-sm text-gray-600 mb-2">Selecciona un banco:</p>
                            <select
                              name="selectedBank"
                              value={formData.selectedBank}
                              onChange={handleInputChange}
                              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-vandora-emerald focus:ring-vandora-emerald sm:text-sm p-2 border"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <option value="">-- Seleccionar Banco --</option>
                              {(settings.banks || []).map((bank, idx) => (
                                <option key={idx} value={bank.name}>{bank.name}</option>
                              ))}
                            </select>
                            {formData.selectedBank && (
                              <p className="mt-2 text-xs text-gray-500 italic">
                                Los datos de la cuenta se enviarán a tu correo y WhatsApp al confirmar el pedido.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {settings.paymentMethods.cash && isCodAvailable && (
                      <div
                        className={`border rounded-lg p-4 cursor-pointer transition-all ${formData.paymentMethod === 'cash' ? 'border-vandora-emerald bg-emerald-50 ring-1 ring-vandora-emerald' : 'border-gray-200 hover:border-gray-300'}`}
                        onClick={() => setFormData({ ...formData, paymentMethod: 'cash' })}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <input
                              id="cash"
                              name="paymentMethod"
                              type="radio"
                              value="cash"
                              checked={formData.paymentMethod === 'cash'}
                              onChange={handleInputChange}
                              className="h-4 w-4 border-gray-300 text-vandora-emerald focus:ring-vandora-emerald"
                            />
                            <label htmlFor="cash" className="ml-3 block text-sm font-medium text-gray-900 cursor-pointer">
                              Pago Contra Entrega
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 text-center text-gray-500">
                  <p>Completa la dirección de envío para ver los métodos de pago disponibles.</p>
                </div>
              )}

              {bumpProduct && (
                <div 
                  className="bg-yellow-50 border-2 border-dashed rounded-lg p-4 animate-pulse"
                  style={{ borderColor: funnelConfig.order_bump.accent_color || '#EAB308' }}
                >
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isBumpAccepted}
                      onChange={(e) => setIsBumpAccepted(e.target.checked)}
                      className="h-5 w-5 text-vandora-emerald border-gray-300 rounded mt-1 focus:ring-vandora-emerald cursor-pointer"
                    />
                    <div className="ml-3">
                      <h3 
                        className="text-sm font-bold uppercase"
                        style={{ color: funnelConfig.order_bump.accent_color || '#dc2626' }}
                      >
                        {funnelConfig.order_bump.title}
                      </h3>
                      <p className="text-sm font-medium text-gray-900">
                        {funnelConfig.order_bump.description.replace('{product}', bumpProduct.name)}
                        {' '}
                        <span className="font-bold text-green-600">{formatPrice(bumpProduct.price)}</span>
                      </p>
                    </div>
                  </label>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-vandora-emerald text-white py-4 px-8 rounded-md hover:bg-emerald-800 transition-colors font-medium text-lg shadow-lg flex items-center justify-center"
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                Confirmar Pedido - {formatPrice(total + (isBumpAccepted && bumpProduct ? bumpProduct.price : 0) + shippingCost)}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutPage;
