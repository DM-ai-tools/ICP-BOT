'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, Layers, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

export function RunCardActions({ runId, hasDocuments }: { runId: string; hasDocuments: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const base = `/api/export?runId=${encodeURIComponent(runId)}`;

  const remove = async () => {
    if (!window.confirm('Delete this ICP and every document in it? This cannot be undone.')) return;
    setDeleting(true);
    await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
    setOpen(false);
    router.refresh();
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen((v) => !v)}
        aria-label="Actions"
      >
        <MoreHorizontal />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-xl animate-slide-down">
            {hasDocuments ? (
              <>
                <a
                  href={`${base}&format=map-docx`}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-secondary"
                >
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Awareness map (DOCX)
                </a>
                <a
                  href={`${base}&format=zip`}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-secondary"
                >
                  <Download className="h-4 w-4 text-muted-foreground" />
                  Download all (ZIP)
                </a>
                <div className="my-1 h-px bg-border" />
              </>
            ) : (
              <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                No documents to download yet.
              </p>
            )}

            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
