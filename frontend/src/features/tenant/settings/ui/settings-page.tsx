'use client';

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useData } from "@/store/DataContext";
import { useAuth } from "@/store/AuthContext";
import {
  Shield,
  Building2,
  Search,
  Users,
  Lock,
  Globe,
  Mail,
  Phone,
  MapPin,
  Save,
  Layout,
  X,
  RefreshCw,
  ChevronDown,
  Receipt,
  Clock,
  DollarSign,
  Link,
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
  Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACCENT_COLORS, applyAccentColor, ACCENT_KEY } from "@/lib/accent-colors";
import { FormsTab } from './forms-tab';
import { TeamManagement } from './team-management';
import { RolesPermissions } from './roles-permissions';
import { PlanUsageTab } from './plan-usage-tab';
import AuditLogsPage from '@/features/tenant/administration/audit/ui/audit-logs-page';

type SettingsTab =
  | 'profile'
  | 'appearance'
  | 'memberships'
  | 'org-general'
  | 'users'
  | 'roles'
  | 'custom-fields'
  | 'archived'
  | 'account-details'
  | 'plan'
  | 'billing'
  | 'forms'
  | 'audit';

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
      { id: 'memberships', label: 'Memberships', icon: Building },
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
  {
    label: 'SYSTEM',
    items: [
      { id: 'audit', label: 'Audit Trail', icon: Activity },
    ],
  },
  {
    label: 'BILLING',
    icon: Banknote,
    isTree: true,
    items: [
      { id: 'plan', label: 'Plan' },
      { id: 'billing', label: 'Payment Methods' },
    ],
  },
];

