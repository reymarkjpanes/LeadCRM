import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';

export default function WorkflowsLoading() {
  return (
    <div className="p-4 lg:p-6">
      <DataLoadingSkeleton rowCount={6} columnCount={5} />
    </div>
  );
}
