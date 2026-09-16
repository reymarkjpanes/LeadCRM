'use client';

import React, { useState, useEffect } from 'react';
import { Lead, Organization, User as UserType, Deal, Task, Campaign } from '@/store/types';
import type { Contact } from '@/store/types';
import { useData } from '@/store/DataContext';
import { leadsService } from '@/features/tenant/crm/leads/services/leads.service';
import { toFrontendContact } from '@/lib/api/adapters/contact.adapter';
import { ClientProfileTabs } from './lead-profile-tabs';
import { CompanyProfileTabs, ExtendedOrg } from './company-profile-tabs';
import { ShieldCheck, TrendingUp } from 'lucide-react';
import { getCRMStatusStyles } from '@/lib/utils';
import { BackButton } from '@/shared/components/ui/back-button';

interface UnifiedDetailViewProps {
  type: 'individual' | 'organization';
  selectedItem: Lead | (Organization & { leads?: Lead[] });
  initialTab?: string;
  users: UserType[];
  deals: Deal[];
  tasks: Task[];
  campaigns: Campaign[];
  currentUser: UserType | null;
  updateLead: (id: string, updates: Partial<Lead>) => void;
  addTask: (taskData: any) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  onClose: () => void;
  handleSyncCompanyDetails: (companyNameRef: string, updates: Partial<Lead>) => void;
  onEditClick?: () => void;
  setSelectedLead?: (lead: Lead | null) => void;
  setSelectedOrgName?: (orgName: string | null) => void;
  setSelectedOrg?: (org: Organization | null) => void;
}

