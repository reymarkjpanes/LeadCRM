// Operational roots only; identity, RBAC, preferences and security remain shared.
export const tenantModels = new Set(["RecordFile", "Account", "Lead", "Contact", "Pipeline", "Stage", "Deal", "LeadDeal", "ContactDeal", "DealStageHistory", "DealAction", "Task", "TaskLead", "TaskContact", "TaskDeal", "TaskAccount", "Activity", "Notification", "TargetAudience", "Campaign", "MarketingForm", "FormSubmission", "CampaignMetrics", "CampaignContact", "Template", "Workflow", "WorkflowTriggerRecord", "WorkflowExecutionRun", "WorkflowExecutionStep", "EmailDeliveryLog", "SMSQueue", "EmailEvent", "AutomationRule", "LeadImport", "AccountImport", "ContactImport", "DealImport"]);
export const tenantChildren: Record<string, { relation: string; model: string }> = {
 TargetAudienceCondition: { relation: "targetAudience", model: "TargetAudience" },
 LeadImportResult: { relation: "import", model: "LeadImport" },
 AccountImportResult: { relation: "import", model: "AccountImport" },
 DealImportResult: { relation: "import", model: "DealImport" },
 ContactImportResult: { relation: "import", model: "ContactImport" },
};
tenantModels.add('MailboxMessage');
tenantModels.add('ClosingFieldDefinition');
