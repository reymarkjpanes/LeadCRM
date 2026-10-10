import PublicFormPage from '@/features/tenant/marketing/forms/ui/public-form-page';
export default async function Page({ params }: { params: Promise<{ publicId: string }> }) {
  return <PublicFormPage publicId={(await params).publicId} />;
}
