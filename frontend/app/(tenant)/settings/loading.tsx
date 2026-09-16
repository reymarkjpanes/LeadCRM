import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';

export default function SettingsLoading() {
  return (
    <div className="p-4 lg:p-6">
      <DataLoadingSkeleton rowCount={4} columnCount={3} />
    </div>
  );
}
