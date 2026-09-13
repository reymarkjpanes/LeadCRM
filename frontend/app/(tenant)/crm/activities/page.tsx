'use client';
import dynamic from 'next/dynamic';
const ActivitiesPage = dynamic(() => import('../../../../src/features/tenant/crm/activities/ui/activities-page'), { ssr: false });
export default ActivitiesPage;
