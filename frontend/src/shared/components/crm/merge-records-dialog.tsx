'use client';
import { panelBodyClass, panelFooterClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';

import React, { useState, useEffect } from 'react';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useData } from '@/store/DataContext';
import {
  AlertTriangle,
  Check,
  GitMerge,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

export type MergeEntityType = 'lead' | 'contact' | 'account';

interface FieldComparison {
  field: string;
  primaryValue: unknown;
  secondaryValue: unknown;
  isDifferent: boolean;
}

interface RelationshipCounts {
  activities: number;
  tasks: number;
  deals: number;
  leads?: number;
  contacts?: number;
  campaigns?: number;
}

interface MergePreviewData {
  primary: Record<string, unknown>;
  secondary: Record<string, unknown>;
  fieldComparisons: FieldComparison[];
  relationshipCounts: {
    primary: RelationshipCounts;
    secondary: RelationshipCounts;
  };
}

interface MergeRecordsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: MergeEntityType;
  primaryId: string;
  secondaryId: string;
  onSuccess?: () => void;
}

// ─── Field Display Labels ──────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  phone: 'Phone',
  companyName: 'Company Name',
  address: 'Address',
  description: 'Description',
  website: 'Website',
  productInterest: 'Product Interest',
  source: 'Source',
  assignedUserId: 'Assigned Agent',
  status: 'Status',
  accountId: 'Account',
  name: 'Name',
  industry: 'Industry',
  size: 'Size',
  notes: 'Notes',
  internalNotes: 'Internal Notes',
  tags: 'Tags',
  productInterests: 'Product Interests',
  activeProducts: 'Active Products',
  city: 'City',
  province: 'Province',
  country: 'Country',
  lastStatusChangedAt: 'Last Status Change',
};

// ─── Component ─────────────────────────────────────────────────────────────

