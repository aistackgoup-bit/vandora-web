import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Edit, Trash, Package, ShoppingBag, Users, Layout as LayoutIcon, Sparkles, Settings, X, Image as ImageIcon, Menu, Ruler, Copy, Megaphone, Loader2, History, Star, Play, Zap, Download, Contact, Boxes } from 'lucide-react';
import { formatPrice } from '../lib/utils';
import MediaManager from '../components/MediaManager';
import SiteEditor from '../components/SiteEditor';
import QuizBuilder from '../components/QuizBuilder';
import SettingsEditor from '../components/SettingsEditor';
import VisualQuizBuilder from '../components/flow/VisualQuizBuilder';
import CheckoutSettingsEditor from '../components/CheckoutSettingsEditor';
import SizeGuideEditor from '../components/SizeGuideEditor';
import PopupManager from '../components/PopupManager';
import FunnelEditor from '../components/FunnelEditor';
import AffiliateManagement from '../components/AffiliateManagement';
import SEO from '../components/SEO';
import { useAuth } from '../context/AuthContext';
import { syncProductToKlaviyo } from '../lib/klaviyo';
import { askAI } from '../lib/ai';
import { useSalesChannels } from '../lib/salesChannels';
import CustomersPanel from '../components/admin/CustomersPanel';
import InventoryPanel from '../components/admin/InventoryPanel';
import VariantStockEditor, { StockMatrix, matrixFromVariants, saveVariantStock } from '../components/admin/VariantStockEditor';
import { Variant, availableFor, useProductVariants } from '../lib/inventory';
import { logger } from '../lib/logger';

const AdminPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const rawRole = profile?.role || 'cliente';
  const role = rawRole.toLowerCase().trim();

  const isSuperAdmin = ['superadmin'].includes(role);
  const isAdmin = ['superadmin', 'admin'].includes(role);
  const canManageProducts = ['superadmin', 'admin', 'editor'].includes(role);
  const canManageOrders = ['superadmin', 'admin', 'support'].includes(role);
  const canManageUsers = ['superadmin', 'admin'].includes(role);

  const [activeTab, setActiveTab] = useState(() => {
    if (canManageProducts) return 'products';
    if (canManageOrders) return 'orders';
    if (canManageUsers) return 'users';
    return 'dashboard';
  });

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userOrders, setUserOrders] = useState<any[]>([]);
  const [fetchingUserOrders, setFetchingUserOrders] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [globalLogs, setGlobalLogs] = useState<any[]>([]);
  const [klaviyoPrivateKey, setKlaviyoPrivateKey] = useState('');
  const [syncingKlaviyo, setSyncingKlaviyo] = useState<string | null>(null);
  const [productTestimonials, setProductTestimonials] = useState<any[]>([]);
  const [isTestimonialModalOpen, setIsTestimonialModalOpen] = useState(false);
  const [editingTestimonial, setEditingTestimonial] = useState<any>(null);
  const [isManualOrderModalOpen, setIsManualOrderModalOpen] = useState(false);
  const [manualOrderFormData, setManualOrderFormData] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    address: '',
    total: '0',
    status: 'pending',
    payment_method: 'whatsapp',
    origin: 'whatsapp',
    notes: '',
    affiliate_id: '',
    items: [] as any[]
  });
  const [matchedCustomer, setMatchedCustomer] = useState<any>(null);
  const { activeChannels, labelOf: labelOfChannel } = useSalesChannels();
  const [manualOrderItem, setManualOrderItem] = useState({
    product_id: '',
    quantity: 1,
    size: '',
    color: ''
  });
  const { variants: manualVariants } = useProductVariants(manualOrderItem.product_id || null);

  const [formData, setFormData] = useState({
    name: '',
    price: '',
    category: '',
    stock: '',
    description: '',
    details: '',
    materials: '',
    care: '',
    images: [] as { url: string; color?: string }[],
    videos: [] as string[],
    sizes: [] as string[],
    colors: [] as { name: string; code: string }[],
    variants: [] as { size: string; color: string; stock: number }[],
    upsell_product_id: '',
    downsell_product_id: '',
    order_bump_product_id: '',
    sku: '',
    gtin: '',
    mpn: '',
    brand: 'Vandora',
    google_product_category: 'Apparel & Accessories > Clothing',
    gender: 'unisex',
    age_group: 'adult',
    condition: 'new',
    sale_price: '',
    pattern: '',
    material_simple: '',
    shipping_rate: '',
    shipping_min_days: '',
    shipping_max_days: '',
    return_days: ''
  });

  const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const [newSize, setNewSize] = useState('');
  const [newColorName, setNewColorName] = useState('');
  const [newColorCode, setNewColorCode] = useState('#000000');

  const [categories, setCategories] = useState<any[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [improvingField, setImprovingField] = useState<string | null>(null);

  useEffect(() => {
    if (isModalOpen || isUserModalOpen || isOrderModalOpen || isCategoryModalOpen || isManualOrderModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, isUserModalOpen, isOrderModalOpen, isCategoryModalOpen, isManualOrderModalOpen]);

  useEffect(() => {
    if (activeTab === 'dashboard' && profile) {
      if (canManageProducts) setActiveTab('products');
      else if (canManageOrders) setActiveTab('orders');
      else if (canManageUsers) setActiveTab('users');
    }
  }, [profile]);

  useEffect(() => {
    if (activeTab === 'products') {
      fetchProducts();
      fetchCategories();
    }
    else if (activeTab === 'orders') fetchOrders();
    else if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'global-logs') fetchGlobalLogs();
    
    // Fetch Klaviyo Private Key if not already fetched
    if (!klaviyoPrivateKey && (activeTab === 'products' || activeTab === 'settings')) {
      supabase.from('app_settings').select('value').eq('key', 'klaviyo_private_api_key').single()
        .then(({ data }) => {
          if (data?.value) setKlaviyoPrivateKey(data.value);
        });
    }
  }, [activeTab]);

  const fetchGlobalLogs = async () => {
    setLoading(true);
    // Try global_logs first, fallback to analytics_logs
    let { data, error } = await supabase
      .from('global_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (error) {
      console.warn('Could not fetch global_logs, trying analytics_logs...', error);
      const { data: altData, error: altError } = await supabase
        .from('analytics_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      data = altData;
      error = altError;
    }

    if (error) {
      console.warn('Could not fetch any logs.', error);
    }
    if (data) setGlobalLogs(data);
    setLoading(false);
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase.from('product_categories').select('*').order('name');
    if (!error && data) setCategories(data);
  };

  const fetchOrders = async () => {
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('Admin: Error fetching orders:', error);
      alert('Error al cargar pedidos: ' + error.message);
    }
    if (data) setOrders(data);
  };

  const fetchUserOrders = async (email: string) => {
    setFetchingUserOrders(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_email', email)
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setUserOrders(data);
    }
    setFetchingUserOrders(false);
  };

  const fetchUsers = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (!error && data) {
      setUsers(data.map(profile => ({
        id: profile.id,
        name: profile.full_name || 'Desconocido',
        email: profile.email || profile.id,
        role: profile.role || 'Cliente',
        status: 'Activo'
      })));
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase.from('products').select('*');
    if (data) {
      const parseJSON = (val: any) => {
        if (typeof val !== 'string') return val;
        try {
          const parsed = JSON.parse(val);
          return parsed && typeof parsed === 'object' ? parsed : val;
        } catch (e) {
          return val;
        }
      };

      setProducts(data.map(p => ({
        ...p,
        images: Array.isArray(p.images) ? p.images.map((img: any) => {
          const parsed = parseJSON(img);
          return typeof parsed === 'string' ? { url: parsed } : parsed;
        }) : [],
        videos: Array.isArray(p.videos) ? p.videos.map((vid: any) => {
          const parsed = parseJSON(vid);
          return typeof parsed === 'string' ? { url: parsed } : parsed;
        }) : [],
        colors: Array.isArray(p.colors) ? p.colors.map((c: any) => {
          const parsed = parseJSON(c);
          return typeof parsed === 'object' && parsed !== null ? parsed : { name: String(c), code: '#CCCCCC' };
        }) : []
      })));
    }
    setLoading(false);
  };

  const fetchProductTestimonials = async (productId: string) => {
    const { data, error } = await supabase
      .from('product_testimonials')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setProductTestimonials(data);
    }
  };

  const handleSaveTestimonial = async (testimonialData: any) => {
    try {
      if (editingTestimonial) {
        const { error } = await supabase
          .from('product_testimonials')
          .update(testimonialData)
          .eq('id', editingTestimonial.id);
        if (error) throw error;
        setProductTestimonials(productTestimonials.map(t => t.id === editingTestimonial.id ? { ...t, ...testimonialData } : t));
      } else {
        const { data, error } = await supabase
          .from('product_testimonials')
          .insert([{ ...testimonialData, product_id: editingProduct.id }])
          .select();
        if (error) throw error;
        if (data) setProductTestimonials([data[0], ...productTestimonials]);
      }
      setIsTestimonialModalOpen(false);
      setEditingTestimonial(null);
    } catch (error: any) {
      alert('Error al guardar testimonio: ' + error.message);
    }
  };

  const handleDeleteTestimonial = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este testimonio?')) return;
    try {
      const { error } = await supabase.from('product_testimonials').delete().eq('id', id);
      if (error) throw error;
      setProductTestimonials(productTestimonials.filter(t => t.id !== id));
    } catch (error: any) {
      alert('Error al eliminar testimonio: ' + error.message);
    }
  };

  const handleDuplicateProduct = async (product: any) => {
    if (!confirm(`¿Estás seguro de duplicar el producto "${product.name}"?`)) return;

    try {
      const { id, created_at, updated_at, slug: oldSlug, ...rest } = product;
      
      // Clean data based on what handleSubmit uses to avoid hidden state issues
      const slugify = (text: string) => {
        return text
          .toString()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]+/g, '')
          .replace(/--+/g, '-')
          .replace(/(^-|-$)/g, '');
      };

      const newName = `${product.name} (Copia)`;
      const newSlug = `${slugify(newName)}-copy-${Date.now()}`;
      
      const duplicatedProduct = {
        ...rest,
        name: newName,
        slug: newSlug,
        stock: 0,
        active: false
      };

      const { data, error } = await supabase
        .from('products')
        .insert(duplicatedProduct)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        // Normalize as we do in fetchProducts
        const normalized = {
          ...data,
          images: Array.isArray(data.images) ? data.images.map((img: any) => typeof img === 'string' ? { url: img } : img) : [],
          videos: Array.isArray(data.videos) ? data.videos.map((vid: any) => typeof vid === 'string' ? { url: vid } : vid) : [],
          colors: Array.isArray(data.colors) ? data.colors.map((c: any) => typeof c === 'string' ? { name: c, code: '#CCCCCC' } : c) : []
        };
        setProducts([normalized, ...products]);
        alert('Producto duplicado correctamente.');
      }
    } catch (error: any) {
      console.error('Error duplicating product:', error);
      alert('Error al duplicar: ' + error.message);
    }
  };

  const handleSyncKlaviyo = async (product: any) => {
    setSyncingKlaviyo(product.id);
    const result = await syncProductToKlaviyo(product);
    if (result.success) {
      alert(`Producto sincronizado con Klaviyo (${result.action === 'created' ? 'Creado' : 'Actualizado'})`);
    } else {
      alert(`Error al sincronizar: ${result.error}`);
    }
    setSyncingKlaviyo(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
  };

  // Stock per color/size for the product form. inventoryReady is false until the inventory
  // migration is applied, in which case the form keeps the old single stock field.
  const [stockMatrix, setStockMatrix] = useState<StockMatrix>({});
  const [inventoryReady, setInventoryReady] = useState(false);
  const [poolStock, setPoolStock] = useState(0);

  useEffect(() => {
    if (!isModalOpen) return;
    setStockMatrix({});
    setPoolStock(0);
    let query = supabase.from('product_variants').select('*');
    query = editingProduct ? query.eq('product_id', editingProduct.id) : query.limit(1);
    query.then(({ data, error }) => {
      setInventoryReady(!error);
      if (error || !editingProduct) return;
      const variants = (data || []) as Variant[];
      setStockMatrix(matrixFromVariants(variants));
      const pool = variants.find(v => v.color === '' && v.size === '');
      const hasAxes = (editingProduct.colors?.length || 0) > 0 || (editingProduct.sizes?.length || 0) > 0;
      setPoolStock(hasAxes ? Math.max(pool?.stock || 0, 0) : 0);
    });
  }, [isModalOpen, editingProduct?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const slugify = (text: string) => {
        return text
          .toString()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]+/g, '')
          .replace(/--+/g, '-')
          .replace(/(^-|-$)/g, '');
      };

      const slug = slugify(formData.name);
      
      // Explicitly construct product data with type conversions and validation
      const productData = {
        name: formData.name,
        price: parseFloat(formData.price) || 0,
        category: formData.category,
        // With per-variant inventory, products.stock is computed by the database from the variants
        ...(inventoryReady
          ? (editingProduct ? {} : { stock: 0 })
          : { stock: parseInt(formData.stock) || 0 }),
        description: formData.description,
        details: formData.details,
        materials: formData.materials,
        care: formData.care,
        images: formData.images,
        videos: formData.videos,
        sizes: formData.sizes,
        colors: formData.colors,
        slug,
        upsell_product_id: formData.upsell_product_id || null,
        downsell_product_id: formData.downsell_product_id || null,
        order_bump_product_id: formData.order_bump_product_id || null,
        sku: formData.sku || null,
        gtin: formData.gtin || null,
        mpn: formData.mpn || null,
        brand: formData.brand || 'Vandora',
        google_product_category: formData.google_product_category || 'Apparel & Accessories > Clothing',
        gender: formData.gender || 'unisex',
        age_group: formData.age_group || 'adult',
        condition: formData.condition || 'new',
        sale_price: parseFloat(formData.sale_price) || null,
        pattern: formData.pattern || null,
        material_simple: formData.material_simple || null,
        shipping_rate: parseFloat(formData.shipping_rate) || null,
        shipping_min_days: parseInt(formData.shipping_min_days) || null,
        shipping_max_days: parseInt(formData.shipping_max_days) || null,
        return_days: parseInt(formData.return_days) || null
      };

      if (editingProduct) {
        const { error } = await supabase.from('products').update(productData).eq('id', editingProduct.id);
        if (error) throw error;
        if (inventoryReady) {
          await saveVariantStock(editingProduct.id, stockMatrix, false);
          fetchProducts();
        } else {
          setProducts(products.map(p => p.id === editingProduct.id ? { ...p, ...productData } : p));
        }
        closeModal();
        
        // Automatic Klaviyo Sync on Update
        if (klaviyoPrivateKey) {
          syncProductToKlaviyo({ ...productData, id: editingProduct.id });
        }
      } else {
        const { data, error } = await supabase.from('products').insert([productData]).select();
        if (error) throw error;
        if (data) {
          // Normalize the returned data before adding to state
          const newProduct = {
            ...data[0],
            images: Array.isArray(data[0].images) ? data[0].images.map((img: any) => typeof img === 'string' ? { url: img } : img) : [],
            videos: Array.isArray(data[0].videos) ? data[0].videos.map((vid: any) => typeof vid === 'string' ? { url: vid } : vid) : [],
            colors: Array.isArray(data[0].colors) ? data[0].colors.map((c: any) => typeof c === 'string' ? { name: c, code: '#CCCCCC' } : c) : []
          };
          setProducts([...products, newProduct]);
          if (inventoryReady) {
            await saveVariantStock(newProduct.id, stockMatrix, true);
            fetchProducts();
          }
          closeModal();
          
          // Automatic Klaviyo Sync on Create
          if (klaviyoPrivateKey) {
            syncProductToKlaviyo(newProduct);
          }
        }
      }
    } catch (error: any) {
      console.error('Error saving product:', error);
      alert('Error al guardar el producto: ' + (error.message || 'Error desconocido'));
    }
  };

  const reportPaymentToRaider = async (order: any) => {
    const raiderUrl = import.meta.env.VITE_RAIDER_URL;
    const trackToken = import.meta.env.VITE_RAIDER_TRACK_TOKEN;
    const trackingId = order.affiliate_id;

    if (!raiderUrl || !trackToken || !trackingId) {
      console.log('Raider reporting skipped: Missing config or tracking ID');
      return;
    }

    try {
      const endpoint = `${raiderUrl.replace(/\/$/, '')}/track/payment/${trackingId}/`;
      const auth = btoa(`:${trackToken}`);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          amount: order.total.toString(),
          currency: 'USD',
          trace: `Order ${order.id}`
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Raider API error: ${response.status} ${errorText}`);
      }

      console.log('Payment successfully reported to Raider');
    } catch (error) {
      console.error('Failed to report payment to Raider:', error);
    }
  };
  
  const handleUpdateOrderStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId);

    if (!error) {
      const updatedOrder = orders.find(o => o.id === orderId);
      if (updatedOrder) {
        updatedOrder.status = newStatus;
        setOrders([...orders]);
        
        // Report to Raider if order is completed or paid
        if (newStatus === 'completed' || newStatus === 'paid') {
          reportPaymentToRaider(updatedOrder);
        }
      }
    }
  };

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('orders').update({
      customer_name: editingOrder.customer_name,
      status: editingOrder.status,
      notes: editingOrder.notes,
      affiliate_id: editingOrder.affiliate_id
    }).eq('id', editingOrder.id);

    if (!error) {
      const updatedOrder = { ...editingOrder };
      setOrders(orders.map(o => o.id === editingOrder.id ? updatedOrder : o));
      setIsOrderModalOpen(false);
      
      // Report to Raider if order is completed or paid via bulk edit
      if (updatedOrder.status === 'completed' || updatedOrder.status === 'paid') {
        reportPaymentToRaider(updatedOrder);
      }
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser?.id) {
      const { error } = await supabase.from('profiles').update({
        role: editingUser.role
      }).eq('id', editingUser.id);

      if (!error) {
        setUsers(users.map(u => u.id === editingUser.id ? editingUser : u));
        setIsUserModalOpen(false);
      }
    } else {
      // Logic for new user invitation could go here if Supabase auth allows
      alert('Funcionalidad de invitación enviada (Simulación). Supabase requiere configuración de SMTP para invitaciones reales.');
      setIsUserModalOpen(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName) return;
    const { data, error } = await supabase.from('product_categories').insert([{ name: newCategoryName }]).select();
    if (!error && data) {
      setCategories([...categories, data[0]]);
      setNewCategoryName('');
    } else {
      alert('Error creando categoría: ' + (error?.message || 'Ya existe o error de conexión'));
    }
  };
  
  // Prefills the manual sale from the unified customer record (and her last shipping address)
  const lookupCustomerByPhone = async (rawPhone: string) => {
    const digits = rawPhone.replace(/\D/g, '').replace(/^(593|0)/, '');
    if (digits.length < 8) { setMatchedCustomer(null); return; }

    const { data: customer } = await supabase
      .from('customer_summary')
      .select('*')
      .ilike('phone', `%${digits}`)
      .limit(1)
      .maybeSingle();
    setMatchedCustomer(customer || null);
    if (!customer) return;

    const { data: lastOrder } = await supabase
      .from('orders')
      .select('address')
      .eq('customer_id', customer.id)
      .not('address', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setManualOrderFormData(prev => ({
      ...prev,
      customer_name: prev.customer_name || customer.full_name || '',
      customer_email: prev.customer_email || customer.email || '',
      address: prev.address || lastOrder?.address || ''
    }));
  };

  const handleCreateManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (manualOrderFormData.items.length === 0) {
        alert('Por favor añade al menos un producto al pedido.');
        return;
      }

      const orderData: any = {
        ...manualOrderFormData,
        affiliate_id: manualOrderFormData.affiliate_id || null,
        total: parseFloat(manualOrderFormData.total),
        created_by: profile?.id || null,
        customer_id: matchedCustomer?.id || null,
        created_at: new Date().toISOString()
      };

      let { data, error } = await supabase.from('orders').insert([orderData]).select();
      // Before the CRM migration these columns don't exist yet: save the sale anyway
      if (error && /created_by|customer_id/.test(error.message || '')) {
        const { created_by, customer_id, ...legacy } = orderData;
        ({ data, error } = await supabase.from('orders').insert([legacy]).select());
      }
      if (error) throw error;

      if (data) {
        setOrders([data[0], ...orders]);
        setIsManualOrderModalOpen(false);
        setMatchedCustomer(null);
        setManualOrderFormData({
          customer_name: '',
          customer_email: '',
          customer_phone: '',
          address: '',
          total: '0',
          status: 'pending',
          payment_method: 'whatsapp',
          origin: 'whatsapp',
          notes: '',
          affiliate_id: '',
          items: [] as any[]
        });
        alert('Pedido manual creado correctamente.');
      }
    } catch (error: any) {
      console.error('Error creating manual order:', error);
      alert('Error al crear pedido: ' + error.message);
    }
  };

  const handleUpdateCategory = async (id: string, oldName: string, newName: string) => {
    if (!newName || oldName === newName) return;
    
    // Update category name
    const { error: catError } = await supabase.from('product_categories').update({ name: newName }).eq('id', id);
    if (catError) {
      alert('Error al actualizar categoría: ' + catError.message);
      return;
    }

    // Update all products with this category
    const { error: prodError } = await supabase.from('products').update({ category: newName }).eq('category', oldName);
    if (prodError) {
      alert('Categoría actualizada, pero hubo un error al actualizar algunos productos.');
    }

    setCategories(categories.map(c => c.id === id ? { ...c, name: newName } : c));
    setProducts(products.map(p => p.category === oldName ? { ...p, category: newName } : p));
  };

  const handleUpdateCategoryImage = async (id: string, imageUrl: string) => {
    const { error } = await supabase.from('product_categories').update({ image_url: imageUrl }).eq('id', id);
    if (error) {
      alert('Error al actualizar imagen de categoría: ' + error.message);
      return;
    }
    setCategories(categories.map(c => c.id === id ? { ...c, image_url: imageUrl } : c));
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!confirm(`¿Estás seguro de eliminar la categoría "${name}"? Los productos asociados NO serán eliminados pero quedarán sin categoría.`)) return;

    const { error } = await supabase.from('product_categories').delete().eq('id', id);
    if (error) {
      alert('Error al eliminar categoría: ' + error.message);
      return;
    }

    setCategories(categories.filter(c => c.id !== id));
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    if (!confirm(`¿Estás seguro de eliminar el producto "${name}"? Esta acción no se puede deshacer.`)) return;

    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      setProducts(products.filter(p => p.id !== id));
      alert('Producto eliminado correctamente.');
    } catch (error: any) {
      console.error('Error deleting product:', error);
      alert('Error al eliminar producto: ' + error.message);
    }
  };

  const handleImproveWithAI = async (field: 'description' | 'details') => {
    const text = formData[field as keyof typeof formData];
    if (typeof text !== 'string' || !text.trim()) {
      alert('Por favor escribe algo primero para que la IA pueda mejorarlo.');
      return;
    }

    setImprovingField(field);
    try {
      const prompt = `Mejora la estructura y el copy de esta descripción de producto de moda, haciéndola más atractiva y profesional, pero MANTENIENDO toda la información técnica, tallas y detalles importantes. No inventes información nueva. Estructura el texto con párrafos claros o puntos clave.\n\nTexto original:\n${text}`;

      const improvedText = await askAI([{ role: 'user', content: prompt }]);

      if (improvedText) {
        setFormData(prev => ({ ...prev, [field]: improvedText }));
      }
    } catch (error: any) {
      console.error('AI Improvement error:', error);
      alert('Error al mejorar con IA: ' + (error.message || 'Error desconocido'));
    } finally {
      setImprovingField(null);
    }
  };

  const handleExportGoogleMerchantCSV = () => {
    const headers = [
      'id', 'title', 'description', 'availability', 'availability date', 'expiration date', 
      'link', 'mobile link', 'image link', 'price', 'sale price', 'sale price effective date', 
      'identifier exists', 'gtin', 'mpn', 'brand', 'product highlight', 'product detail', 
      'additional image link', 'condition', 'adult', 'color', 'size', 'size type', 'size system', 
      'gender', 'material', 'pattern', 'age group', 'multipack', 'is bundle', 'unit pricing measure', 
      'unit pricing base measure', 'energy efficiency class', 'min energy efficiency class', 
      'item group id', 'sell on google quantity'
    ];

    const escapeCSV = (str: any) => {
      if (str === null || str === undefined) return '';
      const stringified = String(str);
      if (stringified.includes('"') || stringified.includes(',') || stringified.includes('\n') || stringified.includes('\r')) {
        return `"${stringified.replace(/"/g, '""')}"`;
      }
      return stringified;
    };

    const rows = products.map(p => {
      const id = p.sku || p.id;
      const title = p.name ? p.name.substring(0, 150) : '';
      const desc = p.description ? p.description.substring(0, 200).replace(/\n/g, ' ') : '';
      const availability = p.stock > 0 ? 'in_stock' : 'out_of_stock';
      const link = `${window.location.origin}/producto/${encodeURIComponent((p.category || 'general').toLowerCase().replace(/\s+/g, '-'))}/${p.slug}`;
      const imageLink = p.images && p.images.length > 0 ? p.images[0].url : '';
      const price = `${p.price || 0} USD`;
      const salePrice = p.sale_price ? `${p.sale_price} USD` : '';
      const identifierExists = p.gtin || p.mpn ? 'yes' : 'no';
      const gtin = p.gtin || '';
      const mpn = p.mpn || p.sku || '';
      const brand = p.brand || 'Vandora';
      const additionalImageLink = p.images && p.images.length > 1 ? p.images.slice(1).map((img: any) => img.url).join(',') : '';
      const condition = p.condition || 'new';
      const color = p.colors && p.colors.length > 0 ? p.colors.map((c: any) => c.name).join('/') : '';
      const size = p.sizes && p.sizes.length > 0 ? p.sizes[0] : '';
      const gender = p.gender || 'female';
      const material = p.material_simple || (p.materials ? p.materials.substring(0, 50) : '');
      const pattern = p.pattern || '';
      const ageGroup = p.age_group || 'adult';
      
      return [
        id, title, desc, availability, '', '', link, '', imageLink, price, salePrice, '',
        identifierExists, gtin, mpn, brand, '', '', additionalImageLink, condition, 'no',
        color, size, '', '', gender, material, pattern, ageGroup, '', 'no', '', '', '', '', p.id, p.stock || 0
      ];
    });

    const csvContent = [headers, ...rows].map(row => row.map(escapeCSV).join(',')).join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `merchant_center_products_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row">
      <SEO title="Admin Dashboard" description="Panel de control de Vandora" />

      {/* Mobile Sidebar Toggle */}
      <div className="md:hidden bg-white p-4 flex justify-between items-center border-b">
        <h2 className="font-serif text-xl text-vandora-emerald">Vandora Admin</h2>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          <Menu className="h-6 w-6 text-gray-600" />
        </button>
      </div>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-xl transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6">
          <h2 className="font-serif text-2xl text-vandora-emerald hidden md:block">Vandora</h2>
          <p className="text-xs text-gray-500 uppercase tracking-wider mt-1">Panel de Control</p>
        </div>

        <nav className="mt-2 px-4 space-y-1">
          <button
            onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <LayoutIcon className="h-5 w-5 mr-3" /> Dashboard
          </button>

          {canManageProducts && (
            <button
              onClick={() => { setActiveTab('products'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'products' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Package className="h-5 w-5 mr-3" /> Productos
            </button>
          )}

          {canManageOrders && (
            <button
              onClick={() => { setActiveTab('orders'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'orders' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <ShoppingBag className="h-5 w-5 mr-3" /> Pedidos
            </button>
          )}

          {(canManageProducts || canManageOrders) && (
            <button
              onClick={() => { setActiveTab('inventory'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'inventory' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Boxes className="h-5 w-5 mr-3" /> Inventario
            </button>
          )}

          {canManageOrders && (
            <button
              onClick={() => { setActiveTab('customers'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'customers' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Contact className="h-5 w-5 mr-3" /> Clientes
            </button>
          )}

          {canManageUsers && (
            <button
              onClick={() => { setActiveTab('users'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'users' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Users className="h-5 w-5 mr-3" /> Usuarios
            </button>
          )}

          {isAdmin && (
            <>
              <button
                onClick={() => { setActiveTab('media'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'media' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <ImageIcon className="h-5 w-5 mr-3" /> Multimedia
              </button>

              <button
                onClick={() => { setActiveTab('site'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'site' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Sparkles className="h-5 w-5 mr-3" /> Editor Sitio
              </button>

              <button
                onClick={() => { setActiveTab('quizzes'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'quizzes' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Plus className="h-5 w-5 mr-3" /> Quizzes
              </button>

              <button
                onClick={() => { setActiveTab('popups'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'popups' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Megaphone className="h-5 w-5 mr-3" /> Popups
              </button>

              <button
                onClick={() => { setActiveTab('funnels'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'funnels' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Zap className="h-5 w-5 mr-3" /> Embudos (Funnel)
              </button>

              <button
                onClick={() => { setActiveTab('affiliates'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'affiliates' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Users className="h-5 w-5 mr-3" /> Solicitudes Afiliados
              </button>

              <button
                onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Settings className="h-5 w-5 mr-3" /> Ajustes
              </button>

              <button
                onClick={() => { setActiveTab('size-guide'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'size-guide' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Ruler className="h-5 w-5 mr-3" /> Guía de Tallas
              </button>

              <button
                onClick={() => { setActiveTab('global-logs'); setIsSidebarOpen(false); }}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-lg transition-colors ${activeTab === 'global-logs' ? 'bg-emerald-50 text-vandora-emerald font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <History className="h-5 w-5 mr-3" /> Logs Globales
              </button>
            </>
          )}
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-serif text-gray-900">
            {activeTab === 'dashboard' ? 'Dashboard' :
              activeTab === 'products' ? 'Inventario' :
                activeTab === 'orders' ? 'Pedidos' :
                  activeTab === 'users' ? 'Gestión de Usuarios' :
                    activeTab === 'media' ? 'Multimedia' :
                      activeTab === 'site' ? 'Editor de Sitio' :
                        activeTab === 'quizzes' ? 'Constructor de Quizzes' : 
                          activeTab === 'size-guide' ? 'Guía de Tallas' : 
                            activeTab === 'global-logs' ? 'Registro de Logs Globales' :
                              activeTab === 'popups' ? 'Gestión de Popups' : 
                                activeTab === 'funnels' ? 'Gestión de Embudos (Funnel)' : 
                                  activeTab === 'affiliates' ? 'Solicitudes de Afiliados' : 'Ajustes'}
          </h1>
          <p className="text-sm text-gray-500">Bienvenido de nuevo, {role}</p>
        </header>

        {activeTab === 'popups' && <PopupManager />}
        {activeTab === 'funnels' && <FunnelEditor />}
        {activeTab === 'affiliates' && <AffiliateManagement />}

        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm text-gray-500 uppercase font-bold mb-1">Total Pedidos</p>
              <h3 className="text-2xl font-serif text-vandora-emerald">{orders.length}</h3>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm text-gray-500 uppercase font-bold mb-1">Productos</p>
              <h3 className="text-2xl font-serif text-vandora-emerald">{products.length}</h3>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm text-gray-500 uppercase font-bold mb-1">Usuarios</p>
              <h3 className="text-2xl font-serif text-vandora-emerald">{users.length}</h3>
            </div>
          </div>
        )}

        {activeTab === 'products' && canManageProducts && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <h3 className="text-lg font-medium text-gray-900 border-l-4 border-vandora-emerald pl-3">Inventario de Productos</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleExportGoogleMerchantCSV}
                  className="bg-white text-gray-700 px-4 py-2 rounded-md flex items-center border border-gray-300 transition-colors hover:bg-gray-50 shadow-sm"
                  title="Exportar productos en formato Google Merchant Center"
                >
                  <Download className="h-4 w-4 mr-2" /> Exportar CSV Merchant
                </button>
                <button
                  onClick={() => setIsCategoryModalOpen(true)}
                  className="bg-white text-gray-700 px-4 py-2 rounded-md flex items-center border border-gray-300 transition-colors hover:bg-gray-50 shadow-sm"
                >
                  <Plus className="h-4 w-4 mr-2" /> Categorías
                </button>
                <button
                  onClick={() => {
                    setEditingProduct(null);
                    setFormData({ 
                      name: '', price: '', category: '', stock: '', description: '', details: '', materials: '', care: '', images: [], videos: [], sizes: [], colors: [], variants: [], 
                      upsell_product_id: '', downsell_product_id: '', order_bump_product_id: '',
                      sku: '', gtin: '', mpn: '', brand: 'Vandora', google_product_category: 'Apparel & Accessories > Clothing', 
                      gender: 'unisex', age_group: 'adult', condition: 'new', sale_price: ''
                    });
                    setIsModalOpen(true);
                  }}
                  className="bg-vandora-emerald text-white px-4 py-2 rounded-md flex items-center transition-colors hover:bg-emerald-800 shadow-md"
                >
                  <Plus className="h-4 w-4 mr-2" /> Nuevo Producto
                </button>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Precio</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {products.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-xs font-mono text-gray-400">
                        {product.id.substring(0, 8)}
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(product.id);
                            alert('ID copiado al portapapeles');
                          }}
                          className="ml-2 hover:text-vandora-emerald"
                          title="Copiar ID completo"
                        >
                          📋
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{product.category}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{formatPrice(product.price)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{product.stock}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium">
                        <button 
                          className="text-gray-400 hover:text-vandora-emerald transition-colors mr-4" 
                          onClick={() => handleDuplicateProduct(product)}
                          title="Duplicar Producto"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button className="text-vandora-emerald hover:text-emerald-800 mr-4" onClick={() => {
                          setEditingProduct(product);
                          const parseJSON = (val: any) => {
                            if (typeof val !== 'string') return val;
                            try {
                              const parsed = JSON.parse(val);
                              return parsed && typeof parsed === 'object' ? parsed : val;
                            } catch (e) {
                              return val;
                            }
                          };

                          setFormData({
                            ...product,
                            price: product.price.toString(),
                            stock: product.stock.toString(),
                            images: Array.isArray(product.images) 
                              ? product.images.map((img: any) => {
                                const parsed = parseJSON(img);
                                return typeof parsed === 'string' ? { url: parsed } : parsed;
                              }) : [],
                            videos: Array.isArray(product.videos) 
                              ? product.videos.map((vid: any) => {
                                const parsed = parseJSON(vid);
                                return typeof parsed === 'string' ? { url: parsed } : parsed;
                              }) : [],
                            colors: Array.isArray(product.colors) 
                              ? product.colors.map((c: any) => {
                                const parsed = parseJSON(c);
                                return typeof parsed === 'object' && parsed !== null ? parsed : { name: String(c), code: '#CCCCCC' };
                              }) : [],
                            sizes: Array.isArray(product.sizes) ? product.sizes : [],
                            variants: Array.isArray(product.variants) ? product.variants : [],
                            sku: product.sku || '',
                            gtin: product.gtin || '',
                            mpn: product.mpn || '',
                            brand: product.brand || 'Vandora',
                            google_product_category: product.google_product_category || 'Apparel & Accessories > Clothing',
                            gender: product.gender || 'unisex',
                            age_group: product.age_group || 'adult',
                            condition: product.condition || 'new',
                            pattern: product.pattern || '',
                            material_simple: product.material_simple || '',
                            shipping_rate: product.shipping_rate?.toString() || '',
                            shipping_min_days: product.shipping_min_days?.toString() || '',
                            shipping_max_days: product.shipping_max_days?.toString() || '',
                            return_days: product.return_days?.toString() || '',
                            sale_price: product.sale_price ? product.sale_price.toString() : ''
                          });
                          fetchProductTestimonials(product.id);
                          setIsModalOpen(true);
                        }}><Edit className="h-4 w-4" /></button>
                        <button
                          onClick={() => handleSyncKlaviyo(product)}
                          disabled={syncingKlaviyo === product.id || !klaviyoPrivateKey}
                          className={`${syncingKlaviyo === product.id ? 'text-gray-400' : 'text-blue-500 hover:text-blue-700'} transition-colors mr-4 disabled:opacity-50`}
                          title="Sincronizar con Klaviyo"
                        >
                          {syncingKlaviyo === product.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        </button>
                        <button 
                          className="text-red-400 hover:text-red-600 transition-colors" 
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          title="Eliminar Producto"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'orders' && canManageOrders && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900 border-l-4 border-vandora-emerald pl-3">Gestión de Pedidos</h3>
              <button
                onClick={() => setIsManualOrderModalOpen(true)}
                className="bg-vandora-emerald text-white px-4 py-2 rounded-md flex items-center transition-colors hover:bg-emerald-800 shadow-md text-sm"
              >
                <Plus className="h-4 w-4 mr-2" /> Nuevo Pedido
              </button>
            </div>
            <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Orden</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Canal</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 italic">
                        No se encontraron pedidos.
                      </td>
                    </tr>
                  ) : (
                    orders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">#{order.id.substring(0, 8)}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{order.customer_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{labelOfChannel(order.origin || 'web')}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{formatPrice(order.total)}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full ${order.status === 'completed' ? 'bg-green-100 text-green-800' :
                            order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                            {order.status === 'pending' ? 'Pendiente' :
                              order.status === 'completed' ? 'Completado' : order.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium">
                          <button className="text-vandora-emerald hover:text-emerald-900" onClick={() => {
                            setEditingOrder(order);
                            setIsOrderModalOpen(true);
                          }}>
                            <Edit className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'customers' && canManageOrders && <CustomersPanel />}

        {activeTab === 'inventory' && (canManageProducts || canManageOrders) && <InventoryPanel />}

        {activeTab === 'users' && canManageUsers && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Gestión de Usuarios</h3>
              <button
                className="bg-vandora-emerald text-white px-4 py-2 rounded-md flex items-center transition-colors hover:bg-emerald-800 text-sm"
                onClick={() => {
                  setEditingUser(null);
                  setIsUserModalOpen(true);
                }}
              >
                <Users className="h-4 w-4 mr-2" /> Invitar Usuario
              </button>
            </div>
            <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email / ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rol</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {users.map(userItem => (
                    <tr key={userItem.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{userItem.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{userItem.email || userItem.id.substring(0, 15) + '...'}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${userItem.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                          userItem.role === 'editor' ? 'bg-blue-100 text-blue-800' :
                            userItem.role === 'support' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                          {userItem.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium">
                        <button className="text-vandora-emerald hover:text-emerald-800" onClick={() => {
                          setEditingUser(userItem);
                          if (userItem.email) fetchUserOrders(userItem.email);
                          setIsUserModalOpen(true);
                        }}><Edit className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'media' && <div className="bg-white p-6 rounded-lg shadow-sm"><MediaManager images={[]} videos={[]} colors={[]} onImagesChange={() => { }} onVideosChange={() => { }} /></div>}
        {activeTab === 'site' && <div className="bg-white p-6 rounded-lg shadow-sm"><SiteEditor /></div>}
        {activeTab === 'quizzes' && <div className="bg-white p-6 rounded-lg shadow-sm space-y-8"><QuizBuilder /><VisualQuizBuilder onBack={() => setActiveTab('quizzes')} /></div>}
        {activeTab === 'settings' && <div className="bg-white p-6 rounded-lg shadow-sm space-y-8"><SettingsEditor /><CheckoutSettingsEditor /></div>}
        {activeTab === 'size-guide' && <div className="bg-white p-6 rounded-lg shadow-sm"><SizeGuideEditor /></div>}

        {activeTab === 'global-logs' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
               <div className="bg-gray-50 border-b px-6 py-3 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-gray-700 uppercase">Eventos y Errores del Sitio</h3>
                  <button onClick={fetchGlobalLogs} className="text-xs text-vandora-emerald hover:underline flex items-center">
                    <History className="w-3 h-3 mr-1" /> Actualizar
                  </button>
               </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Evento / Fuente</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Metadatos / Error</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {globalLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-500 italic">
                        No hay logs registrados en este momento.
                      </td>
                    </tr>
                  ) : (
                    globalLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          <div className="flex flex-col">
                            <span className={`px-2 py-0.5 rounded text-[10px] w-fit mb-1 ${log.event_name?.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                              {log.event_name}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">
                              Status: {log.status_code || 'N/A'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                           <div className="max-w-md truncate hover:whitespace-normal transition-all" title={log.error_message || log.message}>
                             {log.error_message || log.message || 'Sin detalles'}
                           </div>
                           {log.metadata && (
                             <pre className="mt-2 p-2 bg-gray-50 rounded text-[9px] overflow-x-auto max-w-md">
                               {typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata, null, 2)}
                             </pre>
                           )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 italic">Nota: Esta sección muestra eventos de Meta CAPI y otros errores críticos registrados en el sistema.</p>
          </div>
        )}

        {/* Modals remain same as before for products/orders/users edit */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-[60] backdrop-blur-sm">
            <div className="bg-white rounded-xl w-full sm:max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl max-h-[95vh] overflow-y-auto flex flex-col shadow-2xl transition-all duration-300">
              <div className="flex justify-between items-center p-4 md:p-6 sticky top-0 bg-white/80 backdrop-blur-md z-20 border-b">
                <h2 className="text-xl md:text-2xl font-serif text-gray-900">{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h2>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 transition-all hover:scale-110"><X className="h-6 w-6 md:h-8 md:w-8" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-4 md:p-8 space-y-8 flex-1">
                {/* Media Section */}
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <ImageIcon className="w-5 h-5 mr-2 text-vandora-emerald" /> Multimedia
                  </h3>
                  <MediaManager
                    images={formData.images}
                    videos={formData.videos}
                    colors={formData.colors}
                    onImagesChange={(images) => setFormData({ ...formData, images })}
                    onVideosChange={(videos) => setFormData({ ...formData, videos })}
                    productName={formData.name}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Información Básica</h3>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                      <input type="text" name="name" value={formData.name} onChange={handleInputChange} required className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Precio</label>
                        <input type="number" step="0.01" name="price" value={formData.price} onChange={handleInputChange} required className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Precio de Oferta (Opcional)</label>
                        <input type="number" step="0.01" name="sale_price" value={formData.sale_price} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none" placeholder="0.00" title="Precio que aparecerá en Google Shopping como oferta" />
                      </div>
                      {!inventoryReady && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Stock Inicial</label>
                          <input type="number" name="stock" value={formData.stock} onChange={handleInputChange} required className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none" />
                        </div>
                      )}
                    </div>
                    {inventoryReady && (
                      <VariantStockEditor
                        colors={formData.colors}
                        sizes={formData.sizes}
                        matrix={stockMatrix}
                        onChange={setStockMatrix}
                        poolStock={poolStock}
                      />
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                      <div className="flex gap-2">
                        <select
                          name="category"
                          value={formData.category}
                          onChange={handleInputChange}
                          required
                          className="flex-1 rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none appearance-none bg-white"
                        >
                          <option value="">Seleccionar categoría...</option>
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.name}>{cat.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setIsCategoryModalOpen(true)}
                          className="p-3 border rounded-md hover:bg-gray-50 text-gray-400 hover:text-vandora-emerald transition-colors"
                          title="Nueva Categoría"
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-gray-700">Descripción Corta</label>
                        <button 
                          type="button"
                          onClick={() => handleImproveWithAI('description')}
                          disabled={improvingField === 'description'}
                          className="text-[10px] font-bold uppercase tracking-wider text-vandora-emerald hover:text-emerald-800 flex items-center transition-colors disabled:opacity-50"
                        >
                          {improvingField === 'description' ? <Loader2 className="animate-spin h-3 w-3 mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                          Mejorar con IA
                        </button>
                      </div>
                      <textarea name="description" value={formData.description} onChange={handleInputChange} rows={3} className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none" />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Atributos y Variantes</h3>

                    {/* Sizes selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Tallas Disponibles</label>
                      <div className="flex flex-wrap gap-2">
                        {STANDARD_SIZES.map(size => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              const sizes = formData.sizes.includes(size)
                                ? formData.sizes.filter(s => s !== size)
                                : [...formData.sizes, size];
                              setFormData({ ...formData, sizes });
                            }}
                            className={`px-3 py-2 rounded-md border text-sm transition-colors ${formData.sizes.includes(size)
                              ? 'bg-vandora-emerald text-white border-vandora-emerald'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-vandora-emerald'
                              }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Colors selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Colores</label>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
                        <input
                          type="text"
                          placeholder="Nombre color"
                          value={newColorName}
                          onChange={(e) => setNewColorName(e.target.value)}
                          className="flex-1 rounded-md border p-2 text-sm border-gray-300 min-w-0"
                        />
                        <div className="flex gap-2 min-w-0">
                          <input
                            type="color"
                            value={newColorCode.startsWith('#') && newColorCode.length === 7 ? newColorCode : '#000000'}
                            onChange={(e) => setNewColorCode(e.target.value)}
                            className="w-10 h-10 border-0 p-0 rounded-md cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            placeholder="Código (Hex, RGB...)"
                            value={newColorCode}
                            onChange={(e) => setNewColorCode(e.target.value)}
                            className="flex-1 rounded-md border p-2 text-sm border-gray-300 min-w-0"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (newColorName) {
                              setFormData({ ...formData, colors: [...formData.colors, { name: newColorName, code: newColorCode }] });
                              setNewColorName('');
                              setNewColorCode('#000000');
                            }
                          }}
                          className="bg-gray-100 p-2 rounded-md hover:bg-gray-200 shrink-0 flex items-center justify-center h-10 w-10"
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {formData.colors.map((c, i) => (
                          <div key={i} className="flex items-center bg-white border border-gray-200 rounded-full px-3 py-1 text-xs">
                            <span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: c.code }}></span>
                            {c.name}
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, colors: formData.colors.filter((_, idx) => idx !== i) })}
                              className="ml-2 text-gray-400 hover:text-red-500"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Upsell/Downsell */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium text-gray-900">Estrategia de Ventas (Funnels)</h4>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Upsell</label>
                          <select 
                            name="upsell_product_id" 
                            value={formData.upsell_product_id || ''} 
                            onChange={handleInputChange} 
                            className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none bg-white"
                          >
                            <option value="">Ninguno (Sin Upsell)</option>
                            {products.filter(p => !editingProduct || p.id !== editingProduct.id).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Downsell</label>
                          <select 
                            name="downsell_product_id" 
                            value={formData.downsell_product_id || ''} 
                            onChange={handleInputChange} 
                            className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none bg-white"
                          >
                            <option value="">Ninguno (Sin Downsell)</option>
                            {products.filter(p => !editingProduct || p.id !== editingProduct.id).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Order Bump</label>
                          <select 
                            name="order_bump_product_id" 
                            value={formData.order_bump_product_id || ''} 
                            onChange={handleInputChange} 
                            className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none bg-white"
                          >
                            <option value="">Ninguno (Sin Order Bump)</option>
                            {products.filter(p => !editingProduct || p.id !== editingProduct.id).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Google & Meta Catalog Section */}
                <div className="space-y-6 bg-blue-50/50 p-6 rounded-xl border border-blue-100">
                  <h3 className="text-lg font-medium text-gray-900 border-b border-blue-100 pb-2 flex items-center">
                    <Megaphone className="w-5 h-5 mr-2 text-blue-600" /> Catálogos (Google Shopping / Meta Ads)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">SKU</label>
                      <input type="text" name="sku" value={formData.sku || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="SKU Único" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">GTIN / EAN / UPC</label>
                      <input type="text" name="gtin" value={formData.gtin || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Código de Barras" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">MPN</label>
                      <input type="text" name="mpn" value={formData.mpn || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Part Number" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Marca</label>
                      <input type="text" name="brand" value={formData.brand || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Vandora" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Género</label>
                      <select name="gender" value={formData.gender || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="female">Femenino</option>
                        <option value="male">Masculino</option>
                        <option value="unisex">Unisex</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Grupo de Edad</label>
                      <select name="age_group" value={formData.age_group || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="adult">Adulto</option>
                        <option value="all ages">Todas las edades</option>
                        <option value="teen">Adolescente</option>
                        <option value="kids">Niños</option>
                        <option value="toddler">Infante</option>
                        <option value="infant">Bebé</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Estado (Condition)</label>
                      <select name="condition" value={formData.condition || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="new">Nuevo</option>
                        <option value="used">Usado</option>
                        <option value="refurbished">Reacondicionado</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Categoría Google (Taxonomy)</label>
                      <input type="text" name="google_product_category" value={formData.google_product_category || ''} onChange={handleInputChange} className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Apparel & Accessories > Clothing" />
                    </div>
                  </div>
                </div>

                {/* Extended Details */}
                <div className="space-y-6 bg-gray-50 p-6 rounded-xl border border-gray-100">
                  <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Contenido Extendido</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-gray-700">Detalles</label>
                        <button 
                          type="button"
                          onClick={() => handleImproveWithAI('details')}
                          disabled={improvingField === 'details'}
                          className="text-[10px] font-bold uppercase tracking-wider text-vandora-emerald hover:text-emerald-800 flex items-center transition-colors disabled:opacity-50"
                        >
                          {improvingField === 'details' ? <Loader2 className="animate-spin h-3 w-3 mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                          Mejorar con IA
                        </button>
                      </div>
                      <textarea name="details" value={formData.details} onChange={handleInputChange} rows={4} className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Materiales</label>
                      <textarea name="materials" value={formData.materials} onChange={handleInputChange} rows={4} className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Cuidado</label>
                      <textarea name="care" value={formData.care} onChange={handleInputChange} rows={4} className="w-full rounded-md border-gray-300 shadow-sm border p-3 focus:ring-2 focus:ring-vandora-emerald outline-none text-sm" />
                    </div>
                  </div>
                </div>
        
        {/* Testimonials Section (New) */}
                {editingProduct && (
                  <div className="space-y-6 bg-emerald-50/30 p-6 rounded-xl border border-emerald-100">
                    <div className="flex justify-between items-center border-b border-emerald-100 pb-2">
                      <h3 className="text-lg font-medium text-gray-900 flex items-center">
                        <Star className="w-5 h-5 mr-2 text-yellow-500 fill-current" /> Testimonios de Clientes
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTestimonial(null);
                          setIsTestimonialModalOpen(true);
                        }}
                        className="bg-vandora-emerald text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-800 transition-colors flex items-center"
                      >
                        <Plus className="w-3 h-3 mr-1" /> Añadir Testimonio
                      </button>
                    </div>
                    
                    {productTestimonials.length === 0 ? (
                      <p className="text-sm text-gray-500 italic text-center py-4">No hay testimonios para este producto aún.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {productTestimonials.map((t) => (
                          <div key={t.id} className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm relative group">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="font-bold text-sm text-gray-900">{t.user_name}</p>
                                <div className="flex text-yellow-400">
                                  {[...Array(5)].map((_, i) => (
                                    <Star key={i} className={`h-3 w-3 ${i < t.rating ? 'fill-current' : 'text-gray-200'}`} />
                                  ))}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTestimonial(t);
                                    setIsTestimonialModalOpen(true);
                                  }}
                                  className="text-gray-400 hover:text-vandora-emerald"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTestimonial(t.id)}
                                  className="text-gray-400 hover:text-red-500"
                                >
                                  <Trash className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 line-clamp-2 mb-2">{t.comment}</p>
                            {t.size_info && <p className="text-[10px] text-vandora-emerald font-medium italic mb-2">"{t.size_info}"</p>}
                            <div className="flex gap-1 overflow-x-auto pb-1">
                              {t.images?.map((img: string, idx: number) => (
                                <img key={idx} src={img} alt="" className="w-8 h-8 rounded object-cover border" />
                              ))}
                              {t.videos?.length > 0 && (
                                <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center border">
                                  <Play className="w-4 h-4 text-gray-400" />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end space-x-3 p-4 md:p-6 border-t sticky bottom-0 bg-white/80 backdrop-blur-md z-20">
                  <button type="button" onClick={closeModal} className="px-6 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition-colors">Cancelar</button>
                  <button type="submit" className="px-6 py-2 bg-vandora-emerald text-white rounded-md hover:bg-emerald-800 transition-colors shadow-md">Guardar Producto</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isOrderModalOpen && editingOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-[60] backdrop-blur-sm">
            <div className="bg-white rounded-xl w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[95vh] overflow-y-auto flex flex-col shadow-2xl transition-all duration-300">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-serif text-gray-900">Actualizar Pedido</h2>
                <button onClick={() => setIsOrderModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
              </div>
              <form onSubmit={handleSaveOrder} className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg space-y-3 mb-6">
                  <h3 className="text-sm font-semibold text-gray-900 border-b pb-1">Información del Cliente</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Nombre:</p>
                      <p className="font-medium">{editingOrder.customer_name}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Email:</p>
                      <p className="font-medium">{editingOrder.customer_email || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Teléfono:</p>
                      <p className="font-medium">{editingOrder.customer_phone || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Método Pago:</p>
                      <p className="font-medium text-vandora-emerald">
                        {editingOrder.payment_method === 'transfer' ? `Transferencia - ${editingOrder.bank || 'Banco no especificado'}` : 'Contra Entrega'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg space-y-3 mb-6">
                  <h3 className="text-sm font-semibold text-gray-900 border-b pb-1">Dirección de Envío</h3>
                  <div className="text-sm space-y-1">
                    <p><span className="text-gray-500">Dirección:</span> {editingOrder.shipping_address || editingOrder.address || 'N/A'}</p>
                    <p><span className="text-gray-500">Ciudad:</span> {editingOrder.shipping_city || 'N/A'}</p>
                    <p><span className="text-gray-500">Provincia:</span> {editingOrder.shipping_province || 'N/A'}</p>
                    {editingOrder.shipping_reference && (
                      <p><span className="text-gray-500 font-medium">Referencia:</span> {editingOrder.shipping_reference}</p>
                    )}
                  </div>
                </div>

                <div className="bg-emerald-50 p-4 rounded-lg space-y-3 mb-6">
                  <h3 className="text-sm font-semibold text-vandora-emerald border-b border-emerald-100 pb-1">Productos</h3>
                  <div className="space-y-2">
                    {editingOrder.items && Array.isArray(editingOrder.items) ? (
                      editingOrder.items.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span>{item.quantity}x {item.name} ({item.size})</span>
                          <span className="font-medium">{formatPrice(item.price * item.quantity)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500 italic">No hay detalles de productos</p>
                    )}
                    <div className="pt-2 border-t border-emerald-100 flex justify-between font-bold text-vandora-emerald">
                      <span>Total:</span>
                      <span>{formatPrice(editingOrder.total)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg space-y-3 mb-6">
                  <h3 className="text-sm font-semibold text-gray-900 border-b pb-1">Afiliado (Referencia)</h3>
                  <div className="text-sm">
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">ID Afiliado / Tracking Code</label>
                    <input 
                      type="text" 
                      value={editingOrder.affiliate_id || ''}
                      onChange={(e) => setEditingOrder({...editingOrder, affiliate_id: e.target.value})}
                      className="w-full rounded-md border-gray-300 shadow-sm border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Sin afiliado"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado del Pedido</label>
                  <select
                    value={editingOrder.status}
                    onChange={(e) => setEditingOrder({ ...editingOrder, status: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none"
                  >
                    <option value="pending">Pendiente</option>
                    <option value="processing">En Proceso</option>
                    <option value="shipped">Enviado</option>
                    <option value="completed">Completado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas Administrativas</label>
                  <textarea
                    value={editingOrder.notes || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, notes: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none"
                    rows={3}
                    placeholder="Detalles sobre el envío o pago..."
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-6 border-t">
                  <button type="button" onClick={() => setIsOrderModalOpen(false)} className="px-6 py-2 border rounded-md text-gray-600">Cancelar</button>
                  <button type="submit" className="px-6 py-2 bg-vandora-emerald text-white rounded-md hover:bg-emerald-800 transition-colors shadow-md">Guardar</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isUserModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-serif text-gray-900">{editingUser ? 'Cambiar Rol de Usuario' : 'Invitar Usuario'}</h2>
                <button onClick={() => setIsUserModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
              </div>

              {editingUser && (
                <div className="mb-6 space-y-4">
                  <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-600 border border-gray-100">
                    <p className="mb-1"><span className="font-bold text-gray-900">Usuario:</span> {editingUser.name}</p>
                    <p className="mb-1"><span className="font-bold text-gray-900">Email:</span> {editingUser.email || 'N/A'}</p>
                    <p className="mb-1"><span className="font-bold text-gray-900">ID:</span> <span className="text-[10px] font-mono">{editingUser.id}</span></p>
                  </div>

                  {/* Order History */}
                  <div className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100">
                    <h3 className="text-sm font-bold text-vandora-emerald mb-3 flex items-center">
                      <History className="w-4 h-4 mr-2" /> Historial de Pedidos
                    </h3>
                    {fetchingUserOrders ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-6 h-6 animate-spin text-vandora-emerald" />
                      </div>
                    ) : userOrders.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">No tiene pedidos registrados.</p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                        {userOrders.map((order) => (
                          <div key={order.id} className="bg-white p-2 rounded border border-emerald-50 flex justify-between items-center text-xs">
                            <div>
                               <p className="font-medium">#{order.id.substring(0, 8)}</p>
                               <p className="text-gray-400">{new Date(order.created_at).toLocaleDateString()}</p>
                            </div>
                            <div className="text-right">
                               <p className="font-bold text-vandora-emerald">{formatPrice(order.total)}</p>
                               <p className={`capitalize ${order.status === 'completed' ? 'text-green-600' : 'text-yellow-600'}`}>{order.status}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleSaveUser} className="space-y-4">
                {!editingUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email del Invitado</label>
                    <input
                      type="email"
                      required
                      className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none"
                      placeholder="correo@ejemplo.com"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                  <select
                    value={editingUser?.role || 'cliente'}
                    onChange={(e) => editingUser ? setEditingUser({ ...editingUser, role: e.target.value }) : null}
                    className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none"
                  >
                    <option value="cliente">Cliente (Usuario Estándar)</option>
                    <option value="support">Soporte (Pedidos)</option>
                    <option value="editor">Editor (Productos/Contenido)</option>
                    <option value="admin">Administrador (Total)</option>
                    <option value="superadmin">Superadmin (Creador/Dueño)</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-3 pt-6 border-t">
                  <button type="button" onClick={() => setIsUserModalOpen(false)} className="px-6 py-2 border rounded-md text-gray-600 font-medium">Cancelar</button>
                  <button type="submit" className="px-6 py-2 bg-vandora-emerald text-white rounded-md hover:bg-emerald-800 transition-colors shadow-md font-medium">
                    {editingUser ? 'Actualizar Rol' : 'Enviar Invitación'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCategoryModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
            <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-serif text-gray-900">Gestionar Categorías</h2>
                <button onClick={() => setIsCategoryModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
              </div>
              
              <div className="space-y-4 mb-6 max-h-60 overflow-y-auto pr-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-md group">
                    <input 
                      type="text" 
                      defaultValue={cat.name}
                      onBlur={(e) => handleUpdateCategory(cat.id, cat.name, e.target.value)}
                      className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium text-gray-700"
                    />
                    <div className="flex items-center gap-2">
                       {cat.image_url ? (
                         <img src={cat.image_url} alt="" className="w-8 h-8 rounded object-cover border" />
                       ) : (
                         <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center border border-dashed text-gray-400">
                           <ImageIcon className="w-4 h-4" />
                         </div>
                       )}
                       <button 
                         onClick={() => {
                           const url = prompt('URL de la imagen para ' + cat.name, cat.image_url || '');
                           if (url !== null) handleUpdateCategoryImage(cat.id, url);
                         }}
                         className="text-gray-400 hover:text-vandora-emerald p-1"
                         title="Cambiar imagen"
                       >
                         <ImageIcon className="h-4 w-4" />
                       </button>
                    </div>
                    <button 
                      onClick={() => handleDeleteCategory(cat.id, cat.name)}
                      className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Eliminar categoría"
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nueva Categoría</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      className="flex-1 rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none text-sm"
                      placeholder="Ej: Vestidos, Accesorios..."
                    />
                    <button 
                      onClick={handleCreateCategory}
                      className="bg-vandora-emerald text-white px-4 py-2 rounded-md hover:bg-emerald-800 transition-colors shadow-sm text-sm"
                    >
                      Añadir
                    </button>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="px-6 py-2 border rounded-md text-gray-600 text-sm">Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {isTestimonialModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[80] backdrop-blur-sm">
            <div className="bg-white rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-serif text-gray-900">{editingTestimonial ? 'Editar Testimonio' : 'Nuevo Testimonio'}</h2>
                <button onClick={() => setIsTestimonialModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
              </div>
              
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data = {
                  user_name: formData.get('user_name'),
                  rating: parseInt(formData.get('rating') as string),
                  comment: formData.get('comment'),
                  size_info: formData.get('size_info'),
                  images: editingTestimonial?.images || [],
                  videos: editingTestimonial?.videos || [],
                };
                handleSaveTestimonial(data);
              }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Cliente</label>
                    <input 
                      type="text" 
                      name="user_name" 
                      defaultValue={editingTestimonial?.user_name || ''} 
                      required 
                      className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Calificación (1-5)</label>
                    <select 
                      name="rating" 
                      defaultValue={editingTestimonial?.rating || 5} 
                      className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none bg-white"
                    >
                      {[5, 4, 3, 2, 1].map(num => <option key={num} value={num}>{num} Estrellas</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Comentario</label>
                  <textarea 
                    name="comment" 
                    defaultValue={editingTestimonial?.comment || ''} 
                    rows={3} 
                    className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none"
                  ></textarea>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Información de Talla/Ajuste (Opcional)</label>
                  <input 
                    type="text" 
                    name="size_info" 
                    defaultValue={editingTestimonial?.size_info || ''} 
                    placeholder="Ej: Mido 1.65m, pedí S y me queda perfecto" 
                    className="w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-2 focus:ring-vandora-emerald outline-none" 
                  />
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Fotos y Videos del Cliente</label>
                  <MediaManager 
                    images={editingTestimonial?.images || []}
                    videos={editingTestimonial?.videos || []}
                    colors={[]}
                    onImagesChange={(images) => setEditingTestimonial(prev => ({ ...prev, images }))}
                    onVideosChange={(videos) => setEditingTestimonial(prev => ({ ...prev, videos }))}
                  />
                  <p className="text-[10px] text-gray-500 mt-2 italic">Sube capturas de pantalla de chats o fotos que los clientes te hayan enviado.</p>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <button type="button" onClick={() => setIsTestimonialModalOpen(false)} className="px-6 py-2 border rounded-md text-gray-600">Cancelar</button>
                  <button type="submit" className="px-6 py-2 bg-vandora-emerald text-white rounded-md hover:bg-emerald-800 transition-colors shadow-md">Guardar Testimonio</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {isManualOrderModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-[65] backdrop-blur-sm">
            <div className="bg-white rounded-xl w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[95vh] overflow-y-auto flex flex-col shadow-2xl">
              <div className="flex justify-between items-center p-4 md:p-6 sticky top-0 bg-white z-20 border-b">
                <h2 className="text-xl font-serif text-gray-900">Crear Nuevo Pedido Manual</h2>
                <button onClick={() => setIsManualOrderModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
              </div>
              
              <form onSubmit={handleCreateManualOrder} className="p-4 md:p-8 space-y-6 flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Cliente</h3>
                    <input
                      type="tel"
                      placeholder="Teléfono (busca a la clienta)"
                      required
                      className="w-full rounded-md border p-3 outline-none focus:ring-2 focus:ring-vandora-emerald"
                      value={manualOrderFormData.customer_phone}
                      onChange={(e) => setManualOrderFormData({...manualOrderFormData, customer_phone: e.target.value})}
                      onBlur={(e) => lookupCustomerByPhone(e.target.value)}
                    />
                    {matchedCustomer && (
                      <p className="text-xs text-vandora-emerald bg-emerald-50 rounded-md px-3 py-2">
                        Cliente existente: {matchedCustomer.full_name || 'sin nombre'} · {matchedCustomer.orders_count} pedidos · llegó por {labelOfChannel(matchedCustomer.first_channel)}
                      </p>
                    )}
                    <input
                      type="text"
                      placeholder="Nombre Completo"
                      required
                      className="w-full rounded-md border p-3 outline-none focus:ring-2 focus:ring-vandora-emerald"
                      value={manualOrderFormData.customer_name}
                      onChange={(e) => setManualOrderFormData({...manualOrderFormData, customer_name: e.target.value})}
                    />
                    <input
                      type="email"
                      placeholder="Email (Opcional)"
                      className="w-full rounded-md border p-3 outline-none focus:ring-2 focus:ring-vandora-emerald"
                      value={manualOrderFormData.customer_email}
                      onChange={(e) => setManualOrderFormData({...manualOrderFormData, customer_email: e.target.value})}
                    />
                    <textarea
                      placeholder={['tienda_fisica', 'calle'].includes(manualOrderFormData.origin) ? 'Dirección (opcional en venta presencial)' : 'Dirección de Envío'}
                      required={!['tienda_fisica', 'calle'].includes(manualOrderFormData.origin)}
                      rows={2}
                      className="w-full rounded-md border p-3 outline-none focus:ring-2 focus:ring-vandora-emerald"
                      value={manualOrderFormData.address}
                      onChange={(e) => setManualOrderFormData({...manualOrderFormData, address: e.target.value})}
                    />
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Detalles de Venta</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Origen</label>
                        <select 
                          className="w-full rounded-md border p-3 bg-white outline-none focus:ring-2 focus:ring-vandora-emerald"
                          value={manualOrderFormData.origin}
                          onChange={(e) => setManualOrderFormData({...manualOrderFormData, origin: e.target.value})}
                        >
                          {activeChannels.filter(c => c.key !== 'web').map(c => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Estado Inicial</label>
                        <select 
                          className="w-full rounded-md border p-3 bg-white outline-none focus:ring-2 focus:ring-vandora-emerald"
                          value={manualOrderFormData.status}
                          onChange={(e) => setManualOrderFormData({...manualOrderFormData, status: e.target.value})}
                        >
                          <option value="pending">Pendiente</option>
                          <option value="processing">Procesando</option>
                          <option value="completed">Completado</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">ID Afiliado (Si aplica)</label>
                        <input 
                          type="text" 
                          placeholder="Tracking ID"
                          className="w-full rounded-md border p-3 outline-none focus:ring-2 focus:ring-vandora-emerald"
                          value={manualOrderFormData.affiliate_id}
                          onChange={(e) => setManualOrderFormData({...manualOrderFormData, affiliate_id: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl border space-y-4">
                  <h3 className="text-sm font-bold text-vandora-emerald uppercase flex items-center">
                    <Package className="w-4 h-4 mr-2" /> Productos en el Pedido
                  </h3>
                  
                  <div className="flex flex-col sm:flex-row gap-3">
                    <select 
                      className="flex-1 rounded-md border p-2 bg-white text-sm"
                      value={manualOrderItem.product_id}
                      onChange={(e) => {
                        const prod = products.find(p => p.id === e.target.value);
                        setManualOrderItem({
                          ...manualOrderItem, 
                          product_id: e.target.value,
                          size: prod?.sizes?.[0] || '',
                          color: prod?.colors?.[0]?.name || ''
                        });
                      }}
                    >
                      <option value="">Seleccionar Producto...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name} - {formatPrice(p.price)}</option>
                      ))}
                    </select>
                    {(() => {
                      const prod = products.find(p => p.id === manualOrderItem.product_id);
                      if (!prod) return null;
                      const stockLabel = (color: string, size: string) =>
                        manualVariants ? ` (${availableFor(manualVariants, color, size)})` : '';
                      return (
                        <>
                          {prod.colors?.length > 0 && (
                            <select
                              className="rounded-md border p-2 bg-white text-sm"
                              value={manualOrderItem.color}
                              onChange={(e) => setManualOrderItem({ ...manualOrderItem, color: e.target.value })}
                              aria-label="Color"
                            >
                              {prod.colors.map((c: any) => (
                                <option key={c.name} value={c.name}>{c.name}{prod.sizes?.length ? '' : stockLabel(c.name, '')}</option>
                              ))}
                            </select>
                          )}
                          {prod.sizes?.length > 0 && (
                            <select
                              className="rounded-md border p-2 bg-white text-sm"
                              value={manualOrderItem.size}
                              onChange={(e) => setManualOrderItem({ ...manualOrderItem, size: e.target.value })}
                              aria-label="Talla"
                            >
                              {prod.sizes.map((s: string) => (
                                <option key={s} value={s}>{s}{stockLabel(manualOrderItem.color, s)}</option>
                              ))}
                            </select>
                          )}
                        </>
                      );
                    })()}
                    <div className="flex gap-2">
                       <input 
                        type="number" 
                        min="1" 
                        className="w-16 rounded-md border p-2 text-sm"
                        value={manualOrderItem.quantity}
                        onChange={(e) => setManualOrderItem({...manualOrderItem, quantity: parseInt(e.target.value)})}
                       />
                       <button 
                        type="button"
                        onClick={() => {
                          const prod = products.find(p => p.id === manualOrderItem.product_id);
                          if (!prod) return;
                          if (manualVariants) {
                            const available = availableFor(manualVariants, manualOrderItem.color, manualOrderItem.size);
                            if (available < manualOrderItem.quantity &&
                                !confirm(`Solo hay ${available} en stock de esta variante. ¿Registrar la venta de todas formas? El stock quedará en negativo.`)) {
                              return;
                            }
                          }

                          const newItem = {
                            id: prod.id,
                            name: prod.name,
                            price: prod.price,
                            quantity: manualOrderItem.quantity,
                            size: manualOrderItem.size,
                            color: manualOrderItem.color,
                            image: prod.images?.[0]?.url || prod.images?.[0] || ''
                          };
                          
                          const newItems = [...manualOrderFormData.items, newItem];
                          const newTotal = newItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                          
                          setManualOrderFormData({
                            ...manualOrderFormData, 
                            items: newItems,
                            total: newTotal.toString()
                          });
                          setManualOrderItem({ product_id: '', quantity: 1, size: '', color: '' });
                        }}
                        className="bg-vandora-emerald text-white px-4 py-2 rounded-md hover:bg-emerald-800 transition-colors"
                       >
                         Añadir
                       </button>
                    </div>
                  </div>

                  {manualOrderFormData.items.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {manualOrderFormData.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-sm bg-white p-2 rounded border">
                          <span>{item.quantity}x {item.name}</span>
                          <div className="flex items-center gap-4">
                            <span className="font-bold">{formatPrice(item.price * item.quantity)}</span>
                            <button 
                              type="button" 
                              onClick={() => {
                                const newItems = manualOrderFormData.items.filter((_, i) => i !== idx);
                                const newTotal = newItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                                setManualOrderFormData({
                                  ...manualOrderFormData, 
                                  items: newItems,
                                  total: newTotal.toString()
                                });
                              }}
                              className="text-red-500 hover:text-red-700"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between items-center pt-2 font-bold text-vandora-emerald text-lg">
                        <span>TOTAL</span>
                        <span>{formatPrice(parseFloat(manualOrderFormData.total))}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-6 border-t sticky bottom-0 bg-white">
                  <button 
                    type="button" 
                    onClick={() => setIsManualOrderModalOpen(false)} 
                    className="px-6 py-2 border rounded-md text-gray-600"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="px-6 py-2 bg-vandora-emerald text-white rounded-md hover:bg-emerald-800 transition-colors shadow-md"
                  >
                    Crear Pedido
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};



export default AdminPage;
