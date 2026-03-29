export async function getCenterLoginEmails(supabase: any, centerId: string) {
  if (!centerId) return [] as string[];

  const { data } = await supabase
    .from('profiles')
    .select('email')
    .eq('center_id', centerId)
    .eq('is_admin', false)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  return [...new Set((data ?? []).map((profile: any) => profile.email).filter(Boolean))];
}