export function MergeRecordsDialog({
  isOpen,
  onClose,
  entityType,
  primaryId,
  secondaryId,
  onSuccess,
}: MergeRecordsDialogProps): React.ReactElement {
  const { refreshContacts, refreshOrganizations } = useData();
  const [preview, setPreview] = useState<MergePreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldResolutions, setFieldResolutions] = useState<Record<string, 'primary' | 'secondary'>>({});

  // Fetch preview on open
  useEffect(() => {
    if (!isOpen || !primaryId || !secondaryId) return;

    const fetchPreview = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const response = await apiClient.post<{ success: boolean; data: MergePreviewData }>(
          '/crm/merge/preview',
          { entityType, primaryId, secondaryId },
        );
        if (response.success && response.data) {
          setPreview(response.data);
          // Default all different fields to 'primary'
          const defaults: Record<string, 'primary' | 'secondary'> = {};
          response.data.fieldComparisons
            .filter((fc) => fc.isDifferent)
            .forEach((fc) => { defaults[fc.field] = 'primary'; });
          setFieldResolutions(defaults);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load merge preview';
        toast.error(message);
        onClose();
      } finally {
        setIsLoading(false);
      }
    };

    fetchPreview();
  }, [isOpen, entityType, primaryId, secondaryId, onClose]);

  // Execute merge
  const handleMerge = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await apiClient.post('/crm/merge', {
        entityType,
        primaryId,
        secondaryId,
        fieldResolutions,
      });

      toast.success('Records merged successfully');
      // Refresh the appropriate module
      if (entityType === 'account') {
        await refreshOrganizations().catch(() => {});
      } else {
        await refreshContacts().catch(() => {});
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to merge records';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helpers
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const totalSecondaryRelationships = preview
    ? Object.values(preview.relationshipCounts.secondary).reduce((sum, v) => sum + (v || 0), 0)
    : 0;

  const entityLabel = entityType === 'lead' ? 'Lead' : entityType === 'contact' ? 'Contact' : 'Account';

  return (
    <SlidingDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Merge ${entityLabel} Records`}
      subtitle="Compare and merge duplicate records"
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* Loading */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw size={20} className="animate-spin text-blue-500" />
            <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">Loading comparison...</span>
          </div>
        )}

        {/* Content */}
        {preview && !isLoading && (
          <>
            {/* Scrollable comparison */}
            <div className={panelBodyClass + " space-y-5"}>
              {/* Record Headers */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-center">
                <div className="px-3 py-2 rounded-lg border-2 border-green-300 dark:border-green-600 bg-green-50 dark:bg-green-950/20">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">Primary (Keeps)</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white [overflow-wrap:anywhere] mt-0.5">
                    {String(preview.primary.firstName || preview.primary.name || '')} {preview.primary.lastName ? String(preview.primary.lastName) : ''}
                  </p>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
                <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02]">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Secondary (Archives)</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white [overflow-wrap:anywhere] mt-0.5">
                    {String(preview.secondary.firstName || preview.secondary.name || '')} {preview.secondary.lastName ? String(preview.secondary.lastName) : ''}
                  </p>
                </div>
              </div>

              {/* Field Comparisons */}
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Field Values</h4>
                {preview.fieldComparisons.filter((fc) => fc.isDifferent).map((fc) => (
                  <div key={fc.field} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center py-2 border-b border-slate-100 dark:border-white/[0.05]">
                    {/* Primary Value */}
                    <button
                      type="button"
                      onClick={() => setFieldResolutions((prev) => ({ ...prev, [fc.field]: 'primary' }))}
                      className={cn(
                        'text-left px-3 py-2 rounded-lg text-xs transition-all border',
                        fieldResolutions[fc.field] === 'primary'
                          ? 'border-green-300 dark:border-green-600 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300'
                          : 'border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] text-slate-600 dark:text-slate-400',
                      )}
                    >
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">{FIELD_LABELS[fc.field] || fc.field}</span>
                      <span className="block [overflow-wrap:anywhere]">{formatValue(fc.primaryValue)}</span>
                    </button>

                    {/* Radio indicator */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={cn('w-3 h-3 rounded-full border-2', fieldResolutions[fc.field] === 'primary' ? 'border-green-500 bg-green-500' : 'border-slate-300 dark:border-slate-600')} />
                      <div className={cn('w-3 h-3 rounded-full border-2', fieldResolutions[fc.field] === 'secondary' ? 'border-primary bg-primary' : 'border-slate-300 dark:border-slate-600')} />
                    </div>

                    {/* Secondary Value */}
                    <button
                      type="button"
                      onClick={() => setFieldResolutions((prev) => ({ ...prev, [fc.field]: 'secondary' }))}
                      className={cn(
                        'text-left px-3 py-2 rounded-lg text-xs transition-all border',
                        fieldResolutions[fc.field] === 'secondary'
                          ? 'border-blue-300 dark:border-primary bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300'
                          : 'border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] text-slate-600 dark:text-slate-400',
                      )}
                    >
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">{FIELD_LABELS[fc.field] || fc.field}</span>
                      <span className="block [overflow-wrap:anywhere]">{formatValue(fc.secondaryValue)}</span>
                    </button>
                  </div>
                ))}
                {preview.fieldComparisons.filter((fc) => fc.isDifferent).length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-4">All fields have identical values.</p>
                )}
              </div>

              {/* Relationship Summary */}
              {totalSecondaryRelationships > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02] p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Relationships to Reassign</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {preview.relationshipCounts.secondary.activities > 0 && (
                      <div className="flex justify-between"><span className="text-slate-500">Activities</span><span className="font-medium text-slate-700 dark:text-slate-300">{preview.relationshipCounts.secondary.activities}</span></div>
                    )}
                    {preview.relationshipCounts.secondary.tasks > 0 && (
                      <div className="flex justify-between"><span className="text-slate-500">Tasks</span><span className="font-medium text-slate-700 dark:text-slate-300">{preview.relationshipCounts.secondary.tasks}</span></div>
                    )}
                    {preview.relationshipCounts.secondary.deals > 0 && (
                      <div className="flex justify-between"><span className="text-slate-500">Deals</span><span className="font-medium text-slate-700 dark:text-slate-300">{preview.relationshipCounts.secondary.deals}</span></div>
                    )}
                    {(preview.relationshipCounts.secondary.leads ?? 0) > 0 && (
                      <div className="flex justify-between"><span className="text-slate-500">Leads</span><span className="font-medium text-slate-700 dark:text-slate-300">{preview.relationshipCounts.secondary.leads}</span></div>
                    )}
                    {(preview.relationshipCounts.secondary.contacts ?? 0) > 0 && (
                      <div className="flex justify-between"><span className="text-slate-500">Contacts</span><span className="font-medium text-slate-700 dark:text-slate-300">{preview.relationshipCounts.secondary.contacts}</span></div>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    These relationships will be moved to the primary record.
                  </p>
                </div>
              )}

              {/* Warning */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                <AlertTriangle size={16} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-red-800 dark:text-red-300">This action cannot be undone</p>
                  <p className="text-[11px] text-red-700 dark:text-red-400 mt-0.5">
                    The secondary record will be permanently archived. All its relationships will be reassigned to the primary record.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={panelFooterClass + " justify-between"}>
              <button
                type="button"
                onClick={onClose}
                className={panelSecondaryActionClass}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMerge}
                disabled={isSubmitting}
                className="min-h-[42px] px-5 py-2.5 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <GitMerge size={14} />}
                Merge Records
              </button>
            </div>
          </>
        )}
      </div>
    </SlidingDrawer>
  );
}

export default MergeRecordsDialog;
