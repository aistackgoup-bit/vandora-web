import React from 'react';
import Navbar from './Navbar';
import Footer from './Footer';
import CookieConsent from './CookieConsent';
import Breadcrumbs from './Breadcrumbs';
import { useCart } from '../context/CartContext';
import { X, Minus, Plus, Trash2, Truck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatPrice } from '../lib/utils';
import { Link, useLocation } from 'react-router-dom';

// Loaded after the page: the chat pulls in a markdown renderer and neither is needed for first paint
const ChatWidget = React.lazy(() => import('./ChatWidget'));
const PopupDisplay = React.lazy(() => import('./PopupDisplay'));

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const { isOpen, setIsOpen, items, removeItem, updateQuantity, total } = useCart();
  const isCheckout = pathname === '/pagar';
  const freeShippingThreshold = 100;
  const remainingForFreeShipping = Math.max(0, freeShippingThreshold - total);
  const progressPercentage = Math.min(100, (total / freeShippingThreshold) * 100);

  return (
    <div className="min-h-screen flex flex-col bg-vandora-cream font-sans text-vandora-black">
      <Navbar />
      <Breadcrumbs />
      <main className="flex-grow">
        {children}
      </main>
      {!isCheckout && <Footer />}
      {!isCheckout && (
        <React.Suspense fallback={null}>
          <ChatWidget />
          <PopupDisplay />
        </React.Suspense>
      )}
      <CookieConsent />

      {/* Cart Sidebar */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black z-50"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-xl z-50 flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <h2 className="text-xl font-serif text-vandora-emerald">Tu Bolsa de Compras</h2>
                <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X className="h-6 w-6 text-gray-500" />
                </button>
              </div>

              {/* Free Shipping Progress (CRO) */}
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                {remainingForFreeShipping > 0 ? (
                  <p className="text-sm text-gray-600 mb-2">
                    Agrega <span className="font-bold text-vandora-emerald">{formatPrice(remainingForFreeShipping)}</span> más para <span className="font-bold">ENVÍO GRATIS</span>
                  </p>
                ) : (
                  <p className="text-sm text-vandora-emerald font-bold mb-2 flex items-center">
                    <Truck className="h-4 w-4 mr-1" /> ¡Felicidades! Tienes envío gratis
                  </p>
                )}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-vandora-gold h-2 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {items.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500 mb-4">Tu bolsa está vacía.</p>
                    <button 
                      onClick={() => setIsOpen(false)}
                      className="text-vandora-emerald font-medium hover:underline"
                    >
                      Continuar comprando
                    </button>
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={`${item.id}-${item.size}-${item.color}`} className="flex space-x-4">
                      <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border border-gray-200">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="h-full w-full object-cover object-center"
                        />
                      </div>

                      <div className="flex flex-1 flex-col">
                        <div>
                          <div className="flex justify-between text-base font-medium text-gray-900">
                            <h3>
                              <Link to={`/product/${item.id}`} onClick={() => setIsOpen(false)}>
                                {item.name}
                              </Link>
                            </h3>
                            <p className="ml-4">{formatPrice(item.price * item.quantity)}</p>
                          </div>
                          <p className="mt-1 text-sm text-gray-500">{item.color} | {item.size}</p>
                        </div>
                        <div className="flex flex-1 items-end justify-between text-sm">
                          <div className="flex items-center border border-gray-300 rounded">
                            <button 
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              className="p-1 hover:bg-gray-100"
                              disabled={item.quantity <= 1}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="px-2">{item.quantity}</span>
                            <button 
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="p-1 hover:bg-gray-100"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="font-medium text-red-500 hover:text-red-700 flex items-center"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {items.length > 0 && (
                <div className="border-t border-gray-100 p-4 space-y-4">
                  <div className="flex justify-between text-base font-medium text-gray-900">
                    <p>Subtotal</p>
                    <p>{formatPrice(total)}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Envío e impuestos calculados al finalizar la compra.
                  </p>
                  <div className="mt-6">
                    <Link
                      to="/pagar"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-center rounded-md border border-transparent bg-vandora-emerald px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-emerald-800 transition-colors"
                    >
                      Finalizar Compra
                    </Link>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Layout;
