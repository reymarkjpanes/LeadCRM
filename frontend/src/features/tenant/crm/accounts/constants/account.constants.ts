export const COMPANY_INDUSTRIES = [
  'Technology', 'Manufacturing', 'Retail', 'Healthcare',
  'Finance', 'Education', 'Construction', 'Real Estate',
  'Telecommunications', 'Security', 'Other',
] as const;

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
