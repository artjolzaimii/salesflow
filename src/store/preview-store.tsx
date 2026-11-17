"use client";

/**
 * Preview-mode application store.
 *
 * Holds the in-memory copy of the fictional dataset plus the UI state the
 * prototype kept globally (drawers, dialogs, toast, order draft, preview
 * controls). Mutations run through the pure functions in
 * src/services/preview/operations.ts. Nothing is persisted: reloading the page
 * restores the fixtures.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { buildFixtureConversations, ASSISTANT_OFFLINE_REPLY } from "@/mocks/assistant";
import { buildPreviewDataset, DEFAULT_RATES, PREVIEW_TODAY } from "@/mocks/fixtures";
import { formatMoney } from "@/lib/money";
import type { Conversation, Currency, DataState, SalesDataset } from "@/lib/types";
import type { DraftLine } from "@/lib/validation";
import * as ops from "@/services/preview/operations";
import type { CreateOrderInput, CreatePaymentInput } from "@/services/api";

export interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  run: () => void;
}

export interface OrderDraft {
  customerId: string;
  repId: string;
  date: string;
  address: "customer" | "pickup";
  currency: Currency;
  rate: string;
  lines: DraftLine[];
  error: string;
}

export interface PreviewState {
  today: string;
  data: SalesDataset;
  conversations: Conversation[];
  activeConversationId: string;
  assistantPending: boolean;
  assistantInput: string;

  dataState: DataState;

  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  toast: string | null;
  confirm: ConfirmRequest | null;
  orderDrawerId: string | null;
  invoiceDrawerId: string | null;
  /** Open payment dialog, preselected invoice ("" = choose). */
  paymentDialog: { invoiceId: string } | null;
  /** Open product dialog: product id to edit, or "" for a new product. */
  productDialog: { productId: string } | null;
  orderDraft: OrderDraft;
}

let lineKey = 1;
export const blankLine = (): DraftLine => ({ key: lineKey++, productId: "", quantity: "", price: "", discount: "0" });

export function blankDraft(data: SalesDataset, customerId = ""): OrderDraft {
  const c = customerId ? data.customers.find((x) => x.id === customerId) : undefined;
  return { customerId, repId: c ? c.repId : "", date: PREVIEW_TODAY, address: "customer", currency: "ALL", rate: DEFAULT_RATES.ALL, lines: [blankLine()], error: "" };
}

function initialState(): PreviewState {
  const data = buildPreviewDataset(PREVIEW_TODAY);
  return {
    today: PREVIEW_TODAY,
    data,
    conversations: buildFixtureConversations(data),
    activeConversationId: "c1",
    assistantPending: false,
    assistantInput: "",
    dataState: "ready",
    sidebarCollapsed: false,
    mobileNavOpen: false,
    toast: null,
    confirm: null,
    orderDrawerId: null,
    invoiceDrawerId: null,
    paymentDialog: null,
    productDialog: null,
    orderDraft: blankDraft(data),
  };
}

type Patch = Partial<PreviewState> | ((s: PreviewState) => Partial<PreviewState>);

function createPreviewStore() {
  let state = initialState();
  const listeners = new Set<() => void>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let assistantTimer: ReturnType<typeof setTimeout> | undefined;

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

    /* ----- preview controls ----- */
    setDataState: (dataState: DataState) => set({ dataState }),

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

    /* ----- orders ----- */
    confirmOrder: (id: string) => {
      set((s) => ({ data: ops.setOrderStatus(s.data, id, "Confirmed") }));
      toast(id + " confirmed.");
    },
    /** Operational progress; allowed after invoicing (amounts stay locked). */
    advanceOrder: (id: string, status: "Processing" | "Delivered") => {
      set((s) => ({ data: ops.setOrderStatus(s.data, id, status) }));
      toast(`${id} marked as ${status.toLowerCase()}.`);
    },
    cancelOrder: (id: string) => {
      set((s) => ({ data: ops.setOrderStatus(s.data, id, "Cancelled") }));
      toast(id + " cancelled.");
    },
    issueInvoice: (id: string) => {
      const { data, invoice } = ops.issueInvoice(get().data, id, get().today);
      set({ data });
      toast("Invoice " + invoice.id + " issued in preview. Values are frozen from here on.");
    },
    createOrder: (input: CreateOrderInput) => {
      const { data, order } = ops.createOrder(get().data, input);
      set({ data, orderDraft: blankDraft(data), orderDrawerId: order.id });
      toast(order.id + " saved as " + input.status.toLowerCase() + " in preview. In production, totals come back from POST /api/orders.");
      return order;
    },
    startOrder: (customerId = "") => set((s) => ({ orderDraft: blankDraft(s.data, customerId) })),
    updateDraft: (patch: Partial<OrderDraft> | ((d: OrderDraft) => Partial<OrderDraft>)) =>
      set((s) => ({ orderDraft: { ...s.orderDraft, ...(typeof patch === "function" ? patch(s.orderDraft) : patch) } })),
    resetDraft: () => set((s) => ({ orderDraft: blankDraft(s.data) })),

    /* ----- payments ----- */
    openPayment: (invoiceId = "") => set({ paymentDialog: { invoiceId } }),
    closePayment: () => set({ paymentDialog: null }),
    recordPayment: (input: CreatePaymentInput) => {
      const { data, payment } = ops.recordPayment(get().data, input);
      set({ data, paymentDialog: null });
      toast("Payment " + payment.id + " of " + formatMoney(payment.amount, payment.currency) + " recorded in preview.");
    },

    /* ----- products (dialog only; data lives in the database, see product-dialog.tsx) ----- */
    openProduct: (productId = "") => set({ productDialog: { productId } }),
    closeProduct: () => set({ productDialog: null }),

    /* ----- assistant ----- */
    setAssistantInput: (assistantInput: string) => set({ assistantInput }),
    selectConversation: (id: string) => set({ activeConversationId: id }),
    newConversation: () =>
      set((s) => {
        const id = "c" + Date.now();
        return {
          activeConversationId: id,
          assistantInput: "",
          conversations: [{ id, title: "New conversation", updatedLabel: "Just now", fixture: false, messages: [] }, ...s.conversations],
        };
      }),
    sendMessage: () => {
      const s = get();
      const text = s.assistantInput.trim();
      if (!text || s.assistantPending) return;
      let conversations = s.conversations;
      let active = s.activeConversationId;
      if (!conversations.some((c) => c.id === active)) {
        active = "c" + Date.now();
        conversations = [{ id: active, title: "New conversation", updatedLabel: "Just now", fixture: false, messages: [] }, ...conversations];
      }
      conversations = conversations.map((c) =>
        c.id === active
          ? { ...c, title: c.messages.length ? c.title : text.slice(0, 52), updatedLabel: "Just now", fixture: false, messages: [...c.messages, { role: "user", text }] }
          : c,
      );
      set({ conversations, activeConversationId: active, assistantInput: "", assistantPending: true });
      clearTimeout(assistantTimer);
      // No assistant backend exists in preview mode; reply with an explicit "not connected" notice.
      assistantTimer = setTimeout(
        () =>
          set((st) => ({
            assistantPending: false,
            conversations: st.conversations.map((c) =>
              c.id === active ? { ...c, messages: [...c.messages, { role: "error", text: ASSISTANT_OFFLINE_REPLY }] } : c,
            ),
          })),
        1100,
      );
    },
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
