import { LoginView } from './login-view';

export default async function LoginPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  const loginError = typeof searchParams.error === 'string' ? searchParams.error : '';
  const credentialsError = loginError === '1';
  const profileError = loginError === 'profile';
  const inactive = typeof searchParams.inactive === 'string';
  const passwordReset = searchParams.success === 'password_reset';

  return <LoginView credentialsError={credentialsError} inactive={inactive} passwordReset={passwordReset} profileError={profileError} />;
}
