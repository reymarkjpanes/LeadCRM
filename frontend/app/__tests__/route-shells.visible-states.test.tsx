import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error('redirect:' + path); } }));
import Home from '../page';
import Verify from '../verify-email/page';
import Company from '../company-setup/page';
it.each([Home, Verify, Company])('redirects retired public entry points to sign in', page => {
  expect(() => page()).toThrow('redirect:/login');
});
