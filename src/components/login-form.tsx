'use client';

/**
 * Sign in.
 *
 * Two fields and a button. Five of the six people using this are not technical
 * and will meet this screen more often than any other, so it says nothing it
 * does not have to.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import { Button, Input } from '@/components/ui/primitives';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? 'That username and password do not match.');
        setBusy(false);
        return;
      }

      // Full navigation rather than a client push: the server needs to read the
      // new cookie to decide which interface this person gets.
      window.location.href = next;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[22rem] animate-rise">
      <div className="mb-7 text-center">
        <p className="display text-3xl tracking-tight text-fg">{APP_NAME}</p>
        <p className="mt-1.5 text-sm text-fg-muted">{APP_TAGLINE}</p>
      </div>

      <form
        onSubmit={submit}
        className="panel-raised space-y-3.5 rounded-xl border border-line bg-surface-1 p-6"
      >
        <div className="space-y-1.5">
          <label htmlFor="username" className="block text-sm font-medium text-fg-secondary">
            Username
          </label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            disabled={busy}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-fg-secondary">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/[0.08] px-3 py-2 text-sm leading-relaxed text-fg-secondary"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || !username || !password}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs leading-relaxed text-fg-subtle">
        Ask your administrator if you need an account or a password reset.
      </p>
    </div>
  );
}