export const UnifiedDetailView = ({
  type,
  selectedItem,
  initialTab = 'overview',
  users,
  deals,
  tasks,
  campaigns,
  currentUser,
  updateLead,
  addTask,
  updateTask,
  onClose,
  handleSyncCompanyDetails,
  onEditClick,
  setSelectedLead,
  setSelectedOrgName
}: UnifiedDetailViewProps) => {

  const { contacts: leads = [] } = useData({ includeArchived: true });

  // ── On-demand leads fetch for org view ───────────────────────────────────
  // DataContext.contacts is no longer populated at startup (route-scoped migration).
  // Fetch a small list when this detail view mounts so orgLeads is populated.
  const [fetchedLeads, setFetchedLeads] = useState<Contact[]>([]);
  const leadsToUse = fetchedLeads.length > 0 ? fetchedLeads : leads;

  useEffect(() => {
    leadsService.getAll({ limit: 100 })
      .then((res) => setFetchedLeads((res?.data ?? []).map(toFrontendContact) as Contact[]))
      .catch(() => {/* silent — falls back to DataContext array which may be empty */});
  }, []);

  // Robust organization entity normalization regardless of whether selectedItem is a Lead or an Organization
  const normalizedOrg: ExtendedOrg = React.useMemo(() => {
    const isLeadObj = 'companyName' in selectedItem || 'leadPerson' in selectedItem;
    const itemAsLead = selectedItem as Lead;
    const itemAsOrg = selectedItem as Organization;

    const name = (isLeadObj ? itemAsLead.companyName : itemAsOrg.name) || 'Organization';
    const id = isLeadObj ? (itemAsLead.organizationId || itemAsLead.id) : itemAsOrg.id;

    // Find all leads in dataset matching this organization
    const orgLeads = leadsToUse.filter(c => 
      !c.isArchived && (
        (id && c.organizationId === id) ||
        (c.companyName && name && c.companyName.toLowerCase().trim() === name.toLowerCase().trim())
      )
    );

    return {
      id: id || 'org_demo',
      tenantId: selectedItem.tenantId || 'tenant_demo',
      name: name,
      industry: (selectedItem as any).industry || 'Technology & B2B Solutions',
      size: (selectedItem as any).size || '250+ Employees',
      website: (selectedItem as any).website || 'N/A',
      taxId: (selectedItem as any).taxId || 'N/A',
      createdAt: (selectedItem as any).createdAt || new Date().toISOString(),
      leads: orgLeads.length > 0 ? orgLeads : (isLeadObj ? [itemAsLead] : []),
      address: (selectedItem as any).address || [ (selectedItem as any).streetAddress, (selectedItem as any).city, (selectedItem as any).province ].filter(Boolean).join(', ') || 'Metropolitan Manila',
      status: (selectedItem as any).status || 'Customer',
      leadSource: (selectedItem as any).leadSource || 'Website Portal',
      estimatedValue: (selectedItem as any).estimatedValue || 0,
      repId: (selectedItem as any).assignedUserId || 'user_1',
    };
  }, [selectedItem, leadsToUse]);

  // Dynamic Mappings for Status and Connected Deals
  const mappedStatus = type === 'individual' 
    ? (selectedItem as Lead).status 
    : normalizedOrg.status;

  const mappedDeals = React.useMemo(() => {
    if (type === 'individual') {
      const lead = selectedItem as Lead;
      return deals.filter(d => 
        !d.isArchived && (
          d.leadId === lead.id ||
          d.leadIds?.includes(lead.id) ||
          (d.companyName && lead.companyName && d.companyName.toLowerCase().trim() === lead.companyName.toLowerCase().trim()) || 
          (d.leadPerson && lead.leadPerson && String(d.leadPerson).toLowerCase().trim() === lead.leadPerson.toLowerCase().trim())
        )
      );
    } else {
      const orgName = normalizedOrg.name.toLowerCase().trim();
      const orgLeadIds = new Set(normalizedOrg.leads.map(c => c.id));
      const orgLeadPersons = new Set(normalizedOrg.leads.map(c => c.leadPerson?.toLowerCase().trim()).filter(Boolean));

      return deals.filter(d => {
        if (d.isArchived) return false;
        if (d.companyId && normalizedOrg.id && d.companyId === normalizedOrg.id) return true;
        if (d.companyName && d.companyName.toLowerCase().trim() === orgName) return true;
        if (d.leadId && orgLeadIds.has(d.leadId)) return true;
        if (d.leadIds && d.leadIds.some(cid => orgLeadIds.has(cid))) return true;
        if (d.leadPerson && orgLeadPersons.has(String(d.leadPerson).toLowerCase().trim())) return true;
        return false;
      });
    }
  }, [type, selectedItem, deals, normalizedOrg]);

  return (
    <div className="space-y-6" id="unified-detail-view-root">
      {/* Top Header Navigation */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-white/10">
        <BackButton label="Back to Leads" onClick={onClose} variant="default" />
      </div>

      {/* Dynamic Summary Bar displaying Mapped Status and Deals count */}
      <div className="bg-slate-50 dark:bg-white/1 border border-gray-200 dark:border-white/4 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="text-blue-500 shrink-0" size={16} />
          <div>
            <span className="text-slate-405 dark:text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Dynamic CRM Mapping Structure</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Classified as: <strong className="text-blue-500 capitalize">{type} Account model</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className={`flex items-center border px-2.5 py-1 rounded-lg font-semibold text-xs ${getCRMStatusStyles(mappedStatus)}`}>
            <span>Status: <strong className="font-extrabold">{mappedStatus}</strong></span>
          </div>

          <div className="flex items-center gap-1.5 bg-white dark:bg-white/5 border border-gray-150 dark:border-white/5 px-2.5 py-1 rounded-lg">
            <TrendingUp className="text-indigo-400 w-3.5 h-3.5" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Deals Stream: <strong className="text-indigo-500 dark:text-indigo-400">{mappedDeals.length} deal file(s)</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Actual Tab Interfaces Layouts */}
      {type === 'individual' ? (
        <ClientProfileTabs
          selectedLead={selectedItem as Lead}
          initialTab={initialTab as any}
          users={users}
          deals={deals}
          tasks={tasks}
          campaigns={campaigns}
          currentUser={currentUser}
          updateLead={updateLead}
          addTask={addTask}
          updateTask={updateTask}
          onClose={onClose}
          onEditClick={onEditClick}
        />
      ) : (
        <CompanyProfileTabs
          selectedOrg={normalizedOrg}
          initialTab={initialTab as any}
          users={users}
          deals={deals}
          tasks={tasks}
          campaigns={campaigns}
          currentUser={currentUser}
          updateLead={updateLead}
          addTask={addTask}
          updateTask={updateTask}
          onClose={onClose}
          handleSyncCompanyDetails={handleSyncCompanyDetails}
          onEditClick={onEditClick}
          setSelectedLead={setSelectedLead}
          setSelectedOrgName={setSelectedOrgName}
        />
      )}
    </div>
  );
};

