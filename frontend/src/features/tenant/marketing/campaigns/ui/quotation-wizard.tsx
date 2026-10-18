'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { QuotationDraftSchema, quotationNumber, quotationVariableChoices, type QuotationDraft, type QuotationPreview } from '@leadcrm/shared';
import type { Template } from '@/store/types';
import { useAuth } from '@/store/AuthContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { DatePicker } from '@/shared/components/ui/date-time-picker';
import { Button } from '@/shared/components/ui/button';
import { panelBodyClass, panelFooterClass, panelInputClass, panelLabelClass } from '@/shared/components/side-panel-styles';
import { apiClient, type ApiRequestError } from '@/lib/api/client';
import { formatCurrency } from '@/shared/utils/currency';
import { useCampaignVariableFields } from './campaign-variable-picker';
import { QuotationVariableField } from './quotation-variable-field';
import { quotationsApi, quotationPdfBlob, downloadQuotationPdf } from '../services/quotations.api';
import { toast } from 'sonner';

function initialDraft(templateId: string): QuotationDraft {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const until = new Date(today + 'T00:00:00Z'); until.setUTCDate(until.getUTCDate() + 30);
  return { quotationId: crypto.randomUUID(), templateId, recipientType: 'Lead', recipientId: '', products: [], quotationDate: today, validUntil: until.toISOString().slice(0, 10), notes: '' };
}

