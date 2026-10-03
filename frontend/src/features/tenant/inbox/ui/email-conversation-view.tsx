'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchGmailThread, associateThreadDeal, type GmailEmail } from '../services/gmail.service';
import EmailDetailView from './email-detail-view';

export default function EmailConversationView({ email, onBack, onEmailsChanged }: { email: GmailEmail; onBack: () => void; onEmailsChanged: () => void }) {
  const [messages, setMessages] = useState<GmailEmail[]>([email]), [selected, setSelected] = useState(email.id), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<{ id: string; title: string; stage: string }[]>([]), [canAssociate, setCanAssociate] = useState(false), [dealId, setDealId] = useState(''), [associationSaved, setAssociationSaved] = useState(false);
  useEffect(() => {
    let active = true;
    fetchGmailThread(email.threadId).then(result => { if (active) { setMessages(result.emails); setDeals(result.dealOptions); setCanAssociate(result.canAssociateDeal); } }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [email.threadId]);
  const current = messages.find(message => message.id === selected) ?? email;
  return <div className="flex h-full min-w-0 flex-col">
    <div className="max-h-48 shrink-0 space-y-2 overflow-y-auto border-b p-3 text-xs">
      {loading && <p role="status">Loading conversation…</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
      {messages.length > 1 && <div className="flex flex-wrap gap-2">{messages.map(message => <button key={message.id} onClick={() => setSelected(message.id)} className={`min-h-9 max-w-full truncate rounded border px-2 ${selected === message.id ? 'bg-blue-50 text-blue-700' : ''}`}>{message.direction === 'outbound' ? 'You → customer' : message.from} · {new Date(message.date).toLocaleDateString()}</button>)}</div>}
      <div className="flex flex-wrap gap-3">
        {current.leadId && <Link className="text-blue-600 underline" href={`/crm/leads/${current.leadId}`}>View linked Lead</Link>}
        {current.contactId && <Link className="text-blue-600 underline" href={`/crm/contacts/${current.contactId}`}>View linked Contact</Link>}
        {current.dealId && <Link className="text-blue-600 underline" href={`/crm/deals/${current.dealId}`}>View related Deal</Link>}
        {!current.leadId && !current.contactId && <span className="text-muted-foreground">Unlinked — no unique CRM email match.</span>}
      </div>
      {current.needsDealAssociation && <p>Multiple open Deals match this customer. Stages remain unchanged until the conversation is associated with a Deal.</p>}
      {canAssociate && deals.length > 0 && <form className="flex min-w-0 flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void associateThreadDeal(email.threadId, dealId).then(() => { setAssociationSaved(true); setError(''); }).catch(error => setError(error.message)); }}>
        <select aria-label="Associate conversation with Deal" required value={dealId} onChange={event => { setDealId(event.target.value); setAssociationSaved(false); }} className="min-h-9 w-full min-w-0 rounded border bg-background p-2 sm:w-auto sm:max-w-80"><option value="">Select the relevant open Deal</option>{deals.map(deal => <option key={deal.id} value={deal.id}>{deal.title} · {deal.stage}</option>)}</select>
        <button disabled={!dealId || associationSaved} className="min-h-9 rounded border px-3">{associationSaved ? 'Associated' : 'Associate Deal'}</button>
        {associationSaved && <p className="w-full text-muted-foreground">Association saved for future messages. Earlier status and stage decisions are preserved.</p>}
      </form>}
      {current.readyToClose && current.dealId && <p>This Deal may be ready to close. Review the Deal and confirm the final sale with supporting evidence.</p>}
    </div>
    <div className="min-h-0 min-w-0 flex-1"><EmailDetailView key={current.id} email={current} onBack={onBack} onEmailsChanged={onEmailsChanged} /></div>
  </div>;
}
