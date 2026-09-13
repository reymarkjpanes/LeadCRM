'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
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
  Tenant,
  Template,
  RoleDefinition,
  Permission,
  Task,
  WorkflowExecution,
  WorkflowExecutionRun,
  WorkflowExecutionStep,
  WorkflowTriggerRecord,
  PendingAction,
  AuditLog,
  Activity,
  Invoice,
} from "./types";
import {
  MOCK_LEADS,
  MOCK_DEALS,
  MOCK_PIPELINES,
  MOCK_WORKFLOWS,
  MOCK_CAMPAIGNS,
  MOCK_USERS,
  MOCK_TENANTS,
  MOCK_TEMPLATES,
  MOCK_ROLES,
  MOCK_PERMISSIONS,
  MOCK_TASKS,
  MOCK_WORKFLOW_EXECUTIONS,
  MOCK_INVOICES,
} from "./mockData/index";
import { evaluateWorkflowCondition } from "@/features/tenant/automation/workflows/services/workflow-condition-evaluator";
import { uuid } from "@/lib/utils";

// ── Real-API integration ─────────────────────────────────────────────────────
import { toast } from 'sonner';
import { usersService } from "@/features/tenant/administration/users/services/users.service";
import { USE_MOCK_DATA } from "@/lib/config";
import { leadsService as contactsService } from "@/features/tenant/crm/leads/services/leads.service";
import { accountsService as organizationsService } from "@/features/tenant/crm/accounts/services/accounts.service";
import { pipelineService } from "@/features/tenant/crm/pipeline/services/pipeline.service";
import { activitiesService } from "@/features/tenant/crm/activities/services/activities.service";
import { tasksApi } from "@/shared/services/tasks.api";
import { workflowsApi } from "@/shared/services/workflows.api";
import { campaignsApi } from "@/shared/services/campaigns.api";
import { templatesApi } from "@/shared/services/templates.api";
import { invoicesApi } from "@/shared/services/invoices.api";
import { auditApi } from "@/shared/services/audit.api";
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
  campaigns: Campaign[];
  templates: Template[];
  roles: RoleDefinition[];
  permissions: Permission[];
  users: User[];
  tenants: Tenant[];
  tasks: Task[];
  workflowExecutions: WorkflowExecution[];
  workflowExecutionRuns: WorkflowExecutionRun[];
  workflowExecutionSteps: WorkflowExecutionStep[];
  activities: Activity[];
  addActivity: (activity: Omit<Activity, 'id' | 'tenantId'>) => void;
  invoices: Invoice[];
  addInvoice: (invoice: Omit<Invoice, 'id' | 'tenantId' | 'createdAt'>) => void;
  updateInvoice: (id: string, updates: Partial<Invoice>) => void;
  removeInvoice: (id: string) => void;
  pendingActions: PendingAction[];
  auditLogs: AuditLog[];
  addContact: (
    contact: Omit<Contact, "id" | "tenantId" | "createdAt" | "score">,
  ) => Promise<void>;
  refreshContacts: () => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  refreshDeals: () => Promise<void>;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  addOrganization: (
    org: Omit<Organization, "id" | "tenantId" | "createdAt">,
  ) => Promise<string | null>;
  updateOrganization: (id: string, updates: Partial<Organization>) => Promise<void>;
  deleteOrganization: (id: string) => Promise<void>;
  addDeal: (deal: Omit<Deal, "id" | "tenantId" | "createdAt">) => Promise<void>;
  updateDeal: (id: string, updates: Partial<Deal>) => Promise<void>;
  moveDealStage: (id: string, stageId: string, note?: string, lostReason?: string, handoff?: any) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;
  addPipeline: (pipeline: Omit<Pipeline, "id" | "tenantId">) => Promise<void>;
  updatePipeline: (id: string, updates: Partial<Pipeline>) => Promise<void>;
  deletePipeline: (id: string) => Promise<void>;
  addTask: (task: Omit<Task, "id" | "tenantId" | "createdAt">) => Promise<void>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addWorkflow: (
    workflow: Omit<Workflow, "id" | "tenantId" | "executionCount">,
  ) => Promise<void>;
  updateWorkflow: (id: string, updates: Partial<Workflow>) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
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
  ) => void;
  updateRole: (id: string, updates: Partial<RoleDefinition>) => void;
  deleteRole: (id: string) => void;
  addUser: (userData: any) => void;
  updateUser: (id: string, updates: Partial<any>) => void;
  deleteUser: (id: string) => void;
  restoreRecord: (
    type:
      | "Organization"
      | "Contact"
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
  approveTenant: (id: string) => void;
  rejectTenant: (id: string) => void;
  suspendTenant: (id: string) => void;
  updateTenant: (id: string, updates: Partial<Tenant>) => void;
  addAuditLog: (action: string, details: string) => void;
  isBillingModuleEnabled: boolean;
  toggleBillingModule: () => void;

  // Column Preferences
  columnPreferences: Record<string, ColumnConfigItem[]>;
  columnPreferencesLoading: boolean;
  saveColumnPreference: (module: string, columns: ColumnConfigItem[]) => Promise<void>;
  resetColumnPreference: (module: string) => Promise<void>;
}

const MOCK_AUDIT_LO·S: AuditLog[] = [
  {
    id: "log_seed_1",
    userId: "user_client_admin",
    userEmail: "admin@democorp.com",
    action: "Auth Login",
    details:
      "User authenticated successfully via active MFA token from Chrome browser agent.",
    timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    ipAddress: "192.168.1.15",
    tenantId: "tenant_demo",
  },
  {
    id: "log_seed_2",
    userId: "user_sales_1",
    userEmail: "bob@democorp.com",
    action: "Contact Created",
    details:
      "Added a new contact profile for company 'Starlight Ventures' (Contact name: Chloe Starlight) with status 'New'.",
    timestamp: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
    ipAddress: "192.168.1.27",
    tenantId: "tenant_demo",
  },
  {
    id: "log_seed_3",
    userId: "user_sales_1",
    userEmail: "bob@democorp.com",
    action: "Deal Updated",
    details:
      "Updated pipeline stage from 'Prospecting' to 'Proposal Sent' for active commercial deal 'Enterprise SaaS Expansion'.",
    timestamp: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    ipAddress: "192.168.1.27",
    tenantId: "tenant_demo",
  },
  {
    id: "log_seed_4",
    userId: "user_client_admin",
    userEmail: "admin@democorp.com",
    action: "Role Updated",
    details:
      "Updated access definitions and user authorization parameters for role: 'User'.",
    timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    ipAddress: "192.168.1.15",
    tenantId: "tenant_demo",
  },
  {
    id: "log_seed_5",
    userId: "system",
    userEmail: "system@leadcrm.com",
    action: "Workflow Automation",
    details:
      "Triggered business workflow automation rule 'New Contact Auto-responder' for context 'Starlight Ventures'.",
    timestamp: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    ipAddress: "127.0.0.1",
    tenantId: "tenant_demo",
  },
  {
    id: "log_seed_6",
    userId: "user_client_admin",
    userEmail: "admin@democorp.com",
    action: "Auth MFA Update",
    details:
      "Enabled mandatory Multi-Factor Authentication (MFA) challenge for administrative workspace safety verification.",
    timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    ipAddress: "192.168.1.15",
    tenantId: "tenant_demo",
  },
  {
    id: "log_seed_7",
    userId: "user_super",
    userEmail: "super@leadcrm.com",
    action: "System Health Check",
    details:
      "Tenant directory automated resource allocation quota & memory utilization status verified successfully.",
    timestamp: new Date(Date.now() - 60 * 3600 * 1000).toISOString(),
    ipAddress: "10.0.0.2",
    tenantId: "system",
  },
];

