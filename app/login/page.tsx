import { LoginView } from './login-view';

export default async function LoginPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  const loginError = typeof searchParams.error === 'string' ? searchParams.error : '';
  const credentialsError = loginError === '1';
  const profileError = loginError === 'profile';
  const inactive = typeof searchParams.inactive === 'string';

  return <LoginView credentialsError={credentialsError} inactive={inactive} profileError={profileError} />;
}
