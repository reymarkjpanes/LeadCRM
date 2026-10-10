// Operational roots only; identity, RBAC, preferences and security remain shared.
export const tenantModels = new Set(["RecordFile", "Account", "Lead", "Contact", "Pipeline", "Stage", "Deal", "LeadDeal", "ContactDeal", "DealStageHistory", "Task", "TaskLead", "TaskContact", "TaskDeal", "TaskAccount", "Activity", "Notification", "TargetAudience", "Campaign", "MarketingForm", "FormSubmission", "CampaignMetrics", "CampaignContact", "Template", "Workflow", "WorkflowTriggerRecord", "WorkflowExecutionRun", "WorkflowExecutionStep", "EmailDeliveryLog", "EmailEvent", "CrmImportJob", "CrmImportUpload"]);
export const tenantChildren: Record<string, { relation: string; model: string }> = {
 CrmImportRowResult: { relation: "job", model: "CrmImportJob" },
 CrmImportChunk: { relation: "upload", model: "CrmImportUpload" },
 TargetAudienceCondition: { relation: "targetAudience", model: "TargetAudience" },
};
tenantModels.add('MailboxMessage');
tenantModels.add('ScheduledMailboxEmail');
tenantModels.add('MailboxSendReceipt');
tenantModels.add('MailboxThreadAssociation');
tenantModels.add('ClosingFieldDefinition');
tenantModels.add('CustomFieldValue');
tenantModels.add('ProductInterest');
for (const model of ['Lead', 'Contact', 'Account']) tenantChildren[model + 'ProductInterest'] = { relation: model.toLowerCase(), model };

tenantModels.add('DealCreationReceipt');
tenantModels.add('SmsWebhookReceipt');
tenantModels.add('NotificationEvent');
tenantModels.add('NotificationDelivery');
tenantModels.add('DashboardRevision');
