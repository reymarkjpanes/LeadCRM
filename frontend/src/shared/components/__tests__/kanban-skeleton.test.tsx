import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KanbanBoardSkeleton from '../kanban-skeleton';

/**
 * Unit tests for KanbanBoardSkeleton — the loading placeholder shown
 * during the Pipeline route's dynamic() chunk load (via loading.tsx).
 *
 * Validates:
 * - Correct ARIA semantics for assistive technology
 * - Expected structural output (column count, card count)
 * - Dark-mode and animation classes present
 * - No interactive elements (it's a purely presentational skeleton)
 */

describe('KanbanBoardSkeleton', () => {
  describe('accessibility', () => {
    it('renders a status landmark that screen readers can announce', () => {
      render(<KanbanBoardSkeleton />);
      const status = screen.getByRole('status');
      expect(status).toBeDefined();
    });

    it('has an aria-label that describes the loading state', () => {
      render(<KanbanBoardSkeleton />);
      const status = screen.getByRole('status');
      expect(status.getAttribute('aria-label')).toBe('Loading pipeline board');
    });

    it('contains no interactive elements — purely presentational', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      const buttons = container.querySelectorAll('button, a, input, select, textarea');
      expect(buttons.length).toBe(0);
    });
  });

  describe('structure', () => {
    it('renders 4 column placeholders', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      // Each column is a flex-shrink-0 div — identify by the w-72 class
      const columns = container.querySelectorAll('.w-72');
      expect(columns.length).toBe(4);
    });

    it('renders 3 card placeholders per column (12 total)', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      // Cards have the space-y-2 class on the inner card body
      const cards = container.querySelectorAll('.rounded-lg.p-3\\.5');
      expect(cards.length).toBe(12); // 4 cols × 3 cards
    });

    it('renders column header placeholders in each column', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      // Header placeholder: h-3 w-24 rounded-full
      const headerBars = container.querySelectorAll('.h-3.w-24.rounded-full');
      expect(headerBars.length).toBe(4);
    });
  });

  describe('visual styles', () => {
    it('applies animate-pulse to skeleton bars', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      const pulsing = container.querySelectorAll('.animate-pulse');
      expect(pulsing.length).toBeGreaterThan(0);
    });

    it('applies motion-reduce:animate-none to all animated elements', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      const animated = container.querySelectorAll('.animate-pulse');
      // Every pulsing element should carry the reduced-motion override
      animated.forEach((el) => {
        expect(el.className).toContain('motion-reduce:animate-none');
      });
    });

    it('applies dark mode classes to column wrappers', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      const columns = container.querySelectorAll('.w-72');
      columns.forEach((col) => {
        expect(col.className).toContain('dark:bg-white/[0.02]');
      });
    });

    it('applies dark mode classes to card placeholders', () => {
      const { container } = render(<KanbanBoardSkeleton />);
      const cards = container.querySelectorAll('.rounded-lg.p-3\\.5');
      cards.forEach((card) => {
        expect(card.className).toContain('dark:bg-slate-800/60');
      });
    });
  });

  describe('snapshot stability', () => {
    it('renders without throwing', () => {
      expect(() => render(<KanbanBoardSkeleton />)).not.toThrow();
    });

    it('is deterministic — renders identically on multiple mounts', () => {
      const { container: a } = render(<KanbanBoardSkeleton />);
      const { container: b } = render(<KanbanBoardSkeleton />);
      expect(a.innerHTML).toBe(b.innerHTML);
    });
  });
});
