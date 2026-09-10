'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Mail, Phone, ExternalLink, X, ChevronDown, User, Building, Briefcase, Target, Tag } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { getTenantCurrency, formatCurrency } from '@/shared/utils/currency';

type ScopedModule = 'all' | 'leads' | 'contacts' | 'accounts' | 'deals';

export function GlobalOmnibox() {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState<ScopedModule>('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { contacts, deals, organizations } = useData();
  const { tenant } = useAuth();
  const debouncedQuery = useDebounce(query, 300);

  // Derives the tenant's configured currency for deal value display in search results.
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

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

  // 2. Real-time Categorized Filter (Min 3 characters)
  const isTagSearch = debouncedQuery.startsWith('#');
  const cleanQuery = isTagSearch ? debouncedQuery.slice(1).trim().toLowerCase() : debouncedQuery.trim().toLowerCase();

  const results = useMemo(() => {
    if (cleanQuery.length < 3) return { leads: [], contacts: [], accounts: [], deals: [] };

    const leadsRes = (module === 'all' || module === 'leads')
      ? contacts.filter(c => !c.isArchived && c.recordType !== 'Organization' && (
          isTagSearch
            ? (c.leadSource ?? '').toLowerCase().includes(cleanQuery) || (c.customerType ?? '').toLowerCase().includes(cleanQuery)
            : (c.leadPerson ?? c.displayName ?? '').toLowerCase().includes(cleanQuery) ||
              (c.email ?? '').toLowerCase().includes(cleanQuery) ||
              (c.companyName ?? '').toLowerCase().includes(cleanQuery)
        )).slice(0, 4)
      : [];

    const contactsRes = (module === 'all' || module === 'contacts')
      ? contacts.filter(c => !c.isArchived && (
          isTagSearch
            ? (c.customerType ?? '').toLowerCase().includes(cleanQuery)
            : (c.contactPerson ?? c.firstName ?? '').toLowerCase().includes(cleanQuery) ||
              (c.email ?? '').toLowerCase().includes(cleanQuery)
        )).slice(0, 4)
      : [];

    const accountsRes = (module === 'all' || module === 'accounts')
      ? organizations.filter(o => !o.isArchived && (
          isTagSearch
            ? (o.industry ?? '').toLowerCase().includes(cleanQuery)
            : o.name.toLowerCase().includes(cleanQuery) || (o.industry ?? '').toLowerCase().includes(cleanQuery)
        )).slice(0, 4)
      : [];

    const dealsRes = (module === 'all' || module === 'deals')
      ? deals.filter(d => !d.isArchived && (
          isTagSearch
            ? (d.priority ?? '').toLowerCase().includes(cleanQuery) || (d.leadSource ?? '').toLowerCase().includes(cleanQuery)
            : d.title.toLowerCase().includes(cleanQuery) || d.companyName.toLowerCase().includes(cleanQuery)
        )).slice(0, 4)
      : [];

    return { leads: leadsRes, contacts: contactsRes, accounts: accountsRes, deals: dealsRes };
  }, [cleanQuery, isTagSearch, module, contacts, deals, organizations]);

  const totalResults = results.leads.length + results.contacts.length + results.accounts.length + results.deals.length;
  const showResults = isFocused && cleanQuery.length >= 3;

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
        <div className="relative flex-1 flex items-center h-full">
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
            className="w-full h-full pl-8 pr-8 text-[12px] bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
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
              No matching records found for &ldquo;{cleanQuery}&rdquo;.
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
                        onClick={() => { router.push(`/leads?search=${encodeURIComponent(lead.leadPerson ?? lead.displayName ?? '')}`); setIsDropdownOpen(false); }}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-blue-500 transition-colors">
                            {lead.leadPerson ?? lead.displayName}
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
                            onClick={(e) => { e.stopPropagation(); router.push('/leads'); setIsDropdownOpen(false); }}
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
                        onClick={() => { router.push(`/contacts?search=${encodeURIComponent(contact.contactPerson ?? contact.firstName ?? '')}`); setIsDropdownOpen(false); }}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-teal-500 transition-colors">
                            {contact.contactPerson ?? contact.firstName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {contact.customerType ?? 'Prospect'} &middot; {contact.email ?? 'No email'}
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
                        onClick={() => { router.push(`/accounts?search=${encodeURIComponent(account.name)}`); setIsDropdownOpen(false); }}
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
                            onClick={(e) => { e.stopPropagation(); router.push('/accounts'); setIsDropdownOpen(false); }}
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
                        onClick={() => { router.push(`/pipeline?search=${encodeURIComponent(deal.title)}`); setIsDropdownOpen(false); }}
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
                            onClick={(e) => { e.stopPropagation(); router.push('/pipeline'); setIsDropdownOpen(false); }}
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
