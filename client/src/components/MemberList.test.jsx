import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MemberList from './MemberList';

const admin = { userId: 'a1', displayName: 'Alice', role: 'admin', joinedAt: '2025-01-01T00:00:00Z' };
const mod = { userId: 'm1', displayName: 'Bob', role: 'mod', joinedAt: '2025-01-01T00:00:00Z' };
const member1 = { userId: 'u1', displayName: 'Caller', role: 'member', joinedAt: '2025-01-01T00:00:00Z' };
const member2 = { userId: 'u2', displayName: 'Dana', role: 'member', joinedAt: '2025-01-01T00:00:00Z' };

describe('MemberList', () => {
  beforeEach(() => cleanup());

  it('renders members grouped by role with admin and member sections', () => {
    render(
      <MemberList
        members={[admin, member1]}
        onlineUserIds={new Set()}
        currentUserId=""
      />
    );
    expect(screen.getByText('ADMIN — 1')).toBeInTheDocument();
    expect(screen.getByText('MEMBERS — 1')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Caller')).toBeInTheDocument();
  });

  it('shows online dot for users in onlineUserIds', () => {
    const { container } = render(
      <MemberList
        members={[member1]}
        onlineUserIds={new Set([member1.userId])}
        currentUserId=""
      />
    );
    const dots = container.querySelectorAll('[aria-hidden]');
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it('shows offline dot for users not in onlineUserIds', () => {
    render(
      <MemberList
        members={[member1]}
        onlineUserIds={new Set()}
        currentUserId=""
      />
    );
    expect(screen.getByText('MEMBERS — 1')).toBeInTheDocument();
    const callers = screen.getAllByText(/^Caller$/);
    expect(callers.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts online members before offline within a group', () => {
    const { container } = render(
      <MemberList
        members={[member1, member2]}
        onlineUserIds={new Set([member2.userId])}
        currentUserId=""
      />
    );
    expect(screen.getByText('MEMBERS — 2')).toBeInTheDocument();
    const rows = container.querySelectorAll('.member-list-row');
    const names = Array.from(rows).map((r) => r.textContent?.trim() ?? '');
    const danaIdx = names.findIndex((n) => n.includes('Dana'));
    const callerIdx = names.findIndex((n) => n.includes('Caller'));
    expect(danaIdx).toBeGreaterThanOrEqual(0);
    expect(callerIdx).toBeGreaterThanOrEqual(0);
    expect(danaIdx).toBeLessThan(callerIdx);
  });

  it('shows "You" suffix for current user', () => {
    render(
      <MemberList
        members={[member1]}
        onlineUserIds={new Set()}
        currentUserId="u1"
      />
    );
    expect(screen.getByText(/Caller \(You\)/)).toBeInTheDocument();
  });
});
