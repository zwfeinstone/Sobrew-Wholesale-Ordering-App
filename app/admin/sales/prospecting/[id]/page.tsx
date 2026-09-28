import { redirect } from 'next/navigation';
import LegacyLeadDetailPage from './legacy-page';
import { isProspectingWorkspaceEnabled } from '@/lib/prospecting-rollout';

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** Keep saved links working while the new workspace selects leads in-place. */
export default async function LeadDetailPage(props: Props) {
  if (!isProspectingWorkspaceEnabled()) return <LegacyLeadDetailPage {...props} />;
  const [{ id }, search] = await Promise.all([props.params, props.searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search || {})) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  query.set('lead', id);
  redirect(`/admin/sales/prospecting?${query}`);
}
