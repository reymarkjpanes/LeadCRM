'use client';
import dynamic from 'next/dynamic';
const ClosingRecordPanel = dynamic(() => import('@/shared/components/crm/crm-record-view').then(module => module.CrmRecordPanel), { ssr: false });
import {taskAssociationIds, taskAssociationPatch} from "@leadcrm/shared";

import { isOnboardingComplete, WorkflowDraftSchema, type WorkflowDraft } from "@leadcrm/shared";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  Organization,
  Contact,
  Deal,
  Pipeline,
  Workflow,
  Campaign,
  User,
  Template,
  RoleDefinition,
  Permission,
  Task,
  AuditLog,
  Activity,
} from "./types";
import {
  MOCK_LEADS,
  MOCK_DEALS,
  MOCK_PIPELINES,
  MOCK_CAMPAIGNS,
  MOCK_USERS,
  MOCK_TENANTS,
  MOCK_TEMPLATES,
  MOCK_TASKS,
} from "./mockData/index";
import { uuid } from "@/lib/utils";

// ── Real-API integration ─────────────────────────────────────────────────────
import { toast } from 'sonner';
import { usersService } from "@/features/tenant/administration/users/services/users.service";
import { rolesApi } from '@/shared/services/roles.api';
import { rolesService, toSettingsRole, toSettingsPermissions, toPermissionRows } from '@/features/tenant/administration/roles/services/roles.service';
import { USE_MOCK_DATA } from "@/lib/config";
import { invalidatePageCache } from "@/shared/cache/page-cache";
import { leadsService as contactsService } from "@/features/tenant/crm/leads/services/leads.service";
import { accountsService as organizationsService } from "@/features/tenant/crm/accounts/services/accounts.service";
import { pipelineService } from "@/features/tenant/crm/pipeline/services/pipeline.service";
import { activitiesService } from "@/features/tenant/crm/activities/services/activities.service";
import { CreateTaskSchema, UpdateTaskSchema, TaskBulkSchema, TaskStatusSchema, type CreateTaskInput, type TaskBulkInput, type TaskBulkResult, type TaskListQuery, type TaskPage, type TaskSummary } from '@leadcrm/shared';
import { useTaskQueries, taskDueInstant } from '@/features/tenant/operations/tasks/task-data';
import { tasksApi } from "@/shared/services/tasks.api";
import { workflowsApi } from "@/shared/services/workflows.api";
import { campaignsApi } from "@/shared/services/campaigns.api";
import { templatesApi } from "@/shared/services/templates.api";
import { preferencesApi } from "@/shared/services/preferences.api";
import type { ColumnConfigItem } from '@leadcrm/shared';
import {
  toBackendCreateContact,
  toBackendUpdateContact,
  toFrontendContact,
} from "@/lib/api/adapters/contact.adapter";
import {
  toBackendCreateOrg,
  toBackendUpdateOrg,
  toFrontendOrg,
} from "@/lib/api/adapters/organization.adapter";
import {
  toBackendCreateDeal,
  toBackendUpdateDeal,
  toFrontendDeal,
} from "@/lib/api/adapters/deal.adapter";
import {
  toFrontendPipeline, toBackendCreatePipeline, toBackendUpdatePipeline,
} from "@/lib/api/adapters/pipeline.adapter";
// ─────────────────────────────────────────────────────────────────────────────

interface DataContextType {
  organizations: Organization[];
  contacts: Contact[];
  deals: Deal[];
  pipelines: Pipeline[];
  workflows: Workflow[];
  workflowsLoading: boolean;
  workflowsError: string;
  refreshWorkflows: () => Promise<void>;
  campaigns: Campaign[];
  templates: Template[];
  roles: RoleDefinition[];
  permissions: Permission[];
  rolesLoading: boolean;
  rolesError: string;
  refreshRoles: () => Promise<void>;
  users: User[];
  tasks: Task[];
  tasksRevision: number;
  queryTasks: (query?: TaskListQuery) => Promise<TaskPage>;
  queryTaskSummary: (query?: TaskListQuery) => Promise<TaskSummary>;
  refreshTasks: () => void;
  bulkTasks: (input: TaskBulkInput) => Promise<TaskBulkResult>;
  activities: Activity[];
  addActivity: (activity: Omit<Activity, 'id' | 'tenantId'>) => void;
  auditLogs: AuditLog[];
  addContact: (
    contact: Omit<Contact, "id" | "tenantId" | "createdAt" | "score">,
  ) => Promise<void>;
  refreshContacts: () => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  refreshDeals: () => Promise<void>;
  refreshPipelines: () => Promise<void>;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<void>;
  addOrganization: (
    org: Omit<Organization, "id" | "tenantId" | "createdAt">,
  ) => Promise<string | null>;
  updateOrganization: (id: string, updates: Partial<Organization>) => Promise<void>;
  addDeal: (deal: Omit<Deal, "id" | "tenantId" | "createdAt">) => Promise<void>;
  updateDeal: (id: string, updates: Partial<Deal>) => Promise<void>;
  moveDealStage: (id: string, stageId: string, note?: string, lostReason?: string, handoff?: any) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;
  addPipeline: (pipeline: Omit<Pipeline, "id" | "tenantId">) => Promise<void>;
  updatePipeline: (id: string, updates: Partial<Pipeline>) => Promise<void>;
  deletePipeline: (id: string) => Promise<void>;
  addTask: (task: CreateTaskInput) => Promise<void>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addWorkflow: (
    workflow: WorkflowDraft,
  ) => Promise<Workflow>;
  updateWorkflow: (id: string, updates: Partial<WorkflowDraft>) => Promise<Workflow>;
  deleteWorkflow: (id: string) => Promise<void>;
  toggleWorkflow: (id: string) => Promise<void>;
  addCampaign: (
    campaign: Omit<
      Campaign,
      | "id"
      | "tenantId"
      | "createdAt"
      | "sentCount"
      | "openedCount"
      | "clickedCount"
      | "engagement"
    >,
  ) => Promise<void>;
  updateCampaign: (id: string, updates: Partial<Campaign>) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;
  addTemplate: (
    template: Omit<Template, "id" | "tenantId" | "createdAt">,
  ) => Promise<void>;
  updateTemplate: (id: string, updates: Partial<Template>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  reorderDeals: (reorderedDeals: Deal[]) => void;
  addRole: (
    role: Omit<RoleDefinition, "id" | "tenantId" | "updatedAt">,
  ) => Promise<void>;
  updateRole: (id: string, updates: Partial<RoleDefinition>) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  addUser: (userData: any) => void;
  updateUser: (id: string, updates: Partial<any>) => void;
  deleteUser: (id: string) => void;
  restoreRecord: (
    type:
      | "Deal"
      | "Pipeline"
      | "Workflow"
      | "Campaign"
      | "Template"
      | "Role"
      | "User",
    id: string,
  ) => void;
  resetDemoData: () => void;
  addAuditLog: (action: string, details: string) => void;

  // Column Preferences
  columnPreferences: Record<string, ColumnConfigItem[]>;
  columnPreferencesLoading: boolean;
  saveColumnPreference: (module: string, columns: ColumnConfigItem[]) => Promise<void>;
  resetColumnPreference: (module: string) => Promise<void>;
}

// Column defaults remain available when preferences cannot be loaded.
const LEADS_SYSTEM_DEFAULT: ColumnConfigItem[] = [
  { id: 'firstName', visible: true, order: 0 },
  { id: 'lastName', visible: true, order: 1 },
  { id: 'email', visible: true, order: 2 },
  { id: 'phone', visible: true, order: 3 },
  { id: 'companyName', visible: true, order: 4 },
  { id: 'status', visible: true, order: 5 },
  { id: 'source', visible: true, order: 6 },
  { id: 'assignedUserId', visible: true, order: 7 },
  { id: 'productInterest', visible: false, order: 8 },
  { id: 'address', visible: false, order: 9 },
  { id: 'createdAt', visible: true, order: 10 },
  { id: 'accountId', visible: false, order: 11 },
];

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const [closingDealId, setClosingDealId] = useState<string>();
  const { user, tenant, userCan, isLoading: authLoading, authError } = useAuth();
  const workspaceReady = Boolean(!authLoading && !authError && user && (user.status?.toUpperCase() === "ACTIVE" && !user.mustChangePassword &&
      (user.role !== "Client Admin" || isOnboardingComplete(user))));

