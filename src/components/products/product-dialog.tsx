"use client";

import { useState } from "react";
import { grossWithVat, formatDecimal } from "@/lib/decimal-format";
import { VAT_RATES } from "@/lib/labels";
import { fieldErrors } from "@/lib/schemas/common";
import { productSchema } from "@/lib/schemas/catalog";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { CategoryList, ProductDetailDto } from "@/services/client/types";
import { useActions, usePreview } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, SelectOptions } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";

interface Form {
  name: string;
  sku: string;
  categoryId: string;
  unit: string;
  price: string;
  vatRate: string;
  status: "active" | "inactive";
}

const BLANK: Form = { name: "", sku: "", categoryId: "", unit: "", price: "", vatRate: "20", status: "active" };

function toForm(p: ProductDetailDto): Form {
  return { name: p.name, sku: p.sku, categoryId: p.category.id, unit: p.unit, price: formatDecimal(p.defaultNetAll, 2, 4).replace(/,/g, ""), vatRate: p.vatRate, status: p.isActive ? "active" : "inactive" };
}

export function ProductDialog() {
  const open = usePreview((s) => s.productDialog);
  const actions = useActions();
  const product = useApiQuery<{ product: ProductDetailDto }>(open?.productId ? `/api/products/${open.productId}` : null);
  if (!open) return null;
  if (open.productId && !product.data) {
    return (
      <Dialog onClose={actions.closeProduct} labelledBy="pf-t">
        <div id="pf-t" className="dialog-title">
          Edit product
        </div>
        {product.error ? <AlertBanner>{errorMessage(product.error)}</AlertBanner> : <SkeletonRows />}
      </Dialog>
    );
  }
  return <ProductDialogForm key={open.productId || "new"} productId={open.productId} initial={product.data ? toForm(product.data.product) : BLANK} usedBy={product.data?.product.usedByOrderLines ?? 0} />;
}

/** Create or edit a product (POST/PATCH /api/products). Validation mirrors the server's schema. */
function ProductDialogForm({ productId, initial, usedBy }: { productId: string; initial: Form; usedBy: number }) {
  const actions = useActions();
  const categories = useApiQuery<CategoryList>("/api/categories");
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const gross = grossWithVat(f.price, f.vatRate);

  const save = async () => {
    const body = { sku: f.sku, name: f.name, categoryId: f.categoryId, unit: f.unit, defaultNetAll: f.price.trim(), vatRate: f.vatRate, isActive: f.status === "active" };
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError("");
    setSaving(true);
    try {
      await apiFetch(productId ? `/api/products/${productId}` : "/api/products", { method: productId ? "PATCH" : "POST", body });
      invalidate("/api/products");
      invalidate("/api/categories");
      actions.closeProduct();
      actions.toast(productId ? `${f.name} updated.` : `${f.name} added to the catalogue.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_SKU") setErrors({ sku: e.message });
      else if (e instanceof ApiError && e.details) setErrors(e.fieldMessages());
      else setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={actions.closeProduct} labelledBy="pf-t">
      <div id="pf-t" className="dialog-title">
        {productId ? `Edit ${initial.name}` : "New product"}
      </div>
      {formError ? <AlertBanner>{formError}</AlertBanner> : null}
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Field label="Product name" htmlFor="pf-name" error={errors.name} className="col-span-full">
          <input id="pf-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} {...invalidProps("pf-name", errors.name)} />
        </Field>
        <Field label="SKU" htmlFor="pf-sku" error={errors.sku}>
          <input id="pf-sku" className="input uppercase" value={f.sku} onChange={(e) => set("sku", e.target.value)} {...invalidProps("pf-sku", errors.sku)} />
        </Field>
        <Field label="Category" htmlFor="pf-cat" error={errors.categoryId}>
          <select id="pf-cat" className="input" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} {...invalidProps("pf-cat", errors.categoryId)}>
            <option value="">Select…</option>
            <SelectOptions options={(categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          </select>
        </Field>
        <Field label="Unit" htmlFor="pf-unit" error={errors.unit}>
          <input id="pf-unit" className="input" placeholder="kg, pack, bottle" value={f.unit} onChange={(e) => set("unit", e.target.value)} {...invalidProps("pf-unit", errors.unit)} />
        </Field>
        <Field label="VAT rate" htmlFor="pf-vat" error={errors.vatRate}>
          <select id="pf-vat" className="input" value={f.vatRate} onChange={(e) => set("vatRate", e.target.value)}>
            <SelectOptions options={VAT_RATES.map((v) => ({ value: v, label: v + "%" }))} />
          </select>
        </Field>
        <Field
          label="Default net price (ALL, excl. VAT)"
          htmlFor="pf-price"
          error={errors.defaultNetAll}
          hint={gross ? "Incl. VAT: " + formatDecimal(gross) + " ALL" : "Up to 4 decimal places."}
        >
          <input
            id="pf-price"
            className="input text-right tabular-nums"
            inputMode="decimal"
            value={f.price}
            onChange={(e) => set("price", e.target.value)}
            {...invalidProps("pf-price", errors.defaultNetAll)}
          />
        </Field>
        <Field label="Status" htmlFor="pf-st">
          <select id="pf-st" className="input" value={f.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>
      {productId && usedBy ? (
        <p className="text-muted m-0 text-[12px]">
          Used on {usedBy} order {usedBy === 1 ? "line" : "lines"}. Those orders keep the name, price and VAT they were sold with; changes here apply to new orders only.
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={actions.closeProduct}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save product"}
        </Button>
      </div>
    </Dialog>
  );
}
