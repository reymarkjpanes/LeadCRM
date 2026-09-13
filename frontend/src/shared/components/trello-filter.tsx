'use client';

import React, { useState } from 'react';
import { Search, Filter, X, ChevronDown, Check, User as UserIcon, Calendar, Activity, Tag } from 'lucide-react';

export interface FilterOption {
  id: string;
  label: string;
  color?: string; // Tailwind color class or hex
  icon?: React.ReactNode;
}

export interface TrelloFilterProps {
  // Keyword
  searchTerm: string;
  setSearchTerm: (term: string) => void;

  currentUserEmail?: string;

  // Views (Single Select)
  viewsTitle?: string;
  views?: FilterOption[];
  selectedView?: string;
  setSelectedView?: (view: string) => void;

  // Members
  members?: FilterOption[];
  selectedMembers?: string[];
  setSelectedMembers?: (members: string[]) => void;

  // Statuses
  statuses?: FilterOption[];
  selectedStatuses?: string[];
  setSelectedStatuses?: (statuses: string[]) => void;

  // Due Dates or Channels
  labelsTitle?: string;
  labels?: FilterOption[];
  selectedLabels?: string[];
  setSelectedLabels?: (labels: string[]) => void;

  // Triggers / Events
  triggersTitle?: string;
  triggers?: FilterOption[];
  selectedTriggers?: string[];
  setSelectedTriggers?: (triggers: string[]) => void;
  
  // Custom Generic Array matching logic (e.g. Activity, Due Date block)
  matchType?: 'any' | 'exact';
  setMatchType?: (type: 'any' | 'exact') => void;
}

