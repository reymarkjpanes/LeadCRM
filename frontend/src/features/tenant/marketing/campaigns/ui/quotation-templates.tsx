'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Plus, FileDown, MoreVertical, Edit2 } from 'lucide-react';
import { MarketingTemplateSchema, QUOTATION_CATEGORIES, QuotationTemplateContentSchema,
  defaultQuotationContent, parseQuotationTemplate, quotationVariableChoices, type QuotationTemplateContent } from '@leadcrm/shared';
import type { Template } from '@/store/types';
import { useAuth } from '@/store/AuthContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { templatesApi } from '@/shared/services/templates.api';
import { ModuleTableToolbar } from '@/shared/components/crm/module-table-toolbar';
import { FilterButton } from '@/shared/components/crm/filter-button';
import { ModuleFilterRail } from '@/shared/components/crm/module-filter-rail';
import { LeadsPagination } from '@/shared/components/crm/leads-pagination';
import { TableIconButton } from '@/shared/components/data-grid/table-icon-button';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { SideSheet } from '@/shared/components/side-sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';
import { panelBodyClass, panelFooterClass, panelInputClass, panelLabelClass } from '@/shared/components/side-panel-styles';
import { useCampaignVariableFields } from './campaign-variable-picker';
import { quotationsApi, downloadQuotationPdf } from '../services/quotations.api';
import { QuotationVariableField } from './quotation-variable-field';
import { QuotationWizard } from './quotation-wizard';
import { toast } from 'sonner';

function TemplateForm({ template, categories, onSaved, onClose }: { template: Template | null; categories: string[]; onSaved: () => void; onClose: () => void }) {
  const initial = template ? parseQuotationTemplate(template.content) : defaultQuotationContent();
  const [name, setName] = useState(template?.name ?? ''), [category, setCategory] = useState(template?.category ?? 'Sales');
  const [layout, setLayout] = useState<QuotationTemplateContent>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({}), [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const catalog = useCampaignVariableFields();
  const choices = quotationVariableChoices(catalog.fields);
  const dirty = name !== (template?.name ?? '') || category !== (template?.category ?? 'Sales') || JSON.stringify(layout) !== JSON.stringify(initial);
  const close = usePanelDraft({ dirty, busy: saving }) ?? onClose;
  useEffect(() => { if (!dirty) return; const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload); }, [dirty]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    const parsed = MarketingTemplateSchema.safeParse({ name, category, type: 'Quotation', content: JSON.stringify(layout) });
    const content = QuotationTemplateContentSchema.safeParse(layout);
    if (!parsed.success || !content.success) { setErrors(Object.fromEntries((!parsed.success ? parsed.error.issues : []).concat(!content.success ? content.error.issues : []).map(issue => [issue.path.join('.'), issue.message]))); return; }
    lock.current = true; setSaving(true); setErrors({});
    try { if (template) await templatesApi.update(template.id, parsed.data); else await templatesApi.create(parsed.data); toast.success('Quotation template saved.'); onSaved(); }
    catch (error) { setErrors({ form: error instanceof Error ? error.message : 'Unable to save template.' }); }
    finally { lock.current = false; setSaving(false); }
  }
  return <form onSubmit={save} className="flex h-full min-w-0 flex-col">
    <div className={panelBodyClass + ' min-w-0 space-y-4'}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2"><div><label htmlFor="quotation-template-name" className={panelLabelClass}>Template Name *</label><input id="quotation-template-name" className={panelInputClass} maxLength={150} required value={name} onChange={event => setName(event.target.value)} /></div>
        <div><label htmlFor="quotation-template-category" className={panelLabelClass}>Category *</label><select id="quotation-template-category" required className={panelInputClass} value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div><label htmlFor="quotation-template-title" className={panelLabelClass}>Quotation Title *</label><input id="quotation-template-title" required maxLength={200} className={panelInputClass} value={layout.quotationTitle} onChange={event => setLayout(value => ({ ...value, quotationTitle: event.target.value }))} /></div>
      <QuotationVariableField id="quotation-header" label="Header / Company Information" value={layout.header} onChange={header => setLayout(value => ({ ...value, header }))} choices={choices} />
      <QuotationVariableField id="quotation-introduction" label="Introduction / Message" value={layout.introduction} onChange={introduction => setLayout(value => ({ ...value, introduction }))} choices={choices} />
      <div className="min-w-0"><p className={panelLabelClass}>Products Table Layout</p><div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[380px] text-xs"><thead className="bg-muted"><tr>{['Product', 'Description', 'Qty', 'Unit Price', 'Total'].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody><tr>{['Product name', 'Product description', '1', '₱0.00', '₱0.00'].map((label, index) => <td key={index} className="p-2">{label}</td>)}</tr></tbody></table></div></div>
      <QuotationVariableField id="quotation-footer" label="Footer / Terms" value={layout.footer} onChange={footer => setLayout(value => ({ ...value, footer }))} choices={choices} rows={6} />
      {catalog.error && <p role="alert" className="text-sm text-destructive">{catalog.error}</p>}
      {Object.entries(errors).map(([key, message]) => <p key={key} role="alert" className="text-sm text-destructive">{message}</p>)}
    </div>
    <div className={panelFooterClass + ' mt-auto flex justify-end gap-2'}><Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button><Button type="submit" disabled={saving || !!catalog.error}>{saving ? 'Saving…' : 'Save Template'}</Button></div>
  </form>;
}

