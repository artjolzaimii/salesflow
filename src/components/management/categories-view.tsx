"use client";

import { useState } from "react";
import { fieldErrors } from "@/lib/schemas/common";
import { categorySchema } from "@/lib/schemas/catalog";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { CategoryList, CategoryRow } from "@/services/client/types";
import { useActions } from "@/store/preview-store";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, SelectOptions } from "@/components/ui/field";
import { ListPanel } from "@/components/ui/list-panel";
import { Dialog } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/page-header";
import { AlertBanner } from "@/components/ui/states";

/** Product categories from GET /api/categories; managers create, rename, nest and delete empty ones. */
export function CategoriesView() {
  const role = useRole();
  const actions = useActions();
  const list = useApiQuery<CategoryList>("/api/categories");
  const rows = list.data?.items ?? [];
  const state = apiListState(list, rows, "categories", false);
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);

  const remove = (c: CategoryRow) =>
    actions.askConfirm({
      title: `Delete ${c.name}?`,
      body: "Only empty categories can be deleted. This cannot be undone.",
      action: "Delete category",
      run: async () => {
        try {
          await apiFetch(`/api/categories/${c.id}`, { method: "DELETE" });
          invalidate("/api/categories");
          actions.toast(`${c.name} deleted.`);
        } catch (e) {
          actions.toast(errorMessage(e));
        }
      },
    });

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Product groupings used for catalog filters and reports."
        actions={
          role.canManageCategories ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              New category
            </Button>
          ) : null
        }
      />
      <ListPanel state={state} onClear={() => undefined}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Parent</th>
                <th className="text-right">Products</th>
                <th className="text-right">Active</th>
                <th>Units used</th>
                {role.canManageCategories ? <th className="w-[150px]" /> : null}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-neutral-700">{r.parentName ?? "—"}</td>
                  <td className="text-right">{r.productCount}</td>
                  <td className="text-right">{r.activeProductCount}</td>
                  <td>{r.units.join(", ") || "—"}</td>
                  {role.canManageCategories ? (
                    <td className="text-right whitespace-nowrap">
                      <Button variant="ghost" className="text-[13px]" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-[13px]"
                        disabled={r.productCount > 0 || r.childCount > 0}
                        title={r.productCount || r.childCount ? "Move its products and sub-categories first" : undefined}
                        onClick={() => remove(r)}
                      >
                        Delete
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListPanel>
      {editing ? <CategoryDialog category={editing === "new" ? null : editing} all={rows} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CategoryDialog({ category, all, onClose }: { category: CategoryRow | null; all: CategoryRow[]; onClose: () => void }) {
  const actions = useActions();
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const body = { name, parentId: parentId || null };
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setSaving(true);
    try {
      await apiFetch(category ? `/api/categories/${category.id}` : "/api/categories", { method: category ? "PATCH" : "POST", body });
      invalidate("/api/categories");
      invalidate("/api/products");
      actions.toast(category ? "Category updated." : `${name.trim()} created.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_CATEGORY") setErrors({ name: e.message });
      else setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={onClose} labelledBy="cat-t" width={440}>
      <div id="cat-t" className="dialog-title">
        {category ? `Edit ${category.name}` : "New category"}
      </div>
      {formError ? <AlertBanner>{formError}</AlertBanner> : null}
      <Field label="Name" htmlFor="cat-name" error={errors.name}>
        <input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} {...invalidProps("cat-name", errors.name)} />
      </Field>
      <Field label="Parent category" htmlFor="cat-parent" error={errors.parentId}>
        <select id="cat-parent" className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">None (top level)</option>
          <SelectOptions options={all.filter((c) => c.id !== category?.id).map((c) => ({ value: c.id, label: c.name }))} />
        </select>
      </Field>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save category"}
        </Button>
      </div>
    </Dialog>
  );
}
