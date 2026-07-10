import Link from 'next/link';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

type CenterRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type CenterMemberRow = {
  center_id: string | null;
  is_active: boolean | null;
  last_seen_at: string | null;
};

const centerNameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });
const centralDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

function centerDisplayName(center: CenterRow) {
  return center.name?.trim() || 'Unnamed center';
}

function centerStartingLetter(center: CenterRow) {
  const firstCharacter = centerDisplayName(center).charAt(0).toLocaleUpperCase('en-US');
  return /^[A-Z]$/.test(firstCharacter) ? firstCharacter : '#';
}

function groupCentersByStartingLetter(centers: CenterRow[]) {
  const sortedCenters = [...centers].sort((a, b) => {
    const nameComparison = centerNameCollator.compare(centerDisplayName(a), centerDisplayName(b));
    if (nameComparison !== 0) return nameComparison;
    return centerDisplayName(a).localeCompare(centerDisplayName(b));
  });

  const groups: Array<{ letter: string; centers: CenterRow[] }> = [];
  for (const center of sortedCenters) {
    const letter = centerStartingLetter(center);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.letter === letter) {
      currentGroup.centers.push(center);
    } else {
      groups.push({ letter, centers: [center] });
    }
  }

  return groups;
}

function formatCentralDateTime(value: string | null | undefined, emptyLabel: string) {
  if (!value) return emptyLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : centralDateTimeFormatter.format(date);
}

function newerTimestamp(currentValue: string | null | undefined, candidateValue: string | null | undefined) {
  if (!candidateValue) return currentValue ?? null;
  const candidate = new Date(candidateValue);
  if (Number.isNaN(candidate.getTime())) return currentValue ?? null;

  if (!currentValue) return candidateValue;
  const current = new Date(currentValue);
  if (Number.isNaN(current.getTime())) return candidateValue;

  return candidate.getTime() > current.getTime() ? candidateValue : currentValue;
}

function rememberLatest(map: Map<string, string>, key: string, value: string | null | undefined) {
  const latest = newerTimestamp(map.get(key), value);
  if (latest) map.set(key, latest);
}

export default async function UsersPage() {
  const currentAccess = await requireAdminSectionView('centers');
  const supabase = await createClient();
  const canEditCenters = adminCanEdit(currentAccess.access, 'centers');

  const centersQuery = supabase.from('centers').select('id,name,is_active,created_at').order('name', { ascending: true });
  const centerMembersQuery = supabase.from('profiles').select('center_id,is_active,last_seen_at').eq('is_admin', false).not('center_id', 'is', null);

  const [{ data: centers }, { data: centerMembers }, { data: adminUsers }] = await Promise.all([
    centersQuery,
    centerMembersQuery,
    currentAccess.isOwner
      ? supabase.from('profiles').select('id,email,full_name,is_active,is_admin,is_superadmin').eq('is_admin', true).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const memberCountsByCenterId = new Map<string, number>();
  const activeMemberCountsByCenterId = new Map<string, number>();
  const lastActivityByCenterId = new Map<string, string>();
  for (const member of (centerMembers ?? []) as CenterMemberRow[]) {
    if (!member.center_id) continue;
    memberCountsByCenterId.set(member.center_id, (memberCountsByCenterId.get(member.center_id) ?? 0) + 1);
    if (member.is_active) {
      activeMemberCountsByCenterId.set(member.center_id, (activeMemberCountsByCenterId.get(member.center_id) ?? 0) + 1);
    }
    rememberLatest(lastActivityByCenterId, member.center_id, member.last_seen_at);
  }

  const groupedCenters = groupCentersByStartingLetter((centers ?? []) as CenterRow[]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="eyebrow">Center Admin</span>
          <h1 className="page-title mt-4">Centers</h1>
          <p className="page-subtitle mt-3">Create centers, add or remove login access, and keep product pricing tied to the center instead of a single employee account.</p>
        </div>
        {canEditCenters ? <Link href="/admin/users/new" className="btn-primary w-full sm:w-auto">Add Center</Link> : null}
      </div>

      <section className="space-y-4">
        {!centers?.length ? <div className="card text-sm text-slate-600">No centers yet.</div> : null}
        {groupedCenters.map((group) => (
          <div key={group.letter} className="space-y-3">
            <h2 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{group.letter}</h2>
            {group.centers.map((center) => (
              <Link key={center.id} href={`/admin/users/${center.id}`} className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
                <p className="text-lg font-semibold text-slate-950">{centerDisplayName(center)}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {center.is_active ? 'Active center' : 'Inactive center'} - {activeMemberCountsByCenterId.get(center.id) ?? 0} active login(s) - {memberCountsByCenterId.get(center.id) ?? 0} total login(s)
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Last portal activity: {formatCentralDateTime(lastActivityByCenterId.get(center.id), 'No portal activity yet')}
                </p>
              </Link>
            ))}
          </div>
        ))}
      </section>

      {currentAccess.isOwner ? (
      <section className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="eyebrow">Admin Accounts</span>
            <h2 className="page-title mt-4 text-3xl">Admin logins</h2>
          </div>
          {currentAccess.isOwner ? (
            <Link href="/admin/admins/new" className="btn-primary w-full sm:w-auto">
              Add Admin
            </Link>
          ) : null}
        </div>
        {!adminUsers?.length ? <div className="card text-sm text-slate-600">No admin accounts found.</div> : null}
        {adminUsers?.map((user: any) => (
          <Link key={user.id} href={`/admin/users/${user.id}`} className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
            <p className="text-lg font-semibold text-slate-950">{user.full_name || user.email}</p>
            <p className="mt-2 break-all text-sm text-slate-500">{user.email}</p>
            <p className="mt-2 text-sm text-slate-500">{!user.is_active ? 'Deactivated' : 'Active'}{user.is_superadmin ? ' - Superadmin' : ''}</p>
          </Link>
        ))}
      </section>
      ) : null}
    </div>
  );
}
