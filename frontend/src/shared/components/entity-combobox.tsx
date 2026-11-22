'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, X, ChevronsUpDown, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { ThemedPortal } from '@/shared/components/theme-scope';
import { cn } from '@/lib/utils';
import { useData } from '@/store/DataContext';
import { getAssignableAgents } from '@/shared/utils/assigned-agents';
import { useAuth } from '@/store/AuthContext';
import { USE_MOCK_DATA } from '@/lib/config';
import { leadsService } from '@/features/tenant/crm/leads/services/leads.service';
import { accountsService } from '@/features/tenant/crm/accounts/services/accounts.service';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import type { Organization, Contact, User, Pipeline, Stage, Lead } from '@/store/types';
import { Input } from '@/shared/components/ui/input';

// ─── Types ─────────────────────────────────────────────────────────────────

export type EntityType = 'accounts' | 'contacts' | 'leads' | 'users' | 'pipelines' | 'stages';

export interface EntityOption {
  id: string;
  label: string;
  sublabel?: string;
  group?: string;
}

interface EntityOptionSource {
  load: (search: string, signal: AbortSignal) => Promise<EntityOption[]>;
  selected?: EntityOption;
  addOption?: (search: string, options: EntityOption[]) => EntityOption | undefined;
  label: string;
  maxSearchLength?: number;
}

interface EntityComboboxBaseProps {
  id?: string;
  'aria-labelledby'?: string;
  'aria-required'?: React.AriaAttributes['aria-required'];
  /** Entity type for data fetching */
  entityType: EntityType;
  /** Placeholder text */
  placeholder?: string;
  /** Minimum characters before search triggers (default 2) */
  minSearchChars?: number;
  /** Debounce delay in ms (default 300) */
  debounceMs?: number;
  /** Error state message */
  error?: string;
  /** Disabled state */
  disabled?: boolean;
  /** For stages: filter by pipelineId */
  pipelineId?: string;
  /** For user assignment: modules the assignee must be eligible to own. */
  assignmentModules?: readonly string[];
  /** Optional className */
  className?: string;
}

interface SingleSelectProps extends EntityComboboxBaseProps {
  multiple?: false;
  /** Current selected value (ID) */
  value: string | null;
  /** Change handler */
  onChange: (id: string | null, option?: EntityOption) => void;
  optionSource?: EntityOptionSource;
  values?: never;
  onMultiChange?: never;
}

interface MultiSelectProps extends EntityComboboxBaseProps {
  multiple: true;
  /** Selected values for multi-select */
  values: string[];
  /** Multi-select change handler */
  onMultiChange: (ids: string[]) => void;
  value?: never;
  onChange?: never;
  optionSource?: never;
}

export type EntityComboboxProps = SingleSelectProps | MultiSelectProps;

// ─── Helpers ───────────────────────────────────────────────────────────────

const MAX_RESULTS = 50;
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_SEARCH_CHARS = 2;

function getDisplayName(entity: Organization | Contact | User | Pipeline | Stage | Lead, entityType: EntityType): string {
  switch (entityType) {
    case 'accounts':
      return (entity as Organization).name;
    case 'contacts': {
      const contact = entity as Contact;
      const parts = [contact.firstName, contact.lastName].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : contact.email || contact.contactPerson || 'Unknown';
    }
    case 'leads': {
      const lead = entity as Lead;
      const parts = [lead.firstName, lead.lastName].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : lead.email || 'Unknown Lead';
    }
    case 'users': {
      const user = entity as User;
      return `${user.firstName} ${user.lastName}`.trim() || user.email;
    }
    case 'pipelines':
      return (entity as Pipeline).name;
    case 'stages':
      return (entity as Stage).name;
    default:
      return '';
  }
}

function getSublabel(entity: Organization | Contact | User | Pipeline | Stage | Lead, entityType: EntityType): string | undefined {
  switch (entityType) {
    case 'accounts': {
      const org = entity as Organization;
      return org.industry || undefined;
    }
    case 'contacts': {
      const contact = entity as Contact;
      return contact.email || undefined;
    }
    case 'leads': {
      const lead = entity as Lead;
      return lead.email || lead.companyName || undefined;
    }
    case 'users': {
      const user = entity as User;
      return user.email;
    }
    case 'pipelines':
      return undefined;
    case 'stages':
      return undefined;
    default:
      return undefined;
  }
}

