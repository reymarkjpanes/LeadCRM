'use client';
import { uuid } from '@/lib/utils';

import React, { useState, useEffect, useMemo } from 'react';
import { useData } from '@/store/DataContext';
import { leadsService } from '@/features/tenant/crm/leads/services/leads.service';
import { toFrontendContact } from '@/lib/api/adapters/contact.adapter';
import type { Contact } from '@/store/types';
import { 
  Pin, Trash2, Edit3, Plus, Search, X, Check, Copy, 
  FileText, Link2, User, Briefcase, Sparkles, StickyNote, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface NotesSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface QuickNote {
  id: string;
  title: string;
  content: string;
  category: 'Thought' | 'Customer' | 'Idea' | 'Reminder' | 'Draft';
  color: 'amber' | 'blue' | 'emerald' | 'rose' | 'indigo' | 'slate';
  linkedEntity?: {
    type: 'lead' | 'deal';
    id: string;
    name: string;
  };
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLOR_MAP = {
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-200/60 dark:border-amber-500/20',
    text: 'text-amber-800 dark:text-amber-300',
    accent: 'bg-amber-400',
    badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-200/60 dark:border-blue-500/20',
    text: 'text-blue-800 dark:text-blue-300',
    accent: 'bg-blue-400',
    badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/20',
    border: 'border-emerald-200/60 dark:border-emerald-500/20',
    text: 'text-emerald-800 dark:text-emerald-300',
    accent: 'bg-emerald-400',
    badge: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/20',
    border: 'border-rose-200/60 dark:border-rose-500/20',
    text: 'text-rose-800 dark:text-rose-300',
    accent: 'bg-rose-400',
    badge: 'bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300'
  },
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/20',
    border: 'border-indigo-200/60 dark:border-indigo-500/20',
    text: 'text-indigo-800 dark:text-indigo-300',
    accent: 'bg-indigo-400',
    badge: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
  },
  slate: {
    bg: 'bg-slate-50 dark:bg-slate-900/40',
    border: 'border-slate-200 dark:border-white/8',
    text: 'text-slate-800 dark:text-slate-300',
    accent: 'bg-slate-400',
    badge: 'bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-slate-300'
  }
};

