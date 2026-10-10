import { LEAD_SOURCES } from '@leadcrm/shared';
import React from 'react';
import { Search, X, User, Briefcase } from 'lucide-react';
import { TrelloFilter, FilterOption } from '@/shared/components/trello-filter';
import { getAssignableAgents } from '@/shared/utils/assigned-agents';

interface FilterProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  customerTypeFilter: 'All' | 'Individual' | 'Organization';
  setCustomerTypeFilter: (type: 'All' | 'Individual' | 'Organization') => void;
  selectedStatuses: string[];
  setSelectedStatuses: (statuses: string[]) => void;
  selectedOwners: string[];
  setSelectedOwners: (owners: string[]) => void;
  selectedSources: string[];
  setSelectedSources: (sources: string[]) => void;
  usersList: any[];
  currentUserEmail: string;
  smartView?: string;
  setSmartView?: (view: string) => void;
  actions?: React.ReactNode;
}

export function ClientFilters({
  searchTerm, 
  setSearchTerm, 
  customerTypeFilter,
  setCustomerTypeFilter,
  selectedStatuses,
  setSelectedStatuses,
  selectedOwners,
  setSelectedOwners,
  selectedSources,
  setSelectedSources,
  usersList,
  currentUserEmail,
  smartView = 'All Profiles',
  setSmartView,
  actions
 }: FilterProps) {

  const clearFilters = () => {
    setSearchTerm('');
    setCustomerTypeFilter('All');
    setSelectedStatuses([]);
    setSelectedOwners([]);
    setSelectedSources([]);
    if (setSmartView) setSmartView('All Profiles');
  };

  const activeStatusesCount = selectedStatuses.length;
  const activeOwnersCount = selectedOwners.length;
  const activeSourcesCount = selectedSources.length;
  const activeTypeCount = customerTypeFilter !== 'All' ? 1 : 0;
  const activeSmartViewCount = smartView !== 'All Profiles' ? 1 : 0;
  const activeTermCount = searchTerm ? 1 : 0;
  const activeFilterCount = activeStatusesCount + activeOwnersCount + activeSourcesCount + activeTypeCount + activeTermCount + activeSmartViewCount;

  const viewOptions: FilterOption[] = ['All Profiles', 'Leads', 'Individual Profiles', 'Organization Profiles', 'Archived'].map(v => ({
    id: v,
    label: v
  }));

  const statusOptions: FilterOption[] = ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled'].map(st => ({
    id: st,
    label: st
  }));

  const sourceOptions: FilterOption[] = LEAD_SOURCES.map(src => ({
    id: src,
    label: src
  }));

  const memberOptions: FilterOption[] = getAssignableAgents(usersList).map(u => ({
    id: u.id,
    label: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
    icon: (u.firstName?.[0] || u.email?.[0] || '?').toUpperCase()
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2.5 items-center justify-between w-full">
        {/* Left: Search input & Filter popover paired */}
        <div className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-xl">
          <div className="relative flex-1 max-w-xs sm:max-w-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={14} />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search leads by name, email, company..."
              className="w-full h-9 pl-9 pr-8 text-xs font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md shadow-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="shrink-0">
            <TrelloFilter
              searchTerm=""
              setSearchTerm={() => {}}
              views={viewOptions}
              selectedView={smartView}
              setSelectedView={setSmartView}
              members={memberOptions}
              selectedMembers={selectedOwners}
              setSelectedMembers={setSelectedOwners}
              currentUserEmail={currentUserEmail}
              statuses={statusOptions}
              selectedStatuses={selectedStatuses}
              setSelectedStatuses={setSelectedStatuses}
              labelsTitle="Lead Source"
              labels={sourceOptions}
              selectedLabels={selectedSources}
              setSelectedLabels={setSelectedSources}
            />
          </div>
        </div>

        {/* Right: Primary Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          {actions}
        </div>
      </div>
      
      {/* Active Filter Chips Row */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1 uppercase tracking-wider">Active Filters:</span>
          
          {smartView && smartView !== 'All Profiles' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/30 text-xs font-medium text-blue-700 dark:text-blue-400">
              View: {smartView}
              {setSmartView && <button onClick={() => setSmartView('All Profiles')} className="hover:text-red-500 dark:hover:text-red-400 ml-0.5"><X size={12} /></button>}
            </span>
          )}

          {searchTerm && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300">
              <Search size={12} className="text-slate-400" />
              "{searchTerm}"
              <button onClick={() => setSearchTerm('')} className="hover:text-red-500 dark:hover:text-red-400 ml-0.5"><X size={12} /></button>
            </span>
          )}
          
          {selectedStatuses.map(status => (
            <span key={`status-${status}`} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-xs font-medium text-blue-700 dark:text-blue-400">
              Status: {status}
              <button onClick={() => setSelectedStatuses(selectedStatuses.filter(s => s !== status))} className="hover:text-red-500 dark:hover:text-red-400 ml-0.5"><X size={12} /></button>
            </span>
          ))}
          
          {selectedOwners.map(ownerId => {
            const owner = memberOptions.find(m => m.id === ownerId);
            return (
              <span key={`owner-${ownerId}`} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 text-xs font-medium text-purple-700 dark:text-purple-400">
                <User size={12} className="text-purple-400" />
                {owner ? owner.label : ownerId}
                <button onClick={() => setSelectedOwners(selectedOwners.filter(o => o !== ownerId))} className="hover:text-red-500 dark:hover:text-red-400 ml-0.5"><X size={12} /></button>
              </span>
            );
          })}
          
          {selectedSources.map(source => (
            <span key={`source-${source}`} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs font-medium text-amber-700 dark:text-amber-400">
              Source: {source}
              <button onClick={() => setSelectedSources(selectedSources.filter(s => s !== source))} className="hover:text-red-500 dark:hover:text-red-400 ml-0.5"><X size={12} /></button>
            </span>
          ))}

          {activeFilterCount > 1 && (
            <button
              onClick={clearFilters}
              className="px-2 py-1 ml-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  );
}
