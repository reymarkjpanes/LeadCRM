'use client';
import { useMemo } from 'react';
import { Contact, Deal, Task, Campaign } from '@/store/types';

interface UseDashboardOptions {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  campaigns: Campaign[];
}

/**
 * Computes all KPI metrics shown on the CRM Dashboard.
 * Extracted so Dashboard.tsx stays thin and metrics are testable in isolation.
 */
export function useDashboard({
  contacts,
  deals,
  tasks,
  campaigns,
}: UseDashboardOptions) {
  const metrics = useMemo(() => {
    const activeContacts = contacts.filter((c) => !c.isArchived);
    const activeDeals = deals.filter((d) => !d.isArchived);

    const totalRevenue = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    const hotLeads = activeContacts.filter((c) => c.status === 'Hot').length;
    const warmLeads = activeContacts.filter((c) => c.status === 'Warm').length;
    const coldLeads = activeContacts.filter((c) => c.status === 'Cold').length;
    const closedLeads = activeContacts.filter((c) => c.status === 'Closed').length;

    const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;

    const activeCampaigns = campaigns.filter(
      (c) => c.status === 'active' && !c.isArchived
    ).length;

    const conversionRate =
      activeContacts.length > 0
        ? Math.round((closedLeads / activeContacts.length) * 100)
        : 0;

    return {
      totalContacts: activeContacts.length,
      totalDeals: activeDeals.length,
      totalRevenue,
      hotLeads,
      warmLeads,
      coldLeads,
      closedLeads,
      conversionRate,
      pendingTasks,
      inProgressTasks,
      completedTasks,
      activeCampaigns,
    };
  }, [contacts, deals, tasks, campaigns]);

  return { metrics };
}
