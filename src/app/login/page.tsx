import { APP_NAME } from '@/lib/brand';
import { LoginForm } from '@/components/login-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Sign in · ${APP_NAME}` };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only same-app paths. An open redirect on a login form is how a convincing
  // phishing link gets built out of a domain people already trust.
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <div className="atmosphere grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <LoginForm next={destination} />
    </div>
  );
}
