"use client";

import { useActions, usePreview } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Dialog } from "@/components/ui/overlay";
import { InvoiceDrawer } from "@/components/invoices/invoice-drawer";
import { OrderDrawer } from "@/components/orders/order-drawer";
import { PaymentDialog } from "@/components/payments/payment-dialog";
import { ProductDialog } from "@/components/products/product-dialog";

function ConfirmDialog() {
  const req = usePreview((s) => s.confirm);
  const actions = useActions();
  if (!req) return null;
  return (
    <Dialog onClose={actions.closeConfirm} role="alertdialog" width={440} zIndex={90} labelledBy="cd-t">
      <div id="cd-t" className="dialog-title">
        {req.title}
      </div>
      <div className="dialog-body">{req.body}</div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={actions.closeConfirm}>
          Go back
        </Button>
        <Button variant="primary" onClick={actions.runConfirm}>
          {req.action}
        </Button>
      </div>
    </Dialog>
  );
}

function Toast() {
  const message = usePreview((s) => s.toast);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed right-5 bottom-5 z-[100] flex max-w-[min(440px,calc(100vw-40px))] items-start gap-[10px] bg-accent-900 px-4 py-3 text-[13.5px] text-bg shadow-[var(--shadow-lg)]"
    >
      <Icon name="check" />
      <span>{message}</span>
    </div>
  );
}

/** Drawers, dialogs and the toast, rendered once above every page. */
export function GlobalOverlays() {
  return (
    <>
      <OrderDrawer />
      <InvoiceDrawer />
      <PaymentDialog />
      <ProductDialog />
      <ConfirmDialog />
      <Toast />
    </>
  );
}
