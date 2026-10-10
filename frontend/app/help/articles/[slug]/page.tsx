import { notFound } from 'next/navigation';
import { getArticle, helpArticles } from '@/features/tenant/help/content';
import HelpArticlePage from '@/features/tenant/help/ui/help-article';

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return helpArticles.map(article => ({ slug: article.slug })); }
export async function generateMetadata({ params }: Props) {
  const article = getArticle((await params).slug);
  return { title: `${article?.title ?? 'Article not found'} | LeadCRM Help`, description: article?.summary };
}
export default async function Page({ params }: Props) {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  return <HelpArticlePage article={article} />;
}