export default function SettingsPage(): React.ReactElement {
  const { user, tenant, updateProfile, userCan } = useAuth();
  const {
    organizations,
    contacts,
    deals,
    pipelines,
    workflows,
    campaigns,
    templates,
    users,
    roles,
    restoreRecord,
    isBillingModuleEnabled,
    toggleBillingModule,
    updateTenant,
  } = useData();

  const userRoleDef = roles.find((r) => r.name === user?.role);
  const userPerms = userRoleDef?.permissions || [];
  const isClientAdmin = user?.role === "Client Admin";
  const canEditSettings = isClientAdmin || userPerms.includes("p28");

  // RBAC-filtered nav groups — hide Audit Trail from non-admin roles
  const canViewAudit = isClientAdmin || user?.role === "Administrator" || user?.role === "Admin" || userCan('audit', 'canView');
  const visibleNavGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => {
      if ((item as { id: string }).id === 'audit') return canViewAudit;
      return true;
    }),
  })).filter((g) => g.items.length > 0) as typeof NAV_GROUPS;

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

  // Organization state
  const [orgName, setOrgName] = useState(tenant?.name || "");
  const [orgEmail, setOrgEmail] = useState(tenant?.email || "");
  const [orgPhone, setOrgPhone] = useState(tenant?.phone || "");
  const [orgAddress, setOrgAddress] = useState(tenant?.address || "");
  const [orgIndustry, setOrgIndustry] = useState(tenant?.industry || "");
  const [orgTimezone, setOrgTimezone] = useState(tenant?.timezone || "UTC");
  const [orgCurrency, setOrgCurrency] = useState(tenant?.currency || "USD");
  const [orgDomain, setOrgDomain] = useState(tenant?.domain || "");

  // Appearance state
  const [appTheme, setAppTheme] = useState(localStorage.getItem("app_theme") || "Light");
  const [appFontSize, setAppFontSize] = useState(localStorage.getItem("app_font_size") || "Medium");
  const [appAccentColor, setAppAccentColor] = useState(localStorage.getItem(ACCENT_KEY) || "blue");

  // Account (profile) state
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [jobTitle, setJobTitle] = useState(user?.role === "Client Admin" ? "System Administrator" : user?.role || "");
  const [department, setDepartment] = useState("IT");
  const [timezone, setTimezone] = useState("UTC-5  \u00B7 Eastern Time");
  const [language, setLanguage] = useState("English (US)");

  // Archived filter
  const [archivedFilter, setArchivedFilter] = useState<string>("All");

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

  const handleSaveAccount = (e: React.FormEvent): void => {
    e.preventDefault();
    updateProfile({ firstName, lastName, email, phone, role: user?.role || "Client Admin" });
    toast.success("Profile updated successfully!");
  };

  const handleSaveOrganization = (): void => {
    if (tenant) {
      updateTenant(tenant.id, { name: orgName, email: orgEmail, phone: orgPhone, address: orgAddress, industry: orgIndustry, timezone: orgTimezone, currency: orgCurrency, domain: orgDomain });
      toast.success("Organization settings saved successfully");
    }
  };

  // -- Profile Settings Tab --
  const renderProfileTab = (): React.ReactElement => (
    <form onSubmit={handleSaveAccount} className="space-y-6 max-w-2xl">
      {/* Profile Banner */}
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-[#25313D] via-[#2E3B48] to-[#384653] relative" />
        <div className="px-5 pb-5">
          {/* Avatar row - overlaps banner */}
          <div className="flex items-end justify-between -mt-8">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] border-4 border-white dark:border-slate-900 flex items-center justify-center text-white text-lg font-bold shadow-md">
                {firstName.charAt(0)}{lastName.charAt(0)}
              </div>
              <button type="button" onClick={() => toast.info("Photo upload is coming soon.")}
                className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow text-slate-600 dark:text-slate-300 hover:scale-105 transition-transform cursor-pointer"
                aria-label="Change profile photo">
                <Camera size={11} />
              </button>
            </div>
            <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-500/10 flex items-center gap-1.5 w-fit">
              <Shield size={11} /> {user?.role === "Client Admin" ? "Administrator" : user?.role || "Admin"}
            </span>
          </div>
          {/* Name - always below banner */}
          <div className="mt-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{firstName} {lastName}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{user?.role || "Administrator"} {"\u00B7"} {tenant?.name || "Organization"}</p>
          </div>
        </div>
      </div>

      {/* Personal Info */}
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Personal Information</h3>
          <p className="text-xs text-slate-400 mt-0.5">Your name and contact details visible to teammates</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="profile-first-name">First Name</label>
            <input id="profile-first-name" type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#1B252F] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="profile-last-name">Last Name</label>
            <input id="profile-last-name" type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#1B252F] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="profile-email">Email Address</label>
          <div className="relative">
            <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="profile-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#1B252F] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="profile-phone">Phone Number</label>
          <div className="relative">
            <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="profile-phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#1B252F] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="profile-job-title">Job Title</label>
            <input id="profile-job-title" type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#1B252F] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="profile-department">Department</label>
            <input id="profile-department" type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#1B252F] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Lock size={14} className="text-[#3B82F6]" /> Security
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Manage your password and two-factor authentication</p>
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Password</p>
            <p className="text-[10px] text-slate-400">Last changed: Never</p>
          </div>
          <button type="button" onClick={() => toast.success("Password updated successfully.")}
            className="px-3 py-1.5 bg-white dark:bg-[#2E3B48] border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#384653] transition-colors cursor-pointer">
            Change Password
          </button>
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Two-Factor Authentication</p>
            <p className="text-[10px] text-slate-400">Adds an extra layer of security</p>
          </div>
          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded-full border border-amber-500/20">Not enabled</span>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="flex items-center gap-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white font-semibold px-5 py-2 rounded-lg text-xs transition-all shadow-sm cursor-pointer">
          <Save size={13} /> Save Changes
        </button>
      </div>
    </form>
  );

  // -- Account Details Tab (Admin only) --
  const renderAccountDetailsTab = (): React.ReactElement => (
    <div className="max-w-2xl space-y-4">
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
            <p className="text-xs font-mono text-slate-700 dark:text-slate-300">{tenant?.id || 'N/A'}</p>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Subscription Plan</p>
            <span className="px-2 py-0.5 bg-[#3B82F6]/10 text-[#3B82F6] dark:text-[#60A5FA] text-[10px] font-bold rounded-full border border-[#3B82F6]/20">Professional</span>
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
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-[#3B82F6]" /> Billing Summary
        </h3>
        <div className="flex items-center justify-between p-4 bg-[#3B82F6]/5 border border-[#3B82F6]/20 rounded-xl">
          <div>
            <p className="text-xs font-bold text-slate-900 dark:text-white">Professional Plan {"\u00B7"} Monthly</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Next billing: September 8, 2026</p>
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">₱3,600<span className="text-[10px] text-slate-400 font-normal">/mo</span></p>
        </div>
      </div>
    </div>
  );

  // -- Account Tab --
  const renderAccountTab = (): React.ReactElement => (
    <form onSubmit={handleSaveAccount} className="space-y-6 max-w-2xl">
      {/* Profile Banner */}
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-slate-200 via-slate-150 to-slate-100 dark:from-slate-800 dark:to-slate-850 relative" />
        <div className="p-5 pt-0 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex flex-col sm:flex-row gap-3 -mt-8 sm:items-end">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-full bg-slate-800 border-4 border-white dark:border-slate-900 flex items-center justify-center text-white text-lg font-bold shadow-md">
                {firstName.charAt(0)}{lastName.charAt(0)}
              </div>
              <button type="button" onClick={() => toast.info("Photo upload is coming soon.")}
                className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow text-slate-600 dark:text-slate-300 hover:scale-105 transition-transform cursor-pointer"
                aria-label="Change profile photo">
                <Camera size={11} />
              </button>
            </div>
            <div className="pb-1">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">{firstName} {lastName}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{user?.role || "Administrator"} {"\u00B7"} {tenant?.name || "Organization"}</p>
            </div>
          </div>
          <span className="pb-1 px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-500/10 flex items-center gap-1.5 w-fit">
            <Shield size={11} /> {user?.role === "Client Admin" ? "Administrator" : user?.role || "Admin"}
          </span>
        </div>
      </div>

      {/* Basic Info */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Basic Information</h3>
          <p className="text-xs text-slate-400 mt-0.5">Your name and contact details visible to teammates</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="settings-first-name">First Name</label>
            <input id="settings-first-name" type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="settings-last-name">Last Name</label>
            <input id="settings-last-name" type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="settings-email">Email Address</label>
          <div className="relative">
            <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="settings-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="settings-phone">Phone Number</label>
          <div className="relative">
            <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="settings-phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="settings-job-title">Job Title</label>
            <input id="settings-job-title" type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider" htmlFor="settings-department">Department</label>
            <input id="settings-department" type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="flex items-center gap-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white font-semibold px-5 py-2 rounded-lg text-xs transition-all shadow-sm cursor-pointer">
          <Save size={13} /> Save Changes
        </button>
      </div>
    </form>
  );

  // -- Appearance Tab --
  const renderAppearanceTab = (): React.ReactElement => (
    <div className="max-w-2xl space-y-6">
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

  // -- Memberships Tab --
  const renderMembershipsTab = (): React.ReactElement => (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Building size={14} className="text-[#3B82F6]" /> Organization Membership
        </h3>
        <div className="p-4 bg-slate-50 dark:bg-[#1B252F] rounded-xl border border-slate-100 dark:border-slate-700/60 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white dark:bg-[#2E3B48] border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
            <Building2 size={16} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{tenant?.name || "Organization"}</p>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">{user?.role || "Member"}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Contact a system administrator to change your organization membership.</p>
      </div>
    </div>
  );

  // â”€â”€ Org General Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderOrgGeneralTab = (): React.ReactElement => (
    <div className="max-w-2xl space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-name">Organization Name</label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input id="org-name" type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-industry">Industry</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input id="org-industry" type="text" value={orgIndustry} onChange={(e) => setOrgIndustry(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-email">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input id="org-email" type="email" value={orgEmail} onChange={(e) => setOrgEmail(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-phone">Phone</label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input id="org-phone" type="text" value={orgPhone} onChange={(e) => setOrgPhone(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-domain">Domain</label>
          <div className="relative">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input id="org-domain" type="text" value={orgDomain} onChange={(e) => setOrgDomain(e.target.value)} placeholder="e.g., example.com"
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-timezone">Timezone</label>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <select id="org-timezone" value={orgTimezone} onChange={(e) => setOrgTimezone(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors appearance-none">
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="Europe/London">London (GMT/BST)</option>
              <option value="Asia/Manila">Philippine Time (PHT)</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-currency">Currency</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <select id="org-currency" value={orgCurrency} onChange={(e) => setOrgCurrency(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors appearance-none">
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (â‚¬)</option>
              <option value="GBP">GBP (Â£)</option>
              <option value="PHP">PHP (â‚±)</option>
              <option value="AUD">AUD ($)</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="org-address">Office Address</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-500" />
            <textarea id="org-address" value={orgAddress} onChange={(e) => setOrgAddress(e.target.value)} rows={2}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3B82F6] transition-colors resize-none" />
          </div>
        </div>
      </div>
      {canEditSettings && (
        <div className="flex justify-end">
          <button onClick={handleSaveOrganization}
            className="flex items-center gap-2 px-5 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg text-xs font-semibold transition-all shadow-sm cursor-pointer">
            <Save className="w-3.5 h-3.5" /> Save Changes
          </button>
        </div>
      )}
    </div>
  );

  // â”€â”€ Users (Team Management) Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderUsersTab = (): React.ReactElement => <TeamManagement />;

  // â”€â”€ Archived Data Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderArchivedTab = (): React.ReactElement => {
    const allArchived = [
      ...organizations.filter((o) => o.isArchived).map((o) => ({ type: "Organization", id: o.id, name: o.name })),
      ...contacts.filter((c) => c.isArchived).map((c) => ({ type: "Contact", id: c.id, name: c.contactPerson + " (" + c.companyName + ")" })),
      ...deals.filter((d) => d.isArchived).map((d) => ({ type: "Deal", id: d.id, name: d.title })),
      ...pipelines.filter((p) => p.isArchived).map((p) => ({ type: "Pipeline", id: p.id, name: p.name })),
      ...workflows.filter((w) => w.isArchived).map((w) => ({ type: "Workflow", id: w.id, name: w.name })),
      ...campaigns.filter((c) => c.isArchived).map((c) => ({ type: "Campaign", id: c.id, name: c.name })),
      ...templates.filter((t) => t.isArchived).map((t) => ({ type: "Template", id: t.id, name: t.name })),
      ...roles.filter((r) => r.isArchived).map((r) => ({ type: "Role", id: r.id, name: r.name })),
      ...users.filter((u) => u.isArchived).map((u) => ({ type: "User", id: u.id, name: `${u.firstName} ${u.lastName}` })),
    ];
    const filteredArchived = archivedFilter === "All" ? allArchived : allArchived.filter((x) => x.type === archivedFilter);

    return (
      <div className="max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Archived Data Recovery</h3>
            <p className="text-xs text-slate-400 mt-0.5">Restore records previously archived instead of deleted.</p>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["All", "Contact", "Organization", "Deal", "Pipeline", "User", "Role", "Workflow", "Campaign", "Template"].map((type) => (
            <button key={type} onClick={() => setArchivedFilter(type)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${archivedFilter === type ? "bg-[#3B82F6] text-white" : "bg-slate-100 dark:bg-[#1B252F] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
              {type}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {filteredArchived.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 dark:bg-[#25313D] rounded-xl border border-dashed border-slate-200 dark:border-slate-700/60">
              <Archive className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">No archived records found.</p>
            </div>
          ) : (
            filteredArchived.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-xl">
                <div>
                  <span className="text-[10px] font-bold text-[#3B82F6] uppercase tracking-wider">{item.type}</span>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white mt-0.5">{item.name}</p>
                </div>
                <button onClick={() => { restoreRecord(item.type as Parameters<typeof restoreRecord>[0], item.id); toast.success(`${item.type} restored`); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3B82F6]/10 hover:bg-[#3B82F6]/15 dark:bg-[#3B82F6]/10 dark:hover:bg-[#3B82F6]/20 text-[#3B82F6] dark:text-[#60A5FA] rounded-lg text-xs font-semibold transition-colors cursor-pointer">
                  <RefreshCw size={12} /> Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // â”€â”€ Plan & Billing Tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderPlanTab = (): React.ReactElement => (
    <PlanUsageTab />
  );

  const renderBillingTab = (): React.ReactElement => (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[#3B82F6]" /> Payment Methods & Billing Profile
        </h3>
        <div className="p-4 border border-dashed border-gray-200 dark:border-slate-700 rounded-xl text-center space-y-3">
          <Receipt className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Primary Payment Card</p>
            <p className="text-xs text-slate-400">Visa ending in â€¢â€¢â€¢â€¢ 4242 (Expires 12/28)</p>
          </div>
          <button 
            type="button"
            onClick={() => toast.success('Payment method update link generated!')}
            className="px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Update Payment Method
          </button>
        </div>
      </div>
    </div>
  );

  const renderCustomFieldsTab = (): React.ReactElement => (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#3B82F6]" /> Custom Fields
        </h3>
        <div className="text-center py-8 border border-dashed border-gray-200 dark:border-slate-700 rounded-xl">
          <Zap className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">Custom fields configuration coming soon.</p>
        </div>
      </div>
    </div>
  );

  const tabContentMap: Record<Exclude<SettingsTab, 'forms' | 'roles' | 'audit'>, () => React.ReactElement> = {
    'profile': renderProfileTab,
    'appearance': renderAppearanceTab,
    'memberships': renderMembershipsTab,
    'org-general': renderOrgGeneralTab,
    'users': renderUsersTab,
    'custom-fields': renderCustomFieldsTab,
    'archived': renderArchivedTab,
    'account-details': renderAccountDetailsTab,
    'plan': renderPlanTab,
    'billing': renderBillingTab,
  };

  const VALID_TABS: SettingsTab[] = ['profile', 'appearance', 'memberships', 'org-general', 'users', 'roles', 'custom-fields', 'archived', 'account-details', 'plan', 'billing', 'forms', 'audit'];
  useEffect(() => {
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl as SettingsTab)) {
      setActiveTab(tabFromUrl as SettingsTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);

  const activeGroup = visibleNavGroups.find((g) => g.items.some((i) => i.id === activeTab));
  const activeItem = activeGroup?.items.find((i) => i.id === activeTab);

  return (
    <div className="flex flex-col lg:flex-row h-full -m-4 lg:-m-6 min-h-[calc(100vh-4rem)]">
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
          activeTab === 'users' ||
          activeTab === 'roles' ||
          activeTab === 'audit' ||
          activeTab === 'plan' ||
          (activeTab === 'forms' && isFormBuilderActive);

        return (
          <div className={`flex-1 overflow-y-auto custom-scrollbar ${isFullPane ? '' : 'px-4 sm:px-6 py-5'}`}>
            {!isFullPane && !hasOwnHeader && (
              <div className="mb-5">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">{activeItem?.label ?? 'Settings'}</h1>
              </div>
            )}
            {activeTab === 'forms'
              ? <FormsTab onBuilderActiveChange={setIsFormBuilderActive} />
              : activeTab === 'audit'
              ? <AuditLogsPage />
              : activeTab === 'roles'
              ? <RolesPermissions onViewActiveChange={setIsRolesViewActive} />
              : tabContentMap[activeTab as Exclude<SettingsTab, 'forms' | 'roles' | 'audit'>]()
            }
          </div>
        );
      })()}
    </div>
  );
}
