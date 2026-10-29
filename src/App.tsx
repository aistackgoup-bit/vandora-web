/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import ProtectedRoute from './components/ProtectedRoute';
import { AnalyticsProvider } from './context/AnalyticsContext';
import { AffiliateTracker } from './components/AffiliateTracker';

// Every page except the home page is code-split, so visitors only download what they open
// (the admin panel alone is several hundred KB).
const ShopPage = lazy(() => import('./pages/ShopPage'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const MyAccountPage = lazy(() => import('./pages/MyAccountPage'));
const StoryPage = lazy(() => import('./pages/StoryPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const FAQPage = lazy(() => import('./pages/FAQPage'));
const ShippingPage = lazy(() => import('./pages/ShippingPage'));
const ThankYouPage = lazy(() => import('./pages/ThankYouPage'));
const OrderTrackingPage = lazy(() => import('./pages/OrderTrackingPage'));
const UpsellPage = lazy(() => import('./pages/UpsellPage'));
const DownsellPage = lazy(() => import('./pages/DownsellPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const RefundPolicyPage = lazy(() => import('./pages/RefundPolicyPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const QuizPage = lazy(() => import('./pages/QuizPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

// Scroll to top on route change
const ScrollToTop = () => {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const PageFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando">
    <div className="h-8 w-8 rounded-full border-2 border-vandora-black/20 border-t-vandora-black animate-spin" />
  </div>
);

const withLayout = (page: React.ReactNode) => (
  <Layout>
    <Suspense fallback={<PageFallback />}>{page}</Suspense>
  </Layout>
);

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Router>
          <AnalyticsProvider>
            <ScrollToTop />
            <AffiliateTracker />
            <Suspense fallback={<PageFallback />}>
            <Routes>
            {/* Public Routes with Layout */}
            <Route path="/" element={withLayout(<HomePage />)} />
            <Route path="/tienda" element={withLayout(<ShopPage />)} />
            <Route path="/tienda/:categoryName" element={withLayout(<ShopPage />)} />
            <Route path="/producto/:categoria/:slug" element={withLayout(<ProductDetailPage />)} />
            <Route path="/pagar" element={withLayout(<CheckoutPage />)} />
            <Route path="/thank-you" element={withLayout(<ThankYouPage />)} />
            <Route path="/nuestra-historia" element={withLayout(<StoryPage />)} />
            <Route path="/contacto" element={withLayout(<ContactPage />)} />
            <Route path="/preguntas-frecuentes" element={withLayout(<FAQPage />)} />
            <Route path="/envio" element={withLayout(<ShippingPage />)} />
            <Route path="/rastrear-pedido" element={withLayout(<OrderTrackingPage />)} />
            <Route path="/mi-cuenta" element={withLayout(<MyAccountPage />)} />
            <Route path="/politica-de-privacidad" element={withLayout(<PrivacyPolicyPage />)} />
            <Route path="/politica-de-reembolso" element={withLayout(<RefundPolicyPage />)} />
            <Route path="/terminos-y-condiciones" element={withLayout(<TermsPage />)} />
            <Route path="/quiz/:slug" element={<QuizPage />} />
            <Route path="/upsell" element={<UpsellPage />} />
            <Route path="/downsell" element={<DownsellPage />} />
            <Route path="/iniciar-sesion" element={withLayout(<LoginPage />)} />
            <Route path="/restablecer-contrasena" element={withLayout(<ResetPasswordPage />)} />
            <Route path="/administracion" element={
              <ProtectedRoute requireStaff>
                <AdminPage />
              </ProtectedRoute>
            } />
            {/* 404 Catch All */}
            <Route path="*" element={withLayout(<NotFoundPage />)} />
          </Routes>
          </Suspense>
        </AnalyticsProvider>
        </Router>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
