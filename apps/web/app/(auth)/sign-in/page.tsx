import { AuthForm } from '../../../components/auth/AuthForm';

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const notice = error === 'link' ? 'That link is invalid or has expired. Sign in, or ask for a new one.' : undefined;
  return <AuthForm mode="sign-in" next={next} notice={notice} />;
}
