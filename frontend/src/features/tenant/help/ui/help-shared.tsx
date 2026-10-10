import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getCategory } from '../content';
import type { HelpArticle } from '../content/types';
import styles from './help.module.css';

export const articleHref = (slug: string) => `/help/articles/${slug}`;
export const categoryHref = (id: string) => `/help/category/${id}`;

export function HelpBreadcrumb({ category, title }: { category?: string; title?: string }) {
  const categoryInfo = category ? getCategory(category) : undefined;
  return <nav aria-label="Help Center breadcrumb" className={styles.breadcrumb}>
    <Link href="/help">Help Center</Link>
    {categoryInfo && <><ChevronRight size={12} aria-hidden="true" />{title ? <Link href={categoryHref(categoryInfo.id)}>{categoryInfo.title}</Link> : <span aria-current="page">{categoryInfo.title}</span>}</>}
    {title && <><ChevronRight size={12} aria-hidden="true" /><span aria-current="page">{title}</span></>}
  </nav>;
}

export function ArticleResult({ article }: { article: HelpArticle }) {
  return <Link href={articleHref(article.slug)} className={styles.result}>
    <span className={styles.resultCategory}>{getCategory(article.category)?.title}</span>
    <h3>{article.title}</h3><p>{article.summary}</p>
  </Link>;
}

export function HelpFooter() {
  return <p className={styles.footer}>Guides for the current LeadCRM workspace. Available controls depend on your role.</p>;
}
