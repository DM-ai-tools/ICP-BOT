'use client';

import * as React from 'react';
import { LogOut } from 'lucide-react';
import { Button, Hint } from '@/components/ui/primitives';

/** Who you are, and the way out. Present for everyone, admin or not. */
export function SignOut({ userName }: { userName?: string }) {
  const [busy, setBusy] = React.useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* clearing the cookie is best-effort; the redirect still leaves */
    }
    window.location.href = '/login';
  }

  return (
    <>
      {userName && (
        <span className="ml-1 hidden max-w-[9rem] truncate text-xs text-fg-subtle sm:inline">
          {userName}
        </span>
      )}
      <Hint label="Sign out">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void signOut()}
          disabled={busy}
          aria-label="Sign out"
        >
          <LogOut />
        </Button>
      </Hint>
    </>
  );
}
