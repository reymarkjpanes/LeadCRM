import { Suspense } from 'react';
import WorkflowBuilderPage from '@/features/tenant/automation/workflows/ui/workflow-builder-page';
import { WorkflowBuilderSkeleton } from '@/features/tenant/automation/workflows/ui/workflow-builder-skeleton';
export default function Page() { return <Suspense fallback={<WorkflowBuilderSkeleton />}><WorkflowBuilderPage /></Suspense>; }
