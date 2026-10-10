import type { FieldDefinition, ImportModuleConfig } from '../types/import.types';
const field = (key: string, label: string, required = false): FieldDefinition => ({ key, label, required, type: 'text', autoMapPatterns: [key.toLowerCase(), label.toLowerCase()] });
export const dealImportConfig: ImportModuleConfig = {
  moduleKey: 'deals', moduleLabel: 'Deals', moduleSingular: 'Deal', backRoute: '/crm/deals',
  importApiPath: '/crm/deals/imports', detailsRoute: id => `/crm/deals/imports/${id}`,
  templateFileName: 'deal-import-template.csv', permission: 'deals.create',
  requiredFields: [field('title', 'Deal Title', true), { ...field('productInterest', 'Product Interest', true), autoMapPatterns: ['product interest', 'product interests', 'product', 'productinterest'] }, field('pipeline', 'Pipeline', true), field('stage', 'Stage', true)],
  optionalFields: [field('customer', 'Customer Email'), { ...field('priority', 'Priority'), type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
    field('expectedCloseDate', 'Expected Close Date'), field('account', 'Account'), field('contact', 'Contact'), field('lead', 'Lead'), { ...field('assignedUser', 'Assigned Agent Email'), autoMapPatterns: ['assigned agent email', 'assigned user', 'assigneduser', 'assigned agent', 'agent email'] }],
};
