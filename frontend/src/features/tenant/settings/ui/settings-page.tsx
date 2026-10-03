'use client';
import { ProductsPage } from './products-page';
import { ProductInterestsSettings } from './product-interests-settings';

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ArchivedData } from './archived-data';
import { useAuth } from "@/store/AuthContext";
import {
  Shield,
  Building2,
  Search,
  Users,
  Save,
  Layout,
  X,
  RefreshCw,
  ChevronDown,
  Receipt,
  Palette,
  Moon,
  Sun,
  Monitor,
  Info,
  Archive,
  Camera,
  User,
  Building,
  CreditCard,
  Zap,
  Check,
  Banknote,
  PhoneCall,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACCENT_COLORS, applyAccentColor, ACCENT_KEY } from "@/lib/accent-colors";
import { OrganizationSettingsForm } from './organization-settings-form';
import { SecuritySettings } from './security-settings';
import { ProfileForm } from './profile-form';
import { FormsTab } from './forms-tab';
import { TeamManagement } from './team-management';
import { RolesPermissions } from './roles-permissions';

type SettingsTab =
  | 'profile'
  | 'appearance'
  | 'org-general'
  | 'users'
  | 'roles'
  | 'products'
  | 'custom-fields'
  | 'archived'
  | 'account-details'
  | 'forms';

