'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { CrmRecordView } from '@/shared/components/crm/crm-record-view';

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  return <CrmRecordView key={`${params.id}:${user?.id}`} module="accounts" id={params.id} />;
}