export function QuotationWizard({ template, onClose }: { template: Template; onClose: () => void }) {
  const { user } = useAuth();
  const [draft, setDraft] = useState(() => initialDraft(template.id)), [step, setStep] = useState(1);
  const [preview, setPreview] = useState<QuotationPreview | null>(null), [pdfUrl, setPdfUrl] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [pending, setPending] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const lock = useRef(false), requestId = useRef(crypto.randomUUID());
  const products = useProductInterests(), catalog = useCampaignVariableFields();
  const canViewDeals = useHasPermission('deals.view'), canViewProducts = useHasPermission('products.view'), canSend = useHasPermission('campaigns.send');
  const canEditLead = useHasPermission('leads.edit'), canEditContact = useHasPermission('contacts.edit');
  const canViewLead = useHasPermission('leads.view'), canViewContact = useHasPermission('contacts.view');
  const source = draft.recipientType === 'Lead' ? 'leads' : 'contacts';
  const recipient = useCachedPage({ module: source, params: { quotationRecipient: draft.recipientId, canViewDeals }, disabled: !draft.recipientId, revalidateOnInvalidation: true,
    fetchFn: async () => {
      const [record, relationships] = await Promise.all([
        apiClient.get<{ data: { assignedUserId?: string; email?: string } }>(`/crm/${source}/${draft.recipientId}`),
        canViewDeals ? apiClient.get<{ data: { deals: { id: string; title: string }[]; hasMoreDeals: boolean } }>(`/crm/${source}/${draft.recipientId}/relationships?limit=50`) : Promise.resolve({ data: { deals: [], hasMoreDeals: false } }),
      ]);
      return { ...record.data, ...relationships.data, recordId: draft.recipientId };
    } });
  const currentRecipient = recipient.data?.recordId === draft.recipientId ? recipient.data : null;
  const allowedSend = canSend && (draft.recipientType === 'Lead' ? canEditLead : canEditContact) && currentRecipient?.assignedUserId === user?.id && !!currentRecipient?.email;
  const dirty = !sent && (!!draft.recipientId || !!draft.products.length || !!draft.notes);
  const close = usePanelDraft({ dirty, busy: busy || pending }) ?? onClose;
  useEffect(() => { if (!preview) { setPdfUrl(''); return; } const url = URL.createObjectURL(quotationPdfBlob(preview.pdfBase64)); setPdfUrl(url); return () => URL.revokeObjectURL(url); }, [preview]);
  useEffect(() => { if (!dirty) return; const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload); }, [dirty]);
  function change(patch: Partial<QuotationDraft>) { if (busy || pending || sent) return; setDraft(value => ({ ...value, ...patch })); setPreview(null); setError(''); requestId.current = crypto.randomUUID(); }
  const money = (value: number) => formatCurrency(value, undefined, 2);
  const total = draft.products.reduce((sum, line) => sum + Math.round((products.products.find(product => product.id === line.productId)?.dealValue ?? 0) * 100) * line.quantity, 0) / 100;
  async function next() {
    setError('');
    if (step === 1) { if (!draft.recipientId || !currentRecipient || recipient.error) { setError('Select an available recipient.'); return; } setStep(2); return; }
    if (step === 2) { if (!canViewProducts || products.error || !products.enabled || !draft.products.length || draft.products.some(line => !products.products.some(product => product.id === line.productId && product.active) || !Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > 1000000)) { setError('Add available Products with positive whole-number quantities.'); return; } setStep(3); return; }
    const parsed = QuotationDraftSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (lock.current) return; lock.current = true; setBusy(true);
    try { const result = await quotationsApi.preview(parsed.data); setPreview(result.data); setStep(4); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to generate the preview.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function send() {
    if (!preview || lock.current || sent) return;
    lock.current = true; setBusy(true); setError('');
    try { await quotationsApi.send({ draft, requestId: requestId.current, fingerprint: preview.fingerprint }); setSent(true); setPending(false); toast.success('Quotation sent.'); }
    catch (reason) {
      const failure = reason as ApiRequestError;
      const uncertain = !failure.status || failure.status >= 500 || ['GMAIL_OUTCOME_UNKNOWN', 'MAILBOX_OPERATION_PENDING', 'MAILBOX_OPERATION_CLAIM_LOST'].includes(failure.code ?? '');
      setPending(uncertain);
      const message = failure.message || 'Unable to send quotation.'; setError(message); toast.error(message);
      if (failure.code === 'QUOTATION_PREVIEW_CHANGED') { setPreview(null); setStep(3); }
    } finally { lock.current = false; setBusy(false); }
  }
  return <div className="flex h-full min-w-0 flex-col">
    <ol aria-label="Quotation steps" className="grid shrink-0 grid-cols-4 gap-1 border-b border-border px-3 py-4">{['Recipient', 'Products', 'Quotation Details', 'Preview'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`min-w-0 text-center text-[10px] sm:text-xs ${step >= index + 1 ? 'text-primary' : 'text-muted-foreground'}`}><span className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full border ${step >= index + 1 ? 'border-primary bg-primary text-white' : 'border-border'}`}>{step > index + 1 ? <Check size={13} /> : index + 1}</span><span>{label}</span></li>)}</ol>
    <div className={panelBodyClass + ' min-w-0 flex-1 space-y-4'}>
      <h2 className="text-lg font-semibold">{['Recipient', 'Products', 'Quotation Details', 'Preview'][step - 1]}</h2>
      {step === 1 && <div className="space-y-4"><div><label htmlFor="quotation-recipient-type" className={panelLabelClass}>Send To *</label><select id="quotation-recipient-type" className={panelInputClass} value={draft.recipientType} onChange={event => change({ recipientType: event.target.value as 'Lead' | 'Contact', recipientId: '', dealId: undefined })}><option disabled={!canViewLead}>Lead</option><option disabled={!canViewContact}>Contact</option></select></div>
        <div><p className={panelLabelClass}>Recipient *</p><EntityCombobox entityType={source} value={draft.recipientId || null} onChange={id => change({ recipientId: id ?? '', dealId: undefined })} placeholder="Search recipient…" disabled={draft.recipientType === 'Lead' ? !canViewLead : !canViewContact} /></div>
        {canViewDeals && <div><label htmlFor="quotation-deal" className={panelLabelClass}>Associated Deal (Optional)</label><select id="quotation-deal" className={panelInputClass} value={draft.dealId ?? ''} disabled={!currentRecipient} onChange={event => change({ dealId: event.target.value || undefined })}><option value="">No associated Deal</option>{currentRecipient?.deals.map(deal => <option key={deal.id} value={deal.id}>{deal.title}</option>)}</select>{currentRecipient?.hasMoreDeals && <p className="text-xs text-muted-foreground">Showing the first 50 linked Deals.</p>}</div>}
        {recipient.error && <p role="alert" className="text-sm text-destructive">{recipient.error}</p>}</div>}
      {step === 2 && <div className="min-w-0 space-y-4"><Button disabled={!canViewProducts || !!products.error || !products.enabled} onClick={() => setAddingProduct(value => !value)}><Plus size={15} /> Add Product</Button>
        {addingProduct && <ProductInterestSelect searchable products={products.products.filter(product => product.active)} values={draft.products.map(line => line.productId)} onChange={ids => change({ products: ids.map(productId => draft.products.find(line => line.productId === productId) ?? { productId, quantity: 1 }) })} disabled={products.loading || !canViewProducts} />}
        <div className="min-w-0 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[500px] text-sm"><thead className="bg-muted"><tr>{['Product', 'Qty', 'Deal Value', 'Total', ''].map((label, index) => <th key={index} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{draft.products.map(line => { const product = products.products.find(product => product.id === line.productId); return <tr key={line.productId} className="border-t border-border"><td className="max-w-48 break-words p-2">{product?.name ?? 'Unavailable product'}<p className="text-xs text-muted-foreground">{product?.description}</p></td><td className="p-2"><input aria-label={`Quantity for ${product?.name ?? 'product'}`} className={panelInputClass + ' w-20'} type="number" min="1" max="1000000" step="1" value={line.quantity || ''} onChange={event => change({ products: draft.products.map(row => row.productId === line.productId ? { ...row, quantity: Number(event.target.value) } : row) })} /></td><td className="whitespace-nowrap p-2">{money(product?.dealValue ?? 0)}</td><td className="whitespace-nowrap p-2">{money(Math.round((product?.dealValue ?? 0) * 100) * line.quantity / 100)}</td><td><Button variant="ghost" size="icon" aria-label={`Remove ${product?.name ?? 'product'}`} onClick={() => change({ products: draft.products.filter(row => row.productId !== line.productId) })}><Trash2 size={15} /></Button></td></tr>; })}</tbody></table></div>
        <div className="text-right text-sm"><p>Subtotal: {money(total)}</p><p className="font-semibold">Total: {money(total)}</p></div>{products.error && <p role="alert" className="text-sm text-destructive">{products.error}</p>}{!canViewProducts && <p className="text-sm text-destructive">Products View permission is required.</p>}</div>}
      {step === 3 && <div className="space-y-4"><div><label className={panelLabelClass} htmlFor="quotation-number">Quotation Number</label><input id="quotation-number" className={panelInputClass} readOnly value={quotationNumber(draft.quotationId, draft.quotationDate)} /></div><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="quotation-date" className={panelLabelClass}>Quotation Date</label><DatePicker id="quotation-date" value={draft.quotationDate} onChange={quotationDate => change({ quotationDate })} /></div><div><label htmlFor="quotation-until" className={panelLabelClass}>Valid Until</label><DatePicker id="quotation-until" value={draft.validUntil} minDate={draft.quotationDate} onChange={validUntil => change({ validUntil })} /></div></div>
        <QuotationVariableField id="quotation-notes" label="Notes" value={draft.notes} onChange={notes => change({ notes })} choices={quotationVariableChoices(catalog.fields, draft.recipientType === 'Lead' ? 'LEADS' : 'CONTACTS')} /></div>}
      {step === 4 && preview && <div className="min-w-0 space-y-3"><p className="text-sm text-muted-foreground">Review the quotation before downloading or sending.</p>{pdfUrl && <><iframe title="Quotation PDF preview" src={pdfUrl + '#view=FitH'} className="h-[55vh] min-h-80 w-full rounded border border-border" /><a href={pdfUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Open PDF in a new tab</a></>}<p className="text-right font-semibold">Total: {money(Number(preview.document.total))}</p>{!allowedSend && <p className="text-xs text-muted-foreground">Sending requires an email address, Campaign Send and CRM edit permissions, and this recipient’s assignment to you. Your connected Gmail account is checked when sending.</p>}{sent && <p role="status" className="text-sm text-primary">Quotation sent.</p>}</div>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    </div>
    <div className={panelFooterClass + ' mt-auto flex flex-wrap items-center justify-between gap-2'}><Button variant="outline" disabled={busy || pending} onClick={step === 1 || sent ? close : () => setStep(value => value - 1)}>{sent ? 'Close' : step === 1 ? 'Cancel' : 'Back'}</Button>
      {step < 4 ? <Button disabled={busy} onClick={() => void next()}>{busy ? 'Generating…' : 'Next'}</Button> : <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!preview || busy} onClick={() => preview && downloadQuotationPdf(quotationPdfBlob(preview.pdfBase64), preview.filename)}>Download PDF</Button><Button disabled={busy || sent || !allowedSend} onClick={() => void send()}>{busy ? 'Sending…' : sent ? 'Sent' : pending ? 'Verify send' : 'Send'}</Button></div>}
    </div>
  </div>;
}
