import React, { createContext, useContext, useEffect, useState } from 'react';
import ReactGA from 'react-ga4';
import ReactPixel from 'react-facebook-pixel';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

// Extend Window interface for Klaviyo
declare global {
  interface Window {
    klaviyo: any;
    _learnq: any[];
  }
}

interface AnalyticsContextType {
  trackEvent: (category: string, action: string, label?: string, value?: number, eventId?: string) => void;
  trackStandardEvent: (eventName: string, params?: any) => void;
  trackPurchase: (transactionId: string, value: number, currency?: string, eventId?: string, extraUserData?: any) => void;
  trackQuizStart: (quizName: string) => void;
  trackQuizComplete: (quizName: string, result: string) => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined);

export const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { user, profile } = useAuth();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const initAnalytics = async () => {
      try {
        const { data } = await supabase.from('app_settings').select('key, value').in('key', ['ga4_id', 'meta_pixel_id', 'klaviyo_public_key']);
        if (data) {
          const ga4Id = data.find(s => s.key === 'ga4_id')?.value;
          const pixelId = data.find(s => s.key === 'meta_pixel_id')?.value;

          if (ga4Id) {
            ReactGA.initialize(ga4Id);
          }

          if (pixelId) {
            ReactPixel.init(pixelId);
          }

          const klaviyoKey = data.find(s => s.key === 'klaviyo_public_key')?.value;
          if (klaviyoKey) {
            injectKlaviyoScript(klaviyoKey);
          }

          setInitialized(true);
        }
      } catch (error) {
        console.error('Error initializing analytics:', error);
      }
    };

    initAnalytics();
  }, []);

  // Sync Klaviyo Identity
  useEffect(() => {
    if (user || profile) {
      const identifyData: any = {};
      if (user?.email) identifyData['$email'] = user.email;
      if (profile?.phone) identifyData['$phone_number'] = profile.phone;
      if (profile?.full_name) {
        const names = profile.full_name.split(' ');
        identifyData['$first_name'] = names[0];
        if (names.length > 1) identifyData['$last_name'] = names.slice(1).join(' ');
      }

      if (Object.keys(identifyData).length > 0) {
        identifyKlaviyoUser(identifyData);
      }
    }
  }, [user, profile]);

  const injectKlaviyoScript = (publicKey: string) => {
    if (document.getElementById('klaviyo-script')) return;
    
    const script = document.createElement('script');
    script.id = 'klaviyo-script';
    script.type = 'text/javascript';
    script.async = true;
    script.src = `https://static.klaviyo.com/onsite/js/${publicKey}/klaviyo.js`;
    document.head.appendChild(script);
  };

  const identifyKlaviyoUser = (userData: any) => {
    try {
      if (window.klaviyo) {
        window.klaviyo.identify(userData);
      } else {
        window._learnq = window._learnq || [];
        window._learnq.push(['identify', userData]);
      }
    } catch (e) {
      console.warn('Klaviyo identify error:', e);
    }
  };

  const trackKlaviyoEvent = (eventName: string, properties: any = {}) => {
    try {
      if (window.klaviyo) {
        window.klaviyo.track(eventName, properties);
      } else {
        window._learnq = window._learnq || [];
        window._learnq.push(['track', eventName, properties]);
      }
    } catch (e) {
      console.warn('Klaviyo track error:', e);
    }
  };

  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return null;
  };

  const generateEventId = (prefix = 'ev') => {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  };

  const trackCAPI = async (eventName: string, eventId: string, params: any = {}, extraUserData: any = {}) => {
    try {
      const fbc = getCookie('_fbc');
      const fbp = getCookie('_fbp');

      // We send the data to our Supabase Edge Function
      supabase.functions.invoke('meta-capi', {
        body: { 
          eventName, 
          eventId, 
          params, 
          url: window.location.href,
          userData: {
            email: user?.email || extraUserData?.email || null,
            phone: profile?.phone || extraUserData?.phone || null,
            fbc,
            fbp,
          }
        }
      }).catch(err => console.warn('CAPI error:', err));
    } catch (error) {
      console.warn('CAPI track error:', error);
    }
  };

  // Track Page Views
  useEffect(() => {
    if (initialized) {
      ReactGA.send({ hitType: "pageview", page: location.pathname + location.search });
      ReactPixel.pageView();
    }
  }, [location, initialized]);

  const trackEvent = (category: string, action: string, label?: string, value?: number, eventId?: string) => {
    if (!initialized) return;
    
    const evId = eventId || generateEventId();
    
    ReactGA.event({ category, action, label, value });
    // @ts-ignore - Meta Pixel supports 3rd arg for eventID but types may be limited
    ReactPixel.trackCustom(action, { category, label, value }, { eventID: evId });
    trackCAPI(action, evId, { category, label, value });
    
    // Simple Klaviyo fallback for custom events
    trackKlaviyoEvent(action, { category, label, value });
  };

  const trackStandardEvent = (eventName: string, params: any = {}, customEventId?: string) => {
    if (!initialized) return;

    // Use custom event ID if provided (e.g. view-ID-time) or generate one
    const eventId = customEventId || generateEventId(eventName.toLowerCase());

    // GA4 Mapping
    ReactGA.event({
      category: 'MetaStandard',
      action: eventName,
      ...params
    });

    // Meta Pixel
    // @ts-ignore - Meta Pixel supports 3rd arg for eventID
    ReactPixel.track(eventName, params, { eventID: eventId });

    // Meta CAPI
    trackCAPI(eventName, eventId, params);

    // Klaviyo Mapping
    if (eventName === 'ViewContent' && params.content_type === 'product') {
      trackKlaviyoEvent('Viewed Product', {
        'ProductName': params.content_name,
        'ProductID': params.content_ids?.[0],
        'SKU': params.content_ids?.[0],
        'Categories': [params.content_category],
        'ImageURL': params.image_url,
        'URL': window.location.href,
        'Price': params.value
      });
    } else if (eventName === 'AddToCart') {
      trackKlaviyoEvent('Added to Cart', {
        'ProductName': params.content_name,
        'ProductID': params.content_ids?.[0],
        'SKU': params.content_ids?.[0],
        'Categories': [params.content_category],
        'ImageURL': params.image_url,
        'URL': window.location.href,
        'Price': params.value,
        'Quantity': params.num_items || 1
      });
    } else if (eventName === 'InitiateCheckout') {
      trackKlaviyoEvent('Started Checkout', {
        '$value': params.value,
        'ItemNames': params.item_names || [],
        'CheckoutURL': window.location.href,
        'Items': params.items || []
      });
    }
  };

  const trackPurchase = (transactionId: string, value: number, currency = 'USD', eventId?: string, extraUserData?: any) => {
    if (!initialized) return;

    const evId = eventId || `purchase_${transactionId}`;

    ReactGA.event({
      category: "Ecommerce",
      action: "Purchase",
      value: value,
      label: transactionId
    });

    const params = {
      value: value,
      currency: currency,
      content_ids: [transactionId],
      content_type: 'product'
    };

    // @ts-ignore - Meta Pixel supports 3rd arg for eventID
    ReactPixel.track('Purchase', params, { eventID: evId });
    trackCAPI('Purchase', evId, params, extraUserData);

    // Klaviyo Placed Order & Ordered Product
    if (extraUserData?.items) {
      const klaviyoItems = extraUserData.items.map((item: any) => ({
        'ProductID': item.id,
        'SKU': item.id || item.sku,
        'ProductName': item.name,
        'Quantity': item.quantity,
        'ItemPrice': item.price,
        'RowTotal': item.price * item.quantity,
        'ImageURL': item.image,
        'ProductURL': `${window.location.origin}/producto/item/${item.id}` // Best guest
      }));

      trackKlaviyoEvent('Placed Order', {
        '$event_id': transactionId,
        '$value': value,
        'ItemNames': extraUserData.items.map((i: any) => i.name),
        'Brands': ['Vandora'],
        'Items': klaviyoItems,
        'BillingAddress': extraUserData.billing_address || {},
        'ShippingAddress': extraUserData.shipping_address || {}
      });

      // Track each product individually
      klaviyoItems.forEach((kItem: any) => {
        trackKlaviyoEvent('Ordered Product', {
          '$event_id': `${transactionId}_${kItem.SKU}`,
          '$value': kItem.RowTotal,
          ...kItem
        });
      });
    } else {
      // Basic fallback if items are missing
      trackKlaviyoEvent('Placed Order', {
        '$event_id': transactionId,
        '$value': value
      });
    }
  };

  const trackQuizStart = (quizName: string) => {
    trackEvent('Quiz', 'Start', quizName);
    if (initialized) ReactPixel.trackCustom('QuizStart', { quiz_name: quizName });
  };

  const trackQuizComplete = (quizName: string, result: string) => {
    trackEvent('Quiz', 'Complete', `${quizName} - Result: ${result}`);
    if (initialized) ReactPixel.trackCustom('QuizComplete', { quiz_name: quizName, result });
  };

  return (
    <AnalyticsContext.Provider value={{ trackEvent, trackStandardEvent, trackPurchase, trackQuizStart, trackQuizComplete }}>
      {children}
    </AnalyticsContext.Provider>
  );
};

export const useAnalytics = () => {
  const context = useContext(AnalyticsContext);
  if (!context) {
    throw new Error('useAnalytics must be used within an AnalyticsProvider');
  }
  return context;
};
