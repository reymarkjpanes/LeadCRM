// @leadcrm/shared — single source of truth for types, RBAC constants,
// API contracts, and validation schemas.
// Import from here in both frontend and backend — never duplicate.

export * from './types';
export * from './constants';
export * from './contracts';
export * from './validation';
export * from './contracts/auth.contract';
export * from './constants/onboarding';
export * from './validation/auth.schema';
export * from './contracts/profile.contract';
export * from './contracts/record-sort';
export * from './contracts/lead-column-migration';

export * from './validation/administration-user.schema';
export * from './validation/crm-import.schema';

export * from './contracts/campaign-email';
export * from './contracts/campaign-links';
export * from './contracts/forms.contract';
export * from './contracts/archived-data.contract';
export * from './contracts/list-pagination';

export * from './contracts/product-interests.contract';

export * from './contracts/record-experience';

export * from './contracts/lead-created.contract';
export * from './validation/crm-email';
export * from './contracts/mailbox.contract';
export * from './contracts/closing-requirements';
export * from './contracts/notifications';

export * from './contracts/module-table-columns';
export * from './contracts/group.contract';
export * from './constants/company-industries';

export * from './contracts/deal-batch';
export * from './contracts/lead.contract';
export * from './contracts/dashboard.contract';
export * from './contracts/pipeline-stage.contract';
export * from './contracts/workspace-access';
