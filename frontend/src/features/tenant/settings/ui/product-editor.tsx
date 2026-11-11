'use client';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelInputClass, panelLabelClass, panelPrimaryButtonClass, panelSecondaryButtonClass } from '@/shared/components/side-panel-styles';
import { useEffect, useRef, useState } from 'react';
import { isProductCreateAmountInput, ProductInterestCreateSchema, ProductInterestSchema, parseProductAmount, parseProductCreateAmount, PRODUCT_DEAL_VALUE_DIGITS_ERROR, PRODUCT_DEAL_VALUE_NEGATIVE_ERROR, PRODUCT_DEAL_VALUE_REQUIRED_ERROR, PRODUCT_INTEREST_NAME_MAX_ERROR, PRODUCT_INTEREST_NAME_MAX_LENGTH, PRODUCT_DESCRIPTION_MAX_LENGTH, type ProductInterest, type ProductInterestInput } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { toast } from '@/shared/utils/toast';
import { Textarea } from '@/shared/components/ui/textarea';
import { Input } from '@/shared/components/ui/input';
const inputClass = panelInputClass;
export function ProductEditor({ product, categories = [], canCreateCategory = false, onCreateCategory, busy, onSave, onCancel }: { product?: ProductInterest; categories?: string[]; canCreateCategory?: boolean; onCreateCategory?: (name: string) => Promise<void>; busy: boolean; onSave: (data: ProductInterestInput) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [addingCategory, setAddingCategory] = useState(false);
  const [amount, setAmount] = useState(product ? String(product.dealValue) : '');
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; category?: string; description?: string; dealValue?: string }>({});
  const previousCategory = useRef(product?.category ?? '');
  const submitting = useRef(false);
  const amountError = (value: string) => {
    if (!value.trim()) return PRODUCT_DEAL_VALUE_REQUIRED_ERROR;
    if (product) return 'Enter a non-negative amount with up to two decimal places.';
    if (/^-\d+(?:\.\d*)?$/.test(value)) return PRODUCT_DEAL_VALUE_NEGATIVE_ERROR;
    return /^\d+\.\d*$/.test(value) ? 'Enter a non-negative amount with up to two decimal places.' : PRODUCT_DEAL_VALUE_DIGITS_ERROR;
  };
  useEffect(() => {
    const previous = previousCategory.current;
    previousCategory.current = product?.category ?? '';
    if (addingCategory) return;
    setCategory(current => {
      const next = product && current === previous ? product.category ?? '' : current;
      return categories.find(value => value.toLowerCase() === next.trim().toLowerCase()) ?? '';
    });
  }, [product?.category, categories, addingCategory]);
  return <form noValidate className="flex h-full min-h-0 flex-col" onSubmit={async event => {
    event.preventDefault();
    if (busy || submitting.current) return;
    if (Object.values(fieldErrors).some(Boolean)) return;
    const dealValue = product ? parseProductAmount(amount) : parseProductCreateAmount(amount);
    const parsedName = ProductInterestSchema.shape.name.safeParse(name);
    const errors: { name?: string; category?: string; description?: string; dealValue?: string } = {};
    if (!parsedName.success) errors.name = parsedName.error.issues[0].message;
    const parsedCategory = ProductInterestSchema.shape.category.safeParse(category);
    if (!parsedCategory.success) errors.category = parsedCategory.error.issues[0].message;
    else if (!addingCategory && !categories.includes(parsedCategory.data)) errors.category = 'Select an available Product Category.';
    else if (addingCategory && categories.some(value => value.toLowerCase() === parsedCategory.data.toLowerCase())) errors.category = 'Category names must be unique.';
    if (dealValue === null) {
      errors.dealValue = amountError(amount);
      setFieldErrors(errors);
      return;
    }
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    const parsed = (product ? ProductInterestSchema : ProductInterestCreateSchema).safeParse({ name, category, description, dealValue });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
      return;
    }
    setFieldErrors({}); submitting.current = true;
    try {
      if (addingCategory) {
        if (!canCreateCategory || !onCreateCategory) return;
        try { await onCreateCategory(parsed.data.category); }
        catch (failure) {
          const message = failure instanceof Error ? failure.message : 'Unable to add category.';
          setFieldErrors(current => ({ ...current, category: message })); toast.error(message); return;
        }
        setAddingCategory(false); setCategory(parsed.data.category);
      }
      await onSave(parsed.data);
    } finally { submitting.current = false; }
  }}>
    <div className={panelBodyClass + " space-y-4"}><PanelSectionHeading number={1}>Product Information</PanelSectionHeading><div className="grid grid-cols-1 gap-4 ">
      <label className={panelLabelClass + " min-w-0 space-y-1.5"}>Product Name {!product && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}<Input placeholder="Enter product name..." autoFocus aria-label="Product Name" className={`${inputClass}  ${fieldErrors.name ? 'border-red-500' : ''}`} aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'product-name-error' : undefined} value={name} disabled={busy} onChange={e => {
        const value = e.target.value;
        if (value.length > PRODUCT_INTEREST_NAME_MAX_LENGTH) {
          setFieldErrors(current => ({ ...current, name: PRODUCT_INTEREST_NAME_MAX_ERROR }));
          return;
        }
        setName(value);
        const result = ProductInterestSchema.shape.name.safeParse(value);
        setFieldErrors(current => ({ ...current, name: result.success ? '' : result.error.issues[0].message }));
      }} required />{fieldErrors.name && <span id="product-name-error" role="alert" className="block text-xs font-normal text-red-600">{fieldErrors.name}</span>}</label>
      <label className={panelLabelClass + " min-w-0 space-y-1.5"}>Category <span aria-hidden="true" className="ml-1 text-red-500">*</span>
        <select aria-label="Category" className={inputClass} required disabled={busy} value={addingCategory ? '__add__' : category} aria-invalid={!!fieldErrors.category} onChange={event => { const add = event.target.value === '__add__'; setAddingCategory(add); setCategory(add ? '' : event.target.value); setFieldErrors(current => ({ ...current, category: '' })); }}>
          <option value="">Select category</option>{categories.map(label => <option key={label} value={label}>{label}</option>)}{canCreateCategory && <option value="__add__">Add category…</option>}
        </select>{fieldErrors.category && <span role="alert" className="block text-xs text-destructive">{fieldErrors.category}</span>}
      </label>
      {addingCategory && <label className={panelLabelClass + " min-w-0 space-y-1.5"}>New Category <span aria-hidden="true" className="ml-1 text-red-500">*</span><Input placeholder="Enter category name..." aria-label="New Category" required className={inputClass} disabled={busy} maxLength={PRODUCT_INTEREST_NAME_MAX_LENGTH} value={category} onChange={event => { setCategory(event.target.value); setFieldErrors(current => ({ ...current, category: '' })); }} /></label>}
      <label className={panelLabelClass + " min-w-0 space-y-1.5"}>Product Description<Textarea placeholder="Describe this product..." aria-label="Product Description" className={inputClass} rows={4} disabled={busy} maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH} value={description} onChange={event => { setDescription(event.target.value); setFieldErrors(current => ({ ...current, description: '' })); }} />{fieldErrors.description && <span role="alert" className="block text-xs text-destructive">{fieldErrors.description}</span>}</label>
      <label className={panelLabelClass + " min-w-0 space-y-1.5"}>Deal Value (PHP) {!product && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}<span className="relative block"><span className="absolute left-3 top-3 text-sm">₱</span><Input placeholder="0" className={`${inputClass} pl-7 ${fieldErrors.dealValue ? 'border-red-500' : ''}`} aria-label="Deal Value (PHP)" aria-invalid={!!fieldErrors.dealValue} aria-describedby={fieldErrors.dealValue ? 'product-deal-value-error' : undefined} inputMode="decimal" value={amount} disabled={busy} onChange={e => {
        const value = e.target.value;
        if (!product && !isProductCreateAmountInput(value)) {
          setFieldErrors(current => ({ ...current, dealValue: amountError(value) }));
          return;
        }
        setAmount(value);
        if (!product && /^\d+\.$/.test(value)) {
          setFieldErrors(current => ({ ...current, dealValue: '' }));
          return;
        }
        const parsed = product ? parseProductAmount(value) : parseProductCreateAmount(value);
        const result = parsed === null ? undefined : (product ? ProductInterestSchema : ProductInterestCreateSchema).shape.dealValue.safeParse(parsed);
        setFieldErrors(current => ({ ...current, dealValue: parsed === null
          ? amountError(value)
          : result?.success === false ? result.error.issues[0].message : '' }));
      }} required /></span>{fieldErrors.dealValue && <span id="product-deal-value-error" role="alert" className="block text-xs font-normal text-red-600">{fieldErrors.dealValue}</span>}</label>
    </div>
    </div><div className={panelFooterClass + " justify-end"}><Button type="button" variant="outline" className={panelSecondaryButtonClass} disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" className={panelPrimaryButtonClass} disabled={busy}>{busy ? 'Saving…' : 'Save Product'}</Button></div>
  </form>;
}

