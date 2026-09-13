'use client';

import React from 'react';
import { Shield, LogOut, Check } from 'lucide-react';
import { useAuth } from '@/store/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface SwitchAccount {
  email: string;
  password: string;
  label: string;
  role: string;
  initials: string;
}

interface AccountDropdownProps {
  isOpen: boolean;
  onToggle: () => void;
  navigate: (path: string) => void;
  /** When true, shows avatar-only button (collapsed sidebar mode) */
  collapsed?: boolean;
}

// â”€â”€ Canonical demo accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Exactly 5 â€” matches backend seed + MOCK_USERS + DEMO_EMAILS allowlist.
// Passwords are the seeded values; OTP is always '000000' in DEMO_MODE.

const SWITCH_ACCOUNTS: SwitchAccount[] = [
  { email: 'admin@gmail.com',    password: 'admin123', label: 'System Admin',  role: 'System Admin', initials: 'SA' },
  { email: 'super@leadcrm.com', password: 'admin123', label: 'System Admin',  role: 'System Admin', initials: 'SA' },
  { email: 'admin@democorp.com', password: 'admin123', label: 'Alice Admin',   role: 'Client Admin', initials: 'AA' },
  { email: 'bob@democorp.com',   password: 'admin123', label: 'Bob Sales',     role: 'User',         initials: 'BS' },
  { email: 'guest@democorp.com', password: 'guest123', label: 'Guest User',    role: 'Guest',        initials: 'GU' },
];

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function AccountDropdown({
  isOpen,
  onToggle,
  navigate: _navigate,
  collapsed = false,
}: AccountDropdownProps): React.ReactElement {
  const { user, switchDemoAccount, logout } = useAuth();

  const handleSwitch = (acc: SwitchAccount) => {
    if (user?.email === acc.email) { onToggle(); return; }
    onToggle();
    switchDemoAccount(acc.email, acc.password).then((ok) => {
      if (ok) toast.success(`Switched to ${acc.label} (${acc.role})`);
      else    toast.error(`Could not switch to ${acc.email}`);
    });
  };

  const handleLogout = () => {
    onToggle();
    logout().then(() => toast.success('Logged out'));
  };

  const initials = `${user?.firstName?.charAt(0) ?? 'U'}${user?.lastName?.charAt(0) ?? ''}`.toUpperCase();

  // â”€â”€ Collapsed mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (collapsed) {
    return (
      <div className="relative flex justify-center pb-2">
        <button
          onClick={onToggle}
          title={`${user?.firstName ?? ''} ${user?.lastName ?? ''} Â· ${user?.role ?? ''}`}
          className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center text-white font-bold text-[11px] cursor-pointer hover:ring-2 hover:ring-[#3B82F6]/40 transition-all"
        >
          {initials}
        </button>

        {isOpen && (
          <div className="absolute left-full bottom-0 ml-2 w-60 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-xl z-50 overflow-hidden py-1.5">
            <DropdownContent
              user={user}
              initials={initials}
              onSwitch={handleSwitch}
              onLogout={handleLogout}
            />
          </div>
        )}
      </div>
    );
  }

  // â”€â”€ Full mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="shrink-0 border-t border-gray-200 dark:border-white/[0.08] px-3 pt-2 pb-3 relative">
      {isOpen && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-xl z-50 overflow-hidden py-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <DropdownContent
            user={user}
            initials={initials}
            onSwitch={handleSwitch}
            onLogout={handleLogout}
          />
        </div>
      )}

      {/* Profile trigger */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.04] p-2 transition-all cursor-pointer border border-transparent active:scale-[0.98]"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center text-white font-extrabold text-[11px] shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-xs font-bold text-slate-900 dark:text-white truncate leading-tight">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {user?.email}
          </p>
        </div>
      </button>
    </div>
  );
}

// â”€â”€ Shared inner dropdown content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface DropdownContentProps {
  user: ReturnType<typeof useAuth>['user'];
  initials: string;
  onSwitch: (acc: SwitchAccount) => void;
  onLogout: () => void;
}

function DropdownContent({ user, initials, onSwitch, onLogout }: DropdownContentProps): React.ReactElement {
  return (
    <>
      {/* Current user summary */}
      <div className="px-4 py-3 bg-slate-50/60 dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/[0.05] mb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center text-white font-bold text-[11px] shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[10px] text-slate-400 truncate mt-0.5">{user?.email}</p>
          </div>
          <span className="shrink-0 px-2 py-0.5 bg-red-500 text-white text-[10px] font-extrabold rounded-md uppercase tracking-wide flex items-center gap-1 select-none">
            <Shield size={9} />
            <span>{user?.role === 'Client Admin' ? 'Admin' : (user?.role ?? 'User')}</span>
          </span>
        </div>
      </div>

      {/* Section label */}
      <div className="px-4 pt-1.5 pb-1">
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          Switch Role / Demo Host
        </p>
      </div>

      {/* 5 canonical demo accounts */}
      <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
        {SWITCH_ACCOUNTS.map((acc) => {
          const isCurrent = user?.email === acc.email;
          return (
            <button
              key={acc.email}
              onClick={() => onSwitch(acc)}
              className={cn(
                'w-full text-left px-4 py-2 transition-colors flex items-center justify-between gap-2 cursor-pointer',
                isCurrent
                  ? 'bg-[#3B82F6]/5 dark:bg-[#3B82F6]/10'
                  : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]',
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0',
                  isCurrent
                    ? 'bg-[#3B82F6] text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
                )}>
                  {acc.initials}
                </div>
                <div className="min-w-0">
                  <p className={cn(
                    'text-xs font-semibold truncate',
                    isCurrent ? 'text-[#3B82F6] dark:text-[#60A5FA]' : 'text-slate-800 dark:text-slate-200',
                  )}>
                    {acc.label}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{acc.role}</p>
                </div>
              </div>
              {isCurrent && <Check size={12} className="text-[#3B82F6] dark:text-[#60A5FA] shrink-0" />}
            </button>
          );
        })}
      </div>

      <div className="h-px bg-slate-100 dark:bg-white/[0.06] my-1" />

      {/* Logout */}
      <button
        onClick={onLogout}
        className="w-full text-left px-4 py-2 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 transition-colors flex items-center gap-2.5 font-semibold text-xs cursor-pointer"
      >
        <div className="w-5 h-5 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center shrink-0">
          <LogOut size={11} className="text-rose-500" />
        </div>
        Log out
      </button>
    </>
  );
}
