import { notFound } from 'next/navigation';
import { getCategory, helpCategories } from '@/features/tenant/help/content';
import HelpCategoryPage from '@/features/tenant/help/ui/help-category';

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return helpCategories.map(category => ({ slug: category.id })); }
export async function generateMetadata({ params }: Props) {
  const category = getCategory((await params).slug);
  return { title: `${category?.title ?? 'Category not found'} | LeadCRM Help` };
}
export default async function Page({ params }: Props) {
  const category = getCategory((await params).slug);
  if (!category) notFound();
  return <HelpCategoryPage category={category} />;
}
