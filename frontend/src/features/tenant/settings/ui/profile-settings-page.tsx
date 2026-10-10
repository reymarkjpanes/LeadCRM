'use client';

import { useNotificationPreferences } from '@/features/tenant/notifications/hooks/use-notification-preferences';
import { SecuritySettings } from './security-settings';
import { ProfileForm } from './profile-form';
import React, { useState } from "react";
import {
  User,
  Lock,
  Bell,
  Save,
  Palette,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import { toast } from "sonner";
import { AppearanceSettings } from '@/shared/components/appearance-settings';
import { BackButton } from "@/shared/components/ui/back-button";

interface ProfileSettingsPageProps {
  navigate: (path: string) => void;
}

export default function ProfileSettingsPage({
  navigate,
}: ProfileSettingsPageProps) {


  // Active Tab: 'Personal Info' | 'Appearance' | 'Security' | 'Notifications'
  const [activeTab, setActiveTab] = useState<
    "Personal Info" | "Appearance" | "Security" | "Notifications"
  >("Personal Info");

  const notificationPreferences = useNotificationPreferences();
  const { leadAssignmentEmail: notiEmailLeads, dailyPipelineBriefing: notiEmailPipeline, urgentHotLeadSms: notiSmsHot, inAppGeneral: notiPushAll } = notificationPreferences.data;
  const handleSaveNotifications = notificationPreferences.save;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Top Header Navigation */}
      <div className="flex items-center gap-4">
        <BackButton label="Back to Settings" onClick={() => navigate("/settings")} />
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Profile Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage your account, security, and notifications
          </p>
        </div>
      </div>

      {/* Horizontal Pills Tab Container */}
      <div className="bg-slate-150/60 dark:bg-slate-900 p-1 rounded-xl flex flex-wrap sm:flex-nowrap gap-1 w-full max-w-2xl select-none">
        <button
          onClick={() => setActiveTab("Personal Info")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === "Personal Info"
              ? "bg-white dark:bg-slate-800 text-foreground shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <User size={13} />
          <span>Personal Info</span>
        </button>

        <button
          onClick={() => setActiveTab("Appearance")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === "Appearance"
              ? "bg-white dark:bg-slate-800 text-foreground shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Palette size={13} />
          <span>Appearance</span>
        </button>
        <button
          onClick={() => setActiveTab("Security")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === "Security"
              ? "bg-white dark:bg-slate-800 text-foreground shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Lock size={13} />
          <span>Security</span>
        </button>
        <button
          onClick={() => setActiveTab("Notifications")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === "Notifications"
              ? "bg-white dark:bg-slate-800 text-foreground shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Bell size={13} />
          <span>Notifications</span>
        </button>
      </div>

      {/* Tab Panes */}
      <div className="space-y-6">
        {/* Tab 1: Personal Info */}
        {activeTab === "Personal Info" && <ProfileForm />}

        {/* Tab: Appearance */}
        {activeTab === "Appearance" && <AppearanceSettings />}

        {activeTab === "Security" && <SecuritySettings />}

        {/* Tab 3: Notifications */}
        {activeTab === "Notifications" && (
          <div className="space-y-6">
            {/* Preferences */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/[0.06] rounded-2xl p-6 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Notification Channels
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  Control pipeline summaries, daily lead updates and secure
                  triggers
                </p>
              </div>

              <div className="space-y-4">
                {/* Switch item 1 */}
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-white/[0.03]">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      Lead Assignment Email Alerts
                    </span>
                    <span className="text-[10px] text-slate-400 block max-w-sm mt-0.5">
                      Unavailable: Lead assignment email delivery is not implemented.
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled role="switch" aria-label="Lead Assignment Email Alerts — unavailable" aria-checked={false}
                    className={`w-11 h-6 rounded-full transition-colors flex items-center p-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 shrink-0 ${
                      notiEmailLeads
                        ? "bg-primary"
                        : "bg-slate-300 dark:bg-slate-850"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-all transform ${
                        notiEmailLeads ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Switch item 2 */}
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-white/[0.03]">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      Daily Pipeline Briefing reports
                    </span>
                    <span className="text-[10px] text-slate-400 block max-w-sm mt-0.5">
                      Unavailable: Scheduled daily briefings are not implemented.
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled role="switch" aria-label="Daily Pipeline Briefing reports — unavailable" aria-checked={false}
                    className={`w-11 h-6 rounded-full transition-colors flex items-center p-1 cursor-pointer shrink-0 ${
                      notiEmailLeads
                        ? "bg-primary"
                        : "bg-slate-300 dark:bg-slate-850"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-all transform ${
                        notiEmailPipeline ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Switch item 3 */}
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-white/[0.03]">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      Urgent hot lead SMS notification cascade
                    </span>
                    <span className="text-[10px] text-slate-400 block max-w-sm mt-0.5">
                      Unavailable: Staff SMS alerts and consent controls are not configured.
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled role="switch" aria-label="Urgent Hot Lead SMS notifications — unavailable" aria-checked={false}
                    className={`w-11 h-6 rounded-full transition-colors flex items-center p-1 cursor-pointer shrink-0 ${
                      notiSmsHot
                        ? "bg-primary"
                        : "bg-slate-300 dark:bg-slate-850"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-all transform ${
                        notiSmsHot ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Switch item 4 */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      In-app general notification alerts
                    </span>
                    <span className="text-[10px] text-slate-400 block max-w-sm mt-0.5">
                      Show optional operational notifications in the app. Account-integrity alerts remain enabled.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch" aria-label="In-app general notification alerts" aria-checked={notiPushAll}
                    disabled={!notificationPreferences.ready || notificationPreferences.loading || notificationPreferences.saving}
                    onClick={() => notificationPreferences.setInApp(!notiPushAll)}
                    className={`w-11 h-6 rounded-full transition-colors flex items-center p-1 cursor-pointer shrink-0 ${
                      notiPushAll
                        ? "bg-primary"
                        : "bg-slate-300 dark:bg-slate-850"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-all transform ${
                        notiPushAll ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {notificationPreferences.loading && <p role="status" className="text-sm text-muted-foreground">Loading notification preferences...</p>}
            {notificationPreferences.error && <p role="alert" className="text-sm text-red-600">{notificationPreferences.error} <button className="underline" onClick={notificationPreferences.retry}>Reload</button></p>}
            {/* Save button row */}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => void handleSaveNotifications()}
                disabled={!notificationPreferences.ready || notificationPreferences.loading || notificationPreferences.saving || !notificationPreferences.dirty}
                className="flex items-center gap-2 bg-slate-950 hover:bg-slate-900 dark:bg-slate-50 dark:hover:bg-slate-100 text-white dark:text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs select-none transition-transform hover:scale-[1.02] active:scale-[0.98] shadow-sm cursor-pointer"
              >
                <Save size={14} />
                <span>{notificationPreferences.saving ? 'Saving...' : !notificationPreferences.ready || notificationPreferences.dirty ? 'Save Channels' : 'Saved'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
