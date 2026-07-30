import { redirect } from 'next/navigation';
import { createRun } from '@/lib/run-service';

export const dynamic = 'force-dynamic';

/** The front door is the conversation. Land here, get a run, start talking. */
export default async function Home() {
  const id = await createRun();
  redirect(`/r/${id}`);
}
