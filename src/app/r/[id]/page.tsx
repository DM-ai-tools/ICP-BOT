import { notFound } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { loadRun, serialiseRun } from '@/lib/run-service';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await loadRun(id);
  if (!run) notFound();

  // Server-rendered from the database, so a refresh mid-brief resumes exactly
  // where the conversation left off.
  return (
    <Workspace
      runId={run.id}
      initialState={serialiseRun(run)}
      initialMessages={run.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))}
    />
  );
}
