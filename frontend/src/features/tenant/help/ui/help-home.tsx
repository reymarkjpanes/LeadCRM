'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Search, X, ArrowRight, Compass, Target, Users, Building2, Briefcase, CheckSquare, Mail, Workflow, BarChart3, Shield, Settings, LockKeyhole, CircleHelp, UserRoundCog } from 'lucide-react';
import { helpCategories, helpArticles, getArticle, getCategoryArticles, popularArticleIds } from '../content';
import { searchHelp } from '../search';
import { ArticleResult, HelpFooter, articleHref, categoryHref } from './help-shared';
import styles from './help.module.css';

const icons = { 'getting-started': Compass, leads: Target, contacts: Users, accounts: Building2, deals: Briefcase, tasks: CheckSquare, campaigns: Mail, automation: Workflow, dashboard: BarChart3, team: UserRoundCog, roles: Shield, settings: Settings, security: LockKeyhole, troubleshooting: CircleHelp };

export default function HelpHome() {
  const params = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const urlQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  useEffect(() => setQuery(urlQuery), [urlQuery]);
  const category = params.get('category') ?? '';
  const searching = Boolean(query.trim());
  const results = searchHelp(query, category || undefined);
  function updateQuery(q: string, selectedCategory = category) {
    setQuery(q);
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (selectedCategory) next.set('category', selectedCategory);
    // Next's native history integration keeps back navigation in sync without a
    // server navigation for every keystroke. The help index stays client-side.
    window.history.replaceState(null, '', `/help${next.size ? `?${next}` : ''}`);
  }
  return <div className={styles.root}>
    <header className={styles.hero}>
      <div className={styles.eyebrow}><BookOpen size={20} aria-hidden="true" />LeadCRM Help Center</div>
      <h1>How can we help?</h1>
      <p>Practical guides for your everyday CRM work, from your first lead to managing team access.</p>
      <form className={styles.search} role="search" onSubmit={event => event.preventDefault()}>
        <label htmlFor="help-search">Search LeadCRM help</label>
        <div className={styles.searchBox}>
          <Search size={20} aria-hidden="true" className={styles.muted} />
          <input ref={input} id="help-search" type="search" value={query} maxLength={180} placeholder="Try “create role” or “pipeline”" onChange={event => updateQuery(event.target.value)} />
          {query && <button type="button" aria-label="Clear help search" onClick={() => { updateQuery(''); input.current?.focus(); }}><X size={18} aria-hidden="true" /></button>}
        </div>
        <p className={styles.searchHint}>Search guides by topic, question, or field name.</p>
      </form>
    </header>
    {searching ? <section className={styles.section} aria-labelledby="search-results-heading">
      <div className={styles.sectionHead}>
        <div><h2 id="search-results-heading">Search results</h2><p role="status" aria-live="polite">{results.length} {results.length === 1 ? 'article' : 'articles'} for “{query}”</p></div>
        <div className={styles.filter}><label htmlFor="help-category">Category</label><select id="help-category" value={category} onChange={event => updateQuery(query, event.target.value)}><option value="">All categories</option>{helpCategories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      </div>
      {results.length ? <div className={styles.results}>{results.map(article => <ArticleResult key={article.id} article={article} />)}</div> : <div className={styles.empty}><h3>No matching articles</h3><p>Try a shorter phrase such as “phone”, “lead”, or “permissions”, or search all categories.</p><button className={styles.textButton} onClick={() => { updateQuery('', ''); input.current?.focus(); }}>Clear search and browse all guides</button></div>}
    </section> : <>
      <section className={styles.section} aria-labelledby="popular-heading"><div className={styles.sectionHead}><h2 id="popular-heading">Popular articles</h2><p>A useful place to start</p></div><div className={styles.popular}>{popularArticleIds.map(id => { const article = getArticle(id)!; return <Link key={id} href={articleHref(article.slug)}>{article.title}<ArrowRight size={16} aria-hidden="true" /></Link>; })}</div></section>
      <section className={styles.section} aria-labelledby="categories-heading"><div className={styles.sectionHead}><h2 id="categories-heading">Browse by category</h2><p>{helpCategories.length} categories · {helpArticles.length} guides</p></div><div className={styles.categories}>{helpCategories.map(category => { const Icon = icons[category.id as keyof typeof icons]; return <Link key={category.id} href={categoryHref(category.id)} className={styles.category}><Icon size={21} className={styles.categoryIcon} aria-hidden="true" /><div><h3>{category.title}</h3><p>{category.description}</p><span>{getCategoryArticles(category.id).length} articles</span></div></Link>; })}</div></section>
    </>}
    <HelpFooter />
  </div>;
}
