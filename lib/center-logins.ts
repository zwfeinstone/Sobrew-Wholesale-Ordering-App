export async function getCenterLoginEmails(supabase: any, centerId: string) {
  if (!centerId) return [] as string[];

  const { data } = await supabase
    .from('profiles')
    .select('email')
    .eq('center_id', centerId)
    .eq('is_admin', false)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const profile of data ?? []) {
    const email = String((profile as any).email ?? '').trim();
    if (!email) continue;

    const key = email.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    emails.push(email);
  }

  return emails;
}
