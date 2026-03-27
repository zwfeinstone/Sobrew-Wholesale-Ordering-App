import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

async function logout() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export function LogoutButton({ className = 'btn-secondary' }: { className?: string }) {
  return (
    <form action={logout}>
      <button className={className} type="submit">
        Log out
      </button>
    </form>
  );
}