export default function NotesSidePanel({ isOpen, onClose }: NotesSidePanelProps) {
  const { deals } = useData();

  // ── Leads loaded on-demand when panel opens ──────────────────────────────
  // Notes panel uses leads only for the "link to lead" dropdown.
  // Loading all leads at startup is wasteful — fetch a small list here instead.
  const [leads, setLeads] = useState<Contact[]>([]);
  useEffect(() => {
    if (!isOpen) return;
    leadsService.getAll({ limit: 50 })
      .then((res) => setLeads((res?.data ?? []).map(toFrontendContact) as Contact[]))
      .catch(() => setLeads([]));
  }, [isOpen]);

  // Notes state
  const [notes, setNotes] = useState<QuickNote[]>([]);
  
  // Form states
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<QuickNote['category']>('Thought');
  const [color, setColor] = useState<QuickNote['color']>('slate');
  
  // Link state
  const [linkType, setLinkType] = useState<'none' | 'lead' | 'deal'>('none');
  const [selectedEntityId, setSelectedEntityId] = useState('');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'All' | 'Pinned' | QuickNote['category']>('All');

  // Load existing notes on mount / when storage keys change
  useEffect(() => {
    const raw = localStorage.getItem('leadcrm_quick_notes');
    if (raw) {
      try {
        setNotes(JSON.parse(raw));
      } catch (_e) {
        // Corrupted localStorage data — reset to empty notes list
        localStorage.removeItem('leadcrm_quick_notes');
      }
    } else {
      // Seed with some useful notes
      const seed: QuickNote[] = [
        {
          id: 'note_seed_1',
          title: 'Welcome to your CRM Scratchpad',
          content: 'This global Notes panel lets you instantly jot down fleeting thoughts, quick lists, or client discussion briefs. You can link any note directly to leads or current deals!',
          category: 'Thought',
          color: 'indigo',
          pinned: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      setNotes(seed);
      localStorage.setItem('leadcrm_quick_notes', JSON.stringify(seed));
    }
  }, [isOpen]);

  // Sync to local storage on notes update
  const saveNotes = (updatedNotes: QuickNote[]) => {
    setNotes(updatedNotes);
    localStorage.setItem('leadcrm_quick_notes', JSON.stringify(updatedNotes));
  };

  // Reset form helper
  const resetForm = () => {
    setTitle('');
    setContent('');
    setCategory('Thought');
    setColor('slate');
    setLinkType('none');
    setSelectedEntityId('');
    setEditingId(null);
    setIsAdding(false);
  };

  // Handle save
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      toast.error('Note content is required.');
      return;
    }

    let linkedEntityInfo: QuickNote['linkedEntity'] | undefined = undefined;
    if (linkType === 'lead' && selectedEntityId) {
      const match = leads.find(l => l.id === selectedEntityId);
      if (match) {
        linkedEntityInfo = {
          type: 'lead',
          id: match.id,
          name: match.companyName || match.leadPerson || `${match.firstName ?? ''} ${match.lastName ?? ''}`.trim()
        };
      }
    } else if (linkType === 'deal' && selectedEntityId) {
      const match = deals.find(d => d.id === selectedEntityId);
      if (match) {
        linkedEntityInfo = {
          type: 'deal',
          id: match.id,
          name: match.title
        };
      }
    }

    const noteTitle = title.trim() || `Untitled Note (${category})`;

    if (editingId) {
      // Update
      const updated = notes.map(n => {
        if (n.id === editingId) {
          return {
            ...n,
            title: noteTitle,
            content: content.trim(),
            category,
            color,
            linkedEntity: linkedEntityInfo,
            updatedAt: new Date().toISOString()
          };
        }
        return n;
      });
      saveNotes(updated);
      toast.success('Scratchpad note updated successfully!');
    } else {
      // Create
      const newNote: QuickNote = {
        id: uuid(),
        title: noteTitle,
        content: content.trim(),
        category,
        color,
        linkedEntity: linkedEntityInfo,
        pinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      saveNotes([newNote, ...notes]);
      toast.success('New quick note saved!');
    }

    resetForm();
  };

  // Delete
  const handleDelete = (id: string) => {
    const kept = notes.filter(n => n.id !== id);
    saveNotes(kept);
    toast.success('Note removed from scratchpad.');
  };

  // Toggle Pinned
  const togglePin = (id: string) => {
    const updated = notes.map(n => {
      if (n.id === id) {
        return { ...n, pinned: !n.pinned };
      }
      return n;
    });
    saveNotes(updated);
  };

  // Start Editing
  const startEditing = (n: QuickNote) => {
    setEditingId(n.id);
    setTitle(n.title);
    setContent(n.content);
    setCategory(n.category);
    setColor(n.color);
    if (n.linkedEntity) {
      setLinkType(n.linkedEntity.type);
      setSelectedEntityId(n.linkedEntity.id);
    } else {
      setLinkType('none');
      setSelectedEntityId('');
    }
    setIsAdding(true);
  };

  // Copy note details
  const copyDetail = (note: QuickNote) => {
    const text = `--- ${note.title} (${note.category}) ---\n${note.content}\n${note.linkedEntity ? `Associated with: ${note.linkedEntity.name} [${note.linkedEntity.type}]` : ''}`;
    navigator.clipboard.writeText(text);
    toast.success('Note content copied to clipboard!');
  };

  // Autofill templates or quick logs
  const applyAutofill = (type: string) => {
    if (type === 'call') {
      setTitle('Client Call Log');
      setContent('Discussed requirements regarding recent proposals.\n\nNext Steps:\n- Send updated quote sheets\n- Schedule follow-up presentation');
      setCategory('Customer');
      setColor('blue');
    } else if (type === 'lead') {
      setTitle('Fleeting Lead Detail');
      setContent('Spoke with representative. Interested in standard support license.\n\nEmail: \nPhone: ');
      setCategory('Customer');
      setColor('emerald');
    }
  };

  // Filter and Search logic
  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      // 1. Category/Pinned Filter
      if (activeCategory === 'Pinned') {
        if (!note.pinned) return false;
      } else if (activeCategory !== 'All') {
        if (note.category !== activeCategory) return false;
      }

      // 2. Search Query
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query) ||
        (note.linkedEntity?.name || '').toLowerCase().includes(query) ||
        note.category.toLowerCase().includes(query)
      );
    });
  }, [notes, activeCategory, searchQuery]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 transition-opacity cursor-pointer"
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-slate-950 border-l border-gray-200 dark:border-white/10 z-50 shadow-2xl flex flex-col h-full"
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-100 dark:border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded-lg">
                  <StickyNote size={20} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Workspace Scratchpad</h3>
                  <p className="text-[11px] text-slate-500">Quick-notes synced and persistent across workflows</p>
                </div>
              </div>
              
              <button 
                onClick={onClose}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrolling Core Space */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
              
              {/* Form trigger / Edit state */}
              {isAdding ? (
                <form onSubmit={handleSave} className="p-4 bg-gray-50/50 dark:bg-white/2 border border-gray-200 dark:border-white/6 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-500 flex items-center gap-1.5">
                      <Sparkles size={13} /> {editingId ? 'Edit Note details' : 'Compose Scratchpad Note'}
                    </span>
                    
                    {/* Auto templates (only when creating) */}
                    {!editingId && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => applyAutofill('call')}
                          className="text-[10px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded-full font-medium transition-colors"
                        >
                          + Call Log
                        </button>
                        <button
                          type="button"
                          onClick={() => applyAutofill('lead')}
                          className="text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full font-medium transition-colors"
                        >
                          + Lead template
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Title field */}
                  <div>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Note Heading (e.g. Call logs with John)"
                      className="w-full text-sm font-semibold bg-white dark:bg-slate-950 border border-gray-200 dark:border-white/8 rounded-xl px-3 py-2 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Content field */}
                  <div>
                    <textarea
                      value={content}
                      onChange={e => setContent(e.target.value)}
                      rows={4}
                      required
                      placeholder="Jot down customer specifications, billing details or meeting notes details..."
                      className="w-full text-xs font-normal bg-white dark:bg-slate-950 border border-gray-200 dark:border-white/8 rounded-xl px-3 py-2 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>

                  {/* Preset settings (color & category) */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Category Selection */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Category</label>
                      <select
                        value={category}
                        onChange={e => setCategory(e.target.value as QuickNote['category'])}
                        className="w-full text-xs bg-white dark:bg-slate-950 border border-gray-200 dark:border-white/8 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none"
                      >
                        <option value="Thought" className="dark:bg-slate-950">Fleeting Thought</option>
                        <option value="Customer" className="dark:bg-slate-950">Customer Detail</option>
                        <option value="Idea" className="dark:bg-slate-950">Project Idea</option>
                        <option value="Reminder" className="dark:bg-slate-950">Reminder</option>
                        <option value="Draft" className="dark:bg-slate-950">Draft Proposal</option>
                      </select>
                    </div>

                    {/* Color selection circles */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Card Theme</label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(['slate', 'amber', 'blue', 'emerald', 'rose', 'indigo'] as QuickNote['color'][]).map(c => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setColor(c)}
                            className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                              c === 'slate' ? 'bg-slate-400 border-slate-500' :
                              c === 'amber' ? 'bg-amber-400 border-amber-500' :
                              c === 'blue' ? 'bg-blue-400 border-blue-500' :
                              c === 'emerald' ? 'bg-emerald-400 border-emerald-500' :
                              c === 'rose' ? 'bg-rose-400 border-rose-500' :
                              'bg-indigo-400 border-indigo-500'
                            }`}
                          >
                            {color === c && <Check size={11} className="text-white drop-shadow" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Connect to CRM Records */}
                  <div className="p-3 bg-white dark:bg-white/2 border border-gray-100 dark:border-white/4 rounded-xl space-y-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      Link CRM Entity (Optional)
                    </label>
                    
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => { setLinkType('none'); setSelectedEntityId(''); }}
                        className={`px-2.5 py-1 rounded bg-gray-100 dark:bg-white/5 border transition-all ${linkType === 'none' ? 'border-blue-500/40 text-blue-500' : 'border-transparent text-slate-500'}`}
                      >
                        Unlinked
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLinkType('lead'); setSelectedEntityId(leads[0]?.id || ''); }}
                        className={`px-2.5 py-1 rounded bg-gray-100 dark:bg-white/5 border transition-all flex items-center gap-1 ${linkType === 'lead' ? 'border-emerald-500/40 text-emerald-500' : 'border-transparent text-slate-500'}`}
                      >
                        <User size={11} /> Lead/Lead
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLinkType('deal'); setSelectedEntityId(deals[0]?.id || ''); }}
                        className={`px-2.5 py-1 rounded bg-gray-100 dark:bg-white/5 border transition-all flex items-center gap-1 ${linkType === 'deal' ? 'border-sky-500/40 text-sky-500' : 'border-transparent text-slate-500'}`}
                      >
                        <Briefcase size={11} /> Deal
                      </button>
                    </div>

                    {linkType === 'lead' && (
                      <select
                        value={selectedEntityId}
                        onChange={e => setSelectedEntityId(e.target.value)}
                        className="w-full text-xs bg-white dark:bg-slate-950 border border-gray-200 dark:border-white/8 rounded-lg p-1.5 focus:outline-none"
                      >
                        {leads.map(l => (
                          <option key={l.id} value={l.id} className="dark:bg-slate-950">
                            {l.companyName} ({l.leadPerson})
                          </option>
                        ))}
                        {leads.length === 0 && <option value="">No Active Leads Available</option>}
                      </select>
                    )}

                    {linkType === 'deal' && (
                      <select
                        value={selectedEntityId}
                        onChange={e => setSelectedEntityId(e.target.value)}
                        className="w-full text-xs bg-white dark:bg-slate-950 border border-gray-200 dark:border-white/8 rounded-lg p-1.5 focus:outline-none"
                      >
                        {deals.map(d => (
                          <option key={d.id} value={d.id} className="dark:bg-slate-950">
                            {d.title} - {d.companyName}
                          </option>
                        ))}
                        {deals.length === 0 && <option value="">No Active Deals Available</option>}
                      </select>
                    )}
                  </div>

                  {/* Buttons */}
                  <div className="flex justify-end gap-2 pt-1 border-t border-gray-100 dark:border-white/4">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-3 py-1.5 border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 rounded-lg text-xs hover:bg-gray-100 dark:hover:bg-slate-850 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <Check size={13} /> {editingId ? 'Save Edits' : 'Save Note'}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setIsAdding(true)}
                  className="w-full py-2.5 border border-dashed border-gray-300 dark:border-white/10 hover:border-blue-500 bg-gray-50/20 hover:bg-blue-500/5 text-slate-600 dark:text-slate-300 hover:text-blue-500 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all duration-150"
                >
                  <Plus size={15} /> Create a Fleeting Note or Scratchpad Log
                </button>
              )}

              {/* Filtering & Search panel */}
              <div className="space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search scratchpad notes..."
                    className="w-full text-xs bg-gray-50 dark:bg-white/2/30 border border-gray-200 dark:border-white/8 rounded-full pl-9 pr-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Categorization tabs */}
                <div className="flex items-center gap-1 overflow-x-auto py-1 custom-scrollbar text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  {(['All', 'Pinned', 'Thought', 'Customer', 'Idea', 'Reminder'] as const).map(tab => {
                    const isActive = activeCategory === tab;
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveCategory(tab)}
                        className={`px-3 py-1 rounded-full whitespace-nowrap transition-all ${
                          isActive 
                            ? 'bg-blue-500 text-white font-semibold shadow-sm' 
                            : 'bg-gray-100 dark:bg-white/3 hover:bg-gray-200 dark:hover:bg-white/6'
                        }`}
                      >
                        {tab === 'All' ? 'All' : tab === 'Pinned' ? '?? Pinned' : tab}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes List */}
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {filteredNotes.map(n => {
                    const preset = COLOR_MAP[n.color] || COLOR_MAP.slate;
                    return (
                      <motion.div
                        key={n.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={`p-4 rounded-2xl border transition-all relative group flex flex-col justify-between ${preset.bg} ${preset.border}`}
                      >
                        {/* Header within card */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="space-y-1">
                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${preset.badge}`}>
                              {n.category}
                            </span>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white pr-10">
                              {n.title}
                            </h4>
                          </div>

                          {/* Quick Controls */}
                          <div className="absolute top-4 right-4 flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-all">
                            {/* Pin */}
                            <button
                              onClick={() => togglePin(n.id)}
                              className={`p-1 rounded-md transition-colors ${n.pinned ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-white/20'}`}
                              title={n.pinned ? 'Unpin' : 'Pin to Top'}
                            >
                              <Pin size={13} className={n.pinned ? 'fill-amber-500' : ''} />
                            </button>

                            {/* Copy detail */}
                            <button
                              onClick={() => copyDetail(n)}
                              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-white/20 transition-colors"
                              title="Copy notes content"
                            >
                              <Copy size={13} />
                            </button>

                            {/* Edit */}
                            <button
                              onClick={() => startEditing(n)}
                              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-white/20 transition-colors"
                              title="Edit"
                            >
                              <Edit3 size={13} />
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleDelete(n.id)}
                              className="p-1 rounded-md text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-white/20 transition-colors"
                              title="Delete Note"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Note text content */}
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-normal whitespace-pre-wrap wrap-break-word mb-3">
                          {n.content}
                        </p>

                        {/* Bottom stats & linked entities */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-black/4 dark:border-white/4 text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                          <span>
                            {new Date(n.updatedAt).toLocaleDateString()} at {new Date(n.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>

                          {/* Linked entity indicator */}
                          {n.linkedEntity && (
                            <span className="flex items-center gap-1.5 bg-white/50 dark:bg-black/20 border border-slate-200/50 dark:border-white/5 rounded-full px-2 py-0.5 text-[10px] text-slate-600 dark:text-slate-300 max-w-45 truncate">
                              <Link2 size={10} className="text-blue-500 shrink-0" />
                              <strong className="font-semibold">{n.linkedEntity.type === 'lead' ? 'Lead:' : 'Deal:'}</strong>
                              <span className="truncate">{n.linkedEntity.name}</span>
                            </span>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}

                  {filteredNotes.length === 0 && (
                    <div className="text-center py-10 px-4 bg-gray-50/50 dark:bg-white/2/40 rounded-2xl border border-gray-100 dark:border-white/4">
                      <FileText size={24} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-xs text-slate-500">No notes found matching the selected criteria.</p>
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="mt-2 text-xs text-blue-500 hover:underline"
                        >
                          Clear Search
                        </button>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
