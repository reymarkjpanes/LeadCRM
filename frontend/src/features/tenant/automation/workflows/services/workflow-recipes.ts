import type { WorkflowDraft, WorkflowOptions } from '@leadcrm/shared';
import { prepareWorkflowTemplateBinding, WORKFLOW_TEMPLATE_DESCRIPTORS } from './workflow-template-bindings';

export const QUALIFIED_FOLLOW_UP_NAME = 'Qualified Deal Follow-up';

/** Editable display names never determine template preparation. */
export function prepareWorkflowRecipe(recipe: WorkflowDraft, options: WorkflowOptions, identity?: number | string): WorkflowDraft {
  const draft = prepareWorkflowTemplateBinding(recipe, identity ?? WORKFLOW_RECIPES.indexOf(recipe), options);
  draft.isActive = false;
  return draft;
}

// Numeric indexes are used by existing template URLs. Keep this registry in order;
// curate the chooser through WORKFLOW_STARTER_TEMPLATES below.
export const WORKFLOW_RECIPES: WorkflowDraft[] = [
  // 1. Lead Management & Qualification
  {
    name: 'New Lead Follow-up',
    description: 'Assign an eligible agent to handle the new Lead. Configure the agent, Role or Group before activating.',
    trigger: 'lead.created',
    isActive: false,
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Hot Lead Urgent Response',
    description: 'Hand off a Lead to the selected agent or Group when its status becomes Hot.',
    trigger: 'lead.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'lead.status', operator: 'equals', value: 'Hot' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Website Inbound Lead Triage',
    description: 'Route new website Leads to a configured qualification agent or Group. This can deliberately replace initial form routing.',
    trigger: 'lead.created',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'lead.source', operator: 'equals', value: 'Website' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Warm Lead Discovery Preparation',
    description: 'Assign discovery responsibility when a Lead becomes Warm.',
    trigger: 'lead.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'event.newStatus', operator: 'equals', value: 'Warm' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Cold Lead Nurture Check',
    description: 'Hand off a Lead to a configured nurture agent or Group when it becomes Cold.',
    trigger: 'lead.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'lead.status', operator: 'equals', value: 'Cold' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Cancelled Lead Review',
    description: 'Hand off a cancelled Lead for review when its status becomes Cancelled. Closed Leads follow the governed conversion lifecycle.',
    trigger: 'lead.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'lead.status', operator: 'equals', value: 'Cancelled' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Lead Re-assignment & Greeting',
    description: 'Assign a connected eligible agent and send an introductory email.',
    trigger: 'lead.created',
    isActive: false,
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
      { type: 'send_email', config: { subject: 'Hello {{firstName}}', body: '<p>Hi {{firstName}},</p><p>I will help you with your inquiry. Please reply with any questions.</p>' } },
    ],
  },
  {
    name: 'New Lead Email Welcome',
    description: 'Send an immediate welcome email through the assigned agent’s connected Gmail.',
    trigger: 'lead.created',
    isActive: false,
    actions: [
      { type: 'send_email', config: { subject: 'Thank you for connecting, {{first_name}}', body: '<p>Hi {{first_name}},</p><p>Thank you for reaching out to our team. We received your details and an account representative will be in touch shortly.</p>' } },
    ],
  },

  // 2. Contact Management
  {
    name: 'Contact Onboarding Handoff',
    description: 'Assign an eligible onboarding agent or Group when a Contact is created.',
    trigger: 'contact.created',
    isActive: false,
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'VIP Contact Review',
    description: 'Assign a relationship-review agent when a Contact becomes Hot.',
    trigger: 'contact.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'contact.status', operator: 'equals', value: 'Hot' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'At-Risk Contact Follow-up',
    description: 'Hand off a Contact to the selected recovery agent or Group when its status becomes Cold.',
    trigger: 'contact.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'contact.status', operator: 'equals', value: 'Cold' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Contact Status Closed Wrap-up',
    description: 'Assign wrap-up responsibility when a Contact becomes Closed.',
    trigger: 'contact.status_changed',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'contact.status', operator: 'equals', value: 'Closed' }],
    },
    actions: [
      { type: 'assign_owner', config: { userId: '' } },
    ],
  },
  {
    name: 'Contact Welcome Email',
    description: 'Send a welcome email through the assigned agent’s connected Gmail when a Contact is created.',
    trigger: 'contact.created',
    isActive: false,
    actions: [
      { type: 'send_email', config: { subject: 'Welcome to our platform, {{first_name}}!', body: '<p>Hello {{first_name}},</p><p>Welcome! We are excited to partner with {{companyName}}. Please let us know if you have any questions as you get started.</p>' } },
    ],
  },

  // 3. Deal Pipeline & Sales Operations
  {
    name: 'High-value Deal Review',
    description: 'Create a review task for a high-value opportunity.',
    trigger: 'deal.created',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'deal.value', operator: 'greater_than', value: 100000 }],
    },
    actions: [
      { type: 'create_task', config: { title: 'Review high-value opportunity', dueDaysFromNow: 1, priority: 'High' } },
    ],
  },
  {
    name: 'Enterprise Deal Executive Sponsor',
    description: 'Schedule an executive sponsor review for deals valued at 250,000 and above.',
    trigger: 'deal.created',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'deal.value', operator: 'greater_than_or_equal', value: 250000 }],
    },
    actions: [
      { type: 'create_task', config: { title: 'Assign executive sponsor and review proposal', dueDaysFromNow: 2, priority: 'High', description: 'High-impact enterprise deal requires executive oversight and strategic pricing review.' } },
    ],
  },
  {
    name: 'High-Priority Deal Accelerator',
    description: 'Create a priority task for deals marked HIGH priority.',
    trigger: 'deal.created',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'deal.priority', operator: 'equals', value: 'HIGH' }],
    },
    actions: [
      { type: 'create_task', config: { title: 'Fast-track proposal preparation', dueDaysFromNow: 1, priority: 'High', description: 'High-priority opportunity. Coordinate sales engineering support.' } },
    ],
  },
  {
    name: 'Deal Stage Changed',
    description: 'Create a task for the assigned agent after each actual stage change. Use Deal Entered a Specific Stage instead to limit the task to one stage.',
    trigger: 'deal.stage_changed',
    isActive: false,
    actions: [
      { type: 'create_task', config: { title: 'Complete deliverables for new deal stage', dueDaysFromNow: 3, priority: 'Medium', description: 'Verify stage exit criteria and update next steps.' } },
    ],
  },
  {
    name: 'Move New Deal Stage',
    description: 'Move a newly created Deal from a selected source stage to a different open stage in the same pipeline, then create a qualification task. Choose the pipeline and both stages before activating.',
    trigger: 'deal.created',
    isActive: false,
    conditions: { operator: 'AND', conditions: [
      { field: 'deal.pipelineId', operator: 'equals', value: '' },
      { field: 'deal.stageId', operator: 'equals', value: '' },
    ] },
    actions: [
      { type: 'move_deal_stage', config: { stageId: '' } },
      { type: 'create_task', config: { title: 'Conduct initial qualification review', dueDaysFromNow: 2, priority: 'Medium' } },
    ],
  },
  {
    name: 'Deal Marked as Won',
    description: 'Create a handoff task for the assigned agent.',
    trigger: 'deal.closed_won',
    isActive: false,
    actions: [
      { type: 'create_task', config: { title: 'Arrange contact handoff', dueDaysFromNow: 1, priority: 'Medium' } },
    ],
  },
  {
    name: 'Major Won Deal Celebration & Kickoff',
    description: 'Celebrate closed won deal and initiate immediate implementation kickoff.',
    trigger: 'deal.closed_won',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'deal.value', operator: 'greater_than_or_equal', value: 50000 }],
    },
    actions: [
      { type: 'create_task', config: { title: 'Schedule contact implementation kickoff', dueDaysFromNow: 2, priority: 'High', description: 'High-value implementation kickoff meeting and stakeholder introduction.' } },
    ],
  },
  {
    name: 'Lost Deal Win/Loss Analysis',
    description: 'Prompt sales rep to document loss reasons and competitor intelligence.',
    trigger: 'deal.closed_lost',
    isActive: false,
    actions: [
      { type: 'create_task', config: { title: 'Log lost reason and review competitor insights', dueDaysFromNow: 3, priority: 'Low', description: 'Document key objections, pricing factors, and feedback for product marketing.' } },
    ],
  },
  {
    name: 'High-Value Lost Deal Review',
    description: 'Schedule a strategic review when a major deal is lost.',
    trigger: 'deal.closed_lost',
    isActive: false,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'deal.value', operator: 'greater_than_or_equal', value: 50000 }],
    },
    actions: [
      { type: 'create_task', config: { title: 'Conduct executive post-mortem on lost deal', dueDaysFromNow: 5, priority: 'High', description: 'Analyze why this major deal was lost and evaluate future re-engagement timing.' } },
    ],
  },
  {
    name: QUALIFIED_FOLLOW_UP_NAME,
    description: 'Create a follow-up once for each move into Qualified if this deal has never reached Won. Choose the Qualified stage before activating. Edits while Qualified and creation directly in Qualified do not trigger this workflow. Create a new deal for a repeat purchase.',
    trigger: 'deal.stage_changed',
    isActive: false,
    conditions: { operator: 'AND', conditions: [
      { field: 'event.newStageId', operator: 'equals', value: '' },
      { field: 'deal.hasEverBeenWon', operator: 'equals', value: false },
      { field: 'deal.wonHistoryVerified', operator: 'equals', value: true },
      { field: 'deal.pipelineId', operator: 'equals', value: '' },
    ] },
    actions: [{ type: 'create_task', config: { title: 'Follow up on qualified deal', dueDaysFromNow: 1, priority: 'Medium' } }],
  },
  {
    name: 'Hot Lead → Move Related Deal',
    description: 'When a Lead becomes Hot, move one matching persisted related open Deal from the selected source stage to a different open stage in the same pipeline. Choose both stages and optionally a Product. No matching Deal produces no movement or task; multiple matches require review.',
    trigger: 'lead.status_changed',
    isActive: false,
    conditions: { operator: 'AND', conditions: [{ field: 'event.newStatus', operator: 'equals', value: 'Hot' }] },
    actions: [{ type: 'move_deal_stage', config: { stageId: '', currentStageId: '', targetMode: 'single_match' } }],
  },
  {
    name: 'Hot Contact → Move Related Deal',
    description: 'When a Contact becomes Hot, move one matching persisted related open Deal from the selected source stage to a different open stage in the same pipeline. Choose both stages and optionally a Product. No matching Deal produces no movement or task; multiple matches require review.',
    trigger: 'contact.status_changed',
    isActive: false,
    conditions: { operator: 'AND', conditions: [{ field: 'event.newStatus', operator: 'equals', value: 'Hot' }] },
    actions: [{ type: 'move_deal_stage', config: { stageId: '', currentStageId: '', targetMode: 'single_match' } }],
  },
  {
    name: 'Deal Entered a Specific Stage',
    description: 'Create a task for the assigned agent when a Deal enters a selected pipeline stage. Choose the stage before activating. Ordinary edits and creation directly in that stage do not trigger this workflow.',
    trigger: 'deal.stage_changed',
    isActive: false,
    conditions: { operator: 'AND', conditions: [
      { field: 'deal.pipelineId', operator: 'equals', value: '' },
      { field: 'event.newStageId', operator: 'equals', value: '' },
    ] },
    actions: [{ type: 'create_task', config: { title: 'Complete follow-up for entered Deal stage', dueDaysFromNow: 1, priority: 'Medium' } }],
  },
  {
    name: 'Account Field Maintenance',
    description: 'Maintain an approved Account field after an update. Choose the field, value and matching conditions before activating.',
    trigger: 'account.updated',
    isActive: false,
    actions: [{ type: 'update_field', config: { field: 'website', value: '' } }],
  },
  {
    name: 'New Deal Created', description: 'Create a first follow-up task for the new Deal’s assigned agent. Review the assignee and due interval before activating.',
    trigger: 'deal.created', isActive: false,
    actions: [{ type: 'create_task', config: { title: 'Follow up on new Deal', dueDaysFromNow: 1, priority: 'Medium', assignmentTarget: { type: 'record_owner' } } }],
  },
  {
    name: 'Deal Assigned', description: 'When a Deal’s assigned agent changes, create a linked task for the new agent. Existing assignment and task notifications inform that agent. Ordinary edits do not match.',
    trigger: 'deal.updated', isActive: false,
    conditions: { operator: 'AND', conditions: [
      { field: 'event.changedFields', operator: 'contains', value: 'assignedUserId' },
      { field: 'deal.assignedUserId', operator: 'is_not_empty', value: null },
    ] },
    actions: [{ type: 'create_task', config: { title: 'Review newly assigned Deal', dueDaysFromNow: 1, priority: 'Medium', assignmentTarget: { type: 'record_owner' } } }],
  },
  {
    name: 'Deal Follow-up Email', description: 'Send an existing email template to the primary Contact after entry into a selected pipeline stage. Choose the stage and email template; verify the assigned agent’s Gmail connection and recipient permissions.',
    trigger: 'deal.stage_changed', isActive: false,
    conditions: { operator: 'AND', conditions: [
      { field: 'deal.pipelineId', operator: 'equals', value: '' },
      { field: 'event.newStageId', operator: 'equals', value: '' },
    ] },
    actions: [{ type: 'send_email', config: { recipient: 'primary_contact', templateId: '' } }],
  },
  {
    name: 'Won Deal Thank-you Email', description: 'Send an existing post-sale email template to the primary Contact when the Deal is marked Won. Existing closing requirements still apply.',
    trigger: 'deal.closed_won', isActive: false,
    actions: [{ type: 'send_email', config: { recipient: 'primary_contact', templateId: '' } }],
  },
  {
    name: 'Deal Marked as Lost', description: 'Create a review task for the assigned agent when a Deal is marked Lost, whether or not an automated closing action supplied a loss reason.',
    trigger: 'deal.closed_lost', isActive: false,
    actions: [{ type: 'create_task', config: { title: 'Review lost Deal and next steps', dueDaysFromNow: 3, priority: 'Low', assignmentTarget: { type: 'record_owner' } } }],
  },
  {
    name: 'New Lead SMS Acknowledgment', description: 'Acknowledge a new Lead by SMS using its saved first name. Configure TextBee and review eligible recipients before activation.',
    trigger: 'lead.created', isActive: false,
    actions: [{ type: 'send_sms', config: { recipient: 'record', message: 'Hi {{firstName}}, we received your inquiry. Our team will contact you shortly.' } }],
  },
  {
    name: 'Contact Welcome Email Template', description: 'Send an existing welcome email template when a Contact is created. Choose the template and verify the assigned agent’s Gmail connection.',
    trigger: 'contact.created', isActive: false,
    actions: [{ type: 'send_email', config: { recipient: 'record', templateId: '' } }],
  },
  {
    name: 'Automatic Deal Stage Update',
    description: 'Move a Deal to a different open stage when its priority changes to High. Choose the pipeline, source and target stages, then customize the matching conditions before activating. The Deal stays in its current pipeline.',
    trigger: 'deal.updated', isActive: false,
    conditions: { operator: 'AND', conditions: [
      { field: 'event.changedFields', operator: 'contains', value: 'priority' },
      { field: 'deal.priority', operator: 'equals', value: 'HIGH' },
      { field: 'deal.pipelineId', operator: 'equals', value: '' },
      { field: 'deal.stageId', operator: 'equals', value: '' },
    ] },
    actions: [{ type: 'move_deal_stage', config: { stageId: '' } }],
  },
];

// Curate only the chooser. The registry and descriptors retain legacy URLs.
const starterOrder = [27, 16, 25, 34, 17, 18, 31, 28, 0, 1, 7, 23, 8, 33, 24, 26];
export const WORKFLOW_STARTER_TEMPLATES = starterOrder.map(index => ({
  ...WORKFLOW_TEMPLATE_DESCRIPTORS.find(descriptor => descriptor.index === index)!, recipe: WORKFLOW_RECIPES[index],
}));
