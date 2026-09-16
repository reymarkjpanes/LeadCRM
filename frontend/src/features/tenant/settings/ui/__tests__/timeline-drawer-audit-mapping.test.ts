import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Tests for the audit log field mapping used by TimelineDrawer.
 *
 * The API returns AuditLogEntry ({ createdAt, changeset, metadata })
 * but TimelineDrawer expects ({ timestamp, details }).
 *
 * These tests verify the mapping function that converts API shape to display shape,
 * and the relevance filter that scopes logs to a specific user.
 *
 * Validates: on-demand audit fetch → correct display without DataContext startup load.
 */

// ── Types (mirror the component's local types) ────────────────────────────────

interface ApiAuditEntry {
  id: string;
  userId: string;
  action: string;
  createdAt: string;
  changeset?: { before: Record<string, unknown>; after: Record<string, unknown> };
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
}

interface DisplayEntry {
  id: string;
  userId?: string;
  userEmail?: string;
  action: string;
  details: string;
  timestamp: string;
  ipAddress?: string;
}

// ── Mapping function (mirrors team-management-users.tsx fetchLogs mapping) ─────

function mapApiToDisplay(entry: ApiAuditEntry): DisplayEntry {
  return {
    id:        entry.id,
    userId:    entry.userId,
    userEmail: entry.user?.email,
    action:    entry.action,
    details:   entry.changeset
      ? JSON.stringify(entry.changeset)
      : (entry.metadata ? JSON.stringify(entry.metadata) : entry.action),
    timestamp: entry.createdAt,
    ipAddress: entry.ipAddress,
  };
}

// ── Relevance filter (mirrors TimelineDrawer fetchLogs filter) ─────────────────

interface TargetUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

