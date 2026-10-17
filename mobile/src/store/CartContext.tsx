// Shopping cart, persisted in AsyncStorage so it survives app restarts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Order } from '../api/types';

export type CartItem = {
  variant_id: string;
  product_id: string;
  name: string;
  size: string | null;
  color: string | null;
  price_minor: number;
  currency: string;
  quantity: number;
  stock: number;
};

type CartState = {
  items: CartItem[];
  count: number;
  subtotal: number;
  add: (item: CartItem) => void;
  setQuantity: (variantId: string, q: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  lastOrder: (Order & { lines: CartItem[]; discount_code: string | null }) | null;
  setLastOrder: (o: (Order & { lines: CartItem[]; discount_code: string | null }) | null) => void;
};

const KEY = 'nascon.cart';
const Ctx = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastOrder, setLastOrder] = useState<CartState['lastOrder']>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v) setItems(JSON.parse(v));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
  }, [items, loaded]);

  const add = useCallback((item: CartItem) => {
    setItems((prev) => {
      const ex = prev.find((p) => p.variant_id === item.variant_id);
      if (ex) {
        return prev.map((p) =>
          p.variant_id === item.variant_id ? { ...p, quantity: Math.min(p.quantity + item.quantity, Math.max(item.stock, 1)), stock: item.stock } : p,
        );
      }
      return [...prev, item];
    });
  }, []);
  const setQuantity = useCallback((variantId: string, q: number) => {
    setItems((prev) => prev.map((p) => (p.variant_id === variantId ? { ...p, quantity: Math.max(1, q) } : p)));
  }, []);
  const remove = useCallback((variantId: string) => setItems((prev) => prev.filter((p) => p.variant_id !== variantId)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartState>(
    () => ({
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      subtotal: items.reduce((n, i) => n + i.quantity * i.price_minor, 0),
      add,
      setQuantity,
      remove,
      clear,
      lastOrder,
      setLastOrder,
    }),
    [items, add, setQuantity, remove, clear, lastOrder],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart outside CartProvider');
  return v;
}