// ── Column Preferences: System Default (fallback when API unavailable) ────────
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
  const { user, tenant } = useAuth();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workflowExecutions, setWorkflowExecutions] = useState<WorkflowExecution[]>([]);
  const [workflowExecutionRuns, setWorkflowExecutionRuns] = useState<WorkflowExecutionRun[]>([]);
  const [workflowExecutionSteps, setWorkflowExecutionSteps] = useState<WorkflowExecutionStep[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isBillingModuleEnabled, setIsBillingModuleEnabled] =
    useState<boolean>(false);

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

  const loadData = async () => {
    // ── REAL-API MODE ──────────────────────────────────────────────────────────
    if (!USE_MOCK_DATA) {
      if (!user) return;

      try {
        // Batch 1 — core CRM data (roles excluded — admin-only, 403 for Guest)
        // usersService.getRoles() requires roles.manage which Guest does not have.
        // Moving it to a separate non-blocking call prevents a 403 from killing
        // the entire Batch 1 load (contacts, deals, pipelines, users).
        const [contactsRes, orgsRes, dealsRes, pipelinesRes, activitiesRes, usersRes] = await Promise.all([
          contactsService.getAll({ limit: 100 }),
          organizationsService.getAll({ limit: 100 }),
          pipelineService.getDeals(undefined, 100),
          pipelineService.getPipelines(),
          activitiesService.getAll({ limit: 50 }),
          usersService.getAll({ limit: 200 }),
        ]);

        const apiContacts   = (contactsRes?.data ?? []).map(toFrontendContact);
        const apiOrgs       = (orgsRes?.data ?? []).map(toFrontendOrg);
        const apiDeals      = (dealsRes?.data ?? []).map(toFrontendDeal);
        const apiPipelines  = Array.isArray((pipelinesRes as any)?.data)
          ? ((pipelinesRes as any).data as any[]).map(toFrontendPipeline)
          : ((pipelinesRes as any)?.data ? [(pipelinesRes as any).data].map(toFrontendPipeline) : []);
        const apiActivities = activitiesRes?.data ?? [];
        const apiUsers      = usersRes?.data ?? [];

        setContacts((apiContacts as Contact[]).filter((c: any) => !c.isArchived));
        setOrganizations((apiOrgs as Organization[]).filter((o: any) => !o.isArchived));
        setDeals((apiDeals as Deal[]).filter((d: any) => !d.isArchived));
        setPipelines((apiPipelines as Pipeline[]).filter((p: any) => !p.isArchived));
        setActivities(apiActivities as unknown as Activity[]);
        setUsers((apiUsers as any[]).filter((u: any) => !u.isArchived));
      } catch (err) {
        console.error('[DataContext] Failed to load CRM data from API:', err);
        // RC-03 fix: surface genuine transport failures as a user-visible toast so
        // the dashboard never silently shows empty data without explanation.
        // 403 plan-gate responses are excluded -- those are expected for restricted
        // modules and should not alarm the user with a generic error.
        if (err instanceof Error && !err.message.includes('403')) {
          toast.error('Failed to load data. Please refresh the page.');
        }
      }

      // Batch 1b — admin-only data (roles). Silently ignored for non-admin roles
      // such as Guest (sandbox) which lack roles.manage permission.
      try {
        const rolesRes = await usersService.getRoles();
        const apiRoles = rolesRes?.data ?? [];
        setRoles((apiRoles as any[]).filter((r: any) => !r.isArchived));
      } catch {
        // 403 for Guest/User roles is expected — leave roles as empty array
        setRoles([]);
      }

      // ── Column Preferences (Batch 1 addition) ─────────────────────────────
      try {
        setColumnPreferencesLoading(true);
        const colResponse = await preferencesApi.getEffectiveColumns('leads');
        setColumnPreferences(prev => ({ ...prev, leads: colResponse.data.columns }));
      } catch {
        // Fallback to system default — don't block table render
        setColumnPreferences(prev => ({ ...prev, leads: LEADS_SYSTEM_DEFAULT }));
      } finally {
        setColumnPreferencesLoading(false);
      }

      // Batch 2 — deferred after initial paint so Batch 1 data renders first
      // Module flags are synchronous — load them now
      setIsBillingModuleEnabled(safeParse("leadcrm_billing_enabled", true));

      // Defer network-heavy secondary modules to the next event-loop tick
      // so Batch 1 data (contacts, deals, pipelines) is painted first.
      setTimeout(async () => {
        // Use allSettled so a single plan-gated/failed module (e.g. workflows or
        // campaigns on a FREE tenant) does not abort loading the others.
        const [tasksRes, workflowsRes, campaignsRes, templatesRes, invoicesRes, auditRes] = await Promise.allSettled([
          tasksApi.list({ limit: 100 }),
          workflowsApi.list({ limit: 200 }),
          campaignsApi.list({ limit: 100 }),
          templatesApi.list({ limit: 100 }),
          invoicesApi.list({ limit: 100 }),
          auditApi.list({ limit: 50 }),
        ]);

        // Fulfilled → set state; rejected (e.g. plan-gated 403) → default to empty.
        setTasks(tasksRes.status === 'fulfilled' ? ((tasksRes.value?.data ?? []) as Task[]) : []);
        setWorkflows(workflowsRes.status === 'fulfilled' ? ((workflowsRes.value?.data ?? []) as Workflow[]) : []);
        setCampaigns(campaignsRes.status === 'fulfilled' ? ((campaignsRes.value?.data ?? []) as Campaign[]) : []);
        setTemplates(templatesRes.status === 'fulfilled' ? ((templatesRes.value?.data ?? []) as Template[]) : []);
        setInvoices(invoicesRes.status === 'fulfilled' ? ((invoicesRes.value?.data ?? []) as Invoice[]) : []);

        if (auditRes.status === 'fulfilled') {
          // Map backend audit shape → frontend AuditLog shape
          const mappedLogs: AuditLog[] = (auditRes.value?.data ?? []).map((entry: any) => ({
            id:        entry.id,
            tenantId:  entry.tenantId ?? '',
            userId:    entry.userId ?? entry.user?.id ?? 'system',
            userEmail: entry.user?.email ?? '',
            action:    entry.action,
            details:   entry.changeset
              ? JSON.stringify(entry.changeset)
              : (entry.metadata ? JSON.stringify(entry.metadata) : entry.action),
            timestamp: entry.createdAt,
            ipAddress: entry.ipAddress ?? '',
          }));
          setAuditLogs(mappedLogs);
        } else {
          setAuditLogs([]);
        }

        // A plan-gated 403 for a FREE tenant is expected — keep it quiet, don't
        // surface it as a console error. Only debug-log genuinely for diagnostics.
        const rejected = [tasksRes, workflowsRes, campaignsRes, templatesRes, invoicesRes, auditRes]
          .filter((settledResult): settledResult is PromiseRejectedResult => settledResult.status === 'rejected');
        if (rejected.length > 0) {
          console.debug('[DataContext] Some secondary modules unavailable (likely plan-gated):', rejected.map((r) => r.reason?.message ?? r.reason));
        }
      }, 0);

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
              taxId: lead.taxId || "",
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
    const w = safeParse("leadcrm_workflows", MOCK_WORKFLOWS);
    const c = safeParse("leadcrm_campaigns", MOCK_CAMPAIGNS);
    const tpl = safeParse("leadcrm_templates", MOCK_TEMPLATES);
    const r = safeParse("leadcrm_roles", MOCK_ROLES);
    const perm = safeParse("leadcrm_permissions", MOCK_PERMISSIONS);
    const u = safeParse("leadcrm_users", MOCK_USERS);
    const t = safeParse("leadcrm_tenants", MOCK_TENANTS).map((tenant: Tenant) => {
      if (tenant.environment !== "none" && !tenant.healthMetrics) {
        const cpuUsage = Math.floor(Math.random() * 90) + 5;
        const memoryUsage = Math.floor(Math.random() * 90) + 10;
        const storageUsage = Math.floor(Math.random() * 80) + 20;
        let status: "healthy" | "warning" | "critical" = "healthy";

        if (cpuUsage > 90 || memoryUsage > 90 || storageUsage > 90) {
          status = "critical";
        } else if (cpuUsage > 70 || memoryUsage > 70 || storageUsage > 70) {
          status = "warning";
        }

        return {
          ...tenant,
          healthMetrics: {
            cpuUsage,
            memoryUsage,
            storageUsage,
            uptime: (99 + Math.random()).toFixed(1) + "%",
            status,
            lastCheck: new Date().toISOString(),
          },
        };
      }
      return tenant;
    });
    const tsk = safeParse("leadcrm_tasks", MOCK_TASKS ?? []);
    const execs = safeParse("leadcrm_workflow_executions", MOCK_WORKFLOW_EXECUTIONS ?? []);
    const pending = safeParse("leadcrm_pending_actions", [] as PendingAction[]);
    const logs = safeParse("leadcrm_audit_logs", [] as AuditLog[]);
    if (!localStorage.getItem("leadcrm_audit_logs")) {
      localStorage.setItem("leadcrm_audit_logs", JSON.stringify([]));
    }
    const billingEnabled = safeParse("leadcrm_billing_enabled", false);
    const activityData = safeParse("leadcrm_activities", [] as Activity[]);
    const execRuns = safeParse("leadcrm_workflow_execution_runs", [] as WorkflowExecutionRun[]);
    const execSteps = safeParse("leadcrm_workflow_execution_steps", [] as WorkflowExecutionStep[]);
    const invoiceData = safeParse("leadcrm_invoices", MOCK_INVOICES);

    setIsBillingModuleEnabled(billingEnabled);

    // Column preferences: use system default in mock mode
    setColumnPreferences(prev => ({ ...prev, leads: LEADS_SYSTEM_DEFAULT }));

    if (user?.role?.toLowerCase() === "system admin") {
      setContacts(l);
      setDeals(d);
      setPipelines(p);
      setWorkflows(w);
      setCampaigns(c);
      setTemplates(tpl);
      setRoles(r);
      setPermissions(perm);
      setUsers(u);
      setTenants(t);
      setTasks(tsk);
      setWorkflowExecutions(execs);
      setActivities(activityData);
      setWorkflowExecutionRuns(execRuns);
      setWorkflowExecutionSteps(execSteps);
      setInvoices(invoiceData);
    } else if (tenant) {
      setAuditLogs(
        logs.filter((log: any) => !log.tenantId || log.tenantId === tenant.id),
      );
      const userRoleDef =
        r.find(
          (role: any) =>
            role.name === user?.role && role.tenantId === tenant.id,
        ) || r.find((role: any) => role.name === user?.role);
      const userPerms = userRoleDef?.permissions || [];

      const canViewAllLeads = userPerms.includes("p2");
      const canViewOwnLeads = userPerms.includes("p2_own");
      const canViewAllDeals = userPerms.includes("p7");
      const canViewOwnDeals = userPerms.includes("p7_own");

      let filteredLeads = l.filter((x: any) => x.tenantId === tenant.id);
      if (!canViewAllLeads && canViewOwnLeads) {
        filteredLeads = filteredLeads.filter(
          (x: any) => x.assignedUserId === user?.id,
        );
      } else if (
        !canViewAllLeads &&
        !canViewOwnLeads &&
        user?.role?.toLowerCase() !== "client admin"
      ) {
        filteredLeads = [];
      }

      let filteredDeals = d.filter((x: any) => x.tenantId === tenant.id);
      if (!canViewAllDeals && canViewOwnDeals) {
        filteredDeals = filteredDeals.filter(
          (x: any) => x.assignedUserId === user?.id,
        );
      } else if (
        !canViewAllDeals &&
        !canViewOwnDeals &&
        user?.role?.toLowerCase() !== "client admin"
      ) {
        filteredDeals = [];
      }

      setContacts(filteredLeads);
      setDeals(filteredDeals);
      setPipelines(p.filter((x: any) => x.tenantId === tenant.id));
      setWorkflows(w.filter((x: any) => x.tenantId === tenant.id));
      setCampaigns(c.filter((x: any) => x.tenantId === tenant.id));
      setTemplates(tpl.filter((x: any) => x.tenantId === tenant.id));
      setRoles(r.filter((x: any) => x.tenantId === tenant.id));
      setPermissions(perm);
      setUsers(u.filter((x: any) => x.tenantId === tenant.id));
      setTenants(t.filter((x: any) => x.id === tenant.id));
      setTasks(tsk.filter((x: any) => x.tenantId === tenant.id));
      setWorkflowExecutions(execs.filter((x: any) => x.tenantId === tenant.id));
      setPendingActions(pending.filter((x: any) => x.tenantId === tenant.id));
      setActivities(activityData.filter((x: any) => x.tenantId === tenant.id));
      setWorkflowExecutionRuns(execRuns.filter((x: any) => x.tenantId === tenant.id));
      setWorkflowExecutionSteps(execSteps.filter((x: any) => x.tenantId === tenant.id));
      setInvoices(invoiceData.filter((x: any) => x.tenantId === tenant.id && !x.isArchived));
    }
  };

  useEffect(() => {
    // Only load data when we have a confirmed authenticated user
    if (!USE_MOCK_DATA && !user) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tenant?.id]);

  // Delegates to extracted pure service: src/modules/workflows/services/workflowConditionEvaluator.ts
  const evaluateWorkflowConditionDirectly = (
    wf: Workflow,
    context: { contact?: Contact; deal?: Deal },
  ) => evaluateWorkflowCondition(wf, context, deals, contacts);

    // Run actions for a single matched workflow
  const runSingleWorkflow = (
    wf: Workflow,
    context: { contact?: Contact; deal?: Deal },
    trigger: string,
  ) => {
    if (!tenant) return;

    // ── Phase 3: Create WorkflowExecutionRun record ────────────────────────
    const entityId = context.deal?.id || context.contact?.id || '';
    const entityType = context.deal ? 'deal' : 'contact';
    const runId = uuid();

    const newRun: WorkflowExecutionRun = {
      id: runId,
      tenantId: tenant.id,
      workflowId: wf.id,
      workflowName: wf.name,
      triggerId: trigger,
      entityType,
      entityId,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    // Persist the run record
    setWorkflowExecutionRuns(prev => {
      const updated = [newRun, ...prev].slice(0, 200);
      const all = JSON.parse(localStorage.getItem('leadcrm_workflow_execution_runs') || '[]');
      const merged = all.filter((x: any) => x.tenantId !== tenant.id).concat(updated);
      localStorage.setItem('leadcrm_workflow_execution_runs', JSON.stringify(merged));
      return updated;
    });

    // ── Create Activity entry for timeline ────────────────────────────────
    if (entityId) {
      addActivity({
        type: 'workflow',
        relatedToType: entityType as 'contact' | 'deal',
        relatedToId: entityId,
        title: `Workflow "${wf.name}" triggered`,
        description: `Trigger: ${trigger}`,
        createdBy: 'system',
        createdAt: new Date().toISOString(),
        metadata: { workflowId: wf.id, runId },
      });
    }
    // ──────────────────────────────────────────────────────────────────────

    const actionsToRun = wf.actions || [
      {
        id: "legacy_action",
        type: wf.action || "send_email",
        delay: wf.delay || 0,
        delayUnit: wf.delayUnit || "minutes",
        config: wf.actionConfig,
      },
    ];

    actionsToRun.forEach((action: any, stepIndex: number) => {
      if (action.delay && action.delay > 0) {
        // Schedule for later
        const executeAt = new Date();
        if (action.delayUnit === "minutes")
          executeAt.setMinutes(executeAt.getMinutes() + action.delay);
        else if (action.delayUnit === "hours")
          executeAt.setHours(executeAt.getHours() + action.delay);
        else if (action.delayUnit === "days")
          executeAt.setDate(executeAt.getDate() + action.delay);

        const newPending: PendingAction = {
          id: uuid(),
          workflowId: wf.id,
          tenantId: tenant.id,
          executeAt: executeAt.toISOString(),
          trigger: trigger,
          context: context,
          actionId: action.id,
        };

        setPendingActions((prev) => {
          const updated = [...prev, newPending];
          const allData = JSON.parse(
            localStorage.getItem("leadcrm_pending_actions") || "[]",
          );
          let newData = allData
            .filter((x: any) => x.tenantId !== tenant.id)
            .concat(updated);
          localStorage.setItem(
            "leadcrm_pending_actions",
            JSON.stringify(newData),
          );
          return updated;
        });

        // Record step as 'skipped' (scheduled for later)
        const step: WorkflowExecutionStep = {
          id: uuid(),
          executionId: runId,
          tenantId: tenant.id,
          stepIndex,
          actionType: action.type,
          status: 'skipped',
          output: { scheduledFor: executeAt.toISOString() },
          executedAt: new Date().toISOString(),
        };
        setWorkflowExecutionSteps(prev => {
          const updated = [step, ...prev].slice(0, 500);
          const all = JSON.parse(localStorage.getItem('leadcrm_workflow_execution_steps') || '[]');
          const merged = all.filter((x: any) => x.tenantId !== tenant.id).concat(updated);
          localStorage.setItem('leadcrm_workflow_execution_steps', JSON.stringify(merged));
          return updated;
        });

        // Legacy execution log
        const newExec: WorkflowExecution = {
          id: uuid(),
          workflowId: wf.id,
          tenantId: tenant.id,
          timestamp: new Date().toISOString(),
          status: "success",
          details: `Scheduled action '${action.type}' for ${executeAt.toLocaleString()}`,
          relatedEntityId: entityId,
        };
        setWorkflowExecutions((prev) => {
          const updated = [newExec, ...prev].slice(0, 100);
          const allData = JSON.parse(localStorage.getItem("leadcrm_workflow_executions") || "[]");
          const newData = allData.filter((x: any) => x.tenantId !== tenant.id).concat(updated);
          localStorage.setItem("leadcrm_workflow_executions", JSON.stringify(newData));
          return updated;
        });
      } else {
        // Execute immediately — pass runId and stepIndex for step tracking
        executeWorkflowAction(wf, action, context, runId, stepIndex);
      }
    });

    // Mark run as completed
    setWorkflowExecutionRuns(prev =>
      prev.map(r => r.id === runId ? { ...r, status: 'completed', completedAt: new Date().toISOString() } : r),
    );
  };

  // Evaluate time-based triggers periodically
  const evaluateTimeBasedWorkflows = () => {
    if (!tenant) return;

    const timeBasedWorkflows = workflows.filter(
      (wf) =>
        wf.status === "active" &&
        (wf.trigger === "deal_expected_close_date_approaching" ||
          wf.trigger === "lead_expected_close_date_approaching"),
    );

    if (timeBasedWorkflows.length === 0) return;

    timeBasedWorkflows.forEach((wf) => {
      if (wf.trigger === "deal_expected_close_date_approaching") {
        deals.forEach((deal) => {
          const key = `wf_exec_${wf.id}_deal_${deal.id}`;
          if (localStorage.getItem(key) === "true") return;

          const alreadyRun = workflowExecutions.some(
            (exec) =>
              exec.workflowId === wf.id && exec.relatedEntityId === deal.id,
          );
          if (alreadyRun) {
            localStorage.setItem(key, "true");
            return;
          }

          let conditionMet = true;
          if (wf.condition) {
            conditionMet = evaluateWorkflowConditionDirectly(wf, { deal });
          }

          if (conditionMet) {
            localStorage.setItem(key, "true");
            runSingleWorkflow(wf, { deal }, wf.trigger);
          }
        });
      } else if (wf.trigger === "lead_expected_close_date_approaching") {
        contacts.forEach((contact) => {
          const key = `wf_exec_${wf.id}_lead_${contact.id}`;
          if (localStorage.getItem(key) === "true") return;

          const alreadyRun = workflowExecutions.some(
            (exec) =>
              exec.workflowId === wf.id && exec.relatedEntityId === contact.id,
          );
          if (alreadyRun) {
            localStorage.setItem(key, "true");
            return;
          }

          let conditionMet = true;
          if (wf.condition) {
            conditionMet = evaluateWorkflowConditionDirectly(wf, { contact });
          }

          if (conditionMet) {
            localStorage.setItem(key, "true");
            runSingleWorkflow(wf, { contact }, wf.trigger);
          }
        });
      }
    });
  };

  // Process pending actions and time-based workflows
  useEffect(() => {
    evaluateTimeBasedWorkflows();

    const interval = setInterval(() => {
      const now = new Date();
      const toExecute = pendingActions.filter(
        (pa) => new Date(pa.executeAt) <= now,
      );

      if (toExecute.length > 0) {
        toExecute.forEach((pa) => {
          const wf = workflows.find((w) => w.id === pa.workflowId);
          if (wf) {
            const action = wf.actions?.find(
              (a) => a.id === (pa as any).actionId,
            ) || {
              id: "legacy_action",
              type: wf.action || "send_email",
              config: wf.actionConfig,
            };
            executeWorkflowAction(wf, action, pa.context, undefined, 0);
          }
        });

        const remaining = pendingActions.filter(
          (pa) => new Date(pa.executeAt) > now,
        );
        saveAndSet("leadcrm_pending_actions", remaining, setPendingActions);
      }

      evaluateTimeBasedWorkflows();
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingActions.length, workflows.length]);

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

  const runWorkflows = (
    trigger: string,
    context: { contact?: Contact; deal?: Deal },
  ) => {
    if (!tenant) return;

    const activeWorkflows = workflows.filter(
      (wf) => wf.status === "active" && wf.trigger === trigger,
    );

    activeWorkflows.forEach((wf) => {
      // Check condition
      let conditionMet = true;
      if (wf.condition) {
        conditionMet = evaluateWorkflowConditionDirectly(wf, context);
      }

      if (conditionMet) {
        runSingleWorkflow(wf, context, trigger);
      }
    });
  };

  const executeWorkflowAction = (
    wf: Workflow,
    action: any,
    context: { contact?: Contact; deal?: Deal },
    runId?: string,
    stepIndex?: number,
  ) => {
    if (!tenant) return;

    const replaceMergeTags = (text: string) => {
      if (!text) return text;
      return text
        .replace(/\[Deal Name\]/g, context.deal?.title || "")
        .replace(/\[Contact Name\]/g, context.contact?.companyName || "")
        .replace(
          /\[Contact Person\]/g,
          context.deal?.contactPerson || context.contact?.contactPerson || "",
        )
        .replace(
          /\[Company Name\]/g,
          context.deal?.companyName || context.contact?.companyName || "",
        )
        .replace(
          /\[Value\]/g,
          (context.deal?.value || context.contact?.estimatedValue || 0).toString(),
        )
        .replace(/\[Score\]/g, (context.contact?.score || 0).toString());
    };

    let executionDetails = "";
    let stepOutput: Record<string, unknown> = {};

    if (action.type === "create_task") {
      const taskTitle = replaceMergeTags(action.config?.taskTitle || `Workflow: ${wf.name}`);
      const taskDesc  = replaceMergeTags(action.config?.taskDescription || wf.description);
      addTask({
        dealId: context.deal?.id,
        title: taskTitle,
        description: taskDesc,
        status: "pending",
        dueDate: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
        assignedUserId:
          context.deal?.assignedUserId ||
          context.contact?.assignedUserId ||
          user?.id ||
          "system",
      });
      executionDetails = `Created task: ${taskTitle}`;
      stepOutput = { taskTitle };
    } else if (action.type === "send_email" || action.type === "send_sms") {
      const template = templates.find(t => t.id === action.config?.templateId);
      executionDetails = `Sent ${action.type === "send_email" ? "Email" : "SMS"} using template: ${template?.name || "Default"}`;
      stepOutput = { templateName: template?.name || "Default" };
    } else {
      executionDetails = `Executed action: ${action.type}`;
      stepOutput = { actionType: action.type };
    }

    // ── WorkflowExecutionStep record ──────────────────────────────────────
    if (runId !== undefined && stepIndex !== undefined) {
      const step: WorkflowExecutionStep = {
        id: uuid(),
        executionId: runId,
        tenantId: tenant.id,
        stepIndex,
        actionType: action.type,
        status: 'success',
        output: stepOutput,
        executedAt: new Date().toISOString(),
      };
      setWorkflowExecutionSteps(prev => {
        const updated = [step, ...prev].slice(0, 500);
        const all = JSON.parse(localStorage.getItem('leadcrm_workflow_execution_steps') || '[]');
        const merged = all.filter((x: any) => x.tenantId !== tenant.id).concat(updated);
        localStorage.setItem('leadcrm_workflow_execution_steps', JSON.stringify(merged));
        return updated;
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    // Legacy execution log (keep for backward compat)
    const newExec: WorkflowExecution = {
      id: uuid(),
      workflowId: wf.id,
      tenantId: tenant.id,
      timestamp: new Date().toISOString(),
      status: "success",
      details: executionDetails,
      relatedEntityId: context.deal?.id || context.contact?.id,
    };
    const newExecs = [newExec, ...workflowExecutions].slice(0, 100);
    saveAndSet("leadcrm_workflow_executions", newExecs, setWorkflowExecutions);

    const newWorkflows = workflows.map(w =>
      w.id === wf.id ? { ...w, executionCount: w.executionCount + 1 } : w,
    );
    saveAndSet("leadcrm_workflows", newWorkflows, setWorkflows);
  };

  const addOrganization = async (orgData: any): Promise<string | null> => {
    if (!tenant) return null;

    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendCreateOrg(orgData) as any;
        const res = await organizationsService.create(dto);
        const org = toFrontendOrg((res as any).data ?? res) as Organization;
        setOrganizations((prev) => [org, ...prev]);
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

  const deleteOrganization = async (id: string): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        await organizationsService.archive(id);
        setOrganizations((prev) =>
          prev.map((o) => (o.id === id ? { ...o, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user?.id } : o)),
        );
        addAuditLog("Organization Archived", `Archived organization id '${id}'.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to archive organization');
      }
      return;
    }

    const original = organizations.find((o) => o.id === id);
    const arr = organizations.map((o) =>
      o.id === id ? { ...o, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user?.id } : o,
    );
    saveAndSet("leadcrm_organizations", arr, setOrganizations);
    if (original) {
      addAuditLog("Organization Archived", `Archived corporate client profile '${original.name}'.`);
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
        addAuditLog(
          "Contact Created",
          `Added contact '${contact.contactPerson}' (${contact.companyName}) with status '${contact.status}'.`,
          contact.id,
        );
        runWorkflows("lead_created", { contact });
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
    runWorkflows("lead_created", { contact: newLead });
  };

  const updateContact = async (id: string, updates: Partial<Contact>): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        const dto = toBackendUpdateContact(updates as Record<string, any>) as any;
        const res = await contactsService.update(id, dto);
        const contact = toFrontendContact((res as any).data ?? res) as Contact;
        setContacts((prev) => prev.map((l) => (l.id === id ? contact : l)));
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

  const deleteContact = async (id: string): Promise<void> => {
    if (!USE_MOCK_DATA) {
      try {
        await contactsService.archive(id);
        setContacts((prev) =>
          prev.map((l) => (l.id === id ? { ...l, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user?.id } : l)),
        );
        addAuditLog("Contact Archived", `Archived contact id '${id}'.`);
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Failed to archive contact');
      }
      return;
    }

    const original = contacts.find((l) => l.id === id);
    const newLeads = contacts.map((l) =>
      l.id === id ? { ...l, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user?.id } : l,
    );
    saveAndSet("leadcrm_leads", newLeads, setContacts);
    if (original) {
      addAuditLog(
        "Contact Archived",
        `Archived contact profile belonging to company '${original.companyName}'.`,
      );
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
        runWorkflows("deal_created", { deal });
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
    runWorkflows("deal_created", { deal: newDeal });
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
          runWorkflows(`deal_stage_${stageSuffix}`, { deal: updated });
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
    if (!USE_MOCK_DATA) {
      try {
        const res = await pipelineService.moveDealStage(id, { stageId, note, lostReason, handoff });
        const responseData = (res as any).data ?? res;
        const rawDeal = responseData.deal ?? responseData;
        const deal = toFrontendDeal(rawDeal) as Deal;
        setDeals((prev) => prev.map((d) => (d.id === id ? deal : d)));

        const pLine = pipelines.find((p) => p.id === deal.pipelineId);
        const newName = pLine?.stages.find((s) => s.id === stageId)?.name || stageId;
        addAuditLog("Deal Stage Changed", `Moved deal '${deal.title}' to stage '${newName}'.`, id);
        addActivity({
          type: 'stage_change',
          relatedToType: 'deal',
          relatedToId: deal.id,
          title: `Deal moved to new stage`,
          createdBy: user?.id || 'system',
          createdAt: new Date().toISOString(),
          metadata: { newStageId: stageId },
        });
      } catch (err) {
        console.error("Failed to move deal stage", err);
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

  const addTask = async (taskData: any) => {
    if (!tenant) return;
    const now = new Date().toISOString();

    if (!USE_MOCK_DATA) {
      try {
        const dto = {
          title:          taskData.title,
          description:    taskData.description || undefined,
          status:         (taskData.status || 'pending') as 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled',
          priority:       (taskData.priority || 'Medium') as 'Low' | 'Medium' | 'High',
          dueDate:        taskData.dueDate ? (taskData.dueDate.includes('T') ? taskData.dueDate : `${taskData.dueDate}T00:00:00.000Z`) : new Date(Date.now() + 7 * 86400000).toISOString(),
          assignedUserId: taskData.assignedUserId,
          dealId:         taskData.dealId || undefined,
          leadId:         taskData.leadId || undefined,
          accountId:      taskData.accountId || undefined,
          contactId:      taskData.contactId || undefined,
          organizationId: taskData.organizationId || undefined,
        };
        const res = await tasksApi.create(dto as any);
        const created = res?.data ?? res;
        setTasks((prev) => [created as Task, ...prev]);
        addAuditLog("Task Created", `Created task '${dto.title}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create task");
      }
      return;
    }

    const newTask: Task = {
      ...taskData,
      id: uuid(),
      tenantId: tenant.id,
      createdAt: now,
      assignedBy: taskData.assignedBy || user?.id || 'system',
      assignmentHistory: [
        {
          assignedTo: taskData.assignedUserId || 'system',
          assignedBy: taskData.assignedBy || user?.id || 'system',
          assignedAt: now,
          reason: taskData.assignReason,
        },
      ],
    };
    const newTasks = [...tasks, newTask];
    saveAndSet("leadcrm_tasks", newTasks, setTasks);
    addAuditLog("Task Created", `Created task '${newTask.title}'.`);
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    if (!USE_MOCK_DATA) {
      try {
        const dto: Record<string, unknown> = { ...updates };
        if (dto.dueDate && typeof dto.dueDate === 'string' && !dto.dueDate.includes('T')) {
          dto.dueDate = `${dto.dueDate}T00:00:00.000Z`;
        }
        const res = await tasksApi.update(id, dto as any);
        const updated = res?.data ?? res;
        setTasks((prev) => prev.map((t) => (t.id === id ? (updated as Task) : t)));
        addAuditLog("Task Updated", `Updated task '${(updated as any).title || id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update task");
      }
      return;
    }

    const original = tasks.find((t) => t.id === id);
    const newTasks = tasks.map((t) => {
      if (t.id !== id) return t;
      const updated = { ...t, ...updates };
      if (updates.assignedUserId && updates.assignedUserId !== t.assignedUserId) {
        const record: import('./types').TaskAssignmentRecord = {
          assignedTo: updates.assignedUserId,
          assignedBy: user?.id || 'system',
          assignedAt: new Date().toISOString(),
          previousAssignee: t.assignedUserId || undefined,
          reason: (updates as any).reassignReason,
        };
        updated.assignmentHistory = [...(t.assignmentHistory || []), record];
        updated.assignedBy = user?.id || 'system';
      }
      return updated;
    });
    saveAndSet("leadcrm_tasks", newTasks, setTasks);
    if (original) addAuditLog("Task Updated", `Modified task '${original.title}'.`);
  };

  const deleteTask = async (id: string) => {
    const original = tasks.find((t) => t.id === id);
    if (!USE_MOCK_DATA) {
      try {
        await tasksApi.archive(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
        addAuditLog("Task Deleted", `Deleted task '${original?.title || id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to delete task");
      }
      return;
    }
    const newTasks = tasks.filter((t) => t.id !== id);
    saveAndSet("leadcrm_tasks", newTasks, setTasks);
    addAuditLog("Task Deleted", `Deleted task '${original?.title || id}'.`);
  };

  const addWorkflow = async (workflowData: any) => {
    if (!tenant) return;
    if (!USE_MOCK_DATA) {
      try {
        const dto = {
          name:        workflowData.name,
          description: workflowData.description || undefined,
          trigger:     workflowData.trigger,
          conditions:  workflowData.conditions || undefined,
          actions:     workflowData.actions || [],
          isActive:    workflowData.isActive ?? false,
        };
        const res = await workflowsApi.create(dto as any);
        const created = res?.data ?? res;
        setWorkflows((prev) => [created as Workflow, ...prev]);
        addAuditLog("Workflow Created", `Created workflow '${dto.name}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create workflow");
      }
      return;
    }
    const newWorkflow: Workflow = { ...workflowData, id: uuid(), tenantId: tenant.id, executionCount: 0, status: "active" };
    saveAndSet("leadcrm_workflows", [...workflows, newWorkflow], setWorkflows);
    addAuditLog("Workflow Created", `Created workflow '${newWorkflow.name}'.`);
  };

  const updateWorkflow = async (id: string, updates: Partial<Workflow>) => {
    if (!USE_MOCK_DATA) {
      try {
        const res = await workflowsApi.update(id, updates as any);
        const updated = res?.data ?? res;
        setWorkflows((prev) => prev.map((w) => (w.id === id ? (updated as Workflow) : w)));
        addAuditLog("Workflow Updated", `Updated workflow '${(updated as any).name || id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update workflow");
      }
      return;
    }
    const original = workflows.find((w) => w.id === id);
    saveAndSet("leadcrm_workflows", workflows.map((w) => w.id === id ? { ...w, ...updates } : w), setWorkflows);
    if (original) addAuditLog("Workflow Updated", `Updated workflow '${original.name}'.`);
  };

  const deleteWorkflow = async (id: string) => {
    if (!USE_MOCK_DATA) {
      try {
        await workflowsApi.archive(id);
        setWorkflows((prev) => prev.filter((w) => w.id !== id));
        addAuditLog("Workflow Archived", `Archived workflow id '${id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to archive workflow");
      }
      return;
    }
    const original = workflows.find((w) => w.id === id);
    saveAndSet("leadcrm_workflows", workflows.map((w) => w.id === id ? { ...w, isArchived: true } : w), setWorkflows);
    if (original) addAuditLog("Workflow Archived", `Archived workflow '${original.name}'.`);
  };

  const addCampaign = async (campaignData: any) => {
    if (!tenant) return;
    if (!USE_MOCK_DATA) {
      try {
        const res = await campaignsApi.create(campaignData);
        const created = res?.data ?? res;
        setCampaigns((prev) => [created as Campaign, ...prev]);
        addAuditLog("Campaign Created", `Created campaign '${(created as any).name || 'new'}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create campaign");
      }
      return;
    }
    const newCampaign: Campaign = {
      ...campaignData, id: uuid(), tenantId: tenant.id,
      createdAt: new Date().toLocaleDateString(), sentCount: 0, openedCount: 0, clickedCount: 0, engagement: 0,
    };
    saveAndSet("leadcrm_campaigns", [...campaigns, newCampaign], setCampaigns);
    addAuditLog("Campaign Created", `Created campaign '${newCampaign.name}'.`);
  };

  const updateCampaign = async (id: string, updates: Partial<Campaign>) => {
    if (!USE_MOCK_DATA) {
      try {
        const res = await campaignsApi.update(id, updates);
        const updated = res?.data ?? res;
        setCampaigns((prev) => prev.map((c) => (c.id === id ? (updated as Campaign) : c)));
        addAuditLog("Campaign Updated", `Updated campaign '${(updated as any).name || id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update campaign");
      }
      return;
    }
    const original = campaigns.find((c) => c.id === id);
    saveAndSet("leadcrm_campaigns", campaigns.map((c) => c.id === id ? { ...c, ...updates } : c), setCampaigns);
    if (original) addAuditLog("Campaign Updated", `Updated campaign '${original.name}'.`);
  };

  const deleteCampaign = async (id: string) => {
    if (!USE_MOCK_DATA) {
      try {
        await campaignsApi.archive(id);
        setCampaigns((prev) => prev.filter((c) => c.id !== id));
        addAuditLog("Campaign Archived", `Archived campaign id '${id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to archive campaign");
      }
      return;
    }
    const original = campaigns.find((c) => c.id === id);
    saveAndSet("leadcrm_campaigns", campaigns.map((c) => c.id === id ? { ...c, isArchived: true } : c), setCampaigns);
    if (original) addAuditLog("Campaign Archived", `Archived campaign '${original.name}'.`);
  };

  const addTemplate = async (templateData: any) => {
    if (!tenant) return;
    if (!USE_MOCK_DATA) {
      try {
        const res = await templatesApi.create(templateData);
        const created = res?.data ?? res;
        setTemplates((prev) => [created as Template, ...prev]);
        addAuditLog("Template Created", `Created template '${(created as any).name || 'new'}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create template");
      }
      return;
    }
    const newTemplate: Template = { ...templateData, id: uuid(), tenantId: tenant.id, createdAt: new Date().toLocaleDateString() };
    saveAndSet("leadcrm_templates", [...templates, newTemplate], setTemplates);
  };

  const updateTemplate = async (id: string, updates: Partial<Template>) => {
    if (!USE_MOCK_DATA) {
      try {
        const res = await templatesApi.update(id, updates);
        const updated = res?.data ?? res;
        setTemplates((prev) => prev.map((t) => (t.id === id ? (updated as Template) : t)));
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update template");
      }
      return;
    }
    saveAndSet("leadcrm_templates", templates.map((t) => t.id === id ? { ...t, ...updates } : t), setTemplates);
  };

  const deleteTemplate = async (id: string) => {
    if (!USE_MOCK_DATA) {
      try {
        await templatesApi.archive(id);
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        addAuditLog("Template Archived", `Archived template id '${id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to archive template");
      }
      return;
    }
    const original = templates.find((t) => t.id === id);
    saveAndSet("leadcrm_templates", templates.map((t) => t.id === id ? { ...t, isArchived: true } : t), setTemplates);
    if (original) addAuditLog("Template Archived", `Archived template '${original.name}'.`);
  };

  const addRole = async (roleData: any) => {
    if (!tenant) return;
    const newRole: RoleDefinition = {
      ...roleData,
      id: uuid(),
      tenantId: tenant.id,
      updatedAt: new Date().toLocaleString(),
    };

    setRoles((prev) => [...prev, newRole]);

    if (!USE_MOCK_DATA) {
      try {
        const res = await usersService.createRole(newRole);
        if (res.data) {
          setRoles((prev) => prev.map((r) => (r.id === newRole.id ? res.data! : r)));
          addAuditLog("Role Created", `Created custom user access level group description: '${newRole.name}'.`);
        }
      } catch (err: unknown) {
        toast.error("Failed to create role: " + (err instanceof Error ? err.message : "Unknown error"));
        setRoles((prev) => prev.filter((r) => r.id !== newRole.id));
      }
      return;
    }

    const newRoles = [...roles, newRole];
    saveAndSet("leadcrm_roles", newRoles, setRoles);
    addAuditLog(
      "Role Created",
      `Created custom user access level group description: '${newRole.name}'.`,
    );
  };

  const updateRole = async (id: string, updates: Partial<RoleDefinition>) => {
    const original = roles.find((r) => r.id === id);
    if (!original) return;

    setRoles((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, ...updates, updatedAt: new Date().toLocaleString() } : r
      )
    );

    if (!USE_MOCK_DATA) {
      try {
        const res = await usersService.updateRole(id, updates);
        if (res.data) {
          setRoles((prev) => prev.map((r) => (r.id === id ? res.data! : r)));
          addAuditLog("Role Updated", `Updated permissions or configuration for access level role: '${original.name}'.`);
        }
      } catch (err: unknown) {
        toast.error("Failed to update role: " + (err instanceof Error ? err.message : "Unknown error"));
        setRoles((prev) => prev.map((r) => (r.id === id ? original : r)));
      }
      return;
    }

    const newRoles = roles.map((r) =>
      r.id === id
        ? { ...r, ...updates, updatedAt: new Date().toLocaleString() }
        : r,
    );
    saveAndSet("leadcrm_roles", newRoles, setRoles);
    addAuditLog(
      "Role Updated",
      `Updated permissions or configuration for access level role: '${original.name}'.`,
    );
  };

  const deleteRole = async (id: string) => {
    const original = roles.find((r) => r.id === id);
    if (!original) return;

    setRoles((prev) => prev.map((r) => (r.id === id ? { ...r, isArchived: true } : r)));

    if (!USE_MOCK_DATA) {
      try {
        await usersService.deleteRole(id);
        addAuditLog("Role Archived", `Archived custom user access level group: '${original.name}'.`);
      } catch (err: unknown) {
        toast.error("Failed to archive role: " + (err instanceof Error ? err.message : "Unknown error"));
        setRoles((prev) => prev.map((r) => (r.id === id ? original : r)));
      }
      return;
    }

    const newRoles = roles.map((r) =>
      r.id === id ? { ...r, isArchived: true } : r,
    );
    saveAndSet("leadcrm_roles", newRoles, setRoles);
    addAuditLog(
      "Role Archived",
      `Archived custom user access level group: '${original.name}'.`,
    );
  };

  const addUser = async (userData: any) => {
    if (!tenant) return;
    const firstName = userData.firstName || "New";
    const lastName = userData.lastName || "User";

    const newUser: User = {
      id:
        userData.id ||
        uuid(),
      tenantId: tenant.id,
      firstName,
      lastName,
      email: userData.email || "",
      role: userData.role || "User",
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
      | "Organization"
      | "Contact"
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
      case "Organization":
        saveAndSet(
          "leadcrm_organizations",
          organizations.map((o) =>
            o.id === id ? { ...o, isArchived: false } : o,
          ),
          setOrganizations,
        );
        addAuditLog(
          "Organization Restored",
          `Restored corporate client profile (ID: ${id}).`,
        );
        break;
      case "Contact":
        saveAndSet(
          "leadcrm_leads",
          contacts.map((c) =>
            c.id === id ? { ...c, isArchived: false, status: "Cold" } : c,
          ),
          setContacts,
        );
        addAuditLog(
          "Contact Restored",
          `Restored contact profile (ID: ${id}).`,
        );
        break;
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
        saveAndSet(
          "leadcrm_workflows",
          workflows.map((w) => (w.id === id ? { ...w, isArchived: false } : w)),
          setWorkflows,
        );
        addAuditLog(
          "Workflow Restored",
          `Restored workflow automation rule (ID: ${id}).`,
        );
        break;
      case "Campaign":
        saveAndSet(
          "leadcrm_campaigns",
          campaigns.map((c) => (c.id === id ? { ...c, isArchived: false } : c)),
          setCampaigns,
        );
        addAuditLog(
          "Campaign Restored",
          `Restored marketing campaign (ID: ${id}).`,
        );
        break;
      case "Template":
        saveAndSet(
          "leadcrm_templates",
          templates.map((t) => (t.id === id ? { ...t, isArchived: false } : t)),
          setTemplates,
        );
        addAuditLog(
          "Template Restored",
          `Restored communication template (ID: ${id}).`,
        );
        break;
      case "Role":
        saveAndSet(
          "leadcrm_roles",
          roles.map((r) => (r.id === id ? { ...r, isArchived: false } : r)),
          setRoles,
        );
        addAuditLog(
          "Role Restored",
          `Restored custom access role (ID: ${id}).`,
        );
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

    if (user?.role?.toLowerCase() === "system admin") {
      setAuditLogs(updatedLogs);
    } else if (tenant) {
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

  const addInvoice = async (invoiceData: Omit<Invoice, 'id' | 'tenantId' | 'createdAt'>) => {
    if (!tenant) return;
    if (!USE_MOCK_DATA) {
      try {
        const dto: Record<string, unknown> = { ...invoiceData };
        // Ensure datetime fields are ISO format
        (['startDate', 'dueDate', 'nextBillingDate'] as const).forEach((field) => {
          const val = dto[field] as string | undefined;
          if (val && !val.includes('T')) dto[field] = `${val}T00:00:00.000Z`;
        });
        const res = await invoicesApi.create(dto as any);
        const created = res?.data ?? res;
        setInvoices((prev) => [created as Invoice, ...prev]);
        addAuditLog('Invoice Created', `Created invoice for '${(created as any).companyName || 'client'}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create invoice");
      }
      return;
    }
    const newInvoice: Invoice = { ...invoiceData, id: uuid(), tenantId: tenant.id, createdAt: new Date().toISOString() };
    const all = JSON.parse(localStorage.getItem('leadcrm_invoices') || JSON.stringify(MOCK_INVOICES));
    const updated = [...all, newInvoice];
    localStorage.setItem('leadcrm_invoices', JSON.stringify(updated));
    setInvoices(updated.filter((x: Invoice) => x.tenantId === tenant.id && !x.isArchived));
    addAuditLog('Invoice Created', `Created invoice for '${newInvoice.companyName}'.`);
  };

  const updateInvoice = async (id: string, updates: Partial<Invoice>) => {
    if (!USE_MOCK_DATA) {
      try {
        const dto: Record<string, unknown> = { ...updates };
        (['startDate', 'dueDate', 'nextBillingDate'] as const).forEach((field) => {
          const val = dto[field] as string | undefined;
          if (val && !val.includes('T')) dto[field] = `${val}T00:00:00.000Z`;
        });
        const res = await invoicesApi.update(id, dto as any);
        const updated = res?.data ?? res;
        setInvoices((prev) => prev.map((inv) => (inv.id === id ? (updated as Invoice) : inv)));
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update invoice");
      }
      return;
    }
    const all = JSON.parse(localStorage.getItem('leadcrm_invoices') || JSON.stringify(MOCK_INVOICES));
    const updated = all.map((inv: Invoice) => inv.id === id ? { ...inv, ...updates } : inv);
    localStorage.setItem('leadcrm_invoices', JSON.stringify(updated));
    if (tenant) setInvoices(updated.filter((x: Invoice) => x.tenantId === tenant.id && !x.isArchived));
  };

  const removeInvoice = async (id: string) => {
    if (!USE_MOCK_DATA) {
      try {
        await invoicesApi.archive(id);
        setInvoices((prev) => prev.filter((inv) => inv.id !== id));
        addAuditLog('Invoice Archived', `Archived invoice id '${id}'.`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to archive invoice");
      }
      return;
    }
    const all = JSON.parse(localStorage.getItem('leadcrm_invoices') || JSON.stringify(MOCK_INVOICES));
    const updated = all.map((inv: Invoice) => inv.id === id ? { ...inv, isArchived: true } : inv);
    localStorage.setItem('leadcrm_invoices', JSON.stringify(updated));
    if (tenant) setInvoices(updated.filter((x: Invoice) => x.tenantId === tenant.id && !x.isArchived));
  };

  const approveTenant = (id: string) => {
    const allTenants = JSON.parse(
      localStorage.getItem("leadcrm_tenants") || "[]",
    );
    const tenantToApprove = allTenants.find((t: Tenant) => t.id === id);
    if (!tenantToApprove) return;

    const newTenants = allTenants.map((t: Tenant) => {
      if (t.id === id) {
        if (t.approvalStep === "basic") {
          addAuditLog(
            "Approve Tenant Step 1",
            `Approved basic details for ${t.name}. Sandbox environment provisioned.`,
          );
          return {
            ...t,
            approvalStep: "requirements",
            environment: "sandbox",
            status: "pending",
          };
        } else if (t.approvalStep === "requirements") {
          addAuditLog(
            "Approve Tenant Final",
            `Approved business requirements for ${t.name}. Production environment provisioned.`,
          );
          return {
            ...t,
            approvalStep: "completed",
            environment: "production",
            status: "active",
          };
        }
        return {
          ...t,
          status: "active",
          approvalStep: "completed",
          environment: "production",
        };
      }
      return t;
    });
    localStorage.setItem("leadcrm_tenants", JSON.stringify(newTenants));
    loadData();
  };

  const rejectTenant = (id: string) => {
    const allTenants = JSON.parse(
      localStorage.getItem("leadcrm_tenants") || "[]",
    );
    const tenant = allTenants.find((t: Tenant) => t.id === id);
    if (tenant)
      addAuditLog("Reject Tenant", `Rejected application for ${tenant.name}.`);

    const newTenants = allTenants.map((t: Tenant) =>
      t.id === id ? { ...t, status: "rejected" } : t,
    );
    localStorage.setItem("leadcrm_tenants", JSON.stringify(newTenants));
    loadData();
  };

  const suspendTenant = (id: string) => {
    const allTenants = JSON.parse(
      localStorage.getItem("leadcrm_tenants") || "[]",
    );
    const tenant = allTenants.find((t: Tenant) => t.id === id);
    if (tenant)
      addAuditLog("Suspend Tenant", `Suspended access for ${tenant.name}.`);

    const newTenants = allTenants.map((t: Tenant) =>
      t.id === id ? { ...t, status: "suspended" } : t,
    );
    localStorage.setItem("leadcrm_tenants", JSON.stringify(newTenants));
    loadData();
  };

  const updateTenant = (id: string, updates: Partial<Tenant>) => {
    const allTenants = JSON.parse(
      localStorage.getItem("leadcrm_tenants") || "[]",
    );
    const tenant = allTenants.find((t: Tenant) => t.id === id);
    if (tenant && updates.adminNotes) {
      addAuditLog(
        "Update Tenant Notes",
        `Updated internal admin notes for ${tenant.name}.`,
      );
    }

    const newTenants = allTenants.map((t: Tenant) =>
      t.id === id ? { ...t, ...updates } : t,
    );
    localStorage.setItem("leadcrm_tenants", JSON.stringify(newTenants));
    loadData();
  };

  const resetDemoData = () => {
    localStorage.setItem("leadcrm_leads", JSON.stringify(MOCK_LEADS));
    localStorage.setItem("leadcrm_deals", JSON.stringify(MOCK_DEALS));
    localStorage.setItem("leadcrm_pipelines", JSON.stringify(MOCK_PIPELINES));
    localStorage.setItem("leadcrm_workflows", JSON.stringify(MOCK_WORKFLOWS));
    localStorage.setItem("leadcrm_campaigns", JSON.stringify(MOCK_CAMPAIGNS));
    localStorage.setItem("leadcrm_templates", JSON.stringify(MOCK_TEMPLATES));
    localStorage.setItem("leadcrm_roles", JSON.stringify(MOCK_ROLES));
    localStorage.setItem(
      "leadcrm_permissions",
      JSON.stringify(MOCK_PERMISSIONS),
    );
    localStorage.setItem("leadcrm_users", JSON.stringify(MOCK_USERS));
    localStorage.setItem("leadcrm_tenants", JSON.stringify(MOCK_TENANTS));
    localStorage.setItem("leadcrm_tasks", JSON.stringify(MOCK_TASKS));
    localStorage.setItem("leadcrm_billing_enabled", "false");
    loadData();
  };

  const toggleBillingModule = () => {
    const newState = !isBillingModuleEnabled;
    localStorage.setItem("leadcrm_billing_enabled", JSON.stringify(newState));
    setIsBillingModuleEnabled(newState);
  };

  // ── Column Preferences: Save & Reset ───────────────────────────────────────
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
    campaigns,
    templates,
    roles,
    permissions,
    users,
    tenants,
    tasks,
    workflowExecutions,
    workflowExecutionRuns,
    workflowExecutionSteps,
    activities,
    addActivity,
    invoices,
    addInvoice,
    updateInvoice,
    removeInvoice,
    pendingActions,
    auditLogs,
    addOrganization,
    updateOrganization,
    deleteOrganization,
    addContact,
    refreshContacts,
    refreshOrganizations,
    refreshDeals,
    updateContact,
    deleteContact,
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
    approveTenant,
    rejectTenant,
    suspendTenant,
    updateTenant,
    addAuditLog,
    addTask,
    updateTask,
    deleteTask,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    reorderDeals,
    addCampaign,
    updateCampaign,
    deleteCampaign,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    isBillingModuleEnabled,
    toggleBillingModule,
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
    organizations, contacts, deals, pipelines, workflows, campaigns,
    templates, roles, permissions, users, tenants, tasks,
    workflowExecutions, workflowExecutionRuns, workflowExecutionSteps,
    activities, invoices, pendingActions, auditLogs,
    isBillingModuleEnabled,
    columnPreferences, columnPreferencesLoading,
  ]);

  return (
    <DataContext.Provider value={contextValue}>
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
