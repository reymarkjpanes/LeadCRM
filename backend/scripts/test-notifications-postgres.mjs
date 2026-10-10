import { notificationTestPostgres, runNotificationTestFile } from './notification-test-postgres.mjs';
const pg=await notificationTestPostgres();
const files=process.argv.slice(2);
const suites=files.length?files:[
 'src/modules/notifications/notifications.integration.test.ts',
 'src/modules/notifications/notification-delivery.integration.test.ts',
 'src/modules/crm/leads/lead-polish.integration.test.ts',
 'src/modules/crm/leads/crm-completion.integration.test.ts',
 'src/modules/crm/leads/sales-automation.integration.test.ts',
 'src/modules/crm/leads/product-normalization.integration.test.ts',
 'src/modules/operations/tasks/__tests__/tasks.integration.test.ts',
 'src/integrations/gmail/scoped-mailbox.integration.test.ts',
 'src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts',
 'src/modules/automation/workflows/__tests__/workflow.integration.test.ts',
 'src/modules/automation/workflows/__tests__/workflow-polish.integration.test.ts',
 'src/core/permissions/permissions.integration.test.ts',
 'src/api/middleware/__tests__/auth-state.test.ts',
 'src/core/auth/__tests__/account-access.test.ts',
 'src/core/auth/__tests__/session-revocation.test.ts',
];
try {
 for(const file of suites) {
  const name=file.includes('mailbox')?'leadcrm_mailbox_test_1'
   :file.includes('campaigns')?'leadcrm_campaign_test_1'
   :file.includes('workflows')||file.includes('/tasks/')?'leadcrm_workflow_test_1'
   :file.includes('permissions')?'leadcrm_environment_test_1':file.includes('crm-completion')?'leadcrm_completion_test_1':'leadcrm_forms_test_2';
  const code=await runNotificationTestFile(file,await pg.database(name));
  if(code)process.exitCode=code;
 }
} finally { pg.stop(); }