  const dataIdentity = `${user?.id ?? ''}:${tenant?.id ?? ''}:${workspaceReady}`;
  const dataIdentityRef = useRef(dataIdentity);
  dataIdentityRef.current = dataIdentity;

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(!USE_MOCK_DATA);
  const [workflowsError, setWorkflowsError] = useState('');
  const refreshWorkflows = useCallback(async () => {
    const identity = dataIdentityRef.current;
    setWorkflowsLoading(true); setWorkflowsError('');
    try {
      const rows = await workflowsApi.listAll();
      if (identity === dataIdentityRef.current) setWorkflows(rows);
    } catch (error) {
      if (identity === dataIdentityRef.current) setWorkflowsError(error instanceof Error ? error.message : 'Unable to load workflows.');
    } finally {
      if (identity === dataIdentityRef.current) setWorkflowsLoading(false);
    }
  }, []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState('');
  const roleIdentity = `${user?.id ?? ''}:${tenant?.id ?? ''}:${workspaceReady}`;
  const roleIdentityRef = useRef(roleIdentity);
  roleIdentityRef.current = roleIdentity;
  const canReadRoles = userCan('roles', 'canView');
  const refreshRoles = useCallback(async () => {
    const identity = roleIdentityRef.current;
    if (!workspaceReady || !tenant?.id || !canReadRoles) { setRoles([]); setPermissions([]); setRolesLoading(false); return; }
    setRolesLoading(true); setRolesError('');
    try {
      const [rows, registry] = await Promise.all([rolesService.getAll(), rolesApi.getPermissionModules()]);
      if (identity !== roleIdentityRef.current) return;
      setRoles(rows.map(toSettingsRole)); setPermissions(toSettingsPermissions(registry.data));
    } catch (error) {
      if (identity === roleIdentityRef.current) setRolesError(error instanceof Error ? error.message : 'Unable to load roles.');
    } finally {
      if (identity === roleIdentityRef.current) setRolesLoading(false);
    }
  }, [workspaceReady, tenant?.id, user?.id, canReadRoles]);
  useLayoutEffect(() => {
    setRoles([]); setPermissions([]);
    // Discard obsolete browser-only security data; the API is authoritative in every mode.
    localStorage.removeItem('leadcrm_roles'); localStorage.removeItem('leadcrm_permissions');
    void refreshRoles();
  }, [refreshRoles]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const taskRows = useMemo(() => USE_MOCK_DATA ? tasks.map(task => ({
    ...task,
    leads: taskAssociationIds(task,"lead").flatMap(id=>contacts.find(record=>record.id===id) ?? task.leads?.find(record=>record.id===id) ?? []),
    deals: taskAssociationIds(task,"deal").flatMap(id=>deals.find(record=>record.id===id) ?? task.deals?.find(record=>record.id===id) ?? []),
    accounts: taskAssociationIds(task,"account").flatMap(id=>organizations.find(record=>record.id===id) ?? task.accounts?.find(record=>record.id===id) ?? []),
    assignedUser: users.find(person => person.id === task.assignedUserId) ?? task.assignedUser,
    lead: contacts.find(record => record.id === task.leadId) ?? task.lead,
    deal: deals.find(record => record.id === task.dealId) ?? task.deal,
    account: organizations.find(record => record.id === task.accountId) ?? task.account,
  })) : tasks, [tasks, users, contacts, deals, organizations]);
  const taskQueries = useTaskQueries(dataIdentity, taskRows, USE_MOCK_DATA);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // ── Column Preferences State ───────────────────────────────────────────────
  const [columnPreferences, setColumnPreferences] = useState<Record<string, ColumnConfigItem[]>>({});
  const [columnPreferencesLoading, setColumnPreferencesLoading] = useState(false);
  const columnPreferencesRef = useRef(columnPreferences);
  columnPreferencesRef.current = columnPreferences;

  // Safely parse a localStorage value, falling back to `fallback` if the
  // stored value is missing, "undefined", or otherwise unparseable.
  const safeParse = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw || raw === "undefined" || raw === "null") return fallback;
      return JSON.parse(raw) as T;
    } catch {
      localStorage.removeItem(key); // clear the corrupted entry
      return fallback;
    }
  };

  const sharedIdentity = `${user?.id ?? ""}:${tenant?.id ?? ""}`;
  const loadedSharedIdentity = useRef<string | null>(null);
  const [visibleIdentity, setVisibleIdentity] = useState(dataIdentity);

  const loadData = async () => {
    const loadShared = loadedSharedIdentity.current !== sharedIdentity;
    if (!USE_MOCK_DATA && !workspaceReady) return;
    const identity = dataIdentityRef.current;
    const isCurrent = () => identity === dataIdentityRef.current;
    // ── REAL-API MODE ──────────────────────────────────────────────────────────
    if (!USE_MOCK_DATA) {
      if (!user) return;

      try {
        // Batch 1 — core CRM data (roles excluded — admin-only, 403 for custom roles)
        // Roles load independently through the canonical roles service.
        //
        // ── Migration status (route-scoped data-fetching plan) ──────────────
        //
        // COMPLETED — no longer fetched at startup:
        //   ✅ contacts/leads   → useLeadsData (leads-page.tsx) — server-paginated + server-filtered
        //   ✅ activities       → record timelines fetch contextually
        //   ✅ column prefs     → useColumnPreferences per module
        //   ✅ campaigns        → useCampaignsData (campaigns-page.tsx)
        //   ✅ templates        → useCampaignsData (campaigns-page.tsx, same hook)
        //   ✅ auditLogs        → TimelineDrawer fetches on-demand (settings page)
        //   ✅ accounts list    → useAccounts (accounts-page.tsx) — server-paginated + server-filtered
        //
        // REMAINING — still loaded here (cross-module consumers prevent safe removal):
        //   🔄 organizations   → RecordPanelWrappers, deals-page, contacts-page,
        //                        global-omnibox (partial), use-record-detail
        //   🔄 deals (flat)    → dashboard, reports, sidebar badges, command-palette,
        //                        leads-table, notes-side-panel
        //   🔄 pipelines       → 9 consumers: pipeline-page, deals-page, dashboard,
        //                        reports, RecordPanelWrappers, form components
        //   🔄 users           → 15+ consumers for assignee pickers across all modules
        //   🔄 tasks           → task-board, dashboard, RecordPanelWrappers, deals-page
        //   🔄 workflows       → workflows-page, campaign-builder, settings
        const [orgsRes, dealsRes, pipelinesRes, usersRes] = await Promise.all([
          organizationsService.getAll({ limit: 100 }),
          pipelineService.getDeals(undefined, 100),
          pipelineService.getPipelines(),
          loadShared ? usersService.getAll({ limit: 200 }) : Promise.resolve(null),
        ]);

        if (!isCurrent()) return;
        const apiOrgs      = (orgsRes?.data ?? []).map(toFrontendOrg);
        const apiDeals     = (dealsRes?.data ?? []).map(toFrontendDeal);
        const apiPipelines = Array.isArray((pipelinesRes as any)?.data)
          ? ((pipelinesRes as any).data as any[]).map(toFrontendPipeline)
          : ((pipelinesRes as any)?.data ? [(pipelinesRes as any).data].map(toFrontendPipeline) : []);
        const apiUsers     = usersRes?.data ?? [];

        setOrganizations((apiOrgs as Organization[]).filter((o: any) => !o.isArchived));
        setDeals((apiDeals as Deal[]).filter((d: any) => !d.isArchived));
        setPipelines((apiPipelines as Pipeline[]).filter((p: any) => !p.isArchived));
        if (loadShared) setUsers((apiUsers as any[]).filter((u: any) => !u.isArchived));
      } catch (err) {
        if (!isCurrent()) return;
        console.error('[DataContext] Failed to load CRM data from API:', err);
        // RC-03 fix: surface genuine transport failures as a user-visible toast so
        // the dashboard never silently shows empty data without explanation.
        // 403 permission responses are excluded -- those are expected for restricted
        // modules and should not alarm the user with a generic error.
        if (err instanceof Error && !err.message.includes('403')) {
          toast.error('Failed to load data. Please refresh the page.');
        }
      }

      if (!isCurrent()) return;
      if (loadShared) loadedSharedIdentity.current = sharedIdentity;

      if (!isCurrent()) return;
      // Batch 2 — deferred after initial paint so Batch 1 data renders first

      // Defer network-heavy secondary modules to the next event-loop tick.
      // Batch 2 COMPLETED migrations (removed from startup):
      //   ✅ auditLogs  → TimelineDrawer fetches on-demand
      //   ✅ campaigns  → useCampaignsData hook (campaigns-page.tsx)
      //   ✅ templates  → useCampaignsData hook (same)
      // Tasks are queried on demand by their existing DataProvider owner.
      void refreshWorkflows();

      return; // Exit — mock path below is skipped in real mode

    }
    // ── MOCK / LOCALSTORAGE MODE (unchanged below) ─────────────────────────────

    let orgs = safeParse<Organization[] | null>("leadcrm_organizations", null);
    let l = safeParse("leadcrm_leads", MOCK_LEADS);

    // Force refresh leads & deals seed data v7
    if (!localStorage.getItem("leadcrm_migrated_v7")) {
      l = MOCK_LEADS;
      localStorage.setItem("leadcrm_leads", JSON.stringify(l));
      localStorage.setItem("leadcrm_deals", JSON.stringify(MOCK_DEALS));
      orgs = null;
      localStorage.removeItem("leadcrm_organizations");
      localStorage.setItem("leadcrm_migrated_v7", "true");
    } else {
      // Ensure any missing seed items or updateStatus fields are merged
      const parsedLeads = l || [];
      const leadMap = new Map(parsedLeads.map((x: any) => [x.id, x]));
      const mergedLeadsList = [...parsedLeads];

      MOCK_LEADS.forEach((ml) => {
        if (!leadMap.has(ml.id)) {
          mergedLeadsList.push(ml);
        } else {
          const idx = mergedLeadsList.findIndex((x: any) => x.id === ml.id);
          if (idx !== -1) {
            mergedLeadsList[idx] = {
              ...ml,
              ...mergedLeadsList[idx],
              updateStatus: mergedLeadsList[idx].updateStatus || ml.updateStatus,
            };
          }
        }
      });
      l = mergedLeadsList;
    }

    // MIGRATION: Auto-extract Organizations from Leads if not done yet
    if (!orgs && l && l.length > 0) {
      orgs = [];
      const orgMap: Record<string, string> = {}; // Name to ID
      const orgList = orgs as NonNullable<typeof orgs>;

      l.forEach((lead: any) => {
        if (lead.customerType === "Organization" && lead.companyName) {
          if (!orgMap[lead.companyName]) {
            const orgId =
              uuid();
            orgMap[lead.companyName] = orgId;
            orgList.push({
              id: orgId,
              tenantId: lead.tenantId,
              name: lead.companyName,
              industry: lead.businessType || lead.industry || "",
              size: lead.companySize || "",
              website: lead.orgWebsite || "",
              assignedUserId: lead.assignedUserId || "",
              createdAt: lead.createdAt || new Date().toISOString(),
            });
          }
          lead.organizationId = orgMap[lead.companyName];
          lead.customerType = undefined; // Deprecating
        }
      });
      localStorage.setItem("leadcrm_organizations", JSON.stringify(orgList));
      localStorage.setItem("leadcrm_leads", JSON.stringify(l)); // save updated leads back
    } else if (!orgs) {
      orgs = [];
    }

    const parsedDeals = safeParse("leadcrm_deals", MOCK_DEALS);
    const existingDealIds = new Set(parsedDeals.map((x: any) => x.id));
    const mergedDealsList = [...parsedDeals];
    MOCK_DEALS.forEach((md) => {
      if (!existingDealIds.has(md.id)) {
        mergedDealsList.push(md);
      }
    });

    const d = mergedDealsList.map((deal: any) => {
      // Migration: backfill contactIds from legacy contactId
      if (!deal.contactIds && deal.contactId) {
        return { ...deal, contactIds: [deal.contactId] };
      }
      if (!deal.contactIds) {
        return { ...deal, contactIds: [] };
      }
      return deal;
    });

    const p = safeParse("leadcrm_pipelines", MOCK_PIPELINES);
    const c: Campaign[] = []; // Campaign business data is fetched through backend APIs.
    const tpl: Template[] = [];
    const u = safeParse("leadcrm_users", MOCK_USERS);
    const tsk = safeParse<Task[]>("leadcrm_tasks", MOCK_TASKS ?? []).map(task => ({ ...task, status: TaskStatusSchema.parse(task.status) }));
    const logs = safeParse("leadcrm_audit_logs", [] as AuditLog[]);
    if (!localStorage.getItem("leadcrm_audit_logs")) {
      localStorage.setItem("leadcrm_audit_logs", JSON.stringify([]));
    }
    const activityData = safeParse("leadcrm_activities", [] as Activity[]);


    // Column preferences: use system default in mock mode
    setColumnPreferences(prev => ({ ...prev, leads: LEADS_SYSTEM_DEFAULT }));

    if (tenant) {
      setAuditLogs(
        logs.filter((log: any) => !log.tenantId || log.tenantId === tenant.id),
      );
      const canViewAllLeads = userCan('leads', 'canView');
      const canViewAllDeals = userCan('deals', 'canView');

      let filteredLeads = l.filter((x: any) => x.tenantId === tenant.id);
      if (
        !canViewAllLeads &&
        user?.role?.toLowerCase() !== "client admin"
      ) {
        filteredLeads = [];
      }

      let filteredDeals = d.filter((x: any) => x.tenantId === tenant.id);
      if (
        !canViewAllDeals &&
        user?.role?.toLowerCase() !== "client admin"
      ) {
        filteredDeals = [];
      }

      setContacts(filteredLeads);
      setDeals(filteredDeals);
      setPipelines(p.filter((x: any) => x.tenantId === tenant.id));
      setCampaigns(c.filter((x: any) => x.tenantId === tenant.id));
      setTemplates(tpl.filter((x: any) => x.tenantId === tenant.id));
      setUsers(u.filter((x: any) => x.tenantId === tenant.id));
      setTasks(tsk.filter((x: any) => x.tenantId === tenant.id));
      
      
      setActivities(activityData.filter((x: any) => x.tenantId === tenant.id));
      
      
    }
  };

  useLayoutEffect(() => {
    if (!USE_MOCK_DATA) {
      setOrganizations([]); setContacts([]); setDeals([]); setPipelines([]);
      setWorkflows([]); setCampaigns([]); setTemplates([]); setTasks([]);
      setWorkflowsError(''); setWorkflowsLoading(workspaceReady);
      if (loadedSharedIdentity.current !== sharedIdentity) {
        setUsers([]);
      }
        
      setActivities([]);   setAuditLogs([]);
    }
    setVisibleIdentity(dataIdentity);
    // Only load data when we have a confirmed authenticated user
    if (!USE_MOCK_DATA && !workspaceReady) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tenant?.id, workspaceReady]);

  const saveAndSet = (key: string, data: any[], setter: any) => {
    const allData = JSON.parse(localStorage.getItem(key) || "[]");
    // Update the global list
    let newData = [...allData];
    if (tenant) {
      newData = newData
        .filter((x: any) => x.tenantId !== tenant.id)
        .concat(data);
    } else {
      newData = data;
    }
    localStorage.setItem(key, JSON.stringify(newData));
    setter(data);
  };

  const calculateScore = (status: string) => {
    if (status === "Hot") return 95;
    if (status === "Warm") return 75;
    if (status === "Cold") return 40;
    return 0;
  };

  const addOrganization = async (orgData: any): Promise<string | null> => {
    if (!tenant) return null;

    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendCreateOrg(orgData) as any;
        const res = await organizationsService.create(dto);
        const org = toFrontendOrg((res as any).data ?? res) as Organization;
        setOrganizations((prev) => [org, ...prev]);
        invalidatePageCache('accounts', tenant?.id || user?.tenantId || '');
        addAuditLog("Created Organization", `Organization "${org.name}" was added.`);
        return org.id;
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to create organization');
      }
    }

    const newOrg = {
      ...orgData,
      id: uuid(),
      tenantId: tenant.id,
      createdAt: new Date().toISOString(),
    };
    const newOrgs = [...organizations, newOrg];
    saveAndSet("leadcrm_organizations", newOrgs, setOrganizations);
    addAuditLog("Created Organization", `Organization "${newOrg.name}" was added.`);
    return newOrg.id;
  };

  const updateOrganization = async (id: string, updates: any): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendUpdateOrg(updates) as any;
        const res = await organizationsService.update(id, dto);
        const org = toFrontendOrg((res as any).data ?? res) as Organization;
        setOrganizations((prev) => prev.map((o) => (o.id === id ? org : o)));
        invalidatePageCache('accounts', tenant?.id || user?.tenantId || '');
        addAuditLog("Updated Organization", `Organization "${org.name}" was updated.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to update organization');
      }
      return;
    }

    const updated = organizations.map((o) =>
      o.id === id ? { ...o, ...updates } : o,
    );
    saveAndSet("leadcrm_organizations", updated, setOrganizations);
    const org = organizations.find((o) => o.id === id);
    if (org) {
      addAuditLog("Updated Organization", `Organization "${org.name}" was updated.`);
    }
  };


  /** Re-fetch contacts/leads from the API and update state (for use after bulk operations like import) */
  const refreshContacts = async (): Promise<void> => {
    if (USE_MOCK_DATA || !user) return;
    try {
      const contactsRes = await contactsService.getAll({ limit: 100 });
      const apiContacts = (contactsRes?.data ?? []).map(toFrontendContact);
      setContacts((apiContacts as Contact[]).filter((c: any) => !c.isArchived));
    } catch (err) {
      console.error('[DataContext] Failed to refresh contacts:', err);
    }
  };

  /** Re-fetch organizations/accounts from the API and update state */
  const refreshOrganizations = async (): Promise<void> => {
    if (USE_MOCK_DATA || !user) return;
    try {
      const orgsRes = await organizationsService.getAll({ limit: 100 });
      const apiOrgs = (orgsRes?.data ?? []).map(toFrontendOrg);
      setOrganizations((apiOrgs as Organization[]).filter((o: any) => !o.isArchived));
    } catch (err) {
      console.error('[DataContext] Failed to refresh organizations:', err);
    }
  };

  /** Refresh shared pipeline selectors after a database-backed restore. */
  const refreshPipelines = async (): Promise<void> => {
    if (USE_MOCK_DATA || !user) return;
    const identity = dataIdentityRef.current;
    const result = await pipelineService.getPipelines();
    if (identity === dataIdentityRef.current) {
      setPipelines((result.data ?? []).map(toFrontendPipeline).filter(pipeline => !pipeline.isArchived));
    }
  };

  /** Re-fetch deals from the API and update state */
  const refreshDeals = async (): Promise<void> => {
    if (USE_MOCK_DATA || !user) return;
    try {
      const dealsRes = await pipelineService.getDeals(undefined, 100);
      const apiDeals = (dealsRes?.data ?? []).map(toFrontendDeal);
      setDeals((apiDeals as Deal[]).filter((d: any) => !d.isArchived));
    } catch (err) {
      console.error('[DataContext] Failed to refresh deals:', err);
    }
  };

  const addContact = async (leadData: any): Promise<void> => {
    if (!tenant) return;

    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendCreateContact(leadData) as any;
        const res = await contactsService.create(dto);
        const contact = toFrontendContact((res as any).data ?? res) as Contact;
        setContacts((prev) => [contact, ...prev]);
        // Invalidate leads + contacts page cache so next navigation shows fresh data
        const cTenantId = tenant?.id || user?.tenantId || '';
        invalidatePageCache('leads',    cTenantId);
        invalidatePageCache('deals', cTenantId);
        invalidatePageCache('contacts', cTenantId);
        addAuditLog(
          "Contact Created",
          `Added contact '${contact.contactPerson}' (${contact.companyName}) with status '${contact.status}'.`,
          contact.id,
        );
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to create contact');
      }
      return;
    }

    const newLead: Contact = {
      ...leadData,
      id: uuid(),
      tenantId: tenant.id,
      score: calculateScore(leadData.status),
      createdAt: new Date().toISOString(),
    };
    const newLeads = [...contacts, newLead];
    saveAndSet("leadcrm_leads", newLeads, setContacts);
    addAuditLog(
      "Contact Created",
      `Added a new contact profile for company '${newLead.companyName}' (Contact: ${newLead.contactPerson}) with status '${newLead.status}'.`,
      newLead.id,
    );
  };

  const updateContact = async (id: string, updates: Partial<Contact>): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendUpdateContact(updates as Record<string, any>) as any;
        const res = await contactsService.update(id, dto);
        const contact = toFrontendContact((res as any).data ?? res) as Contact;
        setContacts((prev) => prev.map((l) => (l.id === id ? contact : l)));
        invalidatePageCache('leads',    tenant?.id || user?.tenantId || '');
        invalidatePageCache('contacts', tenant?.id || user?.tenantId || '');
        addAuditLog("Contact Updated", `Updated contact '${contact.contactPerson}'.`, id);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to update contact');
      }
      return;
    }

    const original = contacts.find((l) => l.id === id);
    const newLeads = contacts.map((l) => {
      if (l.id === id) {
        const updated = { ...l, ...updates };
        if (updates.status) updated.score = calculateScore(updates.status);
        return updated;
      }
      return l;
    });
    saveAndSet("leadcrm_leads", newLeads, setContacts);
    if (original) {
      const changes: string[] = [];
      const changeset: Record<string, { old: any; new: any }> = {};
      Object.keys(updates).forEach((k) => {
        const key = k as keyof Contact;
        if (updates[key] !== undefined && updates[key] !== original[key]) {
          changeset[key] = {
            old: original[key] === undefined ? null : original[key],
            new: updates[key],
          };
        }
      });
      if (updates.status && updates.status !== original.status)
        changes.push(`status to '${updates.status}'`);
      if (updates.companyName && updates.companyName !== original.companyName)
        changes.push(`company name to '${updates.companyName}'`);
      if (updates.estimatedValue && updates.estimatedValue !== original.estimatedValue)
        changes.push(`value to PHP ${updates.estimatedValue}`);
      if (updates.assignedUserId && updates.assignedUserId !== original.assignedUserId) {
        const assignedUser = users.find((u) => u.id === updates.assignedUserId);
        changes.push(
          `assigned user to '${assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName}` : updates.assignedUserId}'`,
        );
      }
      const details =
        changes.length > 0
          ? `Updated ${changes.join(", ")} for contact '${original.companyName}'.`
          : `Modified contact profile details for '${original.companyName}'.`;
      addAuditLog("Contact Updated", details, id, changeset);
    }
  };


  const addDeal = async (dealData: any): Promise<void> => {
    if (!tenant) return;

    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendCreateDeal(dealData) as any;
        const res = await pipelineService.createDeal(dto);
        const deal = toFrontendDeal((res as any).data ?? res) as Deal;
        setDeals((prev) => [deal, ...prev]);
        addAuditLog(
          "Deal Created",
          `Added a new deal '${deal.title}' (PHP ${deal.value.toLocaleString()}) for client '${deal.companyName}'.`,
          deal.id,
        );
        addActivity({
          type: 'deal_action',
          relatedToType: 'deal',
          relatedToId: deal.id,
          title: `Deal created: ${deal.title}`,
          createdBy: user?.id || 'system',
          createdAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to create deal');
      }
      return;
    }

    // Normalise: always maintain contactIds array, backfill from legacy contactId
    const contactIds: string[] = dealData.contactIds
      ? dealData.contactIds
      : dealData.contactId
        ? [dealData.contactId]
        : [];

    const newDeal: Deal = {
      ...dealData,
      id: uuid(),
      tenantId: tenant.id,
      contactIds,
      lastStageChangeDate: new Date().toISOString(),
      order: deals.filter(
        (d) =>
          d.pipelineId === dealData.pipelineId &&
          d.stageId === dealData.stageId,
      ).length,
      createdAt: new Date().toISOString(),
      history: [
        {
          stageId: dealData.stageId,
          timestamp: new Date().toISOString(),
          userId: user?.id || "system",
          note: "Deal created",
        },
      ],
      ownershipHistory: dealData.assignedUserId
        ? [{ assignedTo: dealData.assignedUserId, assignedBy: user?.id || 'system', assignedAt: new Date().toISOString() }]
        : [],
    };
    const newDeals = [...deals, newDeal];
    saveAndSet("leadcrm_deals", newDeals, setDeals);
    addAuditLog(
      "Deal Created",
      `Added a new deal '${newDeal.title}' (PHP ${newDeal.value.toLocaleString()}) for client '${newDeal.companyName}'.`,
      newDeal.id,
    );
    addActivity({
      type: 'deal_action',
      relatedToType: 'deal',
      relatedToId: newDeal.id,
      title: `Deal created: ${newDeal.title}`,
      createdBy: user?.id || 'system',
      createdAt: new Date().toISOString(),
    });
  };

  const updateDeal = async (id: string, updates: Partial<Deal>): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendUpdateDeal(updates as Record<string, any>) as any;
        const res = await pipelineService.updateDeal(id, dto);
        const deal = toFrontendDeal((res as any).data ?? res) as Deal;
        setDeals((prev) => prev.map((d) => (d.id === id ? deal : d)));

        if (updates.stageId) {
          const pLine = pipelines.find((p) => p.id === updates.pipelineId || p.id === deal.pipelineId);
          const newName = pLine?.stages.find((s) => s.id === updates.stageId)?.name || updates.stageId;
          addAuditLog("Deal Updated", `Updated pipeline stage to '${newName}' for deal '${deal.title}'.`, id);
          addActivity({
            type: 'stage_change',
            relatedToType: 'deal',
            relatedToId: deal.id,
            title: `Deal moved to new stage`,
            createdBy: user?.id || 'system',
            createdAt: new Date().toISOString(),
            metadata: { newStageId: updates.stageId },
          });
        } else {
           addAuditLog("Deal Updated", `Modified deal details for '${deal.title}'.`, id);
        }
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to update deal');
      }
      return;
    }

    const original = deals.find((d) => d.id === id);
    const newDeals = deals.map((d) => {
      if (d.id === id) {
        const updated = { ...d, ...updates };

        // Track stage change
        if (updates.stageId && updates.stageId !== d.stageId) {
          updated.lastStageChangeDate = new Date().toISOString();
          const historyEntry = {
            stageId: updates.stageId,
            previousStageId: d.stageId,
            timestamp: new Date().toISOString(),
            userId: user?.id || "system",
            note: updates.lostReason
              ? `Stage changed to Closed Lost: ${updates.lostReason}`
              : undefined,
          };
          updated.history = [...(d.history || []), historyEntry];

          // Fire stage-change Activity
          addActivity({
            type: 'stage_change',
            relatedToType: 'deal',
            relatedToId: d.id,
            title: `Deal moved to new stage`,
            createdBy: user?.id || 'system',
            createdAt: new Date().toISOString(),
            metadata: { previousStageId: d.stageId, newStageId: updates.stageId },
          });

          const stageSuffix = updates.stageId.includes("stage_")
            ? updates.stageId.replace("stage_", "")
            : updates.stageId;
        }

        // Track owner change — append DealOwnershipRecord
        if (updates.assignedUserId && updates.assignedUserId !== d.assignedUserId) {
          updated.ownershipHistory = [
            ...(d.ownershipHistory || []),
            {
              assignedTo: updates.assignedUserId,
              assignedBy: user?.id || 'system',
              assignedAt: new Date().toISOString(),
            },
          ];
        }

        return updated;
      }
      return d;
    });
    saveAndSet("leadcrm_deals", newDeals, setDeals);
    if (original) {
      const changes: string[] = [];
      const changeset: Record<string, { old: any; new: any }> = {};

      Object.keys(updates).forEach((k) => {
        const key = k as keyof Deal;
        if (updates[key] !== undefined && updates[key] !== original[key]) {
          changeset[key] = {
            old: original[key] === undefined ? null : original[key],
            new: updates[key],
          };
        }
      });

      if (updates.stageId && updates.stageId !== original.stageId) {
        const pLine = pipelines.find((p) => p.id === original.pipelineId);
        const oldName =
          pLine?.stages.find((s) => s.id === original.stageId)?.name ||
          original.stageId;
        const newName =
          pLine?.stages.find((s) => s.id === updates.stageId)?.name ||
          updates.stageId;
        changes.push(`pipeline stage from '${oldName}' to '${newName}'`);
      }
      if (updates.value && updates.value !== original.value) {
        changes.push(`revenue value to PHP ${updates.value.toLocaleString()}`);
      }
      if (updates.priority && updates.priority !== original.priority) {
        changes.push(`priority to '${updates.priority}'`);
      }
      if (
        updates.assignedUserId &&
        updates.assignedUserId !== original.assignedUserId
      ) {
        const assignedUser = users.find((u) => u.id === updates.assignedUserId);
        changes.push(
          `assigned representative to '${assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName}` : updates.assignedUserId}'`,
        );
      }
      const details =
        changes.length > 0
          ? `Updated ${changes.join(", ")} for deal '${original.title}'.`
          : `Modified deal details for '${original.title}'.`;
      addAuditLog("Deal Updated", details, id, changeset);
    }
  };

  const moveDealStage = async (id: string, stageId: string, note?: string, lostReason?: string, handoff?: any): Promise<void> => {
    const targetStage = pipelines.flatMap(pipeline => pipeline.stages).find(stage => stage.id === stageId);
    if (!USE_MOCK_DATA) {
      try {
        const res = await pipelineService.moveDealStage(id, { stageId, note, lostReason, handoff });
        const responseData = (res as any).data ?? res;
        const rawDeal = responseData.deal ?? responseData;
        const deal = toFrontendDeal(rawDeal) as Deal;
        setDeals((prev) => prev.map((d) => (d.id === id ? deal : d)));

        // The stage API commits activity and history in the same transaction.
        for (const module of ['deals', 'activities', 'leads', 'contacts', 'accounts']) {
          invalidatePageCache(module, tenant?.id || user?.tenantId || '');
        }
      } catch (err) {
        console.error("Failed to move deal stage", err);
        if (targetStage?.isWon && (err as { status?: number }).status === 400) {
          const event = new CustomEvent('deal-closing-required', { detail: id, cancelable: true });
          window.dispatchEvent(event);
          if (!event.defaultPrevented) setClosingDealId(id);
        }
        throw err;
      }
    } else {
      const original = deals.find((d) => d.id === id);
      if (!original) return;

      const newDeals = deals.map((d) => {
        if (d.id === id) {
          const updated = {
            ...d,
            stageId,
            lastStageChangeDate: new Date().toISOString(),
            history: [
              ...(d.history || []),
              {
                stageId,
                previousStageId: d.stageId,
                timestamp: new Date().toISOString(),
                userId: user?.id || "system",
                note,
              },
            ],
          };

          addActivity({
            type: 'stage_change',
            relatedToType: 'deal',
            relatedToId: d.id,
            title: `Deal moved to new stage`,
            createdBy: user?.id || 'system',
            createdAt: new Date().toISOString(),
            metadata: { previousStageId: d.stageId, newStageId: stageId },
          });

          return updated;
        }
        return d;
      });

      saveAndSet("leadcrm_deals", newDeals, setDeals);
      addAuditLog("Deal Stage Changed", `Moved deal '${original.title}' to stage '${stageId}'.`, id);
    }
  };

  const deleteDeal = async (id: string): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        await pipelineService.archiveDeal(id);
        setDeals((prev) =>
          prev.map((d) => (d.id === id ? { ...d, isArchived: true } : d)),
        );
        addAuditLog("Deal Archived", `Archived deal id '${id}'.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to archive deal');
      }
      return;
    }

    const original = deals.find((d) => d.id === id);
    const newDeals = deals.map((d) =>
      d.id === id ? { ...d, isArchived: true } : d,
    );
    saveAndSet("leadcrm_deals", newDeals, setDeals);
    if (original) {
      addAuditLog(
        "Deal Archived",
        `Archived deal '${original.title}' valued at PHP ${original.value.toLocaleString()}.`,
      );
    }
  };

  const reorderDeals = (reorderedDeals: Deal[]) => {
    const reorderedIds = new Set(reorderedDeals.map((d) => d.id));
    const newDeals = deals.map((d) => {
      if (reorderedIds.has(d.id)) {
        return reorderedDeals.find((rd) => rd.id === d.id)!;
      }
      return d;
    });
    saveAndSet("leadcrm_deals", newDeals, setDeals);
  };

  const addPipeline = async (pipelineData: Omit<Pipeline, "id" | "tenantId">): Promise<void> => {
    if (!tenant) return;

    if (!USE_MOCK_DATA) {
      try {
        // 1. Create the pipeline (name only — backend schema doesn't accept stages)
        const res = await pipelineService.createPipeline({ name: pipelineData.name });
        const pipeline = toFrontendPipeline((res as any).data ?? res) as Pipeline;

        // 2. Create each stage individually via the stage CRUD API
        if (pipelineData.stages && pipelineData.stages.length > 0) {
          const createdStages: any[] = [];
          for (let i = 0; i < pipelineData.stages.length; i++) {
            const s = pipelineData.stages[i];
            const stageRes = await pipelineService.createStage({
              pipelineId: pipeline.id,
              name: s.name,
              order: i + 1,
              probability: s.probability,
              color: s.color,
              isWon: s.isWon,
              isLost: s.isLost,
              isDefault: s.isDefault || i === 0,
            });
            const created = (stageRes as any).data ?? stageRes;
            createdStages.push(created);
          }
          pipeline.stages = createdStages;
        }

        setPipelines((prev) => [pipeline, ...prev]);
        addAuditLog("Pipeline Created", `Created pipeline '${pipeline.name}' with ${pipeline.stages.length} stages.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to create pipeline');
      }
      return;
    }

    const newPipeline: Pipeline = {
      ...pipelineData,
      id: uuid(),
      tenantId: tenant.id,
    };
    const newPipelines = [...pipelines, newPipeline];
    saveAndSet("leadcrm_pipelines", newPipelines, setPipelines);
  };

  const updatePipeline = async (id: string, updates: Partial<Pipeline>): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        // 1. Update the pipeline name/settings if provided
        if (updates.name) {
          await pipelineService.updatePipeline(id, { name: updates.name });
        }

        // 2. If stages are provided, sync them individually
        if (updates.stages) {
          const existingPipeline = pipelines.find(p => p.id === id);
          const existingStages = existingPipeline?.stages || [];
          const newStages = updates.stages;

          // Find stages to delete (exist in old but not in new)
          const newStageIds = new Set(newStages.map(s => s.id));
          const stagesToDelete = existingStages.filter(s => !newStageIds.has(s.id));

          // Find stages to create (exist in new but not in old, or have client-generated UUIDs)
          const existingStageIds = new Set(existingStages.map(s => s.id));
          const stagesToCreate = newStages.filter(s => !existingStageIds.has(s.id));

          // Find stages to update (exist in both)
          const stagesToUpdate = newStages.filter(s => existingStageIds.has(s.id));

          // Delete removed stages
          for (const stage of stagesToDelete) {
            try { await pipelineService.deleteStage(stage.id); } catch { /* may have active deals */ }
          }

          // Create new stages
          for (const stage of stagesToCreate) {
            const idx = newStages.indexOf(stage);
            await pipelineService.createStage({
              pipelineId: id,
              name: stage.name,
              order: idx + 1,
              probability: stage.probability,
              color: stage.color,
              isWon: stage.isWon,
              isLost: stage.isLost,
              isDefault: stage.isDefault,
            });
          }

          // Update existing stages (name changes, order changes)
          for (const stage of stagesToUpdate) {
            const oldStage = existingStages.find(s => s.id === stage.id);
            const idx = newStages.indexOf(stage);
            if (oldStage && (oldStage.name !== stage.name || oldStage.order !== idx + 1)) {
              await pipelineService.updateStage(stage.id, {
                name: stage.name,
                order: idx + 1,
                probability: stage.probability,
                color: stage.color,
                isWon: stage.isWon,
                isLost: stage.isLost,
              });
            }
          }

          // Reorder all stages to match the new order
          const orderedIds = newStages.map(s => s.id).filter(sid => existingStageIds.has(sid));
          if (orderedIds.length > 1) {
            try { await pipelineService.reorderStages(id, orderedIds); } catch { /* non-critical */ }
          }
        }

        // 3. Refetch the pipeline to get the final server state
        const refreshRes = await pipelineService.getPipelines();
        const allPipelines = ((refreshRes as any).data ?? refreshRes) as any[];
        const refreshed = allPipelines.find((p: any) => p.id === id);
        if (refreshed) {
          const mapped = toFrontendPipeline(refreshed) as Pipeline;
          setPipelines((prev) => prev.map((p) => (p.id === id ? mapped : p)));
        }

        addAuditLog("Pipeline Updated", `Updated pipeline.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to update pipeline');
      }
      return;
    }

    const newPipelines = pipelines.map((p) =>
      p.id === id ? { ...p, ...updates } : p,
    );
    saveAndSet("leadcrm_pipelines", newPipelines, setPipelines);
  };

  const deletePipeline = async (id: string): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        await pipelineService.archivePipeline(id);
        setPipelines((prev) =>
          prev.map((p) => (p.id === id ? { ...p, isArchived: true } : p)),
        );
        addAuditLog("Pipeline Archived", `Archived pipeline id '${id}'.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to archive pipeline');
      }
      return;
    }

    const original = pipelines.find((p) => p.id === id);
    const newPipelines = pipelines.map((p) =>
      p.id === id ? { ...p, isArchived: true } : p,
    );
    saveAndSet("leadcrm_pipelines", newPipelines, setPipelines);
    if (original) {
      addAuditLog(
        "Pipeline Archived",
        `Archived sales pipeline configuration '${original.name}'.`,
      );
    }
  };

  const addTask = async (taskData: CreateTaskInput): Promise<void> => {
    if (!tenant || !user) throw new Error('Sign in to a workspace first.');
    const identity = dataIdentityRef.current;
    const dto = CreateTaskSchema.parse({ ...taskData, dueDate: taskDueInstant(taskData.dueDate) });
    const now = new Date().toISOString();
    const created: Task = USE_MOCK_DATA ? {
      ...dto, ...taskAssociationPatch(dto), description: dto.description ?? '', id: uuid(), tenantId: tenant.id, createdAt: now,
      assignedById: user.id, completedAt: dto.status === 'completed' ? now : null,
      completedById: dto.status === 'completed' ? user.id : null,
    } : (await tasksApi.create(dto)).data;
    if (identity !== dataIdentityRef.current) return;
    setTasks(previous => {
      const next = [created, ...previous];
      if (USE_MOCK_DATA) localStorage.setItem('leadcrm_tasks', JSON.stringify(next));
      return next;
    });
    taskQueries.refreshTasks();
  };

  const updateTask = async (id: string, updates: Partial<Task>): Promise<void> => {
    const identity = dataIdentityRef.current;
    const dto = UpdateTaskSchema.parse({ ...updates, ...(updates.dueDate ? { dueDate: taskDueInstant(updates.dueDate) } : {}) });
    const updated = USE_MOCK_DATA ? null : (await tasksApi.update(id, dto)).data;
    if (identity !== dataIdentityRef.current) return;
    setTasks(previous => {
      const next = previous.map(task => {
        if (task.id !== id) return task;
        if (updated) return updated;
        const completed = dto.status === 'completed';
        return { ...task, ...dto, ...taskAssociationPatch(dto), description: dto.description === undefined ? task.description : dto.description ?? '',
          ...(dto.status === undefined ? {} : { completedAt: completed ? task.completedAt ?? new Date().toISOString() : null, completedById: completed ? task.completedById ?? user?.id : null }),
          ...(dto.assignedUserId && dto.assignedUserId !== task.assignedUserId ? { assignedById: user?.id } : {}) };
      });
      if (USE_MOCK_DATA) localStorage.setItem('leadcrm_tasks', JSON.stringify(next));
      return next;
    });
    taskQueries.refreshTasks();
  };

  const deleteTask = async (id: string): Promise<void> => {
    const identity = dataIdentityRef.current;
    if (!USE_MOCK_DATA) await tasksApi.archive(id);
    if (identity !== dataIdentityRef.current) return;
    setTasks(previous => {
      const next = previous.map(task => task.id === id ? { ...task, isArchived: true } : task);
      if (USE_MOCK_DATA) localStorage.setItem('leadcrm_tasks', JSON.stringify(next));
      return next;
    });
    taskQueries.refreshTasks();
  };

  const bulkTasks = async (input: TaskBulkInput): Promise<TaskBulkResult> => {
    const dto = TaskBulkSchema.parse(input);
    const identity = dataIdentityRef.current;
    if (!USE_MOCK_DATA) {
      const result = (await tasksApi.bulk(dto)).data;
      if (identity === dataIdentityRef.current) taskQueries.refreshTasks();
      return result;
    }
    const result: TaskBulkResult = { succeeded: [], failed: [] };
    for (const id of dto.ids) {
      try {
        if (!tasks.some(task => task.id === id && !task.isArchived)) throw new Error('Task not found.');
        if (dto.operation === 'archive') await deleteTask(id);
        else await updateTask(id, dto.operation === 'complete' ? { status: 'completed' } : dto.operation === 'assign' ? { assignedUserId: dto.assignedUserId } : { dueDate: dto.dueDate });
        result.succeeded.push(id);
      } catch (error) { result.failed.push({ id, error: error instanceof Error ? error.message : 'Task update failed.' }); }
    }
    return result;
  };

  const addWorkflow = async (workflowData: WorkflowDraft) => {
    if (!tenant) throw new Error('Sign in to a workspace first.');
    const identity = dataIdentityRef.current;
    const response = await workflowsApi.create(WorkflowDraftSchema.parse(workflowData));
    if (identity === dataIdentityRef.current) setWorkflows(previous => [response.data, ...previous]);
    return response.data;
  };
  const updateWorkflow = async (id: string, updates: Partial<WorkflowDraft>) => {
    const identity = dataIdentityRef.current;
    const response = await workflowsApi.update(id, updates);
    if (identity === dataIdentityRef.current) setWorkflows(previous => previous.map(workflow => workflow.id === id ? { ...workflow, ...response.data } : workflow));
    return response.data;
  };
  const toggleWorkflow = async (id: string) => {
    const identity = dataIdentityRef.current;
    const current = workflows.find(workflow => workflow.id === id);
    if (!current) throw new Error('Reload the workflow and try again.');
    const response = await workflowsApi.toggle(id, !current.isActive);
    if (identity === dataIdentityRef.current) setWorkflows(previous => previous.map(workflow => workflow.id === id ? { ...workflow, ...response.data } : workflow));
  };
  const deleteWorkflow = async (id: string) => {
    const identity = dataIdentityRef.current;
    await workflowsApi.archive(id);
    if (identity === dataIdentityRef.current) setWorkflows(previous => previous.filter(workflow => workflow.id !== id));
  };
  const addCampaign: DataContextType['addCampaign'] = async (data) => {
    if (!tenant) throw new Error('Select a workspace first.');
    const created = (await campaignsApi.create({ name: data.name, type: data.type === 'Email' ? 'EMAIL' : data.type === 'Sms' ? 'SMS' : 'MULTI_CHANNEL', subject: data.subject, body: data.body, audienceSource: data.audienceSource, targetAudienceId: data.targetAudienceId })).data;
    setCampaigns(prev => [created, ...prev]);
    invalidatePageCache('campaigns', tenant.id);
  };
  const updateCampaign = async (id: string, updates: Partial<Campaign>) => {
    const updated = (await campaignsApi.update(id, updates)).data;
    setCampaigns(prev => prev.map(c => c.id === id ? updated : c));
    invalidatePageCache('campaigns', tenant?.id || '');
  };
  const deleteCampaign = async (id: string) => {
    await campaignsApi.archive(id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
    invalidatePageCache('campaigns', tenant?.id || '');
  };
  const addTemplate: DataContextType['addTemplate'] = async (data) => {
    const created = (await templatesApi.create(data)).data;
    setTemplates(prev => [created, ...prev]);
    invalidatePageCache('campaigns', tenant?.id || '');
  };
  const updateTemplate = async (id: string, updates: Partial<Template>) => {
    const updated = (await templatesApi.update(id, updates)).data;
    setTemplates(prev => prev.map(t => t.id === id ? updated : t));
    invalidatePageCache('campaigns', tenant?.id || '');
  };
  const deleteTemplate = async (id: string) => {
    await templatesApi.archive(id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    invalidatePageCache('campaigns', tenant?.id || '');
  };

  const addRole: DataContextType['addRole'] = async (data) => {
    if (!tenant) throw new Error('Select a workspace before creating a role.');
    const identity = roleIdentityRef.current;
    const saved = toSettingsRole(await rolesService.create({
      name: data.name.trim(), description: data.description?.trim(),
      permissions: toPermissionRows(data.permissions, permissions),
    }));
    if (identity === roleIdentityRef.current) setRoles(prev => [...prev, saved]);
  };

  const updateRole: DataContextType['updateRole'] = async (id, data) => {
    const identity = roleIdentityRef.current;
    const saved = toSettingsRole(await rolesService.update(id, {
      name: data.name?.trim(), description: data.description?.trim(),
      ...(data.permissions ? { permissions: toPermissionRows(data.permissions, permissions) } : {}),
    }));
    if (identity === roleIdentityRef.current) setRoles(prev => prev.map(role => role.id === id ? saved : role));
  };

  const deleteRole = async (id: string) => {
    const identity = roleIdentityRef.current;
    await rolesService.archive(id);
    if (identity === roleIdentityRef.current) setRoles(prev => prev.filter(role => role.id !== id));
  };

  const addUser = async (userData: any) => {
    if (!tenant) return;
    const firstName = userData.firstName || "New";
    const lastName = userData.lastName || "User";

    if (!userData.role || !roles.some(r => r.name === userData.role && !r.isSystemRole && !r.isArchived)) {
      throw new Error('Select an active custom role before creating a user.');
    }
    const newUser: User = {
      id:
        userData.id ||
        uuid(),
      tenantId: tenant.id,
      firstName,
      lastName,
      email: userData.email || "",
      role: userData.role,
      status: userData.status || "active",
      phone: userData.phone || "",
      jobTitle: userData.jobTitle || "",
      department: userData.department || "",
    };

    // Optimistic Update
    setUsers((prev) => [...prev, newUser]);

    if (!USE_MOCK_DATA) {
      try {
        const res = await usersService.create(newUser);
        if (res.data) {
          setUsers((prev) => prev.map((u) => (u.id === newUser.id ? res.data! : u)));
          addAuditLog(
            "User Registered",
            `Registered new team member: '${firstName} ${lastName}'.`,
          );
        }
      } catch (err: unknown) {
        toast.error("Failed to register user: " + (err instanceof Error ? err.message : "Unknown error"));
        setUsers((prev) => prev.filter((u) => u.id !== newUser.id));
      }
      return;
    }

    const allUsers = JSON.parse(
      localStorage.getItem("leadcrm_users") || JSON.stringify(MOCK_USERS),
    );
    const updatedUsers = [
      ...allUsers.filter((u: any) => u.id !== newUser.id),
      newUser,
    ];
    localStorage.setItem("leadcrm_users", JSON.stringify(updatedUsers));
    addAuditLog(
      "User Registered",
      `Registered new team member: '${firstName} ${lastName}'.`,
    );
  };

  const updateUser = async (id: string, updates: Partial<any>) => {
    const original = users.find((u) => u.id === id);
    if (!original) return;

    let firstName = updates.firstName || original.firstName;
    let lastName = updates.lastName || original.lastName;
    // Legacy support just in case
    if (updates.name) {
      const nameParts = updates.name.trim().split(/\s+/);
      firstName = updates.firstName || nameParts[0] || original.firstName;
      lastName = updates.lastName || nameParts.slice(1).join(" ") || original.lastName;
    }

    const updatedUser = {
      ...original,
      ...updates,
      firstName,
      lastName,
    };

    // Optimistic UI Update
    setUsers((prev) => prev.map((u) => (u.id === id ? updatedUser : u)));

    if (!USE_MOCK_DATA) {
      try {
        const res = await usersService.update(id, updatedUser);
        if (res.data) {
          setUsers((prev) => prev.map((u) => (u.id === id ? res.data! : u)));
          addAuditLog(
            "User Updated",
            `Updated profile/role details for team member: '${firstName} ${lastName}'.`,
          );
        }
      } catch (err: unknown) {
        toast.error("Failed to update user: " + (err instanceof Error ? err.message : "Unknown error"));
        setUsers((prev) => prev.map((u) => (u.id === id ? original : u)));
      }
      return;
    }

    const allUsers = JSON.parse(
      localStorage.getItem("leadcrm_users") || JSON.stringify(MOCK_USERS),
    );
    const updatedUsers = allUsers.map((u: any) =>
      u.id === id ? updatedUser : u,
    );
    localStorage.setItem("leadcrm_users", JSON.stringify(updatedUsers));

    addAuditLog(
      "User Updated",
      `Updated profile/role details for team member: '${firstName} ${lastName}'.`,
    );

    const currentUser = JSON.parse(
      localStorage.getItem("leadcrm_user") || "null",
    );
    if (currentUser && currentUser.id === id) {
      localStorage.setItem("leadcrm_user", JSON.stringify(updatedUser));
    }
  };

  const deleteUser = async (id: string) => {
    const original = users.find((u) => u.id === id);
    if (!original) return;

    // Optimistic UI Update
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, status: "inactive", isArchived: true } : u,
      ),
    );

    if (!USE_MOCK_DATA) {
      try {
        await usersService.archive(id);
        addAuditLog(
          "User Archived",
          `Deactivated and archived team member account: '${original.firstName} ${original.lastName}'.`,
        );
      } catch (err: unknown) {
        toast.error("Failed to archive user: " + (err instanceof Error ? err.message : "Unknown error"));
        setUsers((prev) => prev.map((u) => (u.id === id ? original : u)));
      }
      return;
    }

    const allUsers = JSON.parse(
      localStorage.getItem("leadcrm_users") || JSON.stringify(MOCK_USERS),
    );
    const updatedUsers = allUsers.map((u: any) =>
      u.id === id ? { ...u, status: "inactive", isArchived: true } : u,
    );
    localStorage.setItem("leadcrm_users", JSON.stringify(updatedUsers));

    addAuditLog(
      "User Archived",
      `Deactivated and archived team member account: '${original.firstName} ${original.lastName}'.`,
    );
  };

  const restoreRecord = (
    type:
      | "Deal"
      | "Pipeline"
      | "Workflow"
      | "Campaign"
      | "Template"
      | "Role"
      | "User",
    id: string,
  ) => {
    switch (type) {
      case "Deal":
        saveAndSet(
          "leadcrm_deals",
          deals.map((d) => (d.id === id ? { ...d, isArchived: false } : d)),
          setDeals,
        );
        addAuditLog("Deal Restored", `Restored deal (ID: ${id}).`);
        break;
      case "Pipeline":
        saveAndSet(
          "leadcrm_pipelines",
          pipelines.map((p) => (p.id === id ? { ...p, isArchived: false } : p)),
          setPipelines,
        );
        addAuditLog(
          "Pipeline Restored",
          `Restored sales pipeline (ID: ${id}).`,
        );
        break;
      case "Workflow":
        throw new Error('Archived workflows preserve history and cannot be restored here.');

      case "Campaign":
      case "Template":
        toast.error('Campaign and template restoration is not available. Create a new draft through Campaigns.');
        break;
      case "Role":
        toast.error('Archived roles cannot be restored. Create a new role through Roles & Permissions.');
        break;
      case "User":
        const allUsers = JSON.parse(
          localStorage.getItem("leadcrm_users") || "[]",
        );
        const updatedUsers = allUsers.map((u: any) =>
          u.id === id ? { ...u, status: "Active", isArchived: false } : u,
        );
        localStorage.setItem("leadcrm_users", JSON.stringify(updatedUsers));
        if (tenant) {
          setUsers(updatedUsers.filter((u: any) => u.tenantId === tenant.id));
        } else {
          setUsers(updatedUsers);
        }
        addAuditLog(
          "User Restored",
          `Restored team member account (ID: ${id}).`,
        );
        break;
    }
  };

  const addAuditLog = (
    action: string,
    details: string,
    rowId?: string,
    changeset?: Record<string, { old: any; new: any }>,
  ) => {
    const currentUser =
      user || JSON.parse(localStorage.getItem("leadcrm_user") || "null");
    if (!currentUser) return;

    // Simulate semi-dynamic IP address based on user session ranges to look organic
    const mockIPs = [
      "112.204.42.10",
      "120.28.114.50",
      "202.90.136.2",
      "180.191.137.24",
      "49.145.96.12",
    ];
    const hashedIndex =
      currentUser.id
        .split("")
        .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) %
      mockIPs.length;
    const ipAddress = mockIPs[hashedIndex];

    const newLog: AuditLog = {
      id: uuid(),
      userId: currentUser.id,
      userEmail: currentUser.email,
      action,
      details,
      timestamp: new Date().toISOString(),
      ipAddress,
      tenantId: tenant?.id || currentUser.tenantId || "",
      rowId,
      changeset,
      operatorRole: currentUser.role,
    };

    const allLogs = JSON.parse(
      localStorage.getItem("leadcrm_audit_logs") || "[]",
    );
    const updatedLogs = [newLog, ...allLogs].slice(0, 500); // Keep last 500 logs
    localStorage.setItem("leadcrm_audit_logs", JSON.stringify(updatedLogs));

    if (tenant) {
      setAuditLogs(
        updatedLogs.filter(
          (log: any) => !log.tenantId || log.tenantId === tenant.id,
        ),
      );
    } else {
      setAuditLogs([newLog]);
    }
  };

  const addActivity = async (activityData: Omit<Activity, 'id' | 'tenantId'>) => {
    const currentTenantId = tenant?.id || user?.tenantId || '';
    if (!currentTenantId) return;

    if (!USE_MOCK_DATA) {
      try {
        const res = await activitiesService.create(activityData as any);
        if (res.data) {
          setActivities((prev) => [res.data as unknown as Activity, ...prev]);
          invalidatePageCache('activities', currentTenantId);
        }
      } catch (error) {
        console.error('Failed to create activity via API', error);
      }
      return;
    }

    const newActivity: Activity = {
      ...activityData,
      id: uuid(),
      tenantId: currentTenantId,
      createdAt: new Date().toISOString(),
    };

    const allActivities = JSON.parse(
      localStorage.getItem('leadcrm_activities') || '[]',
    );
    const updated = [newActivity, ...allActivities].slice(0, 1000);
    localStorage.setItem('leadcrm_activities', JSON.stringify(updated));
    setActivities(updated.filter((a: Activity) => a.tenantId === currentTenantId));
  };

  const resetDemoData = () => {
    localStorage.setItem("leadcrm_leads", JSON.stringify(MOCK_LEADS));
    localStorage.setItem("leadcrm_deals", JSON.stringify(MOCK_DEALS));
    localStorage.setItem("leadcrm_pipelines", JSON.stringify(MOCK_PIPELINES));
    localStorage.setItem("leadcrm_users", JSON.stringify(MOCK_USERS));
    localStorage.setItem("leadcrm_tenants", JSON.stringify(MOCK_TENANTS));
    localStorage.setItem("leadcrm_tasks", JSON.stringify(MOCK_TASKS));
    loadData();
  };

  const saveColumnPreference = useCallback(async (module: string, columns: ColumnConfigItem[]): Promise<void> => {
    const previous = columnPreferencesRef.current[module];
    // Optimistic update
    setColumnPreferences(prev => ({ ...prev, [module]: columns }));
    try {
      const response = await preferencesApi.saveUserPreference(module, columns);
      // Server response overwrites cache (cache subordination)
      setColumnPreferences(prev => ({ ...prev, [module]: response.data.columns }));
    } catch (err: unknown) {
      // Rollback on failure
      setColumnPreferences(prev => ({ ...prev, [module]: previous ?? [] }));
      throw err instanceof Error ? err : new Error('Failed to save column preference');
    }
  }, []);

  const resetColumnPreference = useCallback(async (module: string): Promise<void> => {
    const previous = columnPreferencesRef.current[module];
    try {
      const response = await preferencesApi.deleteUserPreference(module);
      // Server sends back fallback (tenant or system default)
      setColumnPreferences(prev => ({ ...prev, [module]: response.data.columns }));
    } catch (err: unknown) {
      // Keep current state on failure
      setColumnPreferences(prev => ({ ...prev, [module]: previous ?? [] }));
      throw err instanceof Error ? err : new Error('Failed to reset column preference');
    }
  }, []);

  // ── Memoize provider value to prevent re-render cascade to 38 consumers ──
  const contextValue = useMemo(() => ({
    organizations,
    contacts,
    deals,
    pipelines,
    workflows,
    workflowsLoading,
    workflowsError,
    refreshWorkflows,
    campaigns,
    templates,
    roles,
    permissions, rolesLoading, rolesError, refreshRoles,
    users,
    tasks,
    ...taskQueries,
    bulkTasks,
    activities,
    addActivity,
    auditLogs,
    addOrganization,
    updateOrganization,
    addContact,
    refreshContacts,
    refreshOrganizations,
    refreshDeals,
    refreshPipelines,
    updateContact,
    addDeal,
    updateDeal,
    moveDealStage,
    deleteDeal,
    addPipeline,
    updatePipeline,
    deletePipeline,
    addRole,
    updateRole,
    deleteRole,
    resetDemoData,
    addAuditLog,
    addTask,
    updateTask,
    deleteTask,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    toggleWorkflow,
    reorderDeals,
    addCampaign,
    updateCampaign,
    deleteCampaign,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    addUser,
    updateUser,
    deleteUser,
    restoreRecord,
    columnPreferences,
    columnPreferencesLoading,
    saveColumnPreference,
    resetColumnPreference,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    organizations, contacts, deals, pipelines, workflows, workflowsLoading, workflowsError, refreshWorkflows, campaigns,
    templates, roles, permissions, rolesLoading, rolesError, refreshRoles, users, tasks, taskQueries, dataIdentity,
    activities, auditLogs,
    columnPreferences, columnPreferencesLoading,
  ]);

  return (
    <DataContext.Provider value={visibleIdentity === dataIdentity ? contextValue : { ...contextValue, organizations: [], contacts: [], deals: [], pipelines: [], workflows: [], campaigns: [], templates: [], tasks: [], activities: [], auditLogs: [] }}>
      {closingDealId && <ClosingRecordPanel module="deals" id={closingDealId} open focusClosing onOpenChange={open => { if (!open) setClosingDealId(undefined); }} />}
      {children}
    </DataContext.Provider>
  );
}

export const useData = (options?: { includeArchived?: boolean }) => {
  const context = useContext(DataContext);
  if (context === undefined)
    throw new Error("useData must be used within a DataProvider");

  const includeArchived = options?.includeArchived ?? false;

  // Memoize filtered views so consumers don't recompute on every render
  return useMemo(() => {
    if (includeArchived) return context;

    return {
      ...context,
      contacts: context.contacts.filter((c) => !c.isArchived),
      organizations: context.organizations.filter((o) => !o.isArchived),
      deals: context.deals.filter((d) => !d.isArchived),
      pipelines: context.pipelines.filter((p) => !p.isArchived),
      workflows: context.workflows.filter((w) => !w.isArchived),
      campaigns: context.campaigns.filter((c) => !c.isArchived),
      templates: context.templates.filter((t) => !t.isArchived),
      roles: context.roles.filter((r) => !r.isArchived),
      users: context.users.filter((u) => !u.isArchived),
      tasks: context.tasks ? context.tasks.filter((t) => !("isArchived" in t) || !(t as any).isArchived) : [],
    };
  }, [context, includeArchived]);
};