interface NavGroup {
  label: string;
  icon?: React.ElementType;
  isTree?: boolean;
  items: { id: SettingsTab; label: string; icon?: React.ElementType }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'GENERAL',
    items: [
      { id: 'profile', label: 'Profile Settings', icon: User },
      { id: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
  {
    label: 'ORGANIZATION',
    items: [
      { id: 'org-general', label: 'General', icon: Building2 },
      { id: 'users', label: 'Team Management', icon: Users },
      { id: 'roles', label: 'Roles & Permissions', icon: Shield },
    ],
  },
  {
    label: 'CUSTOMIZATION',
    items: [
      { id: 'custom-fields', label: 'Custom Fields', icon: Zap },
      { id: 'products', label: 'Products', icon: Zap },
      { id: 'archived', label: 'Archived Data', icon: Archive },
    ],
  },
  {
    label: 'CONNECT',
    items: [
      { id: 'forms', label: 'Forms', icon: Layout },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      { id: 'account-details', label: 'Account Details', icon: Shield },
    ],
  },

];

export default function SettingsPage(): React.ReactElement {
  const { user, tenant, userCan } = useAuth();

  const isClientAdmin = user?.role === "Client Admin";

  const tabModules: Partial<Record<SettingsTab, string>> = { 'org-general': 'settings', users: 'users', roles: 'roles', products: 'products', 'custom-fields': 'custom_fields', archived: 'archived_data', forms: 'forms' };
  const canAccessTab = (tab: SettingsTab) => tab === 'users' ? userCan('users', 'canView') || userCan('groups', 'canView') : !tabModules[tab] || userCan(tabModules[tab]!, 'canView');
  const visibleNavGroups = NAV_GROUPS.map(group => ({ ...group, items: group.items.filter(item => canAccessTab(item.id)) })).filter(group => group.items.length);

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [isFormBuilderActive, setIsFormBuilderActive] = useState(false);
  const [isRolesViewActive, setIsRolesViewActive] = useState(false);
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams?.get('tab') ?? null;

  // Dispatch breadcrumb event to topbar when settings tab changes
  useEffect(() => {
    const group = visibleNavGroups.find(g => g.items.some(i => i.id === activeTab));
    const item = group?.items.find(i => i.id === activeTab);
    if (group && item) {
      window.dispatchEvent(new CustomEvent('settings-tab-change', {
        detail: { group: group.label.charAt(0) + group.label.slice(1).toLowerCase(), tab: item.label },
      }));
    }
  }, [activeTab]);

  // Appearance state
  const [appTheme, setAppTheme] = useState(localStorage.getItem("app_theme") || "Light");
  const [appFontSize, setAppFontSize] = useState(localStorage.getItem("app_font_size") || "Medium");
  const [appAccentColor, setAppAccentColor] = useState(localStorage.getItem(ACCENT_KEY) || "blue");

  useEffect(() => {
    const handleSync = () => {
      setAppTheme(localStorage.getItem("app_theme") || "Light");
      setAppAccentColor(localStorage.getItem(ACCENT_KEY) || "blue");
    };
    window.addEventListener("themechange", handleSync);
    window.addEventListener("accentcolorchange", handleSync);
    return () => {
      window.removeEventListener("themechange", handleSync);
      window.removeEventListener("accentcolorchange", handleSync);
    };
  }, []);

  const handleSaveAppearance = (): void => {
    localStorage.setItem("app_theme", appTheme);
    localStorage.setItem("app_font_size", appFontSize);
    applyAccentColor(appAccentColor);

    // Apply theme to the CRM container
    const container = document.querySelector('[data-theme-container]');
    if (container) {
      container.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');

      if (appTheme === "Dark") {
        container.classList.add("dark", "theme-dark");
      } else if (appTheme === "Classic") {
        container.classList.add("theme-classic");
      } else if (appTheme === "System") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
          container.classList.add("dark", "theme-dark");
        } else {
          container.classList.add("theme-light");
        }
      } else {
        container.classList.add("theme-light");
      }
    }

    let size = "16px";
    if (appFontSize === "Small") size = "14px";
    if (appFontSize === "Large") size = "18px";
    document.documentElement.style.fontSize = size;
    toast.success("Appearance settings saved successfully");

    const resolved = appTheme === "Dark" ? "dark" : appTheme === "Classic" ? "classic" : appTheme === "System" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : "light";
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: resolved, mode: appTheme } }));
  };

  // -- Profile Settings Tab --
  const renderProfileTab = (): React.ReactElement => (
    <div className="space-y-6 w-full max-w-6xl"><ProfileForm />
      <SecuritySettings />
    </div>
  );

  // -- Account Details Tab (Admin only) --
  const renderAccountDetailsTab = (): React.ReactElement => (
    <div className="w-full max-w-6xl space-y-4">
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#3B82F6]" /> Account Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Account Name</p>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">{tenant?.name || 'N/A'}</p>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Account ID</p>
            <p className="text-xs font-mono break-all text-slate-700 dark:text-slate-300">{tenant?.id || 'N/A'}</p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Status</p>
            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded-full border border-emerald-500/20">Active</span>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Industry</p>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">{tenant?.industry || 'Not set'}</p>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Domain</p>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">{tenant?.domain || 'Not configured'}</p>
          </div>
        </div>
      </div>

    </div>
  );

  // -- Appearance Tab --
  const renderAppearanceTab = (): React.ReactElement => (
    <div className="w-full max-w-6xl space-y-6">
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-[#3B82F6]" /> System Appearance
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Choose how LeadCRM looks to you. Select a theme below.</p>
        </div>

        {/* Theme Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { id: "Classic", icon: Layout, desc: "Dark sidebar + Light", preview: { bg: "#F5F6F7", sidebar: "#25313D", card: "#FFFFFF", accent: "#3B82F6" } },
            { id: "Light", icon: Sun, desc: "Fully light", preview: { bg: "#F5F6F7", sidebar: "#FFFFFF", card: "#FFFFFF", accent: "#3B82F6" } },
            { id: "Dark", icon: Moon, desc: "Fully dark", preview: { bg: "#1B252F", sidebar: "#1B252F", card: "#2E3B48", accent: "#3B82F6" } },
            { id: "System", icon: Monitor, desc: "Match your OS", preview: { bg: "#E8ECF0", sidebar: "#E8ECF0", card: "#FFFFFF", accent: "#3B82F6" } },
          ] as const).map((theme) => {
            const isSelected = appTheme === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  setAppTheme(theme.id);
                  // Apply immediately for live preview
                  localStorage.setItem("app_theme", theme.id);
                  const container = document.querySelector('[data-theme-container]');
                  if (container) {
                    container.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');
                    if (theme.id === "Dark") {
                      container.classList.add("dark", "theme-dark");
                    } else if (theme.id === "Classic") {
                      container.classList.add("theme-classic");
                    } else if (theme.id === "System") {
                      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                      if (prefersDark) container.classList.add("dark", "theme-dark");
                      else container.classList.add("theme-light");
                    } else {
                      container.classList.add("theme-light");
                    }
                  }
                  const resolved = theme.id === "Dark" ? "dark" : theme.id === "Classic" ? "classic" : theme.id === "System" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : "light";
                  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: resolved, mode: theme.id } }));
                }}
                aria-pressed={isSelected}
                aria-label={`Select ${theme.id} theme`}
                className={cn(
                  'relative flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]/40',
                  isSelected
                    ? 'border-[#3B82F6]/60 bg-[#3B82F6]/[0.04] shadow-sm'
                    : 'border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.14] bg-white dark:bg-white/[0.02]'
                )}
              >
                {/* Selection indicator dot */}
                {isSelected && (
                  <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#3B82F6]" />
                )}

                {/* Mini theme preview */}
                <div className="w-full aspect-[4/3] rounded-lg overflow-hidden border border-gray-100 dark:border-white/[0.06] shadow-sm">
                  <div className="w-full h-full flex" style={{ backgroundColor: theme.preview.bg }}>
                    <div className="w-[22%] h-full" style={{ backgroundColor: theme.preview.sidebar }} />
                    <div className="flex-1 p-1.5 flex flex-col gap-1">
                      <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: theme.preview.accent, opacity: 0.6 }} />
                      <div className="flex-1 rounded" style={{ backgroundColor: theme.preview.card, border: '1px solid rgba(0,0,0,0.06)' }} />
                    </div>
                  </div>
                </div>

                {/* Label */}
                <div className="text-center">
                  <div className={cn(
                    'text-xs font-semibold',
                    isSelected ? 'text-[#3B82F6]' : 'text-slate-700 dark:text-slate-200'
                  )}>{theme.id}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{theme.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Accent Color */}
        <div className="pt-5 border-t border-gray-200 dark:border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Accent Color</label>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Customize the primary brand and highlight color across the entire application.</p>
            </div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 capitalize">
              {ACCENT_COLORS.find(c => c.id === appAccentColor)?.name || 'Blue'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {ACCENT_COLORS.map((color) => {
              const isSelected = appAccentColor === color.id;
              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => {
                    setAppAccentColor(color.id);
                    applyAccentColor(color.id);
                  }}
                  title={color.name}
                  aria-label={`Select ${color.name} accent color`}
                  aria-pressed={isSelected}
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer shadow-xs',
                    color.previewClass,
                    'hover:scale-110 active:scale-95',
                    isSelected
                      ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ring-slate-900 dark:ring-white scale-105'
                      : 'hover:opacity-90'
                  )}
                >
                  {isSelected && (
                    <Check size={14} className="text-white drop-shadow-xs stroke-[3]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Interface Density */}
        <div className="pt-5 border-t border-gray-200 dark:border-white/[0.06]">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">Interface Density</label>
          <div className="flex gap-3">
            {(["Small", "Medium", "Large"] as const).map((size) => (
              <button key={size} onClick={() => setAppFontSize(size)}
                aria-pressed={appFontSize === size}
                className={cn(
                  'px-4 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer',
                  appFontSize === size
                    ? 'border-[#3B82F6]/50 bg-[#3B82F6]/[0.06] text-[#3B82F6] dark:text-[#60A5FA]'
                    : 'border-gray-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-white/[0.12]'
                )}>
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Apply button */}
        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-white/[0.06]">
          <button onClick={handleSaveAppearance}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer">
            <Save className="w-3.5 h-3.5" /> Apply Changes
          </button>
        </div>
      </div>
    </div>
  );

  const renderOrgGeneralTab = (): React.ReactElement => <OrganizationSettingsForm key={tenant?.id} />;

  // Users (Team Management) Tab
  const renderUsersTab = (): React.ReactElement => <TeamManagement />;

  // â”€â”€ Archived Data Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderArchivedTab = () => <ArchivedData />;

  const renderCustomFieldsTab = () => <ProductInterestsSettings />;

  const tabContentMap: Record<Exclude<SettingsTab, 'forms' | 'roles'>, () => React.ReactElement> = {
    'profile': renderProfileTab,
    'appearance': renderAppearanceTab,
    'org-general': renderOrgGeneralTab,
    'users': renderUsersTab,
    'custom-fields': renderCustomFieldsTab,
    'products': () => <ProductsPage key={tenant?.id} />,
    'archived': renderArchivedTab,
    'account-details': renderAccountDetailsTab,
  };

  const VALID_TABS: SettingsTab[] = ['profile', 'appearance', 'org-general', 'users', 'roles', 'custom-fields', 'products', 'archived', 'account-details', 'forms'];
  useEffect(() => {
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl as SettingsTab)) {
      setActiveTab(tabFromUrl as SettingsTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);

  const activeGroup = visibleNavGroups.find((g) => g.items.some((i) => i.id === activeTab));
  const activeItem = activeGroup?.items.find((i) => i.id === activeTab);

  return (
    <div className="flex flex-col lg:flex-row h-full min-w-0 -m-3 sm:-m-4 lg:-m-6 min-h-[calc(100dvh-4rem)] max-h-[100dvh] overflow-hidden">
      {/* Mobile Tab Selector — visible below lg breakpoint */}
      <div className="lg:hidden shrink-0 border-b border-gray-200 dark:border-[#262A33] bg-white dark:bg-[#121418] px-4 py-3">
        <label htmlFor="settings-mobile-nav" className="sr-only">Settings section</label>
        <div className="relative">
          <select
            id="settings-mobile-nav"
            value={activeTab}
            onChange={(e) => { setActiveTab(e.target.value as SettingsTab); setIsFormBuilderActive(false); setIsRolesViewActive(false); }}
            className="w-full bg-slate-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg pl-3 pr-9 py-2.5 text-sm font-medium focus:outline-none focus:border-[#3B82F6] transition-colors appearance-none"
          >
            {visibleNavGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Left Sub-Nav (Close CRM #121418) — hidden on mobile */}
      <aside className="hidden lg:block w-52 shrink-0 border-r border-gray-200 dark:border-[#262A33] bg-white dark:bg-[#121418] overflow-y-auto custom-scrollbar py-4 transition-colors">
        {visibleNavGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {group.isTree ? (
              <div>
                <div className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold text-slate-700 dark:text-[#CBD5E1] uppercase tracking-wider">
                  {group.icon && React.createElement(group.icon, { className: "w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" })}
                  <span>{group.label}</span>
                </div>
                <div className="relative ml-6 pl-2.5 border-l border-slate-200 dark:border-slate-700/60 my-1 space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveTab(item.id); setIsFormBuilderActive(false); setIsRolesViewActive(false); }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer text-left',
                          isActive
                            ? 'border-l-2 -ml-[11px] border-[#2563EB] pl-2.5 text-[#2563EB] dark:text-[#3B82F6] font-semibold'
                            : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-[#F1F5F9] hover:bg-slate-50 dark:hover:bg-[#1C2027]'
                        )}
                      >
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                <p className="px-4 py-1.5 text-[10px] font-bold text-slate-400 dark:text-[#64748B] uppercase tracking-widest">{group.label}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveTab(item.id); setIsFormBuilderActive(false); setIsRolesViewActive(false); }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer text-left',
                        isActive
                          ? 'border-l-2 border-[var(--primary)] pl-[14px] bg-[var(--color-brand-light)] text-[var(--primary)] font-semibold'
                          : 'border-l-2 border-transparent text-slate-600 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-[#F1F5F9] hover:bg-slate-50 dark:hover:bg-[#1C2027]'
                      )}
                    >
                      {Icon && React.createElement(Icon as any, { className: "w-3.5 h-3.5 shrink-0" })}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </aside>

      {/* Right Content */}
      {(() => {
        const isFullPane =
          (activeTab === 'forms' && isFormBuilderActive) ||
          (activeTab === 'roles' && isRolesViewActive);
        // Tabs that render their own title/header internally â€” suppress the page header
        const hasOwnHeader =
          activeTab === 'custom-fields' ||
          activeTab === 'products' ||
          activeTab === 'org-general' ||
          activeTab === 'users' ||
          activeTab === 'roles' ||
          activeTab === 'forms';

        return (
          <div className={`flex-1 min-w-0 overflow-y-auto custom-scrollbar ${isFullPane ? '' : 'px-4 sm:px-6 py-5'}`}>
            {!isFullPane && !hasOwnHeader && (
              <div className="mb-5">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">{activeItem?.label ?? 'Settings'}</h1>
              </div>
            )}
            {!canAccessTab(activeTab) ? <p role="alert">You do not have permission to access this settings section.</p> : activeTab === 'forms'
              ? <FormsTab onBuilderActiveChange={setIsFormBuilderActive} />
              : activeTab === 'roles'
              ? <RolesPermissions onViewActiveChange={setIsRolesViewActive} />
              : tabContentMap[activeTab as Exclude<SettingsTab, 'forms' | 'roles'>]()
            }
          </div>
        );
      })()}
    </div>
  );
}
