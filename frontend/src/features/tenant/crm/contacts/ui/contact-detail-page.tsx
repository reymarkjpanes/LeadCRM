'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { CrmRecordView } from '@/shared/components/crm/crm-record-view';

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  return <CrmRecordView key={`${params.id}:${user?.id}`} module="contacts" id={params.id} />;
}
