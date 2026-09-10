import LoginForm from './login-form';

/**
 * Server wrapper. Auth.js redirects here with ?error=... on a failed callback;
 * reading it server-side avoids useSearchParams(), which would otherwise force
 * the whole page into a client-side bailout and need a Suspense boundary.
 *
 * Next 16: searchParams is async (docs/next16-notes.md).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error, code } = await searchParams;
  return <LoginForm initialError={code ?? error} />;
}