export function QuotationTemplates() {
  const { tenant, user } = useAuth();
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [filters, setFilters] = useState(false);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{ template: Template | null } | null>(null), [using, setUsing] = useState<Template | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null), [busyId, setBusyId] = useState('');
  const identity = useRef(''); identity.current = `${user?.tenantId}:${user?.id}`;
  const canCreate = useHasPermission('campaigns.create'), canEdit = useHasPermission('campaigns.edit');
  const result = useCachedPage({ module: 'campaigns', params: { quotationTemplates: true, search, category, page, pageSize }, revalidateOnInvalidation: true,
    fetchFn: () => templatesApi.list({ type: 'Quotation', search, category, page, limit: pageSize }) });
  const templates = result.data?.data ?? [];
  const categories = [...new Set([...QUOTATION_CATEGORIES, ...templates.map(template => template.category).filter(Boolean)])];
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { setEditor(null); setUsing(null); setPreview(null); setBusyId(''); }, [user?.tenantId, user?.id]);
  async function pdf(template: Template, download: boolean) {
    if (busyId) return; setBusyId(template.id); const requestIdentity = identity.current;
    try { const blob = await quotationsApi.templatePdf(template.id); if (identity.current !== requestIdentity) return; if (download) downloadQuotationPdf(blob, `${template.name}.pdf`); else setPreview({ url: URL.createObjectURL(blob), name: template.name }); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to generate PDF.'); }
    finally { setBusyId(''); }
  }
  return <section className="min-w-0 space-y-4">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><ModuleTableToolbar label="templates" search={search} onSearch={value => { setSearch(value); setPage(1); }} placeholder="Search templates…" onRefresh={result.refetch} refreshing={result.isRefreshing}
      filter={<FilterButton title="quotation templates" open={filters} active={!!category} onClick={() => setFilters(value => !value)} />} />
      {canCreate && <Button onClick={() => setEditor({ template: null })}><Plus size={16} /> New Quotation Template</Button>}</div>
    <ModuleFilterRail showFilters={filters} onToggleFilters={() => setFilters(false)} totalRecords={result.data?.meta.total ?? 0} onClearFilters={() => { setCategory(''); setPage(1); }} filterGroups={[{ id: 'category', label: 'Category', isExpanded: true, items: categories.map(value => ({ id: value, label: value, isChecked: category === value })) }]} onFilterToggle={(_group, value) => { setCategory(previous => previous === value ? '' : value); setPage(1); }} />
    <div><h2 className="text-lg font-semibold">Quotation Templates</h2><p className="text-sm text-muted-foreground">Create reusable PDF-formatted quotations for your customers.</p></div>
    {result.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
    {result.isInitialLoad ? <p role="status">Loading quotation templates…</p> : !templates.length ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">No quotation templates found.{canCreate && <Button variant="outline" className="ml-2" onClick={() => setEditor({ template: null })}>Create a quotation template</Button>}</div> :
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{templates.map(template => {
        let description = 'Reusable quotation template';
        try { description = parseQuotationTemplate(template.content).introduction.replace(/^Dear[^\n]*\n*/i, '').trim(); } catch { /* Existing malformed records remain visible for a clear API error. */ }
        return <article key={template.id} className="flex h-full min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-lg backdrop-blur-xl dark:border-white/5 dark:bg-white/2">
          <div className="mb-3 flex items-center justify-between gap-2"><Badge variant="secondary">{template.category}</Badge><div className="flex shrink-0 items-center gap-1"><TableIconButton label="Download PDF" touchFriendly disabled={!!busyId} onClick={() => void pdf(template, true)}><FileDown size={17} /></TableIconButton>
            {canEdit && <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for ${template.name}`}><MoreVertical size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { try { parseQuotationTemplate(template.content); setEditor({ template }); } catch { toast.error('This saved template has an invalid layout.'); } }}><Edit2 size={14} /> Edit Template</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></div>
          <h3 className="break-words text-lg font-semibold">{template.name}</h3><p className="mb-3 text-sm text-muted-foreground">{tenant?.name}</p><p className="mb-5 line-clamp-3 flex-1 break-words text-sm text-muted-foreground">{description}</p>
          <div className="flex gap-2"><Button className="flex-1" variant="outline" disabled={!!busyId} onClick={() => void pdf(template, false)}>Preview</Button><Button className="flex-1" onClick={() => setUsing(template)}>Use Template</Button></div>
        </article>;
      })}</div>}
    <LeadsPagination currentPage={page} totalRecords={result.data?.meta.total ?? 0} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} refreshing={result.isRefreshing} loading={result.isInitialLoad} />
    <SideSheet isOpen={!!editor} onClose={() => setEditor(null)} title={editor?.template ? 'Edit Quotation Template' : 'Create Quotation Template'}>{editor && <TemplateForm template={editor.template} categories={categories} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void result.refetch(); }} />}</SideSheet>
    <SideSheet isOpen={!!using} onClose={() => setUsing(null)} title={`Use Template: ${using?.name ?? ''}`} width="w-full max-w-3xl">{using && <QuotationWizard template={using} onClose={() => setUsing(null)} />}</SideSheet>
    <SideSheet isOpen={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? 'Quotation Preview'} width="w-full max-w-3xl">{preview && <div className="flex h-full min-h-[65vh] flex-col gap-3 p-4"><iframe title="Quotation template PDF preview" src={preview.url + '#view=FitH'} className="min-h-[65vh] w-full flex-1 rounded border border-border" /><a className="text-sm text-primary underline" href={preview.url} target="_blank" rel="noreferrer">Open PDF in a new tab</a></div>}</SideSheet>
  </section>;
}
