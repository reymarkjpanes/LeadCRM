import React from 'react';
import { motion } from 'motion/react';
import { Plus, Sparkles, Send, Mail, MessageSquare, Zap, Play, HelpCircle, Search, UserX } from 'lucide-react';

interface EmptyStateProps {
  type: 'campaigns' | 'email' | 'sms' | 'workflows' | 'contacts' | 'pipelines' | 'deals';
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export default function EmptyState({
  type,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  
  // Floating animation for decorative elements
  const floatTransition = {
    duration: 3,
    repeat: Infinity,
    repeatType: "reverse",
    ease: "easeInOut",
  } as const;

  const renderIllustration = () => {
    switch (type) {
      case 'campaigns':
        return (
          <div className="relative w-72 h-60 mx-auto flex items-center justify-center">
            {/* Background glowing rings */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 25, repeat: Infinity, ease: "linear" } as const}
              className="absolute w-48 h-48 rounded-full border border-dashed border-primary/10 dark:border-primary/5 flex items-center justify-center"
            >
              <div className="w-36 h-36 rounded-full border border-dashed border-purple-500/15 dark:border-purple-500/10" />
            </motion.div>

            {/* Glowing background blob */}
            <div className="absolute w-36 h-36 rounded-full bg-gradient-to-tr from-blue-500/10 to-purple-500/10 dark:from-blue-500/5 dark:to-purple-500/5 blur-2xl" />

            {/* Main Central Megaphone Card */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={floatTransition}
              className="relative z-10 p-5 bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-2xl shadow-xl flex items-center justify-center w-24 h-24"
            >
              <div className="p-3 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-xl border border-primary/20 text-blue-500">
                <Send size={32} className="transform rotate-12" />
              </div>
            </motion.div>

            {/* Flying Email Indicator */}
            <motion.div
              animate={{ y: [-4, 6, -4], x: [0, 4, 0] }}
              transition={{ ...floatTransition, duration: 4, delay: 0.5 }}
              className="absolute top-10 left-10 p-2.5 bg-white dark:bg-slate-900 border border-gray-100 dark:border-white/[0.04] rounded-xl shadow-md text-emerald-500"
            >
              <Mail size={18} />
            </motion.div>

            {/* Flying SMS Indicator */}
            <motion.div
              animate={{ y: [4, -6, 4], x: [0, -4, 0] }}
              transition={{ ...floatTransition, duration: 3.5, delay: 1 }}
              className="absolute bottom-12 right-8 p-2.5 bg-white dark:bg-slate-900 border border-gray-100 dark:border-white/[0.04] rounded-xl shadow-md text-purple-500"
            >
              <MessageSquare size={18} />
            </motion.div>

            {/* Flying Sparkles */}
            <motion.div
              animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute top-12 right-14 text-amber-400"
            >
              <Sparkles size={16} />
            </motion.div>
          </div>
        );

      case 'email':
        return (
          <div className="relative w-72 h-60 mx-auto flex items-center justify-center">
            {/* Background glowing element */}
            <div className="absolute w-44 h-44 rounded-full bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5 blur-2xl" />

            {/* Behind layout Card */}
            <motion.div
              animate={{ y: [5, -2, 5] }}
              transition={{ ...floatTransition, duration: 3.5 }}
              className="absolute w-24 h-24 bg-white/40 dark:bg-slate-950/40 border border-gray-100/50 dark:border-white/[0.02] rounded-2xl shadow-sm rotate-6 transform translate-x-4"
            />

            {/* Front Envelope Card */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={floatTransition}
              className="relative z-10 p-5 bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-2xl shadow-xl flex flex-col justify-between w-28 h-28"
            >
              <div className="w-10 h-10 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20 flex items-center justify-center">
                <Mail size={20} />
              </div>
              <div className="space-y-1">
                <div className="w-full h-1.5 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
                <div className="w-2/3 h-1.5 bg-gray-150 dark:bg-white/[0.05] rounded-full" />
              </div>
            </motion.div>

            {/* Sparkles around envelope */}
            <motion.div
              animate={{ scale: [0.7, 1.1, 0.7], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: 0.3 }}
              className="absolute top-16 left-14 text-yellow-400"
            >
              <Sparkles size={16} />
            </motion.div>
          </div>
        );

      case 'sms':
        return (
          <div className="relative w-72 h-60 mx-auto flex items-center justify-center">
            {/* Ambient Background Glow */}
            <div className="absolute w-44 h-44 rounded-full bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 dark:from-purple-500/5 dark:to-indigo-500/5 blur-2xl" />

            {/* Left Chat Bubble */}
            <motion.div
              animate={{ y: [0, -5, 0], scale: [1, 1.02, 1] }}
              transition={{ ...floatTransition, duration: 4 }}
              className="absolute left-10 top-14 p-4 bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-2xl rounded-bl-sm shadow-lg max-w-[120px] text-xs space-y-1.5"
            >
              <div className="w-8 h-1.5 bg-purple-500/25 rounded-full" />
              <div className="w-12 h-1 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
            </motion.div>

            {/* Right Chat Bubble (Triggered) */}
            <motion.div
              animate={{ y: [0, 5, 0], scale: [1, 0.98, 1] }}
              transition={{ ...floatTransition, duration: 3.5, delay: 0.5 }}
              className="absolute right-12 bottom-12 p-4 bg-purple-600 border border-purple-500 rounded-2xl rounded-br-sm shadow-xl max-w-[130px] text-xs text-white space-y-1.5 z-10"
            >
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white opacity-40 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-white opacity-45 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-white opacity-50 animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
              <div className="w-16 h-1 bg-white/[0.25] rounded-full" />
            </motion.div>
          </div>
        );

      case 'workflows':
        return (
          <div className="relative w-80 h-60 mx-auto flex items-center justify-center overflow-hidden">
            {/* Background glowing grid layer */}
            <div className="absolute inset-0 bg-radial-gradient from-blue-500/5 to-transparent dark:from-blue-500/[0.02] blur-xl opacity-60" />

            <svg className="absolute inset-0 w-full h-full text-slate-200 dark:text-white/[0.03]" viewBox="0 0 320 240" fill="none">
              {/* Dynamic Connection Path */}
              <motion.path
                d="M 60,120 Q 160,50 260,120"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="text-gray-300 dark:text-white/[0.04]"
                animate={{ strokeDashoffset: -20 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" } as const}
              />
              <motion.path
                d="M 60,120 Q 160,190 260,120"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="text-gray-300 dark:text-white/[0.04]"
                animate={{ strokeDashoffset: 20 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" } as const}
              />
            </svg>

            {/* Left Node - Trigger */}
            <motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{ ...floatTransition, duration: 4 }}
              className="absolute left-6 top-1/2 -translate-y-1/2 p-3 bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-xl shadow-lg z-10 flex flex-col items-center gap-1 w-20"
            >
              <div className="p-2 bg-primary/10 text-blue-400 rounded-lg border border-primary/20">
                <Zap size={18} className="animate-pulse" />
              </div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Trigger</span>
            </motion.div>

            {/* Travel pulse along path */}
            <motion.div
              animate={{
                offsetDistance: ["0%", "100%"],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              } as const}
              className="absolute w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(10,110,255,1)] z-10"
              style={{
                // Custom CSS path helper
                motionPath: "path('M 48 120 Q 160 50 244 120')"
              }}
            />

            {/* Right Node - Action */}
            <motion.div
              animate={{ y: [0, 4, 0] }}
              transition={{ ...floatTransition, duration: 3.5, delay: 0.5 }}
              className="absolute right-6 top-1/2 -translate-y-1/2 p-3 bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-xl shadow-lg z-10 flex flex-col items-center gap-1 w-20"
            >
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
                <Mail size={18} />
              </div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Action</span>
            </motion.div>

            {/* Central Gear/Concentric Ring */}
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 15, repeat: Infinity, ease: "linear" } as const}
              className="absolute w-12 h-12 rounded-full border border-dashed border-purple-500/15 dark:border-purple-500/10 flex items-center justify-center text-purple-400/40"
            >
              <Sparkles size={16} />
            </motion.div>
          </div>
        );

      case 'contacts':
        return (
          <div className="relative w-72 h-60 mx-auto flex items-center justify-center">
            {/* Background glowing rings */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 30, repeat: Infinity, ease: "linear" } as const}
              className="absolute w-44 h-44 rounded-full border border-dashed border-gray-150 dark:border-white/[0.04] flex items-center justify-center"
            >
              <div className="w-32 h-32 rounded-full border border-dashed border-primary/10 dark:border-primary/5" />
            </motion.div>

            {/* Glowing background blob */}
            <div className="absolute w-32 h-32 rounded-full bg-gradient-to-tr from-blue-500/10 to-indigo-500/10 dark:from-blue-500/5 dark:to-indigo-500/5 blur-2xl" />

            {/* Front search-card */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={floatTransition}
              className="relative z-10 p-4 bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-2xl shadow-xl flex flex-col justify-between w-28 h-28"
            >
              <div className="w-9 h-9 bg-primary/10 text-blue-500 rounded-xl border border-primary/20 flex items-center justify-center">
                <Search size={18} />
              </div>
              <div className="space-y-1.5 pt-4">
                <div className="w-full h-1.5 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
                <div className="w-4/5 h-1.5 bg-gray-150 dark:bg-white/[0.05] rounded-full" />
                <div className="w-1/2 h-1 bg-gray-100 dark:bg-white/[0.03] rounded-full" />
              </div>
            </motion.div>

            {/* Back profile icon-card */}
            <motion.div
              animate={{ y: [4, -4, 4], rotate: [6, 4, 6] }}
              transition={{ ...floatTransition, duration: 4, delay: 0.5 }}
              className="absolute w-24 h-24 bg-white/60 dark:bg-slate-950/40 border border-gray-150 dark:border-white/[0.04] rounded-2xl shadow-sm flex flex-col justify-between p-3.5 transform translate-x-12 -translate-y-2"
            >
              <div className="w-7 h-7 bg-indigo-500/10 text-indigo-400 rounded-lg flex items-center justify-center">
                <UserX size={14} />
              </div>
              <div className="space-y-1">
                <div className="w-10 h-1 bg-gray-200 dark:bg-white/[0.05] rounded-full" />
                <div className="w-6 h-1 bg-gray-155 dark:bg-white/[0.03] rounded-full" />
              </div>
            </motion.div>

            {/* Orbiting Sparkles */}
            <motion.div
              animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.4, 0.9, 0.4] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 0.2 }}
              className="absolute top-14 left-14 text-blue-400"
            >
              <Sparkles size={14} />
            </motion.div>
            <motion.div
              animate={{ scale: [1, 0.7, 1], opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: 0.7 }}
              className="absolute bottom-14 right-12 text-indigo-400"
            >
              <Sparkles size={16} />
            </motion.div>
          </div>
        );

      case 'pipelines':
      case 'deals':
        return (
          <div className="relative w-72 h-60 mx-auto flex items-center justify-center">
            {/* Background glowing rings */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 30, repeat: Infinity, ease: "linear" } as const}
              className="absolute w-44 h-44 rounded-full border border-dashed border-gray-150 dark:border-white/[0.04] flex items-center justify-center"
            >
              <div className="w-32 h-32 rounded-full border border-dashed border-emerald-500/10 dark:border-emerald-500/5" />
            </motion.div>

            {/* Glowing background blob */}
            <div className="absolute w-32 h-32 rounded-full bg-gradient-to-tr from-emerald-500/10 to-blue-500/10 dark:from-emerald-500/5 dark:to-blue-500/5 blur-2xl" />

            {/* Column visualization */}
            <div className="relative z-10 flex gap-3 h-28 transform -translate-y-2">
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ ...floatTransition, duration: 4, delay: 0.2 }}
                className="w-16 h-full bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-xl shadow-lg p-2 space-y-2 opacity-60"
              >
                <div className="w-full h-2 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
                <div className="w-full h-8 bg-gray-100 dark:bg-white/[0.04] rounded-lg border border-gray-200 dark:border-white/[0.05]" />
                <div className="w-full h-8 bg-gray-100 dark:bg-white/[0.04] rounded-lg border border-gray-200 dark:border-white/[0.05]" />
              </motion.div>
              
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={floatTransition}
                className="w-20 h-full bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.08] rounded-xl shadow-xl p-2 space-y-2 relative z-20 scale-110"
              >
                <div className="w-full flex items-center justify-between mb-2">
                   <div className="w-8 h-2 bg-blue-200 dark:bg-primary/40 rounded-full" />
                   <div className="w-3 h-3 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center">
                     <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                   </div>
                </div>
                <div className="w-full h-10 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 rounded-lg shadow-sm" />
                <div className="w-full h-10 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-primary/20 rounded-lg shadow-sm" />
              </motion.div>
              
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ ...floatTransition, duration: 4, delay: 0.6 }}
                className="w-16 h-full bg-white dark:bg-slate-900 border border-gray-150 dark:border-white/[0.06] rounded-xl shadow-lg p-2 space-y-2 opacity-60"
              >
                <div className="w-full h-2 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
                <div className="w-full h-8 bg-gray-100 dark:bg-white/[0.04] rounded-lg border border-gray-200 dark:border-white/[0.05]" />
              </motion.div>
            </div>

            {/* Orbiting Sparkles */}
            <motion.div
              animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.4, 0.9, 0.4] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 0.2 }}
              className="absolute top-10 left-16 text-emerald-400"
            >
              <Sparkles size={14} />
            </motion.div>
            <motion.div
              animate={{ scale: [1, 0.7, 1], opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: 0.7 }}
              className="absolute bottom-10 right-16 text-blue-400"
            >
              <Sparkles size={16} />
            </motion.div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center text-center p-6 sm:p-8 max-w-lg mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs"
    >
      {/* Decorative illustration */}
      {renderIllustration()}

      {/* Structured Text Content */}
      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1.5 tracking-tight">
        {title}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 max-w-sm leading-relaxed">
        {description}
      </p>

      {/* Call to Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 w-full sm:w-auto">
        {onAction && actionLabel && (
          <button
            onClick={onAction}
            className="w-full sm:w-auto h-9 px-4 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus size={14} />
            <span>{actionLabel}</span>
          </button>
        )}

        {onSecondaryAction && secondaryActionLabel && (
          <button
            onClick={onSecondaryAction}
            className="w-full sm:w-auto h-9 px-4 text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span>{secondaryActionLabel}</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

