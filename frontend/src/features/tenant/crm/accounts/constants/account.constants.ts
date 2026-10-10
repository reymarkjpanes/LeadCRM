export { COMPANY_INDUSTRIES } from '@leadcrm/shared';

export const COMPANY_SIZES = [
  '1–10', '11–50', '51–200', '201–500', '500+',
] as const;

export const COMPANY_TABLE_COLUMNS = [
  { key: 'name',            label: 'Account Name' },
  { key: 'industry',        label: 'Industry' },
  { key: 'size',            label: 'Size' },
  { key: 'assignedUserId',  label: 'Assigned Agent' },
  { key: 'createdAt',       label: 'Created' },
] as const;
