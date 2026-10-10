'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Building, Plus, Search, X, ChevronsUpDown, Check } from 'lucide-react';
import { Organization } from '@/store/types';

interface OrganizationComboboxProps {
  organizations: Organization[];
  value: string;
  companyName?: string;
  onChange: (orgId: string, orgName: string) => void;
  onCreateNew?: (name: string) => void;
}

export function OrganizationCombobox({ organizations, value, companyName, onChange, onCreateNew }: OrganizationComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOrg = organizations.find((o) => o.id === value);
  const isTempNew = value === 'NEW_TEMP';
  const displayName = isTempNew && companyName
    ? `New Organization: ${companyName}`
    : selectedOrg 
      ? selectedOrg.name 
      : "Select Organization...";
  const hasSelection = !!(selectedOrg || isTempNew);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
    } else if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOrgs = organizations.filter((org) => 
    org.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exactMatch = filteredOrgs.some((org) => org.name.toLowerCase() === searchTerm.toLowerCase());

  // Handle keyboard interaction to open
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {!isOpen ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full relative pl-9 pr-10 bg-slate-50 hover:bg-slate-100/75 dark:bg-slate-800/50 border border-gray-200 dark:border-white/10 rounded-lg py-2 text-sm text-left transition-all outline-none focus:ring-2 focus:ring-primary flex items-center justify-between cursor-pointer group"
        >
          <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-300 transition-colors" size={16} />
          <span className={hasSelection ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-500"}>
            {displayName}
          </span>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {hasSelection && (
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('', '');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                title="Clear selection"
              >
                <X size={14} />
              </button>
            )}
            <ChevronsUpDown size={15} className="text-slate-400 group-hover:text-slate-500 transition-colors" />
          </div>
        </div>
      ) : (
        <div className="relative w-full flex items-center">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            ref={inputRef}
            type="text"
            className="w-full pl-9 pr-10 bg-white dark:bg-slate-900 border-2 border-primary rounded-xl py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none shadow-sm transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsOpen(false);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredOrgs.length > 0) {
                  const bestMatch = filteredOrgs.find(org => org.name.toLowerCase() === searchTerm.toLowerCase()) || filteredOrgs[0];
                  onChange(bestMatch.id, bestMatch.name);
                  setIsOpen(false);
                } else if (searchTerm.trim() && onCreateNew) {
                  onCreateNew(searchTerm);
                  setIsOpen(false);
                }
              }
            }}
            placeholder="Type to search organizations or create new..."
          />
          <button 
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden max-h-64 overflow-y-auto transform origin-top transition-all duration-150 py-1">
          {filteredOrgs.length > 0 && (
            <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider dark:text-slate-500">
              Suggested Options
            </div>
          )}
          
          {filteredOrgs.length > 0 ? (
            <div className="divide-y divide-slate-50 dark:divide-white/5">
              {filteredOrgs.map((org) => {
                const isSelected = org.id === value;
                return (
                  <button
                    key={org.id}
                    type="button"
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between outline-none transition-all ${
                      isSelected
                        ? "bg-blue-50/50 text-primary dark:bg-blue-900/10 dark:text-primary font-semibold"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:bg-slate-50 dark:focus:bg-slate-800/50"
                    }`}
                    onClick={() => {
                      onChange(org.id, org.name);
                      setIsOpen(false);
                    }}
                  >
                    <div className="flex flex-col items-start gap-0.5">
                      <span className={isSelected ? "font-semibold" : "font-medium"}>{org.name}</span>
                      {(org.industry || org.website) && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                          {org.industry}{org.industry && org.website ? ' · ' : ''}{org.website}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={16} className="shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-5 text-sm text-slate-400 dark:text-slate-500 text-center flex flex-col items-center justify-center gap-1">
              <span>No matching organizations found.</span>
            </div>
          )}

          {searchTerm && !exactMatch && onCreateNew && (
            <div className="p-1.5 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] sticky bottom-0">
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-primary dark:text-primary font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all active:scale-[0.99] border border-blue-100 dark:border-blue-900/30"
                onClick={() => {
                  onCreateNew(searchTerm);
                  setIsOpen(false);
                }}
              >
                <Plus size={16} className="animate-pulse" />
                <span>Create Organization "{searchTerm}"</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { OrganizationCombobox as OrganizationSelector };

