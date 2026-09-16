'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Users, Briefcase, LayoutDashboard, Workflow, Mail, Settings, ShieldAlert, Receipt, Activity } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { useAuth } from '../../store/AuthContext';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { leadsService } from '@/features/tenant/crm/leads/services/leads.service';
import { pipelineService } from '@/features/tenant/crm/pipeline/services/pipeline.service';
import { toFrontendContact } from '@/lib/api/adapters/contact.adapter';
import { toFrontendDeal } from '@/lib/api/adapters/deal.adapter';
import type { Contact, Deal } from '@/store/types';

interface CommandPaletteProps {
  navigate: (path: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function CommandPalette({ navigate, isOpen, setIsOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const { isBillingModuleEnabled, roles } = useData();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Server-side search results ───────────────────────────────────────────
  const [searchedLeads,  setSearchedLeads]  = useState<Contact[]>([]);
  const [searchedDeals,  setSearchedDeals]  = useState<Deal[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  const userRoleDef    = roles.find(r => r.name === user?.role);
  const userPermissions = userRoleDef?.permissions || [];

  const searchRecords = useCallback(async (term: string): Promise<void> => {
    if (!term.trim() || term.length < 2) {
      setSearchedLeads([]);
      setSearchedDeals([]);
      return;
    }
    setIsSearching(true);
    try {
      const [leadsRes, dealsRes] = await Promise.allSettled([
        leadsService.getAll({ search: term, limit: 5 }),
        pipelineService.getDeals(undefined, 5),
      ]);
      setSearchedLeads(
        leadsRes.status === 'fulfilled'
          ? (leadsRes.value?.data ?? []).map(toFrontendContact) as Contact[]
          : [],
      );
      setSearchedDeals(
        dealsRes.status === 'fulfilled'
          ? (dealsRes.value?.data ?? [])
              .map(toFrontendDeal)
              .filter((d): d is Deal =>
                d !== null &&
                (
                  (d.title ?? '').toLowerCase().includes(term.toLowerCase()) ||
                  (d.companyName ?? '').toLowerCase().includes(term.toLowerCase())
                ),
              ) as Deal[]
          : [],
      );
    } catch {
      // Silent failure — nav items remain usable
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    void searchRecords(debouncedQuery);
  }, [debouncedQuery, searchRecords]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setSearchedLeads([]);
      setSearchedDeals([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const navItems = [
    { name: 'Dashboard',       path: 'dashboard',  icon: LayoutDashboard, permissions: ['p1'] },
    { name: 'Client Profiles', path: 'contacts',   icon: Users,           permissions: ['contacts.view', 'p2', 'p2_own'] },
    { name: 'Leads',           path: 'leads',      icon: Users,           permissions: ['contacts.view', 'p2', 'p2_own'] },
    { name: 'Accounts',        path: 'accounts',   icon: Users,           permissions: ['accounts.view', 'p2', 'p2_own'] },
    { name: 'Deals',           path: 'deals',      icon: Briefcase,       permissions: ['deals.view', 'p7', 'p7_own'] },
    { name: 'Contract Billing',path: 'billing',    icon: Receipt,         permissions: ['billing.view', 'p29'], enabled: isBillingModuleEnabled },
    { name: 'Workflows',       path: 'workflows',  icon: Workflow,        permissions: ['workflows.view', 'p12'] },
    { name: 'Campaigns',       path: 'campaigns',  icon: Mail,            permissions: ['campaigns.view', 'p17'] },
    { name: 'Users',           path: 'users',      icon: Users,           permissions: ['users.view', 'p22'] },
    { name: 'Settings',        path: 'settings',   icon: Settings,        permissions: ['settings.view', 'p27'] },
    { name: 'Audit Trail',     path: 'audit-log',  icon: Activity,        permissions: ['audit.view', 'p30'] },
    { name: 'Admin Console',   path: 'admin',      icon: ShieldAlert,     roles: ['System Admin'] },
  ];

  const hasAccess = (item: { name: string; permissions?: string[]; roles?: string[]; enabled?: boolean }) => {
    if (user?.role?.toLowerCase() === 'system admin') {
      return ['Dashboard', 'Users', 'Settings', 'Admin Console', 'Audit Trail'].includes(item.name);
    }
    if (item.name === 'Admin Console') return false;
    if (user?.role?.toLowerCase() === 'client admin') return true;
    if (user?.role?.toLowerCase() === 'guest') {
      return ['Dashboard', 'Leads', 'Pipeline', 'Workflows', 'Campaigns'].includes(item.name);
    }
    if (item.roles?.some((r) => r.toLowerCase() === user?.role?.toLowerCase())) return true;
    if (item.permissions?.some((p) => userPermissions.includes(p))) return true;
    return false;
  };

  const filteredNav = navItems.filter((item) =>
    hasAccess(item) &&
    (item.enabled === undefined || item.enabled === true) &&
    item.name.toLowerCase().includes(query.toLowerCase()),
  );

  const handleSelect = (path: string): void => {
    navigate(path);
    setIsOpen(false);
  };

  const hasResults = filteredNav.length > 0 || searchedLeads.length > 0 || searchedDeals.length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div
        className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-950 border border-gray-300 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        {/* Search input */}
        <div className="flex items-center px-4 py-4 border-b border-gray-200 dark:border-white/5">
          <Search className="text-slate-500 dark:text-slate-400 mr-3 shrink-0" size={20} />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none text-lg"
            placeholder="Search leads, deals, or navigate..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isSearching && (
            <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mr-2 shrink-0" aria-label="Searching" />
          )}
          <div className="text-xs text-slate-500 font-mono bg-gray-50 dark:bg-white/5 px-2 py-1 rounded border border-gray-300 dark:border-white/10 shrink-0">
            ESC
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {query === '' && (
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Quick Navigation
            </div>
          )}

          {/* Navigation items */}
          {filteredNav.length > 0 && (
            <div className="mb-4">
              {query !== '' && (
                <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Navigation
                </div>
              )}
              {filteredNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleSelect(item.path)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-left"
                  >
                    <Icon size={18} className="text-slate-500 dark:text-slate-400" />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Lead results */}
          {query !== '' && searchedLeads.length > 0 && (
            <div className="mb-4">
              <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Leads
              </div>
              {searchedLeads.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => handleSelect('leads')}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-left"
                >
                  <Users size={18} className="text-blue-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{contact.companyName || contact.contactPerson}</div>
                    <div className="text-xs text-slate-500 truncate">{contact.contactPerson}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Deal results */}
          {query !== '' && searchedDeals.length > 0 && (
            <div className="mb-4">
              <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Deals
              </div>
              {searchedDeals.map((deal) => (
                <button
                  key={deal.id}
                  onClick={() => handleSelect('pipeline')}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-left"
                >
                  <Briefcase size={18} className="text-purple-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{deal.title}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {deal.companyName} · ${(deal.value ?? 0).toLocaleString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {query !== '' && !isSearching && !hasResults && (
            <div className="px-4 py-8 text-center text-slate-500">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
