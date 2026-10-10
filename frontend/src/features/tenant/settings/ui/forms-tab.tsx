'use client';
import FormsPage from '@/features/tenant/marketing/forms/ui/forms-page';
export function FormsTab(props: { onBuilderActiveChange?: (active: boolean) => void }) {
  return <FormsPage {...props} />;
}
