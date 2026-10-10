'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Mail, Phone, ExternalLink, X, ChevronDown, User, Building, Briefcase, Target, Tag } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { getTenantCurrency, formatCurrency } from '@/shared/utils/currency';
import { leadsService } from '@/features/tenant/crm/leads/services/leads.service';
import { accountsService } from '@/features/tenant/crm/accounts/services/accounts.service';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import { toFrontendOrg } from '@/lib/api/adapters/organization.adapter';
import type { Contact, Organization, Deal } from '@/store/types';

type ScopedModule = 'all' | 'leads' | 'contacts' | 'accounts' | 'deals';

interface GlobalOmniboxProps {
  autoFocus?: boolean;
  onResultSelect?: () => void;
}

function personName(record: Contact, kind: 'lead' | 'contact'): string {
  const fullName = [record.firstName, record.lastName].map(part => part?.trim()).filter(Boolean).join(' ');
  return fullName || (kind === 'lead' ? record.leadPerson?.trim() || record.displayName?.trim() : record.contactPerson?.trim()) || 'Unnamed person';
}

export function GlobalOmnibox({ autoFocus = false, onResultSelect }: GlobalOmniboxProps) {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState<ScopedModule>('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchVersion = useRef(0);

  // Only need deals from DataContext (still loaded at startup for cross-module use).
  // Leads, contacts, accounts are now fetched server-side on search.
  const { deals: contextDeals } = useData();
  const { tenant, user } = useAuth();
  const debouncedQuery = useDebounce(query, 300);
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  // ── Server-side search results ───────────────────────────────────────────
  const [serverLeads,    setServerLeads]    = useState<Contact[]>([]);
  const [serverContacts, setServerContacts] = useState<Contact[]>([]);
  const [serverAccounts, setServerAccounts] = useState<Organization[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);

  const isTagSearch = debouncedQuery.startsWith('#');
  const cleanQuery  = isTagSearch
    ? debouncedQuery.slice(1).trim().toLowerCase()
    : debouncedQuery.trim().toLowerCase();

  const searchServer = useCallback(async (term: string, scope: ScopedModule): Promise<void> => {
    const version = ++searchVersion.current;
    if (term.length < 3) {
      setIsSearching(false);
      setServerLeads([]);
      setServerContacts([]);
      setServerAccounts([]);
      return;
    }
    setIsSearching(true);
    try {
      const [leadsRes, contactsRes, accountsRes] = await Promise.allSettled([
        (scope === 'all' || scope === 'leads')
          ? leadsService.getAll({ search: term, limit: 4 })
          : Promise.resolve(null),
        (scope === 'all' || scope === 'contacts')
          ? contactsV2Api.list({ search: term, limit: 4 })
          : Promise.resolve(null),
        (scope === 'all' || scope === 'accounts')
          ? accountsService.getAll({ search: term, limit: 4 })
          : Promise.resolve(null),
      ]);
      if (version !== searchVersion.current) return;
      setServerLeads(
        leadsRes.status === 'fulfilled' && leadsRes.value
          ? (leadsRes.value?.data ?? []) as Contact[]
          : [],
      );
      setServerContacts(
        contactsRes.status === 'fulfilled' && contactsRes.value
          ? (contactsRes.value?.data ?? []) as Contact[]
          : [],
      );
      setServerAccounts(
        accountsRes.status === 'fulfilled' && accountsRes.value
          ? (accountsRes.value?.data ?? []).map(toFrontendOrg) as Organization[]
          : [],
      );
    } catch {
      // Silent — partial results are fine; nav still works
    } finally {
      if (version === searchVersion.current) setIsSearching(false);
    }
  }, [tenant?.id, user?.id]);

  useEffect(() => {
    setServerLeads([]); setServerContacts([]); setServerAccounts([]);
    if (isFocused) void searchServer(cleanQuery, module);
    return () => { searchVersion.current++; };
  }, [cleanQuery, module, searchServer, isFocused]);

  // Deals: filter from DataContext since deals are still loaded at startup
  const serverDeals = useMemo((): Deal[] => {
    if (cleanQuery.length < 3) return [];
    if (module !== 'all' && module !== 'deals') return [];
    return contextDeals
      .filter((d) => !d.isArchived && (
        isTagSearch
          ? (d.priority ?? '').toLowerCase().includes(cleanQuery) || (d.leadSource ?? '').toLowerCase().includes(cleanQuery)
          : d.title.toLowerCase().includes(cleanQuery) || (d.companyName ?? '').toLowerCase().includes(cleanQuery)
      ))
      .slice(0, 4);
  }, [cleanQuery, isTagSearch, module, contextDeals]);

  const results = useMemo(() => ({
    leads:    serverLeads,
    contacts: serverContacts,
    accounts: serverAccounts,
    deals:    serverDeals,
  }), [serverLeads, serverContacts, serverAccounts, serverDeals]);

  const totalResults = results.leads.length + results.contacts.length + results.accounts.length + results.deals.length;
  const showResults  = isFocused && query.trim().length >= 3 && cleanQuery.length >= 3;

  // 1. Keyboard Shortcuts (/ and #)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target !== inputRef.current) {
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsDropdownOpen(true);
      } else if (e.key === '#') {
        e.preventDefault();
        inputRef.current?.focus();
        setQuery('#');
        setIsDropdownOpen(true);
      } else if (e.key === 'Escape') {
        inputRef.current?.blur();
        setIsDropdownOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 2. autoFocus — when used inside MobileSearchOverlay, focus the input on mount
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        setIsDropdownOpen(true);
        setIsFocused(true);
      }
    }, 50);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectResult = (path: string, id: string) => {
    searchVersion.current++;
    setQuery('');
    setServerLeads([]); setServerContacts([]); setServerAccounts([]);
    setIsSearching(false);
    setIsDropdownOpen(false);
    setIsFocused(false);
    inputRef.current?.blur();
    onResultSelect?.();
    router.push(`${path}?highlight=${encodeURIComponent(id)}`);
  };

  return (

    <div ref={dropdownRef} className="relative w-full max-w-[460px]">
      <div className="flex items-center h-8.5 w-full bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl focus-within:ring-2 focus-within:ring-[#2563EB]/20 focus-within:border-[#2563EB] focus-within:bg-white dark:focus-within:bg-slate-900 transition-all overflow-hidden shadow-2xs">
        {/* Module Scoper */}
        <div className="relative shrink-0 border-r border-slate-200 dark:border-slate-700">
          <select
            value={module}
            onChange={(e) => setModule(e.target.value as ScopedModule)}
            className="h-8.5 pl-2.5 pr-6 text-[11.5px] font-semibold bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none appearance-none cursor-pointer"
            aria-label="Scope Search Module"
          >
            <option value="all">All Modules</option>
            <option value="leads">Leads</option>
            <option value="contacts">Contacts</option>
            <option value="accounts">Accounts</option>
            <option value="deals">Deals</option>
          </select>
          <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Input */}
        <div className="relative min-w-0 flex-1 flex items-center h-full">
          {isTagSearch ? (
            <Tag size={13} className="absolute left-2.5 text-blue-500" />
          ) : (
            <Search size={13} className="absolute left-2.5 text-slate-400" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => { setIsFocused(true); setIsDropdownOpen(true); }}
            onChange={(e) => { setQuery(e.target.value); setIsDropdownOpen(true); }}
            placeholder={isTagSearch ? "Filter by tag or category..." : "Search records (Press '/' or '#')..."}
            className="min-w-0 w-full h-full pl-8 pr-8 text-[12px] bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          {isSearching && cleanQuery.length >= 3 && (
            <div
              className="absolute right-7 w-3 h-3 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
              aria-label="Searching"
            />
          )}
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded"
            >
              <X size={13} />
            </button>
          ) : (
            <div className="absolute right-2 flex items-center gap-1">
              <kbd className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                /
              </kbd>
            </div>
          )}
        </div>
      </div>

      {/* Results Dropdown Overlay */}
      {isDropdownOpen && showResults && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-2 z-50 max-h-[70vh] overflow-y-auto space-y-3 custom-scrollbar backdrop-blur-md">
          {totalResults === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              {isSearching ? 'Searching records…' : <>No matching records found for &ldquo;{cleanQuery}&rdquo;.</>}
            </div>
          ) : (
            <>
              {/* Leads */}
              {results.leads.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] font-bold uppercase text-slate-400 tracking-wider">
                    <Target size={12} className="text-blue-500" /> Leads
                  </div>
                  <div className="space-y-0.5">
                    {results.leads.map((lead) => (
                      <div
                        key={lead.id}
                        role="button" tabIndex={0}
                        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectResult('/crm/leads', lead.id); } } }
                        onClick={() => selectResult('/crm/leads', lead.id)}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-blue-500 transition-colors">
                            {personName(lead, 'lead')}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {lead.companyName ?? 'Independent'} &middot; {lead.email ?? 'No email'}
                          </p>
                        </div>
                        {/* Quick Action Icons */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {lead.email && (
                            <button
                              onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${lead.email}`; }}
                              title="Send Email"
                              className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                            >
                              <Mail size={13} />
                            </button>
                          )}
                          {lead.phone && (
                            <button
                              onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${lead.phone}`; }}
                              title="Call"
                              className="p-1 text-slate-400 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                            >
                              <Phone size={13} />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); selectResult('/crm/leads', lead.id); }}
                            title="View Lead"
                            className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                          >
                            <ExternalLink size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contacts */}
              {results.contacts.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] font-bold uppercase text-slate-400 tracking-wider">
                    <User size={12} className="text-teal-500" /> Contacts
                  </div>
                  <div className="space-y-0.5">
                    {results.contacts.map((contact) => (
                      <div
                        key={contact.id}
                        role="button" tabIndex={0}
                        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectResult('/crm/contacts', contact.id); } } }
                        onClick={() => selectResult('/crm/contacts', contact.id)}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-teal-500 transition-colors">
                            {personName(contact, 'contact')}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {contact.companyName || (contact as Contact & { account?: { name?: string } }).account?.name || contact.customerType || 'Prospect'} &middot; {contact.email ?? 'No email'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {contact.email && (
                            <button
                              onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${contact.email}`; }}
                              title="Send Email"
                              className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                            >
                              <Mail size={13} />
                            </button>
                          )}
                          {contact.phone && (
                            <button
                              onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${contact.phone}`; }}
                              title="Call"
                              className="p-1 text-slate-400 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                            >
                              <Phone size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Accounts */}
              {results.accounts.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] font-bold uppercase text-slate-400 tracking-wider">
                    <Building size={12} className="text-amber-500" /> Accounts
                  </div>
                  <div className="space-y-0.5">
                    {results.accounts.map((account) => (
                      <div
                        key={account.id}
                        role="button" tabIndex={0}
                        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectResult('/crm/accounts', account.id); } } }
                        onClick={() => selectResult('/crm/accounts', account.id)}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-amber-500 transition-colors">
                            {account.name}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {account.industry ?? 'General'} &middot; {account.city ?? 'Global'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); selectResult('/crm/accounts', account.id); }}
                            title="View Account"
                            className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                          >
                            <ExternalLink size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deals */}
              {results.deals.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] font-bold uppercase text-slate-400 tracking-wider">
                    <Briefcase size={12} className="text-purple-500" /> Deals
                  </div>
                  <div className="space-y-0.5">
                    {results.deals.map((deal) => (
                      <div
                        key={deal.id}
                        role="button" tabIndex={0}
                        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectResult('/crm/deals', deal.id); } } }
                        onClick={() => selectResult('/crm/deals', deal.id)}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-purple-500 transition-colors">
                            {deal.title}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {deal.companyName} &middot; {formatCurrency(deal.value ?? 0, tenantCurrency)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); selectResult('/crm/deals', deal.id); }}
                            title="Open Deal"
                            className="p-1 text-slate-400 hover:text-purple-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                          >
                            <ExternalLink size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
