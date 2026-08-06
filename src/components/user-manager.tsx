'use client';

/**
 * Accounts, in the admin panel.
 *
 * Six rows. Rename, reset a password, switch an account off. Nothing else,
 * because nothing else is needed and every extra control is another thing that
 * can be got wrong at eleven at night.
 */
import * as React from 'react';
import { Check, KeyRound, Loader2, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Badge, Button, Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}

export function UserManager() {
  const [users, setUsers] = React.useState<Account[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, { name?: string; password?: string }>>({});

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users');
      const payload = (await response.json()) as { users?: Account[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Could not load accounts');
        return;
      }
      setUsers(payload.users ?? []);
    } catch {
      setError('Could not load accounts');
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save(id: string, changes: { displayName?: string; password?: string; active?: boolean }) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...changes }),
      });
      const payload = (await response.json()) as { error?: string; signedOut?: boolean };
      if (!response.ok) {
        setError(payload.error ?? 'That change did not save');
        return;
      }
      setNotice(
        payload.signedOut
          ? 'Password changed. Anyone signed in with the old one has been signed out.'
          : 'Saved.',
      );
      setDrafts((prior) => ({ ...prior, [id]: {} }));
      await load();
    } catch {
      setError('That change did not save');
    } finally {
      setBusyId(null);
    }
  }

  if (!users) {
    return <p className="text-sm text-fg-muted">Loading accounts…</p>;
  }

  return (
    <div className="space-y-3">
      {(notice || error) && (
        <p
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            error
              ? 'border-danger/40 bg-danger/[0.07] text-fg-secondary'
              : 'border-accent/40 bg-accent/[0.07] text-fg-secondary',
          )}
        >
          {error ?? notice}
        </p>
      )}

      <ul className="space-y-2">
        {users.map((user) => {
          const draft = drafts[user.id] ?? {};
          const busy = busyId === user.id;
          const isAdmin = user.role === 'admin';

          return (
            <li
              key={user.id}
              className={cn(
                'rounded-lg border border-line bg-surface-1 p-4',
                !user.active && 'opacity-60',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full',
                      isAdmin ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-fg-muted',
                    )}
                  >
                    {isAdmin ? <ShieldCheck className="size-4" /> : <UserIcon className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-md font-medium text-fg">{user.displayName}</p>
                    <p className="mono text-2xs text-fg-subtle">
                      {user.username}
                      {user.lastLoginAt
                        ? ` · last signed in ${new Date(user.lastLoginAt).toLocaleDateString()}`
                        : ' · never signed in'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge tone={isAdmin ? 'accent' : 'neutral'} size="sm">
                    {isAdmin ? 'Admin' : 'User'}
                  </Badge>
                  {!isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void save(user.id, { active: !user.active })}
                    >
                      {user.active ? 'Switch off' : 'Switch on'}
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={`Display name for ${user.username}`}
                  placeholder="Display name"
                  value={draft.name ?? user.displayName}
                  disabled={busy}
                  onChange={(e) =>
                    setDrafts((prior) => ({
                      ...prior,
                      [user.id]: { ...prior[user.id], name: e.target.value },
                    }))
                  }
                />
                <Input
                  aria-label={`New password for ${user.username}`}
                  type="password"
                  placeholder="New password (leave blank to keep)"
                  value={draft.password ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    setDrafts((prior) => ({
                      ...prior,
                      [user.id]: { ...prior[user.id], password: e.target.value },
                    }))
                  }
                />
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    ((draft.name ?? user.displayName) === user.displayName && !draft.password)
                  }
                  onClick={() =>
                    void save(user.id, {
                      displayName: draft.name,
                      password: draft.password || undefined,
                    })
                  }
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Save
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-fg-subtle">
        <KeyRound className="mt-0.5 size-3 shrink-0" />
        <span>
          Passwords need at least eight characters. Changing one signs that person out everywhere
          immediately — which is the point of changing it.
        </span>
      </p>
    </div>
  );
}