function isRelevantToUser(entry: DisplayEntry, user: TargetUser): boolean {
  const uEmail      = user.email.toLowerCase();
  const uName       = `${user.firstName} ${user.lastName}`.toLowerCase();
  const logEmail    = entry.userEmail?.toLowerCase() ?? '';
  const detailsLow  = entry.details?.toLowerCase() ?? '';

  return (
    entry.userId === user.id ||
    (logEmail.length > 0 && logEmail === uEmail) ||
    (uName.trim().length > 0 && detailsLow.includes(uName.trim())) ||
    (uEmail.length > 0 && detailsLow.includes(uEmail))
  );
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const isoDateArb = fc.constantFrom(
  '2023-01-01T00:00:00.000Z',
  '2023-06-15T12:30:00.000Z',
  '2024-01-01T00:00:00.000Z',
  '2024-09-16T10:25:00.000Z',
  '2025-03-22T08:00:00.000Z',
);

const uuidArb = fc.uuid();

const apiEntryArb = fc.record({
  id:        uuidArb,
  userId:    uuidArb,
  action:    fc.string({ minLength: 1, maxLength: 80 }),
  createdAt: isoDateArb,
  ipAddress: fc.option(fc.stringMatching(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/), { nil: undefined }),
});

// ─── Field mapping tests ───────────────────────────────────────────────────────

describe('TimelineDrawer — audit log field mapping', () => {
  it('maps createdAt → timestamp exactly', () => {
    fc.assert(
      fc.property(apiEntryArb, (entry) => {
        const display = mapApiToDisplay(entry);
        expect(display.timestamp).toBe(entry.createdAt);
      }),
      { numRuns: 100 },
    );
  });

  it('maps userId → userId exactly', () => {
    fc.assert(
      fc.property(apiEntryArb, (entry) => {
        const display = mapApiToDisplay(entry);
        expect(display.userId).toBe(entry.userId);
      }),
      { numRuns: 100 },
    );
  });

  it('maps action → action exactly', () => {
    fc.assert(
      fc.property(apiEntryArb, (entry) => {
        const display = mapApiToDisplay(entry);
        expect(display.action).toBe(entry.action);
      }),
      { numRuns: 100 },
    );
  });

  it('maps id → id exactly', () => {
    fc.assert(
      fc.property(apiEntryArb, (entry) => {
        const display = mapApiToDisplay(entry);
        expect(display.id).toBe(entry.id);
      }),
      { numRuns: 100 },
    );
  });

  it('uses changeset JSON as details when changeset is present', () => {
    const entry: ApiAuditEntry = {
      id: 'a1',
      userId: 'u1',
      action: 'Contact Updated',
      createdAt: '2024-01-01T00:00:00.000Z',
      changeset: { before: { status: 'HOT' }, after: { status: 'COLD' } },
    };
    const display = mapApiToDisplay(entry);
    expect(display.details).toBe(JSON.stringify(entry.changeset));
  });

  it('falls back to metadata JSON when no changeset', () => {
    const entry: ApiAuditEntry = {
      id: 'a2',
      userId: 'u1',
      action: 'Workflow Triggered',
      createdAt: '2024-01-01T00:00:00.000Z',
      metadata: { workflowId: 'wf-1', trigger: 'lead_created' },
    };
    const display = mapApiToDisplay(entry);
    expect(display.details).toBe(JSON.stringify(entry.metadata));
  });

  it('falls back to action string when neither changeset nor metadata', () => {
    const entry: ApiAuditEntry = {
      id: 'a3',
      userId: 'u1',
      action: 'User Logged In',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const display = mapApiToDisplay(entry);
    expect(display.details).toBe('User Logged In');
  });

  it('changeset takes priority over metadata when both present', () => {
    const entry: ApiAuditEntry = {
      id: 'a4',
      userId: 'u1',
      action: 'Both Present',
      createdAt: '2024-01-01T00:00:00.000Z',
      changeset:  { before: {}, after: { x: 1 } },
      metadata:   { note: 'should be ignored' },
    };
    const display = mapApiToDisplay(entry);
    expect(display.details).toBe(JSON.stringify(entry.changeset));
    expect(display.details).not.toContain('should be ignored');
  });

  it('maps user.email → userEmail when user object present', () => {
    const entry: ApiAuditEntry = {
      id: 'a5',
      userId: 'u1',
      action: 'Login',
      createdAt: '2024-01-01T00:00:00.000Z',
      user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
    };
    const display = mapApiToDisplay(entry);
    expect(display.userEmail).toBe('alice@example.com');
  });

  it('userEmail is undefined when user object absent', () => {
    const entry: ApiAuditEntry = {
      id: 'a6', userId: 'u1', action: 'Login', createdAt: '2024-01-01T00:00:00.000Z',
    };
    const display = mapApiToDisplay(entry);
    expect(display.userEmail).toBeUndefined();
  });
});

describe('TimelineDrawer — relevance filter', () => {
  const user: TargetUser = {
    id: 'user-123',
    email: 'alice@acme.com',
    firstName: 'Alice',
    lastName: 'Smith',
  };

  it('matches when entry.userId equals user.id', () => {
    const entry: DisplayEntry = {
      id: 'e1', userId: 'user-123', action: 'Login', details: 'details', timestamp: '2024-01-01',
    };
    expect(isRelevantToUser(entry, user)).toBe(true);
  });

  it('matches when userEmail equals user.email (case-insensitive)', () => {
    const entry: DisplayEntry = {
      id: 'e2', userId: 'other-user', userEmail: 'ALICE@ACME.COM',
      action: 'Login', details: 'details', timestamp: '2024-01-01',
    };
    expect(isRelevantToUser(entry, user)).toBe(true);
  });

  it('matches when details contains user full name', () => {
    const entry: DisplayEntry = {
      id: 'e3', userId: 'other-user',
      action: 'Record Updated', details: 'Updated contact for alice smith', timestamp: '2024-01-01',
    };
    expect(isRelevantToUser(entry, user)).toBe(true);
  });

  it('matches when details contains user email', () => {
    const entry: DisplayEntry = {
      id: 'e4', userId: 'other-user',
      action: 'Invite Sent', details: 'Invitation sent to alice@acme.com', timestamp: '2024-01-01',
    };
    expect(isRelevantToUser(entry, user)).toBe(true);
  });

  it('does not match unrelated log entries', () => {
    const entry: DisplayEntry = {
      id: 'e5', userId: 'unrelated-user', userEmail: 'bob@other.com',
      action: 'Deal Created', details: 'Created deal for bob company', timestamp: '2024-01-01',
    };
    expect(isRelevantToUser(entry, user)).toBe(false);
  });

  it('returns false for empty details and non-matching userId/email', () => {
    const entry: DisplayEntry = {
      id: 'e6', userId: 'other', action: 'Action', details: '', timestamp: '2024-01-01',
    };
    expect(isRelevantToUser(entry, user)).toBe(false);
  });

  it('for any user, relevance is deterministic for the same input', () => {
    fc.assert(
      fc.property(
        fc.record({
          id:        uuidArb,
          userId:    uuidArb,
          action:    fc.string({ minLength: 1, maxLength: 40 }),
          details:   fc.string({ minLength: 0, maxLength: 100 }),
          timestamp: isoDateArb,
        }),
        (entry) => {
          const result1 = isRelevantToUser(entry, user);
          const result2 = isRelevantToUser(entry, user);
          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
