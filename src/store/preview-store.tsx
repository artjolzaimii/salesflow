"use client";

/**
 * Client UI store: the global UI state the prototype kept (drawers, dialogs,
 * confirmation, toast, sidebar). It holds no business data: every screen reads
 * and writes through the database APIs (src/services/client). The file keeps its
 * historical name to avoid churn in imports.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

export interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  run: () => void;
}

export interface PreviewState {


  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  toast: string | null;
  confirm: ConfirmRequest | null;
  /** Database order shown in the order drawer (orders are live since Phase 5C). */
  orderDrawerId: string | null;
  /** Database invoice shown in the invoice drawer (live since Phase 5D). */
  invoiceDrawerId: string | null;
  /** Open payment dialog, preselected invoice ("" = choose). */
  paymentDialog: { invoiceId: string } | null;
  /** Open product dialog: product id to edit, or "" for a new product. */
  productDialog: { productId: string } | null;
}

function initialState(): PreviewState {
  return {
    sidebarCollapsed: false,
    mobileNavOpen: false,
    toast: null,
    confirm: null,
    orderDrawerId: null,
    invoiceDrawerId: null,
    paymentDialog: null,
    productDialog: null,
  };
}

type Patch = Partial<PreviewState> | ((s: PreviewState) => Partial<PreviewState>);

function createPreviewStore() {
  let state = initialState();
  const listeners = new Set<() => void>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const get = () => state;
  const set = (patch: Patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  const toast = (message: string) => {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 3800);
  };

  const actions = {
    set,
    toast,

    /* ----- shell ----- */
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    setMobileNav: (open: boolean) => set({ mobileNavOpen: open }),
    /** Mirrors the prototype's `go()`: navigation closes transient overlays. */
    closeOverlays: () => set({ mobileNavOpen: false, orderDrawerId: null, invoiceDrawerId: null }),
    closeAll: () =>
      set({ mobileNavOpen: false, orderDrawerId: null, invoiceDrawerId: null, paymentDialog: null, productDialog: null, confirm: null }),
    openOrder: (id: string) => set({ orderDrawerId: id, invoiceDrawerId: null, mobileNavOpen: false }),
    openInvoice: (id: string) => set({ invoiceDrawerId: id, orderDrawerId: null, mobileNavOpen: false }),
    closeOrder: () => set({ orderDrawerId: null }),
    closeInvoice: () => set({ invoiceDrawerId: null }),
    askConfirm: (req: ConfirmRequest) => set({ confirm: req }),
    closeConfirm: () => set({ confirm: null }),
    runConfirm: () => {
      const req = get().confirm;
      set({ confirm: null });
      req?.run();
    },

    /* ----- payments (dialog only; recorded through POST /api/payments, see payment-dialog.tsx) ----- */
    openPayment: (invoiceId = "") => set({ paymentDialog: { invoiceId } }),
    closePayment: () => set({ paymentDialog: null }),

    /* ----- products (dialog only; data lives in the database, see product-dialog.tsx) ----- */
    openProduct: (productId = "") => set({ productDialog: { productId } }),
    closeProduct: () => set({ productDialog: null }),
  };

  return { get, set, subscribe, actions };
}

type PreviewStore = ReturnType<typeof createPreviewStore>;
export type PreviewActions = PreviewStore["actions"];

const StoreContext = createContext<PreviewStore | null>(null);

export function PreviewStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createPreviewStore);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.actions.closeAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function useStore(): PreviewStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("usePreview must be used inside <PreviewStoreProvider>");
  return store;
}

/** Subscribes to a slice of preview state. Selectors must return stored references, not new objects. */
export function usePreview<T>(selector: (s: PreviewState) => T): T {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

export function useActions(): PreviewActions {
  return useStore().actions;
}
