"use client";

import { useState } from "react";
import { centsToInput, formatMoney, inputToCents } from "@/lib/money";
import type { Product } from "@/lib/types";
import { validateProduct, type ProductForm } from "@/lib/validation";
import { useActions, usePreview } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, SelectOptions } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";

function toForm(p: Product | undefined): ProductForm {
  return p
    ? { id: p.id, name: p.name, sku: p.sku, category: p.category, unit: p.unit, price: centsToInput(p.price), vatRate: String(p.vatRate), status: p.active ? "active" : "inactive" }
    : { id: "", name: "", sku: "", category: "", unit: "", price: "", vatRate: "20", status: "active" };
}

export function ProductDialog() {
  const open = usePreview((s) => s.productDialog);
  if (!open) return null;
  return <ProductDialogForm key={open.productId || "new"} productId={open.productId} />;
}

function ProductDialogForm({ productId }: { productId: string }) {
  const products = usePreview((s) => s.data.products);
  const actions = useActions();
  const [f, setF] = useState<ProductForm>(() => toForm(products.find((p) => p.id === productId)));
  const [errors, setErrors] = useState<ReturnType<typeof validateProduct>>({});
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const categories = [...new Set(products.map((p) => p.category))].sort();
  const gross = Math.round(inputToCents(f.price) * (1 + Number(f.vatRate) / 100));

  const save = () => {
    const e = validateProduct(f, products);
    if (Object.keys(e).length) return setErrors(e);
    actions.saveProduct({
      id: f.id || undefined,
      name: f.name.trim(),
      sku: f.sku.trim().toUpperCase(),
      category: f.category,
      unit: f.unit.trim(),
      price: inputToCents(f.price),
      vatRate: Number(f.vatRate),
      active: f.status === "active",
    });
  };

  return (
    <Dialog onClose={actions.closeProduct} labelledBy="pf-t">
      <div id="pf-t" className="dialog-title">
        {f.id ? `Edit ${f.name}` : "New product"}
      </div>
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Field label="Product name" htmlFor="pf-name" error={errors.name} className="col-span-full">
          <input id="pf-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} {...invalidProps("pf-name", errors.name)} />
        </Field>
        <Field label="SKU" htmlFor="pf-sku" error={errors.sku}>
          <input id="pf-sku" className="input uppercase" value={f.sku} onChange={(e) => set("sku", e.target.value)} {...invalidProps("pf-sku", errors.sku)} />
        </Field>
        <Field label="Category" htmlFor="pf-cat" error={errors.category}>
          <select id="pf-cat" className="input" value={f.category} onChange={(e) => set("category", e.target.value)} {...invalidProps("pf-cat", errors.category)}>
            <option value="">Select…</option>
            <SelectOptions options={categories} />
          </select>
        </Field>
        <Field label="Unit" htmlFor="pf-unit" error={errors.unit}>
          <input id="pf-unit" className="input" placeholder="kg, pack, bottle" value={f.unit} onChange={(e) => set("unit", e.target.value)} {...invalidProps("pf-unit", errors.unit)} />
        </Field>
        <Field label="VAT rate" htmlFor="pf-vat">
          <select id="pf-vat" className="input" value={f.vatRate} onChange={(e) => set("vatRate", e.target.value)}>
            <SelectOptions options={["20", "10", "6", "0"].map((v) => ({ value: v, label: v + "%" }))} />
          </select>
        </Field>
        <Field label="Default net price (ALL, excl. VAT)" htmlFor="pf-price" error={errors.price} hint={"Incl. VAT: " + formatMoney(gross, "ALL")}>
          <input
            id="pf-price"
            className="input text-right tabular-nums"
            inputMode="decimal"
            value={f.price}
            onChange={(e) => set("price", e.target.value)}
            {...invalidProps("pf-price", errors.price)}
          />
        </Field>
        <Field label="Status" htmlFor="pf-st">
          <select id="pf-st" className="input" value={f.status} onChange={(e) => set("status", e.target.value as ProductForm["status"])}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={actions.closeProduct}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save product
        </Button>
      </div>
    </Dialog>
  );
}
