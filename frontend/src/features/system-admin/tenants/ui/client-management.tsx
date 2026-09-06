'use client';

import React, { useEffect, useState } from 'react';
import { Search, UserX, UserCheck, CheckCircle, ChevronDown, Check, UserPlus, ArrowLeft } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from '@/shared/components/ui/dropdown-menu';
import { SideSheet } from '@/shared/components/side-sheet';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import { useData } from '@/store/DataContext';
import { Tenant } from '@/store/types';
import { cn } from '@/lib/utils';
import { useTenants } from '../hooks/use-tenants';
import { tenantApiService } from '../services/tenants.service';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'pending' | 'active' | 'inactive' | 'rejected';
type PlanFilter = 'all' | 'Basic' | 'Pro' | 'Enterprise';

const PHONE_COUNTRIES = [
  { code: '+63', label: 'PH +63' },
  { code: '+1', label: 'US +1' },
  { code: '+44', label: 'UK +44' },
  { code: '+61', label: 'AU +61' },
  { code: '+65', label: 'SG +65' },
  { code: '+81', label: 'JP +81' },
  { code: '+971', label: 'AE +971' },
];

interface FilterOption<T extends string> {
  id: T;
  label: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_SHELL =
  'rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] shadow-lg backdrop-blur-xl';

const STATUS_OPTIONS: FilterOption<StatusFilter>[] = [
  { id: 'all',      label: 'All Status' },
  { id: 'active',   label: 'Active' },
  { id: 'pending',  label: 'Pending' },
  { id: 'inactive', label: 'Inactive' },
];

const PLAN_OPTIONS: FilterOption<PlanFilter>[] = [
  { id: 'all',        label: 'All Plans' },
  { id: 'Enterprise', label: 'Enterprise' },
  { id: 'Pro',        label: 'Pro' },
  { id: 'Basic',      label: 'Basic' },
];

const STATUS_BADGE: Record<string, string> = {
  active:  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
};

const STATUS_BADGE_FALLBACK = 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20';

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * System Admin — Client Management page.
 * Lists all tenant accounts with approve / suspend / activate actions.
 */
export default function ClientManagement(): React.ReactElement {
  const { tenants, approveTenant } = useData();
  const [serverTenants, setServerTenants] = useState<Tenant[] | null>(null);
  const [createdTenants, setCreatedTenants] = useState<Tenant[]>([]);
  const visibleTenants = [...(serverTenants ?? tenants), ...createdTenants];
  const {
    filteredTenants,
    searchQuery, setSearchQuery,
    statusFilter, setStatusFilter,
    planFilter, setPlanFilter,
  } = useTenants({ tenants: visibleTenants });

  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [showAddClientModal, setShowAddClientModal] = useState(false);

  const {
    currentPage, pageSize, totalPages, totalItems,
    paginateItems, goToPage, setPageSize,
  } = usePagination({
    totalItems: filteredTenants.length,
    initialPageSize: 10,
    resetDeps: [searchQuery, statusFilter, planFilter],
  });

  const paginatedTenants = paginateItems(filteredTenants);

  const handleDeactivate = async (tenant: Tenant) => {
    try {
      await tenantApiService.deactivate(tenant.id);
      setServerTenants((current) => current?.map((item) => item.id === tenant.id
        ? { ...item, status: 'suspended' }
        : item) ?? current);
      setCreatedTenants((current) => current.map((item) => item.id === tenant.id
        ? { ...item, status: 'suspended' }
        : item));
      toast.success(`${tenant.name} was deactivated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to deactivate client');
    }
  };

  const handleActivate = async (tenant: Tenant) => {
    try {
      await tenantApiService.activate(tenant.id);
      setServerTenants((current) => current?.map((item) => item.id === tenant.id
        ? { ...item, status: 'active' }
        : item) ?? current);
      setCreatedTenants((current) => current.map((item) => item.id === tenant.id
        ? { ...item, status: 'active' }
        : item));
      toast.success(`${tenant.name} was activated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to activate client');
    }
  };

  useEffect(() => {
    tenantApiService.getAll().then((response) => {
      const apiTenants = (response.data as Array<Record<string, unknown>>).map((tenant) => ({
        ...tenant,
        size: tenant.companySize ?? '',
        status: String(tenant.status ?? 'ACTIVE').toLowerCase(),
        approvalStep: 'completed',
        environment: 'production',
        createdAt: new Date(String(tenant.createdAt)).toISOString(),
      })) as Tenant[];
      setServerTenants(apiTenants);
    }).catch((error) => {
      console.error('[ClientManagement] Failed to load database tenants:', error);
    });
  }, []);

  const activeStatusLabel = STATUS_OPTIONS.find((option) => option.id === statusFilter)?.label ?? 'All Status';
  const activePlanLabel = PLAN_OPTIONS.find((option) => option.id === planFilter)?.label ?? 'All Plans';

  return (
    <>
      {showAddClientModal ? (
        <AddClientModal
          isOpen={showAddClientModal}
          onClose={() => setShowAddClientModal(false)}
          onCreated={(tenant) => {
            if (serverTenants) {
              setServerTenants((current) => current ? [tenant, ...current] : current);
            } else {
              setCreatedTenants((current) => [...current, tenant]);
            }
          }}
        />
      ) : (
        <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Client Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Manage and monitor all client accounts
          </p>
        </div>
        <button
          onClick={() => setShowAddClientModal(true)}
          className="flex items-center gap-2 h-10 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm active:scale-95"
        >
          <UserPlus size={18} />
          Add New Client
        </button>
      </div>

      {/* Filters */}
      <div className={cn(CARD_SHELL, 'p-4 flex flex-col md:flex-row gap-3')}>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
          <label htmlFor="client-search" className="sr-only">Search clients</label>
          <input
            id="client-search"
            type="search"
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-9 w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] pl-9 pr-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div className="flex gap-3">
          <FilterDropdown<StatusFilter>
            label="Status"
            activeLabel={activeStatusLabel}
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onSelect={(value) => setStatusFilter(value)}
          />
          <FilterDropdown<PlanFilter>
            label="Plan"
            activeLabel={activePlanLabel}
            options={PLAN_OPTIONS}
            selected={planFilter}
            onSelect={(value) => setPlanFilter(value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className={cn(CARD_SHELL, 'overflow-hidden flex flex-col')}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse table-fixed">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/[0.05] bg-gray-50/50 dark:bg-white/[0.01] text-[9px] sm:text-[10px] uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                <th scope="col" className="p-2 sm:p-4 py-2 sm:py-3 font-semibold w-[28%]">Company Name</th>
                <th scope="col" className="p-2 sm:p-4 py-2 sm:py-3 font-semibold w-[18%] hidden sm:table-cell">Industry</th>
                <th scope="col" className="p-2 sm:p-4 py-2 sm:py-3 font-semibold w-[12%]">Status</th>
                <th scope="col" className="p-2 sm:p-4 py-2 sm:py-3 font-semibold w-[10%]">Plan</th>
                <th scope="col" className="p-2 sm:p-4 py-2 sm:py-3 font-semibold w-[14%] hidden md:table-cell">Created</th>
                <th scope="col" className="p-2 sm:p-4 py-2 sm:py-3 font-semibold text-right w-[18%]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04] text-[10px] sm:text-[11px] text-slate-700 dark:text-slate-300">
              {paginatedTenants.length > 0 ? paginatedTenants.map((tenant) => {
                const normalizedStatus: string = tenant.status === 'suspended' ? 'inactive' : tenant.status;
                const planLabel = (tenant as { plan?: string }).plan ?? 'Basic';
                const createdOn = new Date(tenant.createdAt).toISOString().split('T')[0];

                return (
                  <tr
                    key={tenant.id}
                    onClick={() => setSelectedTenant(tenant)}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <td className="p-2 sm:p-4">
                      <span className="font-semibold text-slate-900 dark:text-white block truncate" title={tenant.name}>
                        {tenant.name}
                      </span>
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 sm:hidden block truncate">
                        {tenant.industry || 'Technology'}
                      </span>
                    </td>
                    <td className="p-2 sm:p-4 text-slate-500 dark:text-slate-400 hidden sm:table-cell truncate">
                      {tenant.industry || 'Technology'}
                    </td>
                    <td className="p-2 sm:p-4">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase border',
                          STATUS_BADGE[normalizedStatus] ?? STATUS_BADGE_FALLBACK,
                        )}
                      >
                        {normalizedStatus}
                      </span>
                    </td>
                    <td className="p-2 sm:p-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        {planLabel}
                      </span>
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono md:hidden block mt-1">
                        {createdOn}
                      </span>
                    </td>
                    <td className="p-2 sm:p-4 text-slate-500 dark:text-slate-400 hidden md:table-cell font-mono text-[10px]">
                      {createdOn}
                    </td>
                    <td className="p-2 sm:p-4">
                      <div
                        className="flex items-center justify-end gap-1.5 flex-wrap"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {normalizedStatus === 'active' && (
                          <RowAction
                            onClick={() => void handleDeactivate(tenant)}
                            label={`Deactivate ${tenant.name}`}
                            tone="danger"
                            icon={<UserX size={12} />}
                          >
                            Deactivate
                          </RowAction>
                        )}

                        {normalizedStatus === 'pending' && (
                          <RowAction
                            onClick={() => setSelectedTenant(tenant)}
                            label={`Review ${tenant.name}`}
                            tone="primary"
                            icon={<CheckCircle size={12} />}
                          >
                            Review
                          </RowAction>
                        )}

                        {(normalizedStatus === 'inactive' || normalizedStatus === 'sandbox') && (
                          <RowAction
                            onClick={() => void handleActivate(tenant)}
                            label={`Activate ${tenant.name}`}
                            tone="success"
                            icon={<UserCheck size={12} />}
                          >
                            Activate
                          </RowAction>
                        )}

                        {normalizedStatus === 'rejected' && (
                          <RowAction
                            onClick={() => approveTenant(tenant.id)}
                            label={`Activate ${tenant.name}`}
                            tone="success"
                            icon={<UserCheck size={12} />}
                          >
                            Activate
                          </RowAction>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400 text-sm">
                    No clients found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-white/[0.05]">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={totalItems}
            pageSizeOptions={[10, 25, 50, 100]}
            onPageChange={goToPage}
            onPageSizeChange={setPageSize}
            isLoading={false}
          />
        </div>
      </div>

      {/* Detail sheet */}
      <AnimatePresence>
        {selectedTenant && (
          <TenantDetailSheet
            tenant={selectedTenant}
            onClose={() => setSelectedTenant(null)}
            onApprove={() => {
              approveTenant(selectedTenant.id);
              setSelectedTenant(null);
              toast.success('Tenant approved');
            }}
          />
        )}
      </AnimatePresence>

    </div>
      )}
    </>
  );
}

// ── Local components ──────────────────────────────────────────────────────────

interface FilterDropdownProps<T extends string> {
  label: string;
  activeLabel: string;
  options: FilterOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}

function FilterDropdown<T extends string>({
  label, activeLabel, options, selected, onSelect,
}: FilterDropdownProps<T>): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-9 min-w-[150px] px-3 inline-flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"
          aria-label={`Filter by ${label}`}
        >
          <span className="truncate">{activeLabel}</span>
          <ChevronDown size={14} className="shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[170px]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onClick={() => onSelect(option.id)}>
            <span className="flex items-center justify-between w-full gap-2">
              <span>{option.label}</span>
              {selected === option.id && <Check size={14} className="text-blue-500 shrink-0" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ActionTone = 'neutral' | 'primary' | 'success' | 'danger';

const ACTION_TONES: Record<ActionTone, string> = {
  neutral: 'border-gray-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]',
  primary: 'border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10',
  success: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10',
  danger:  'border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10',
};

interface RowActionProps {
  onClick: () => void;
  label: string;
  tone: ActionTone;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function RowAction({ onClick, label, tone, icon, children }: RowActionProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] font-medium transition-colors active:scale-95',
        ACTION_TONES[tone],
      )}
    >
      {icon} {children}
    </button>
  );
}

interface TenantDetailSheetProps {
  tenant: Tenant;
  onClose: () => void;
  onApprove: () => void;
}

function TenantDetailSheet({ tenant, onClose, onApprove }: TenantDetailSheetProps): React.ReactElement {
  const planLabel = (tenant as { plan?: string }).plan ?? 'Basic';

  const summary: [string, string][] = [
    ['Status', tenant.status],
    ['Plan', planLabel],
    ['Created', new Date(tenant.createdAt).toLocaleDateString()],
  ];

  return (
    <SideSheet isOpen onClose={onClose} title="Client Details">
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <InfoBlock
          title="Company Information"
          fields={[
            ['Name', tenant.name],
            ['Industry', tenant.industry || '—'],
            ['Size', tenant.size || '—'],
          ]}
        />
        <InfoBlock
          title="Contact Details"
          fields={[
            ['Email', tenant.email || '—'],
            ['Phone', tenant.phone || '—'],
            ['Address', tenant.address || '—'],
          ]}
        />

        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-200 dark:border-white/[0.05]">
          {summary.map(([key, value]) => (
            <div
              key={key}
              className="rounded-xl border border-gray-200 dark:border-white/[0.05] bg-slate-50 dark:bg-white/[0.02] p-3"
            >
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{key}</p>
              <p className="font-medium capitalize text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-white/[0.05] bg-slate-50 dark:bg-white/[0.02] flex justify-end gap-3">
        <button
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors active:scale-95"
        >
          Close
        </button>
        {tenant.status === 'pending' && (
          <button
            onClick={onApprove}
            className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-all active:scale-95"
          >
            Approve Client
          </button>
        )}
      </div>
    </SideSheet>
  );
}

interface InfoBlockProps {
  title: string;
  fields: [string, string][];
}

function InfoBlock({ title, fields }: InfoBlockProps): React.ReactElement {
  return (
    <div>
      <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
        {title}
      </h3>
      <div className="space-y-3">
        {fields.map(([key, value]) => (
          <div key={key}>
            <p className="text-xs text-slate-500 dark:text-slate-400">{key}</p>
            <p className="font-medium text-slate-900 dark:text-white break-words">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (tenant: Tenant) => void;
}

interface ClientFormData {
  companyName: string;
  industry: string;
  companySize: string;
  plan: string;
  firstName: string;
  lastName: string;
  adminEmail: string;
  adminPassword: string;
  phone: string;
  address: string;
  phoneCountryCode: string;
}

function AddClientModal({ isOpen, onClose, onCreated }: AddClientModalProps): React.ReactElement | null {
  const [formData, setFormData] = useState<ClientFormData>({
    companyName: '',
    industry: '',
    companySize: '',
    plan: '',
    firstName: '',
    lastName: '',
    adminEmail: '',
    adminPassword: '',
    phone: '',
    phoneCountryCode: '+63',
    address: '',
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credentialsUnlocked, setCredentialsUnlocked] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ClientFormData, string>>>({});

  if (!isOpen) return null;

  const handleChange = (field: keyof ClientFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof ClientFormData, string>> = {};

    if (!formData.companyName.trim()) {
      newErrors.companyName = 'Company name is required';
    }
    if (!formData.industry) {
      newErrors.industry = 'Industry is required';
    }
    if (!formData.companySize) {
      newErrors.companySize = 'Company size is required';
    }
    if (!formData.plan) {
      newErrors.plan = 'Subscription plan is required';
    }
    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }
    if (!formData.adminEmail.trim()) {
      newErrors.adminEmail = 'Admin email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.adminEmail)) {
      newErrors.adminEmail = 'Invalid email format';
    }
    if (!formData.adminPassword) {
      newErrors.adminPassword = 'Password is required';
    } else if (formData.adminPassword.length < 8) {
      newErrors.adminPassword = 'Password must be at least 8 characters';
    }
    if (formData.phone.trim()) {
      const compactPhone = formData.phone.replace(/[\s().-]/g, '');
      if (!/^(?:\+?[1-9]\d{7,14}|0?9\d{8,10})$/.test(compactPhone)) {
        newErrors.phone = 'Use 09..., 9..., or a valid international number';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    setIsSubmitting(true);

    try {
      const phone = formData.phone.trim();
      const normalizedPhone = phone
        ? phone.startsWith('+')
          ? phone
          : `${formData.phoneCountryCode} ${phone.replace(/^0(?=9)/, '')}`
        : undefined;
      const response = await tenantApiService.create({
        name: formData.companyName,
        industry: formData.industry,
        companySize: formData.companySize,
        plan: formData.plan as 'STARTER' | 'PRO' | 'ENTERPRISE',
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.adminEmail,
        password: formData.adminPassword,
        phone: normalizedPhone,
        address: formData.address || undefined,
      });
      const created = response.data as { tenant?: Record<string, unknown> };
      if (created.tenant) {
        onCreated?.({
          ...(created.tenant as object),
          size: created.tenant.companySize ?? '',
          email: formData.adminEmail,
          status: String(created.tenant.status ?? 'ACTIVE').toLowerCase(),
          approvalStep: 'completed',
          environment: 'production',
        } as Tenant);
      }
      
      toast.success(`Client "${formData.companyName}" created successfully!`);
      onClose();
      
      // Reset form
      setFormData({
        companyName: '',
        industry: '',
        companySize: '',
        plan: '',
        firstName: '',
        lastName: '',
        adminEmail: '',
        adminPassword: '',
        phone: '',
        phoneCountryCode: '+63',
        address: '',
      });
    } catch (error) {
      toast.error('Failed to create client. Please try again.');
      console.error('Create client error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 bg-slate-50 dark:bg-[#030712] flex flex-col">
      {/* Body - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 lg:px-14 py-10 pb-32">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Client Management
          </button>
          <div className="mt-5 mb-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Add New Client</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Create a new client account and set up their admin user</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Company Information Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Company Information</h3>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label htmlFor="companyName" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="companyName"
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => handleChange('companyName', e.target.value)}
                    className={cn(
                      "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                      errors.companyName ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                    )}
                    placeholder="Company Name"
                  />
                  {errors.companyName && (
                    <p className="text-xs text-red-500 mt-1">{errors.companyName}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="industry" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Industry <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="industry"
                      value={formData.industry}
                      onChange={(e) => handleChange('industry', e.target.value)}
                      className={cn(
                        "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                        errors.industry ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                      )}
                    >
                      <option value="">Select...</option>
                      <option value="IT Solutions">IT Solutions</option>
                      <option value="Telecom">Telecom</option>
                      <option value="Security">Security</option>
                      <option value="Healthcare">Healthcare</option>
                      <option value="Finance">Finance</option>
                      <option value="Retail">Retail</option>
                      <option value="Other">Other</option>
                    </select>
                    {errors.industry && (
                      <p className="text-xs text-red-500 mt-1">{errors.industry}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="companySize" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Company Size <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="companySize"
                      value={formData.companySize}
                      onChange={(e) => handleChange('companySize', e.target.value)}
                      className={cn(
                        "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                        errors.companySize ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                      )}
                    >
                      <option value="">Select...</option>
                      <option value="1-10">1-10</option>
                      <option value="11-50">11-50</option>
                      <option value="51-200">51-200</option>
                      <option value="201-500">201-500</option>
                      <option value="500+">500+</option>
                    </select>
                    {errors.companySize && (
                      <p className="text-xs text-red-500 mt-1">{errors.companySize}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="plan" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Subscription Plan <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="plan"
                      value={formData.plan}
                      onChange={(e) => handleChange('plan', e.target.value)}
                      className={cn(
                        "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                        errors.plan ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                      )}
                    >
                      <option value="">Select...</option>
                      <option value="FREE">Free</option>
                      <option value="PRO">Pro</option>
                      <option value="ENTERPRISE">Enterprise</option>
                    </select>
                    {errors.plan && (
                      <p className="text-xs text-red-500 mt-1">{errors.plan}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Admin User + Contact Information — side by side on large screens */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Admin User Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 sm:p-8 h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Admin User</h3>
              </div>

              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => handleChange('firstName', e.target.value)}
                      className={cn(
                        "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                        errors.firstName ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                      )}
                      placeholder="First Name"
                    />
                    {errors.firstName && (
                      <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="lastName" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => handleChange('lastName', e.target.value)}
                      className={cn(
                        "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                        errors.lastName ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                      )}
                      placeholder="Last Name"
                    />
                    {errors.lastName && (
                      <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="adminEmail" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Admin Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="adminEmail"
                    name="client-admin-email"
                    type="email"
                    autoComplete="off"
                    readOnly={!credentialsUnlocked}
                    onFocus={() => setCredentialsUnlocked(true)}
                    value={formData.adminEmail}
                    onChange={(e) => handleChange('adminEmail', e.target.value)}
                    className={cn(
                      "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                      errors.adminEmail ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                    )}
                    placeholder="Email"
                  />
                  {errors.adminEmail && (
                    <p className="text-xs text-red-500 mt-1">{errors.adminEmail}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="adminPassword" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Initial Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="adminPassword"
                    name="client-admin-password"
                    type="password"
                    autoComplete="new-password"
                    readOnly={!credentialsUnlocked}
                    onFocus={() => setCredentialsUnlocked(true)}
                    value={formData.adminPassword}
                    onChange={(e) => handleChange('adminPassword', e.target.value)}
                    className={cn(
                      "w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
                      errors.adminPassword ? "border-red-500" : "border-gray-200 dark:border-white/[0.08]"
                    )}
                    placeholder="Password"
                  />
                  {errors.adminPassword && (
                    <p className="text-xs text-red-500 mt-1">{errors.adminPassword}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Contact Information Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 sm:p-8 h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Contact Information</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Optional</p>
                </div>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label htmlFor="phone" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Phone Number
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="phone-country"
                      aria-label="Phone country code"
                      value={formData.phoneCountryCode}
                      onChange={(e) => handleChange('phoneCountryCode', e.target.value)}
                      className="h-11 w-28 shrink-0 bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/[0.08] rounded-lg px-2 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    >
                      {PHONE_COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>{country.label}</option>
                      ))}
                    </select>
                    <input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => handleChange('phone', e.target.value)}
                      className={cn(
                        'w-full h-11 bg-white dark:bg-slate-800 border rounded-lg px-4 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all',
                        errors.phone ? 'border-red-500' : 'border-gray-200 dark:border-white/[0.08]',
                      )}
                      placeholder="09XX XXX XXXX or 9XX XXX XXXX"
                    />
                  </div>
                  {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
                </div>

                <div>
                  <label htmlFor="address" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Address
                  </label>
                  <textarea
                    id="address"
                    rows={3}
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/[0.08] rounded-lg px-4 py-3 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                    placeholder="123 Main St, City, State, ZIP"
                  />
                </div>
              </div>
            </div>
            </div>
            {/* end Admin User + Contact Information grid */}

            {/* Info Note */}
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-blue-900 dark:text-blue-100">
                Client will receive a welcome email with login credentials to access their dedicated CRM workspace.
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* Footer - Sticky at Bottom */}
      <div className="absolute bottom-0 inset-x-0 border-t border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shrink-0 shadow-lg z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-end gap-3 px-6 sm:px-10 lg:px-14 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-10 px-4 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-10 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </>
            ) : (
              'Create Client'
            )}
          </button>
        </div>
      </div>

    </div>
  );
}
