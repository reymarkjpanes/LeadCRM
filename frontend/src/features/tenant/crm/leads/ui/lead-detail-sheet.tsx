'use client';

import React, { useMemo, useState } from 'react';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { Lead, Organization } from '@/store/types';
import { useData } from '@/store/DataContext';
import { getCRMStatusStyles } from '@/lib/utils';
import { AlertTriangle, Archive, Building, Briefcase, Calendar, Edit2, FileText, Mail, MapPin, Phone, Tag, TrendingUp, User } from 'lucide-react';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';

const formatDate = (dateString: string) => {
  if (!dateString) return '--';
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

interface ClientDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  client: Lead | Organization | null;
  clientType: 'individual' | 'organization';
  onArchive: (id: string, type: 'individual' | 'organization') => void;
  onEdit?: () => void;
}

export function ClientDetailSheet({
  isOpen,
  onClose,
  client,
  clientType,
  onArchive,
  onEdit,
}: ClientDetailSheetProps) {
  const { deals, pipelines } = useData();

  // ── Archive confirmation state ───────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);

  const clientName = React.useMemo(() => {
    if (!client) return '';
    if (clientType === 'individual') {
      const c = client as Lead;
      return `${c.firstName} ${c.lastName}`.trim();
    }
    return (client as Organization).name;
  }, [client, clientType]);

  const associatedDeals = useMemo(() => {
    if (!client) return [];
    return deals.filter(deal => {
      if (clientType === 'individual') {
        const c = client as Lead;
        return (
          (deal.leadId === c.id) || 
          (deal.leadPerson && String(deal.leadPerson).toLowerCase() === clientName.toLowerCase()) ||
          (deal.companyName && c.companyName && deal.companyName.toLowerCase() === c.companyName.toLowerCase())
        );
      } else {
        const org = client as Organization;
        return (
          (deal.organizationId === org.id) ||
          (deal.companyName && deal.companyName.toLowerCase() === org.name.toLowerCase())
        );
      }
    });
  }, [client, clientType, clientName, deals]);

  const activeDeals = associatedDeals.filter(d => !d.isArchived);

  if (!client) return null;

  const isIndividual = clientType === 'individual';
  const displayStatus = isIndividual ? (client as Lead).status : 'Customer';
  const displaySource = isIndividual ? (client as Lead).leadSource : undefined;

  const getStageName = (pipelineId: string, stageId: string) => {
    const pipeline = pipelines.find(p => p.id === pipelineId);
    if (!pipeline) return 'Unknown Stage';
    const stage = pipeline.stages.find(s => s.id === stageId);
    return stage ? stage.name : 'Unknown Stage';
  };

  const handleArchive = (): void => {
    setConfirmOpen(true);
  };

  return (
    <>
    <SlidingDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={clientName}
      subtitle={isIndividual ? (client as Lead).jobTitle : (client as Organization).industry}
      width="w-full max-w-2xl md:max-w-4xl"
      headerActions={onEdit ? (
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 border border-blue-200 dark:border-blue-500/30 rounded-lg transition-colors"
        >
          <Edit2 size={13} />
          Edit
        </button>
      ) : undefined}
    >
      <div className="p-6 md:p-8 overflow-y-auto space-y-8 pb-24 font-sans text-slate-800 dark:text-slate-200">
        
        {/* Header Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-50 dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700/50 rounded-xl space-y-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Type</h4>
            <div className="flex items-center gap-2 font-medium">
              {isIndividual ? <User size={16} className="text-blue-500" /> : <Building size={16} className="text-blue-500" />}
              {isIndividual ? 'Individual Lead' : 'Organization'}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700/50 rounded-xl space-y-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Status</h4>
            <div className={`inline-flex px-2 py-1 rounded text-xs font-bold ${getCRMStatusStyles(displayStatus)}`}>
              {displayStatus}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700/50 rounded-xl space-y-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Created</h4>
            <div className="text-sm font-medium">
              {new Date(client.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Left Column: Details & Lead Info */}
          <div className="space-y-8">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <h3 className="font-bold flex items-center gap-2">
                  <User size={18} className="text-blue-500" />
                  Primary Details
                </h3>
              </div>
              <div className="p-5 space-y-4 text-sm">
                {isIndividual && (
                  <>
                    <div>
                      <span className="text-slate-500 block text-xs mb-1">Job Title</span>
                      <div className="font-medium">{(client as Lead).jobTitle || '--'}</div>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-xs mb-1">Company</span>
                      <div className="font-medium">{(client as Lead).companyName || '--'}</div>
                    </div>
                  </>
                )}
                <div>
                  <span className="text-slate-500 block text-xs mb-1">Email</span>
                  <div className="font-medium flex items-center gap-2">
                    <Mail size={14} className="text-slate-400" />
                    {(client as any).email || '--'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs mb-1">Phone</span>
                  <div className="font-medium flex items-center gap-2">
                    <Phone size={14} className="text-slate-400" />
                    {(client as any).phone || '--'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs mb-1">Address</span>
                  <div className="font-medium flex items-center gap-2">
                    <MapPin size={14} className="text-slate-400" />
                    {(() => {
                      const c = client as any;
                      // Try granular fields first, fall back to address string
                      const parts = [c.city, c.province, c.country].filter(Boolean);
                      return parts.length > 0 ? parts.join(', ') : (c.address || '--');
                    })()}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs mb-1">Lead Source</span>
                  <div className="font-medium">{(client as Lead).leadSource || '--'}</div>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs mb-1">Product Interest</span>
                  <div className="font-medium flex flex-wrap gap-1.5">
                    {(() => {
                      const interests = (client as Lead).productInterests;
                      if (Array.isArray(interests) && interests.length > 0) {
                        return interests.map((p, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 rounded-full text-xs font-medium">
                            <Tag size={10} />
                            {p}
                          </span>
                        ));
                      }
                      return <span className="text-slate-400">--</span>;
                    })()}
                  </div>
                </div>
                {(client as Lead).notes && (
                  <div>
                    <span className="text-slate-500 block text-xs mb-1">Notes</span>
                    <div className="font-medium text-slate-700 dark:text-slate-300 text-xs leading-relaxed bg-slate-50 dark:bg-white/2 rounded-lg p-2.5 border border-slate-200 dark:border-white/5">
                      {(client as Lead).notes}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <h3 className="font-bold flex items-center gap-2">
                  <TrendingUp size={18} className="text-emerald-500" />
                  Active Deals ({activeDeals.length})
                </h3>
              </div>
              <div className="p-0">
                {activeDeals.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeDeals.map(deal => (
                      <div key={deal.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-sm">{deal.title}</h4>
                          <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full whitespace-nowrap">
                            ₱{deal.value?.toLocaleString('en-PH')}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 space-y-1">
                          <div className="flex items-center gap-1">
                            <Briefcase size={12} /> Stage: {getStageName(deal.pipelineId, deal.stageId)}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar size={12} /> Expected Close: {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : '--'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    No active deals found for this client.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Active Deals & History */}
          <div className="space-y-8">
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-red-200 dark:border-red-900/30 bg-red-100/50 dark:bg-red-900/20">
                <h3 className="font-bold flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertTriangle size={18} />
                  Danger Zone
                </h3>
              </div>
              <div className="p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-sm text-red-800/80 dark:text-red-400/80">
                  <p className="font-bold mb-1">Archive this client</p>
                  <p className="text-xs">This will hide the client from main views but preserve their historical data.</p>
                </div>
                <button
                  type="button"
                  onClick={handleArchive}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm transition-colors flex items-center gap-2 shrink-0 shadow-sm"
                >
                  <Archive size={16} />
                  Archive Client
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </SlidingDrawer>

    <ConfirmActionDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Archive Client"
      description={`This will archive ${clientName} and hide them from active views.`}
      warning="Their historical data and associated deals are preserved."
      confirmLabel="Archive"
      variant="destructive"
      onConfirm={async () => {
        onArchive(client.id, clientType);
        onClose();
      }}
    />
    </>
  );
}

