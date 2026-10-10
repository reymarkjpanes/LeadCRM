'use client';
import { panelBodyClass, panelFooterClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';

import React, { useState, useCallback } from 'react';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { useData } from '@/store/DataContext';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Building,
  UserPlus,
  Briefcase,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { Lead } from '@/store/types';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ConvertLeadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead;
  onSuccess?: () => void;
}

interface ConvertFormState {
  // Account
  accountMode: 'create' | 'existing';
  accountName: string;
  accountId: string;
  // Contact
  contactMode: 'create' | 'existing';
  contactId: string;

}

type Step = 1 | 2 | 3 | 4 | 5;

// ─── Component ─────────────────────────────────────────────────────────────

export function ConvertLeadDialog({ isOpen, onClose, lead, onSuccess }: ConvertLeadDialogProps): React.ReactElement {
  const { refreshContacts, refreshOrganizations, refreshDeals } = useData();
  const [step, setStep] = useState<Step>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState<ConvertFormState>({
    accountMode: 'create',
    accountName: lead.companyName || '',
    accountId: lead.accountId || lead.organizationId || '',
    contactMode: 'create',
    contactId: '',

  });

  const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unnamed Lead';

  // ── Navigation ────────────────────────────────────────────────────────────
  const canGoNext = useCallback((): boolean => {
    switch (step) {
      case 1: return true; // Review step is always valid
      case 2: return form.accountMode === 'create' || !!form.accountId;
      case 3: return form.contactMode === 'existing' ? !!form.contactId : true;
      case 4: return true;
      case 5: return true;
      default: return false;
    }
  }, [step, form]);

  const goNext = (): void => { if (canGoNext() && step < 5) setStep((s) => (s + 1) as Step); };
  const goBack = (): void => { if (step > 1) setStep((s) => (s - 1) as Step); };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleConvert = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};

      // Account
      if (form.accountMode === 'existing' && form.accountId) {
        payload.accountId = form.accountId;
      } else {
        payload.accountName = form.accountName;
      }

      payload.createContact = true;
      if (form.contactMode === 'existing' && form.contactId) payload.contactId = form.contactId;
      payload.createDeal = false;
      if (!payload.accountName) delete payload.accountName;

      await apiClient.post(`/crm/leads/${lead.id}/convert`, payload);

      toast.success('Lead converted successfully');

      // Refresh data across all affected modules
      await Promise.all([
        refreshContacts(),
        refreshOrganizations(),
        refreshDeals(),
      ]).catch(() => {});

      onSuccess?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to convert lead';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const cardCls = 'border border-gray-200 dark:border-white/[0.08] rounded-xl p-4 bg-white dark:bg-white/[0.02]';
  const radioCls = 'w-full text-left px-4 py-3 rounded-xl border transition-all text-sm';
  const radioActiveCls = 'border-primary bg-blue-50 dark:bg-primary/10 text-blue-700 dark:text-blue-300';
  const radioInactiveCls = 'border-gray-200 dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:border-blue-300 dark:hover:border-primary/30';
  const inputCls = 'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

  // ── Step Renderers ─────────────────────────────────────────────────────────

  const renderStep1 = (): React.ReactElement => (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Review Lead</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400">Confirm the lead details before conversion.</p>
      <div className={cardCls}>
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 [&>span:last-child]:text-right [&>span:last-child]:[overflow-wrap:anywhere]"><span className="text-slate-500 dark:text-slate-400">Name</span><span className="font-medium text-slate-900 dark:text-white">{leadName}</span></div>
          {lead.email && <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 [&>span:last-child]:text-right [&>span:last-child]:[overflow-wrap:anywhere]"><span className="text-slate-500 dark:text-slate-400">Email</span><span className="text-slate-700 dark:text-slate-300">{lead.email}</span></div>}
          {lead.phone && <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 [&>span:last-child]:text-right [&>span:last-child]:[overflow-wrap:anywhere]"><span className="text-slate-500 dark:text-slate-400">Phone</span><span className="text-slate-700 dark:text-slate-300">{lead.phone}</span></div>}
          {lead.companyName && <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 [&>span:last-child]:text-right [&>span:last-child]:[overflow-wrap:anywhere]"><span className="text-slate-500 dark:text-slate-400">Company</span><span className="text-slate-700 dark:text-slate-300">{lead.companyName}</span></div>}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 [&>span:last-child]:text-right [&>span:last-child]:[overflow-wrap:anywhere]"><span className="text-slate-500 dark:text-slate-400">Status</span><span className="text-slate-700 dark:text-slate-300">{lead.status}</span></div>
          {lead.leadSource && <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 [&>span:last-child]:text-right [&>span:last-child]:[overflow-wrap:anywhere]"><span className="text-slate-500 dark:text-slate-400">Source</span><span className="text-slate-700 dark:text-slate-300">{lead.leadSource}</span></div>}
        </div>
      </div>
    </div>
  );

  const renderStep2 = (): React.ReactElement => (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
        <Building size={18} className="text-blue-500" /> Account
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400">Create a new account or link to an existing one.</p>
      <div className="space-y-2">
        <button type="button" onClick={() => setForm((f) => ({ ...f, accountMode: 'create' }))} className={cn(radioCls, form.accountMode === 'create' ? radioActiveCls : radioInactiveCls)}>
          Create new account
        </button>
        <button type="button" onClick={() => setForm((f) => ({ ...f, accountMode: 'existing' }))} className={cn(radioCls, form.accountMode === 'existing' ? radioActiveCls : radioInactiveCls)}>
          Use existing account
        </button>
      </div>
      {form.accountMode === 'create' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Account Name</label>
          <input
            value={form.accountName}
            onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
            className={inputCls}
            placeholder="Enter account name"
          />
        </div>
      )}
      {form.accountMode === 'existing' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Select Account</label>
          <EntityCombobox
            entityType="accounts"
            value={form.accountId || null}
            onChange={(id) => setForm((f) => ({ ...f, accountId: id || '' }))}
            placeholder="Search accounts..."
          />
        </div>
      )}
    </div>
  );

  const renderStep3 = (): React.ReactElement => (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
        <UserPlus size={18} className="text-green-500" /> Contact
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400">A Contact record will be created from this lead&apos;s data, or you can link to an existing one.</p>
      <div className="space-y-2">
        <button type="button" onClick={() => setForm((f) => ({ ...f, contactMode: 'create' }))} className={cn(radioCls, form.contactMode === 'create' ? radioActiveCls : radioInactiveCls)}>
          Create new contact (from lead data)
        </button>
        <button type="button" onClick={() => setForm((f) => ({ ...f, contactMode: 'existing' }))} className={cn(radioCls, form.contactMode === 'existing' ? radioActiveCls : radioInactiveCls)}>
          Use existing contact
        </button>

      </div>
      {form.contactMode === 'create' && (
        <div className={cn(cardCls, 'text-sm space-y-1')}>
          <p className="text-slate-500 dark:text-slate-400">Will create contact with:</p>
          <p className="text-slate-700 dark:text-slate-300"><strong>Name:</strong> {leadName}</p>
          {lead.email && <p className="text-slate-700 dark:text-slate-300"><strong>Email:</strong> {lead.email}</p>}
          {lead.phone && <p className="text-slate-700 dark:text-slate-300"><strong>Phone:</strong> {lead.phone}</p>}
        </div>
      )}
      {form.contactMode === 'existing' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Select Contact</label>
          <EntityCombobox
            entityType="contacts"
            value={form.contactId || null}
            onChange={(id) => setForm((f) => ({ ...f, contactId: id || '' }))}
            placeholder="Search contacts..."
          />
        </div>
      )}
    </div>
  );

  const renderStep4 = (): React.ReactElement => (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Briefcase size={18} className="text-blue-500" /> Deal</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400">A related Deal must already be confirmed Closed Won. Conversion preserves all existing Deals, Products, prices, and sales history.</p>
    </div>
  );

  const renderStep5 = (): React.ReactElement => (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
        <Check size={18} className="text-green-500" /> Confirmation
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400">Review the conversion actions below.</p>
      <div className={cn(cardCls, 'space-y-3')}>
        <div className="flex items-start gap-2 text-sm">
          <Check size={16} className="text-green-500 mt-0.5 shrink-0" />
          <span className="text-slate-700 dark:text-slate-300">Lead status will change to <strong>Closed</strong></span>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <Check size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <span className="text-slate-700 dark:text-slate-300">
            Account: {!form.accountName.trim() && form.accountMode === 'create' ? 'Keep existing account, or none' : form.accountMode === 'create' ? `Create "${form.accountName}"` : 'Link to existing account'}
          </span>
        </div>
        {(
          <div className="flex items-start gap-2 text-sm">
            <Check size={16} className="text-green-500 mt-0.5 shrink-0" />
            <span className="text-slate-700 dark:text-slate-300">
              Contact: {form.contactMode === 'create' ? `Create from lead data (${leadName})` : 'Link to existing contact'}
            </span>
          </div>
        )}

      </div>
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          This action will convert the lead and set its status to &quot;Closed&quot;. This cannot be easily reversed.
        </p>
      </div>
    </div>
  );

  // ── Step Indicators ─────────────────────────────────────────────────────────
  const steps = [
    { num: 1, label: 'Review' },
    { num: 2, label: 'Account' },
    { num: 3, label: 'Contact' },
    { num: 4, label: 'Deal' },
    { num: 5, label: 'Confirm' },
  ];

  return (
    <SlidingDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Convert Lead"
      subtitle={leadName}
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* Step Progress */}
        <div className="shrink-0 px-4 sm:px-6 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {steps.map((s, idx) => (
              <React.Fragment key={s.num}>
                <div className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                  step === s.num ? 'bg-blue-50 dark:bg-primary/10 text-blue-700 dark:text-blue-300' :
                  step > s.num ? 'text-green-600 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'
                )}>
                  {step > s.num ? <Check size={12} /> : <span>{s.num}</span>}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {idx < steps.length - 1 && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className={panelBodyClass}>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
        </div>

        {/* Footer */}
        <div className={panelFooterClass + " justify-between"}>
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className={panelSecondaryActionClass}
          >
            {step === 1 ? 'Cancel' : <><ChevronLeft size={14} /> Back</>}
          </button>
          {step < 5 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext()}
              className={cn(
                'min-h-[42px] px-5 py-2.5 text-sm font-semibold rounded-xl transition-all flex items-center gap-1',
                canGoNext()
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-slate-100 dark:bg-white/[0.05] text-slate-400 cursor-not-allowed'
              )}
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConvert}
              disabled={isSubmitting}
              className="min-h-[42px] px-5 py-2.5 text-sm font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
              Convert Lead
            </button>
          )}
        </div>
      </div>
    </SlidingDrawer>
  );
}

export default ConvertLeadDialog;
