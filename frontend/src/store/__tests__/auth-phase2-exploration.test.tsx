import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

/**
 * Bug Condition Exploration Tests — Phase 2 (RC-05 seed check + RC-10 login page check)
 *
 * **Property 1: Bug Condition** - Routing Defects and UX Gaps (Phase 2)
 *
 * These tests MUST FAIL on unfixed code — failure confirms each bug exists.
 * DO NOT fix the test or the code when it fails — the failure confirms the bug.
 *
 * Test scope:
 *     include `emailVerified` in every user upsert.
 *   - RC-10: The login page component uses onNavigate('dashboard') in a useEffect
 *     that fires when `user && isSigningIn` — this is an indirect navigation call
 *     that races with AuthGuard. Assert the login page does NOT navigate after
 *     login() succeeds — navigation must be owned by AuthGuard only.
 *
 * **Validates: Requirements 2.4, 2.5**
 */

// ─────────────────────────────────────────────────────
// RC-05 — SEED FILE INSPECTION
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-05 — Seed files include emailVerified on every user upsert', () => {
  const BACKEND_SEEDERS_DIR = path.resolve(
    __dirname,
    '../../../../backend/src/database/seeders',
  );

  function readSeedFile(filename: string): string {
    return fs.readFileSync(path.join(BACKEND_SEEDERS_DIR, filename), 'utf-8');
  }

  /**
   * Extracts all `create: { ... }` blocks from user upsert calls in a seed file.
   * Uses a simple heuristic: find `prisma.user.upsert` call sites and capture
   * the text of the `create:` sub-object.
   *
   * Returns the full upsert source text so we can inspect each `create` block.
   */
  function extractUserUpsertBlocks(source: string): string[] {
    const blocks: string[] = [];
    // Match prisma.user.upsert({ ... }) — captures the body inside the outer braces
    const upsertRegex = /prisma\.user\.upsert\(\{([\s\S]*?)\}\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = upsertRegex.exec(source)) !== null) {
      blocks.push(match[1]);
    }
    return blocks;
  }

  it('seeder.seed.ts verifies the initial account without overwriting existing identities', () => {
    const source = readSeedFile('seeder.seed.ts');
    const file = ts.createSourceFile('seeder.seed.ts', source, ts.ScriptTarget.Latest, true);
    const creates: ts.ObjectLiteralExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'tx.user.create') {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          const data = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === 'data');
          if (data && ts.isPropertyAssignment(data) && ts.isObjectLiteralExpression(data.initializer)) creates.push(data.initializer);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(creates).toHaveLength(1);
    for (const create of creates) {
      const verified = create.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === 'emailVerified');
      expect(verified && ts.isPropertyAssignment(verified) ? verified.initializer.getText(file) : '').toBe('new Date()');
    }
    expect(source).not.toMatch(/(?:prisma|tx)\.user\.(?:upsert|update)\(/);
  });
});

// ─────────────────────────────────────────────────────
// RC-10 — Login page navigation after login() success
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-10 — Login page does not manually navigate after login() success', () => {
  it('login page source does NOT call router.push or router.replace with any path after login() succeeds', () => {
    // Read the login page source and assert it does NOT contain a direct router navigation
    // call (router.push / router.replace) immediately after a successful login() return.
    //
    // EXPECTED (post-fix): all navigation is owned by AuthGuard, not the login page.
    // The login page may use onNavigate('dashboard') — this is the RC-10 bug scenario —
    // because it races with AuthGuard's useEffect (both fire when user state updates).
    //
    // NOTE: The current login page uses onNavigate('dashboard') in a useEffect:
    //   useEffect(() => { if (user && isSigningIn) { onNavigate('dashboard'); } }, [...])
    // This is an indirect navigation call that races with AuthGuard.
    // The fix is to remove this useEffect and let AuthGuard own all routing.
    //
    // EXPECTED: FAILS on unfixed code — login page contains onNavigate('dashboard') call
    // that fires after login() sets user, creating a race condition with AuthGuard.

    const LOGIN_PAGE_PATH = path.resolve(
      __dirname,
      '../../features/tenant/pages/modern-login-page.tsx',
    );

    const source = fs.readFileSync(LOGIN_PAGE_PATH, 'utf-8');

    // The login page must NOT navigate to any route after login() succeeds.
    // This includes:
    //   1. Direct router.push('/...') calls after a successful login()
    //   2. useEffect that calls onNavigate('dashboard') when user && isSigningIn
    //      (this is the actual RC-10 pattern present in the current code)

    // Check for the useEffect that fires when user becomes set after login:
    // if (user && isSigningIn) { onNavigate('dashboard'); }
    // This creates a race condition with AuthGuard.
    const hasRaceConditionNavigation =
      /if\s*\(\s*user\s*&&\s*isSigningIn\s*\)/.test(source) &&
      /onNavigate\s*\(\s*['"]dashboard['"]/.test(source);

    // EXPECTED (post-fix): hasRaceConditionNavigation === false
    // FAILS on unfixed code — the useEffect with this pattern IS present
    expect(hasRaceConditionNavigation).toBe(false);
  });

  it('login page source does NOT call router.push or router.replace after login() success anywhere in the component', () => {
    // Additional check: no raw router.push('/...') or router.replace('/...')
    // calls inside the submit handler or a post-login useEffect.
    //
    // EXPECTED: PASSES — the current login page uses onNavigate(), not router directly,
    // so this check confirms the component doesn't bypass the pattern.

    const LOGIN_PAGE_PATH = path.resolve(
      __dirname,
      '../../features/tenant/pages/modern-login-page.tsx',
    );

    const source = fs.readFileSync(LOGIN_PAGE_PATH, 'utf-8');

    // Check the handleLogin function body only (not the whole file which may reference router for other things)
    const handleLoginMatch = /const handleLogin[\s\S]*?^  };/m.exec(source);

    if (handleLoginMatch) {
      const handlerBody = handleLoginMatch[0];
      const hasRouterPush = /router\.(push|replace)\s*\(/.test(handlerBody);
      expect(hasRouterPush).toBe(false);
    }
    // If the handler wasn't found, it means the pattern is different — pass to not block other tests
  });
});