export function TrelloFilter({
  searchTerm,
  setSearchTerm,
  viewsTitle = "Smart Views",
  views = [],
  selectedView,
  setSelectedView,
  members = [],
  selectedMembers = [],
  setSelectedMembers,
  currentUserEmail = '',
  statuses = [],
  selectedStatuses = [],
  setSelectedStatuses,
  labelsTitle = "Labels",
  labels = [],
  selectedLabels = [],
  setSelectedLabels,
  triggersTitle = "Triggers",
  triggers = [],
  selectedTriggers = [],
  setSelectedTriggers,
  matchType = 'any',
  setMatchType
}: TrelloFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  const activeCount = 
    (searchTerm ? 1 : 0) + 
    selectedMembers.length + 
    selectedStatuses.length + 
    selectedLabels.length +
    selectedTriggers.length +
    (selectedView ? 1 : 0);

  const clearAll = () => {
    setSearchTerm('');
    setSelectedMembers?.([]);
    setSelectedStatuses?.([]);
    setSelectedLabels?.([]);
    setSelectedTriggers?.([]);
    setSelectedView?.('');
  };

  const toggleMember = (id: string) => {
    if (!setSelectedMembers) return;
    if (selectedMembers.includes(id)) {
      setSelectedMembers(selectedMembers.filter(m => m !== id));
    } else {
      setSelectedMembers([...selectedMembers, id]);
    }
  };

  const toggleStatus = (id: string) => {
    if (!setSelectedStatuses) return;
    if (selectedStatuses.includes(id)) {
      setSelectedStatuses(selectedStatuses.filter(s => s !== id));
    } else {
      setSelectedStatuses([...selectedStatuses, id]);
    }
  };

  const toggleLabel = (id: string) => {
    if (!setSelectedLabels) return;
    if (selectedLabels.includes(id)) {
      setSelectedLabels(selectedLabels.filter(l => l !== id));
    } else {
      setSelectedLabels([...selectedLabels, id]);
    }
  };

  const toggleTrigger = (id: string) => {
    if (!setSelectedTriggers) return;
    if (selectedTriggers.includes(id)) {
      setSelectedTriggers(selectedTriggers.filter(t => t !== id));
    } else {
      setSelectedTriggers([...selectedTriggers, id]);
    }
  };

  return (
    <div className="relative z-30 shrink-0 inline-flex items-center">
      {/* Trigger Button */}
      {/* We match the exact dark Trello style or standard style */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 h-9 min-h-[44px] px-3 text-xs font-medium rounded-md transition-colors border shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
          isOpen || activeCount > 0
            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/60'
            : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
        }`}
      >
        <Filter size={14} className={activeCount > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'} />
        <span>Filter</span>
        {activeCount > 0 && (
          <span className="flex items-center justify-center min-w-4.5 h-4.5 px-1 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 rounded-full text-[11px] font-semibold ml-0.5">
            {activeCount}
          </span>
        )}
        <ChevronDown size={13} className={`text-slate-400 transform transition-transform duration-200 ml-0.5 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Flyout/Popover */}
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)} 
          />
          <div className="absolute right-0 top-full mt-2 w-[calc(100vw-1rem)] max-w-[340px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-3.5 z-50 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <span className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Filters</span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close filters"
              >
                <X size={14} />
              </button>
            </div>


            <div className="space-y-5 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700 flex-1">
              
              {/* Keyword */}
              {setSearchTerm !== undefined && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Keyword</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search keywords..."
                      value={searchTerm || ''}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 text-sm font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 transition-colors"
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white bg-slate-200 dark:bg-slate-800 rounded-full p-0.5">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Smart View */}
              {views.length > 0 && selectedView && setSelectedView && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">{viewsTitle}</label>
                  <div className="space-y-1">
                    {views.map((v) => (
                      <div 
                        key={v.id}
                        onClick={() => setSelectedView(v.id)}
                        className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className={`flex items-center justify-center w-4 h-4 rounded-full border transition-colors ${selectedView === v.id ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${selectedView === v.id ? 'bg-white' : 'transparent'}`}></div>
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{v.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Members */}
              {members.length > 0 && selectedMembers && setSelectedMembers && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Members</label>
                  <div className="space-y-1">
                    <div 
                      onClick={() => toggleMember('unassigned')}
                      className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${selectedMembers.includes('unassigned') ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                        {selectedMembers.includes('unassigned') && <Check size={12} className="text-white stroke-[3px]" />}
                      </div>
                      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400">
                        <UserIcon size={13} />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">No members</span>
                    </div>

                    <div 
                      onClick={() => toggleMember('me')}
                      className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${selectedMembers.includes('me') ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                        {selectedMembers.includes('me') && <Check size={12} className="text-white stroke-[3px]" />}
                      </div>
                      <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold uppercase shadow-sm">
                        {currentUserEmail ? currentUserEmail.substring(0, 2) : 'ME'}
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Cards assigned to me</span>
                    </div>

                    {/* Member select dropdown matching screenshot 2 "Select members" */}
                    <div className="relative mt-2">
                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500/80 transition-all">
                        <details className="group/details" open={memberSearch.length > 0 ? true : undefined}>
                          <summary className="flex items-center justify-between w-full relative cursor-pointer list-none">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input 
                              type="text" 
                              placeholder="Search team members..."
                              value={memberSearch}
                              onChange={e => setMemberSearch(e.target.value)}
                              onClick={e => {
                                // Prevent default so clicking input to type doesn't close the dropdown
                                e.preventDefault();
                                const details = e.currentTarget.closest('details');
                                if (details && !details.open) {
                                  details.open = true;
                                }
                                e.currentTarget.focus();
                              }}
                              className="w-full pl-9 pr-8 py-2.5 text-sm bg-transparent border-none focus:outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 font-medium"
                            />
                            {memberSearch ? (
                               <button 
                                 type="button"
                                 onClick={(e) => { e.preventDefault(); setMemberSearch(''); }}
                                 className="absolute right-0 top-0 bottom-0 px-3 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                               >
                                 <X size={14} />
                               </button>
                            ) : (
                               <div className="absolute right-0 top-0 bottom-0 px-3 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer pointer-events-auto">
                                 <ChevronDown size={15} className="transform group-open/details:rotate-180 transition-transform" />
                               </div>
                            )}
                          </summary>
                          <div className="border-t border-slate-200 dark:border-slate-800 p-2 space-y-0.5 max-h-48 overflow-y-auto bg-white dark:bg-slate-900 relative">
                            {members.filter(m => m.label.toLowerCase().includes(memberSearch.toLowerCase())).length > 0 ? (
                              members.filter(m => m.label.toLowerCase().includes(memberSearch.toLowerCase())).map(m => (
                                <div 
                                  key={m.id}
                                  onClick={() => toggleMember(m.id)}
                                  className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                                >
                                  <div className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors ${selectedMembers.includes(m.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                                    {selectedMembers.includes(m.id) && <Check size={12} className="text-white stroke-[3px]" />}
                                  </div>
                                  <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                                    {m.icon || m.label.substring(0, 2)}
                                  </div>
                                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{m.label}</span>
                                </div>
                              ))
                            ) : (
                              <div className="py-4 text-center text-xs text-slate-500 font-medium">
                                No members found
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Statuses / Card status */}
              {statuses.length > 0 && selectedStatuses && setSelectedStatuses && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Status</label>
                  <div className="space-y-1">
                    {statuses.map((st) => (
                      <div 
                        key={st.id}
                        onClick={() => toggleStatus(st.id)}
                        className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${selectedStatuses.includes(st.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                          {selectedStatuses.includes(st.id) && <Check size={12} className="text-white stroke-[3px]" />}
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{st.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Due Date / Labels */}
              {labels.length > 0 && selectedLabels && setSelectedLabels && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">{labelsTitle}</label>
                  <div className="space-y-1">
                    <div 
                      onClick={() => toggleLabel('none')}
                      className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${selectedLabels.includes('none') ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                        {selectedLabels.includes('none') && <Check size={12} className="text-white stroke-[3px]" />}
                      </div>
                      <div className="w-7 h-7 flex items-center justify-center text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg">
                         <Tag size={13} />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">No {labelsTitle.toLowerCase()}</span>
                    </div>

                    {labels.map((l) => (
                      <div 
                        key={l.id}
                        onClick={() => toggleLabel(l.id)}
                        className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${selectedLabels.includes(l.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                          {selectedLabels.includes(l.id) && <Check size={12} className="text-white stroke-[3px]" />}
                        </div>
                        {l.color ? (
                           <div className={`w-auto min-w-25 inline-flex h-7 rounded-lg ml-1 items-center px-3 ${l.color}`}>
                             <span className="text-xs font-bold text-white drop-shadow-sm">{l.label}</span>
                           </div>
                        ) : (
                           <>
                             {l.icon && <div className="text-slate-400">{l.icon}</div>}
                             <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{l.label}</span>
                           </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Triggers / Events */}
              {triggers.length > 0 && selectedTriggers && setSelectedTriggers && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">{triggersTitle}</label>
                  <div className="space-y-1">
                    {triggers.map((tr) => (
                      <div 
                        key={tr.id}
                        onClick={() => toggleTrigger(tr.id)}
                        className="flex items-center gap-3 p-1.5 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${selectedTriggers.includes(tr.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-slate-400'}`}>
                          {selectedTriggers.includes(tr.id) && <Check size={12} className="text-white stroke-[3px]" />}
                        </div>
                        {tr.icon && <div className="text-slate-400">{tr.icon}</div>}
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{tr.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Match Strategy */}
              {setMatchType && (
                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                   <select 
                     value={matchType}
                     onChange={(e) => setMatchType(e.target.value as 'any' | 'exact')}
                     className="w-full text-sm font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                   >
                     <option value="any">Match any selected</option>
                     <option value="exact">Match all selected</option>
                   </select>
                </div>
              )}
            </div>
            
            {activeCount > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{activeCount} applied</span>
                <button
                  onClick={clearAll}
                  className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
