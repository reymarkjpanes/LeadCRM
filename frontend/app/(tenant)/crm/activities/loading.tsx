import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';

export default function ActivitiesLoading() {
  return (
    <div className="p-4 lg:p-6">
      <DataLoadingSkeleton rowCount={8} columnCount={5} />
    </div>
  );
}
