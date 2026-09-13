'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, Users, Briefcase, LayoutDashboard, Workflow, Mail, Settings, ShieldAlert, Receipt, Activity, Book } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { useAuth } from '../../store/AuthContext';

interface CommandPaletteProps {
  navigate: (path: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function CommandPalette({ navigate, isOpen, setIsOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const { contacts, deals, isBillingModuleEnabled, roles } = useData();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const userRoleDef = roles.find(r => r.name === user?.role);
  const userPermissions = userRoleDef?.permissions || [];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const navItems = [
    { name: 'Dashboard', path: 'dashboard', icon: LayoutDashboard, permissions: ['p1'] },
    { name: 'Client Profiles', path: 'contacts', icon: Users, permissions: ['contacts.view', 'p2', 'p2_own'] },
    { name: 'Leads', path: 'leads', icon: Users, permissions: ['contacts.view', 'p2', 'p2_own'] },
    { name: 'Accounts', path: 'accounts', icon: Users, permissions: ['accounts.view', 'p2', 'p2_own'] },
    { name: 'Deals', path: 'deals', icon: Briefcase, permissions: ['deals.view', 'p7', 'p7_own'] },
    { name: 'Contract Billing', path: 'billing', icon: Receipt, permissions: ['billing.view', 'p29'], enabled: isBillingModuleEnabled },
    { name: 'Workflows', path: 'workflows', icon: Workflow, permissions: ['workflows.view', 'p12'] },
    { name: 'Campaigns', path: 'campaigns', icon: Mail, permissions: ['campaigns.view', 'p17'] },
    { name: 'Users', path: 'users', icon: Users, permissions: ['users.view', 'p22'] },
    { name: 'Settings', path: 'settings', icon: Settings, permissions: ['settings.view', 'p27'] },
    { name: 'Audit Trail', path: 'audit-log', icon: Activity, permissions: ['audit.view', 'p30'] },
    { name: 'Admin Console', path: 'admin', icon: ShieldAlert, roles: ['System Admin'] },
  ];

  const hasAccess = (item: any) => {
    if (user?.role?.toLowerCase() === 'system admin') return ['Dashboard', 'Users', 'Settings', 'Admin Console', 'Audit Trail'].includes(item.name);
    if (item.name === 'Admin Console') return false;
    if (user?.role?.toLowerCase() === 'client admin') return true;
    if (user?.role?.toLowerCase() === 'guest') return ['Dashboard', 'Leads', 'Pipeline', 'Workflows', 'Campaigns'].includes(item.name);
    if (item.roles && item.roles.some((r: string) => r.toLowerCase() === user?.role?.toLowerCase())) return true;
    if (item.permissions && item.permissions.some((p: string) => userPermissions.includes(p))) return true;
    return false;
  };

  const filteredNav = navItems.filter(item => 
    hasAccess(item) && 
    (item.enabled === undefined || item.enabled === true) &&
    item.name.toLowerCase().includes(query.toLowerCase())
  );

  const filteredLeads = contacts.filter(l => 
    (l.companyName ?? '').toLowerCase().includes(query.toLowerCase()) || 
    (l.contactPerson ?? '').toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);

  const filteredDeals = deals.filter(d => 
    d.title.toLowerCase().includes(query.toLowerCase()) || 
    d.companyName.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);

  const handleSelect = (path: string) => {
    navigate(path);
    setIsOpen(false);
  };

  return (
    <div className="fixed inset-0 z-100 flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-950 border border-gray-300 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        <div className="flex items-center px-4 py-4 border-b border-gray-200 dark:border-white/5">
          <Search className="text-slate-500 dark:text-slate-400 mr-3" size={20} />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none text-lg"
            placeholder="Search contacts, deals, or navigate..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="text-xs text-slate-500 font-mono bg-gray-50 dark:bg-white/5 px-2 py-1 rounded border border-gray-300 dark:border-white/10">ESC</div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {query === '' && (
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Quick Navigation</div>
          )}
          
          {filteredNav.length > 0 && (
            <div className="mb-4">
              {query !== '' && <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Navigation</div>}
              {filteredNav.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleSelect(item.path)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/4 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-left"
                  >
                    <Icon size={18} className="text-slate-500 dark:text-slate-400" />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {query !== '' && filteredLeads.length > 0 && (
            <div className="mb-4">
              <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Leads</div>
              {filteredLeads.map(contact => (
                <button
                  key={contact.id}
                  onClick={() => handleSelect('contacts')}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/4 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-left"
                >
                  <Users size={18} className="text-blue-400" />
                  <div>
                    <div className="font-medium">{contact.companyName}</div>
                    <div className="text-xs text-slate-500">{contact.contactPerson}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {query !== '' && filteredDeals.length > 0 && (
            <div className="mb-4">
              <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Deals</div>
              {filteredDeals.map(deal => (
                <button
                  key={deal.id}
                  onClick={() => handleSelect('pipeline')}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/4 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-left"
                >
                  <Briefcase size={18} className="text-purple-400" />
                  <div>
                    <div className="font-medium">{deal.title}</div>
                    <div className="text-xs text-slate-500">{deal.companyName} • ${deal.value.toLocaleString()}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {query !== '' && filteredNav.length === 0 && filteredLeads.length === 0 && filteredDeals.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500">
              No results found for "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