function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function EntityCombobox(props: EntityComboboxProps): React.ReactElement {
  const errorId = React.useId();
  const listId = React.useId();
  const [position, setPosition] = useState({ top: 0, left: 8, width: 200, maxHeight: 256 });
  const {
    entityType,
    placeholder,
    minSearchChars = DEFAULT_MIN_SEARCH_CHARS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    error,
    disabled = false,
    pipelineId,
    assignmentModules,
    className,
    multiple = false,
    optionSource,
  } = props;
  const loadOptions = optionSource?.load;

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [settledSearch, setSettledSearch] = useState<string | null>(null);
  const [remoteOptions, setRemoteOptions] = useState<EntityOption[]>([]);
  const [knownOptions, setKnownOptions] = useState<Record<string, EntityOption>>({});
  const requestVersion = useRef(0);
  const { user } = useAuth();
  const useServer = !!loadOptions || !USE_MOCK_DATA && ['accounts', 'contacts', 'leads'].includes(entityType);
  const selectedIds: string[] = props.multiple ? props.values : props.value ? [props.value] : [];
  const selectionKey = JSON.stringify(selectedIds);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const debouncedSearch = useDebounce(searchTerm, debounceMs);

  // Access data from DataContext
  const dataContext = useData();

  // Retry mechanism for data load errors
  const handleRetry = useCallback((): void => {
    setLoadError(null);
    setSettledSearch(null);
    setRetry(value => value + 1);
  }, []);

  // Get the raw entity list from DataContext
  const rawEntities = useMemo((): EntityOption[] => {
    if (loadOptions) return [];
    try {
      let entities: Array<Organization | Contact | User | Pipeline | Stage> = [];

      switch (entityType) {
        case 'accounts':
          entities = dataContext.organizations;
          break;
        case 'contacts':
          entities = USE_MOCK_DATA ? dataContext.contacts : [];
          break;
        case 'leads':
          entities = dataContext.contacts; // Leads are stored as 'contacts' in DataContext
          break;
        case 'users':
          entities = getAssignableAgents(dataContext.users, assignmentModules);
          break;
        case 'pipelines':
          entities = dataContext.pipelines;
          break;
        case 'stages': {
          if (pipelineId) {
            const pipeline = dataContext.pipelines.find((p) => p.id === pipelineId);
            entities = pipeline?.stages || [];
          } else {
            // Return all stages from all pipelines
            entities = dataContext.pipelines.flatMap((p) => p.stages || []);
          }
          break;
        }
      }

      return entities.filter(entity => !('isArchived' in entity) || !entity.isArchived).map((entity) => ({
        id: entity.id,
        label: getDisplayName(entity, entityType),
        sublabel: getSublabel(entity, entityType),
      }));
    } catch {
      setLoadError('Failed to load data. Please try again.');
      return [];
    }
  }, [dataContext, entityType, pipelineId, assignmentModules, loadOptions]);

  useEffect(() => {
    setRemoteOptions([]); setKnownOptions({}); setLoadError(null);
    setSettledSearch(null);
    return () => { requestVersion.current++; };
  }, [user?.id, user?.tenantId, entityType, loadOptions]);

  useEffect(() => {
    if (!useServer || !isOpen || searchTerm.trim() !== debouncedSearch.trim()) return;
    const version = ++requestVersion.current, controller = new AbortController();
    const term = debouncedSearch.trim();
    setLoading(true); setLoadError(null);
    const query = { search: term.length >= minSearchChars ? term : '', limit: MAX_RESULTS };
    const entityRequest = () => entityType === 'leads' ? leadsService.getAll(query, controller.signal)
      : entityType === 'contacts' ? contactsV2Api.list(query, controller.signal)
      : accountsService.getAll(query, controller.signal);
    const request = loadOptions ? loadOptions(query.search, controller.signal)
      : entityRequest().then(response => response.data.filter(entity => !entity.isArchived).map(entity => ({
        id: entity.id, label: getDisplayName(entity, entityType), sublabel: getSublabel(entity, entityType),
      })));
    void request.then(options => {
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setRemoteOptions(options);
      if (!loadOptions) setKnownOptions(previous => ({ ...previous, ...Object.fromEntries(options.map(option => [option.id, option])) }));
    }).catch(error => {
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setRemoteOptions([]); setLoadError(error instanceof Error ? error.message : 'Unable to load options.');
    }).finally(() => {
      if (version !== requestVersion.current) return;
      setLoading(false);
      if (loadOptions) setSettledSearch(term);
    });
    return () => { controller.abort(); requestVersion.current++; };
  }, [useServer, loadOptions, isOpen, debouncedSearch, searchTerm, minSearchChars, entityType, user?.id, user?.tenantId, retry]);

  // A saved association may be beyond the first page and must retain its label.
  useEffect(() => {
    if (!useServer || loadOptions) return;
    let active = true;
    const ids: string[] = JSON.parse(selectionKey);
    void Promise.allSettled(ids.map(async id => {
      const response = entityType === 'leads' ? await leadsService.getById(id)
        : entityType === 'contacts' ? await contactsV2Api.get(id) : await accountsService.getById(id);
      return { id, label: getDisplayName(response.data, entityType), sublabel: getSublabel(response.data, entityType) };
    })).then(results => {
      if (!active) return;
      setKnownOptions(previous => ({ ...previous, ...Object.fromEntries(results.flatMap(result => result.status === 'fulfilled' ? [[result.value.id, result.value]] : [])) }));
    });
    return () => { active = false; };
  }, [useServer, loadOptions, selectionKey, entityType, user?.id, user?.tenantId]);

  // Filter entities based on debounced search
  const filteredOptions = useMemo((): EntityOption[] => {
    if (useServer) return remoteOptions;
    const term = debouncedSearch.trim();
    if (term.length < minSearchChars) {
      return entityType === 'users' ? rawEntities : rawEntities.slice(0, MAX_RESULTS);
    }

    const terms = term.toLowerCase().split(/\s+/);
    const matches = rawEntities.filter(option => terms.every(term => [option.label, option.sublabel].filter(Boolean).join(' ').toLowerCase().includes(term)));
    return entityType === 'users' ? matches : matches.slice(0, MAX_RESULTS);
  }, [rawEntities, debouncedSearch, minSearchChars, entityType, useServer, remoteOptions]);

  // Determine if "No results found" should show
  const searchPending = loading || (!!loadOptions && settledSearch !== searchTerm.trim());
  const addOption = searchPending ? undefined : optionSource?.addOption?.(searchTerm, filteredOptions);
  const canAdd = !!addOption;
  const showNoResults = filteredOptions.length === 0 && !addOption && !loadError && !searchPending;
  const groups = new Map<string | undefined, EntityOption[]>();
  for (const option of filteredOptions) {
    const group = groups.get(option.group);
    if (group) group.push(option);
    else groups.set(option.group, [option]);
  }

  const selectedOptions = useMemo((): EntityOption[] => {
    const options = new Map([...(useServer ? [] : rawEntities), ...Object.values(knownOptions)].map(option => [option.id, option]));
    if (optionSource?.selected) options.set(optionSource.selected.id, optionSource.selected);
    return selectedIds.flatMap(id => options.get(id) ? [options.get(id)!] : []);
  }, [rawEntities, knownOptions, selectionKey, useServer, optionSource?.selected]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node) && !listRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useLayoutEffect(() => {
    if (!isOpen) return;
    const align = () => {
      const anchor = inputRef.current ?? wrapperRef.current;
      const rect = anchor?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const offsetTop = viewport?.offsetTop ?? 0, offsetLeft = viewport?.offsetLeft ?? 0;
      const width = Math.max(0, Math.min(rect.width, viewportWidth - 16));
      const below = height + offsetTop - rect.bottom - 14, above = rect.top - offsetTop - 14;
      const useAbove = below < 180 && above > below;
      const maxHeight = Math.max(0, Math.min(256, height - 16, Math.max(40, useAbove ? above : below)));
      const actualHeight = Math.min(listRef.current?.scrollHeight ?? maxHeight, maxHeight);
      const desiredTop = useAbove ? rect.top - actualHeight - 6 : rect.bottom + 6;
      // The anchor can leave the visible area as a mobile keyboard opens.
      // Clamp both popup edges even while the drawer adjusts its scroll position.
      setPosition({
        left: Math.max(offsetLeft + 8, Math.min(rect.left, offsetLeft + viewportWidth - width - 8)), width,
        top: Math.max(offsetTop + 8, Math.min(desiredTop, offsetTop + height - actualHeight - 8)), maxHeight,
      });
    };
    const resize = () => {
      if (inputRef.current === document.activeElement) inputRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      align();
    };
    align();
    window.addEventListener('resize', resize); window.addEventListener('scroll', align, true);
    window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', align);
    return () => {
      window.removeEventListener('resize', resize); window.removeEventListener('scroll', align, true);
      window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', align);
    };
  }, [isOpen, filteredOptions.length, loadError, searchPending, canAdd]);
  const returnFocus = () => requestAnimationFrame(() => wrapperRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true }));

  // Focus search input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setSearchTerm('');
      if (loadOptions) { setSettledSearch(null); setRemoteOptions([]); setLoadError(null); }
    }
  }, [isOpen, loadOptions]);

  // Event handlers
  const handleSelect = useCallback((option: EntityOption): void => {
    const optionId = option.id;
    if (props.multiple) {
      const currentValues = props.values;
      if (currentValues.includes(optionId)) {
        props.onMultiChange(currentValues.filter((id) => id !== optionId));
      } else {
        props.onMultiChange([...currentValues, optionId]);
      }
    } else {
      if (props.optionSource) props.onChange(optionId, option);
      else props.onChange(optionId);
      setIsOpen(false); returnFocus();
    }
  }, [props]);

  const handleRemove = useCallback((optionId: string): void => {
    if (props.multiple) {
      props.onMultiChange(props.values.filter((id) => id !== optionId));
    } else {
      props.onChange(null);
    }
  }, [props]);

  const handleClear = useCallback((): void => {
    if (props.multiple) {
      props.onMultiChange([]);
    } else {
      props.onChange(null);
    }
  }, [props]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!disabled) setIsOpen(true);
    }
  }, [disabled]);

  const handleSearchKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setIsOpen(false); returnFocus(); return; }
    if (optionSource && e.key === 'Enter' && e.target === inputRef.current) {
      e.preventDefault();
      listRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    if ((e.key === 'Home' || e.key === 'End') && e.target === inputRef.current) return;
    e.preventDefault(); e.stopPropagation();
    const options = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!options.length) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : current < 0 ? (e.key === 'ArrowUp' ? options.length - 1 : 0) : (current + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
    options[next]?.focus(); options[next]?.scrollIntoView?.({ block: 'nearest' });
  };

  // Determine placeholder text
  const defaultPlaceholder = `Search ${entityType}...`;
  const displayPlaceholder = placeholder || defaultPlaceholder;

  // Render display value for closed state
  const renderTriggerContent = (): React.ReactNode => {
    if (multiple && selectedOptions.length > 0) {
      return null; // Multi-select shows chips instead
    }

    if (!multiple && selectedOptions.length === 1) {
      return (
        <span className="text-slate-900 dark:text-white truncate">
          {selectedOptions[0].label}
        </span>
      );
    }

    return (
      <span className="text-slate-400 dark:text-slate-500 truncate">
        {displayPlaceholder}
      </span>
    );
  };

  return (
    <div className={cn('relative w-full', className)} ref={wrapperRef}>
      {/* Multi-select chips */}
      {multiple && selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedOptions.map((option) => (
            <span
              key={option.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md border border-slate-200 dark:border-white/10"
            >
              {option.label}
              <button
                type="button"
                onClick={() => handleRemove(option.id)}
                className="ml-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-sm hover:bg-slate-200 dark:hover:bg-slate-700 p-0.5 transition-colors"
                aria-label={`Remove ${option.label}`}
                disabled={disabled}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trigger / Search Input */}
      {!isOpen ? (
        <div
          id={props.id}
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-label={displayPlaceholder}
          aria-labelledby={props['aria-labelledby']}
          aria-required={props['aria-required']}
          aria-disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onClick={() => !disabled && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full relative pl-3 pr-10 bg-slate-50 hover:bg-slate-100/75 dark:bg-slate-800/50 border rounded-lg py-2 text-sm text-left transition-all outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] flex items-center justify-between cursor-pointer',
            disabled && 'opacity-50 cursor-not-allowed',
            error ? 'border-rose-500 dark:border-rose-400' : 'border-gray-200 dark:border-white/10',
          )}
        >
          {renderTriggerContent()}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {selectedIds.length > 0 && !disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                aria-label="Clear selection"
              >
                <X size={14} />
              </button>
            )}
            <ChevronsUpDown size={15} className="text-slate-400" />
          </div>
        </div>
      ) : (
        <div className="relative w-full flex items-center">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
          <Input
            id={props.id}
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={`Search ${entityType}`}
            aria-labelledby={props['aria-labelledby']}
            aria-required={props['aria-required']}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="w-full pl-9 pr-10 border-2 rounded-lg py-2 text-sm shadow-sm transition-all"
            maxLength={optionSource?.maxSearchLength}
            value={searchTerm}
            onChange={(e) => {
              requestVersion.current++;
              setRemoteOptions([]);
              setSearchTerm(e.target.value);
              if (loadOptions) { setSettledSearch(null); setLoadError(null); }
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={displayPlaceholder}
          />
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none"
            aria-label="Close search"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Dropdown List */}
      {isOpen && (
        <ThemedPortal><div
          ref={listRef}
          id={listId}
          onKeyDown={handleSearchKeyDown}
          style={position}
          role="listbox"
          aria-multiselectable={multiple}
          aria-label={optionSource?.label ?? `${entityType} options`}
          className="fixed z-[300] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-lg overflow-y-auto overscroll-contain py-1"
        >
          {/* Error state with retry */}
          {searchPending && <p role="status" className="px-4 py-3 text-center text-sm text-muted-foreground">Loading options…</p>}
          {loadError && (
            <div className="px-4 py-5 text-center">
              <AlertCircle size={20} className="mx-auto mb-2 text-rose-500" />
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{loadError}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {/* No results state */}
          {!loadError && showNoResults && (
            <div className="px-4 py-5 text-sm text-slate-400 dark:text-slate-500 text-center">
              No results found
            </div>
          )}

          {/* Search hint when below threshold */}
          {!loadOptions && !loadError && !showNoResults && debouncedSearch.length > 0 && debouncedSearch.length < minSearchChars && (
            <div className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500 text-center">
              Type at least {minSearchChars} characters to search
            </div>
          )}

          {/* Results list */}
          {!loadError && [...groups].map(([group, options]) => (
            <div key={group ?? 'ungrouped'} role={group ? 'group' : undefined} aria-label={group} className="divide-y divide-slate-50 dark:divide-white/5">
              {group && <div aria-hidden="true" className="px-4 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{group}</div>}
              {options.map((option) => {
                const isSelected = selectedIds.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'w-full text-left px-4 py-2.5 text-sm flex items-center justify-between outline-none transition-all',
                      isSelected
                        ? 'bg-blue-50/50 text-blue-600 dark:bg-blue-900/10 dark:text-blue-400 font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:bg-slate-50 dark:focus:bg-slate-800/50',
                    )}
                    onClick={() => handleSelect(option)}
                  >
                    <div className="flex flex-col items-start gap-0.5 min-w-0">
                      <span className={cn('truncate', isSelected && 'font-medium')}>
                        {option.label}
                      </span>
                      {option.sublabel && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-normal truncate">
                          {option.sublabel}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={16} className="shrink-0 ml-2 text-blue-500" />}
                  </button>
                );
              })}
            </div>
          ))}
          {addOption && <button
            type="button"
            role="option"
            aria-selected={false}
            className="w-full break-words border-t border-border px-4 py-2.5 text-left text-sm font-medium text-primary outline-none hover:bg-primary/5 focus:bg-primary/10"
            onClick={() => handleSelect(addOption)}
          >Add company “{addOption.label}”</button>}
        </div></ThemedPortal>
      )}

      {/* Field-level error */}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-rose-500 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

export default EntityCombobox;
