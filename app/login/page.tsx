import { LoginView } from './login-view';

export default function LoginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const loginError = typeof searchParams.error === 'string' ? searchParams.error : '';
  const credentialsError = loginError === '1';
  const profileError = loginError === 'profile';
  const inactive = typeof searchParams.inactive === 'string';

  return <LoginView credentialsError={credentialsError} inactive={inactive} profileError={profileError} />;
}
