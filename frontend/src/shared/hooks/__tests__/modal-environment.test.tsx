import { afterEach, expect, it } from 'vitest';
import { lockBackgroundScroll, lockModalBackground } from '@/shared/lib/overlay-state';

afterEach(() => { document.body.innerHTML = ''; document.body.style.overflow = ''; });

it('keeps body and workspace locked when a parent releases before its child', () => {
  const main = document.createElement('main');
  main.setAttribute('data-app-scroll', '');
  main.style.overflow = 'auto'; document.body.append(main);
  const releaseParent = lockBackgroundScroll(), releaseChild = lockBackgroundScroll();
  releaseParent();
  expect(document.body.style.overflow).toBe('hidden');
  expect(main.style.overflow).toBe('hidden');
  releaseChild();
  expect(document.body.style.overflow).toBe('');
  expect(main.style.overflow).toBe('auto');
});

it('keeps the workspace inert until the final overlay closes', () => {
  const main = document.createElement('main');
  const portal = document.createElement('div'); portal.setAttribute('data-theme-portal', '');
  const panel = document.createElement('section'); portal.append(panel); document.body.append(main, portal);
  const releaseParent = lockModalBackground(panel), releaseChild = lockModalBackground(panel);
  releaseParent(); expect(main.inert).toBe(true);
  releaseChild(); expect(main.inert).not.toBe(true);
});
