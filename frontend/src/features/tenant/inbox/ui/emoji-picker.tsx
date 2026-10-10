'use client';

import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

interface EmojiCategory {
  name: string;
  icon: string;
  emojis: string[];
}

const CATEGORIES: EmojiCategory[] = [
  {
    name: 'Smileys & Emotions',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜',
      '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑',
      '😶', '🫥', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴',
      '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳',
      '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '😮', '😯', '😲', '😳',
      '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀',
    ],
  },
  {
    name: 'Gestures & People',
    icon: '👋',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏',
      '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
      '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲',
      '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻',
    ],
  },
  {
    name: 'Hearts & Symbols',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️',
      '💯', '💢', '💥', '💫', '💦', '💨', '🕊️', '🔥', '✨', '🌟', '💡', '⚡',
      '⭐', '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌧️', '⛈️', '🌩️', '❄️', '💎',
    ],
  },
  {
    name: 'Objects & Activities',
    icon: '🎉',
    emojis: [
      '🎉', '🎊', '🎈', '🎁', '🎗️', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈',
      '🎯', '🎮', '🎲', '🧩', '🎵', '🎶', '🎤', '🎧', '🎸', '🎹', '🎺', '🎻',
      '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '📹', '🎬', '📺', '📻', '🔔', '📣',
      '📧', '✉️', '📩', '📨', '📬', '📮', '📝', '📋', '📎', '📌', '📍', '🗂️',
    ],
  },
  {
    name: 'Nature & Animals',
    icon: '🌿',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮',
      '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅', '🦆', '🦉', '🐝', '🐛', '🦋',
      '🌸', '🌺', '🌻', '🌹', '🌷', '🌱', '🌲', '🌳', '🌴', '🌿', '☘️', '🍀',
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭',
    ],
  },
  {
    name: 'Food & Drink',
    icon: '☕',
    emojis: [
      '☕', '🍵', '🧃', '🥤', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉',
      '🍕', '🍔', '🍟', '🌭', '🥪', '🌮', '🌯', '🫔', '🥗', '🍝', '🍜', '🍲',
      '🍛', '🍣', '🍱', '🥟', '🍤', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫',
      '🍬', '🍭', '🍮', '🧇', '🥞', '🧈', '🍳', '🥚', '🧀', '🥓', '🥩', '🍗',
    ],
  },
  {
    name: 'Travel & Places',
    icon: '✈️',
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚',
      '✈️', '🛫', '🛬', '🚀', '🛸', '🚁', '⛵', '🚢', '🏠', '🏡', '🏢', '🏣',
      '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼',
      '🗽', '⛪', '🕌', '🛕', '🕍', '⛩️', '🌍', '🌎', '🌏', '🗺️', '🏔️', '⛰️',
    ],
  },
  {
    name: 'Flags',
    icon: '🏁',
    emojis: [
      '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇺🇸', '🇬🇧', '🇫🇷', '🇩🇪',
      '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇨🇦', '🇦🇺', '🇮🇹', '🇪🇸', '🇲🇽', '🇵🇭', '🇹🇭',
    ],
  },
];

export default function EmojiPicker({ onSelect }: EmojiPickerProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);

  // Simple search — filter emojis by category name match
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return CATEGORIES;

    const query = searchQuery.toLowerCase();
    return CATEGORIES
      .map((cat) => ({
        ...cat,
        emojis: cat.emojis.filter(() => cat.name.toLowerCase().includes(query)),
      }))
      .filter((cat) => cat.emojis.length > 0);
  }, [searchQuery]);

  const displayCategories = searchQuery ? filteredCategories : [CATEGORIES[activeCategory]];

  return (
    <div className="flex min-w-0 flex-col w-full h-[min(360px,calc(100dvh-8rem))]">
      {/* Search */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* Category tabs */}
      {!searchQuery && (
        <div className="flex items-center gap-0.5 px-3 pb-2 border-b border-gray-100 dark:border-white/[0.05] shrink-0 overflow-x-auto">
          {CATEGORIES.map((cat, index) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(index)}
              className={`min-w-11 min-h-11 p-1.5 rounded-md text-base transition-colors cursor-pointer shrink-0 ${
                activeCategory === index
                  ? 'bg-blue-50 dark:bg-blue-950/40'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              aria-label={cat.name}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {displayCategories.map((cat) => (
          <div key={cat.name}>
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5 mt-1">
              {cat.name}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-0.5 mb-3">
              {cat.emojis.map((emoji, idx) => (
                <button
                  key={`${emoji}-${idx}`}
                  onClick={() => onSelect(emoji)}
                  className="w-full min-h-11 flex items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-xl cursor-pointer transition-colors"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
