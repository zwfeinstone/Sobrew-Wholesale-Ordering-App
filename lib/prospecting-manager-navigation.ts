export const PROSPECTING_MANAGER_TABS = [
  { id: 'leads', label: 'All leads', group: 'leads' },
  { id: 'pipeline', label: 'Pipeline review', group: 'leads' },
  { id: 'add', label: 'Add lead', group: 'imports' },
  { id: 'imports', label: 'Import & history', group: 'imports' },
  { id: 'duplicates', label: 'Duplicate review', group: 'imports' },
  { id: 'requests', label: 'Requests', group: 'samples' },
  { id: 'samples', label: 'Outcomes', group: 'samples' },
  { id: 'hubspot_queue', label: 'Export queue', group: 'hubspot' },
  { id: 'hubspot', label: 'Export tools', group: 'hubspot' },
  { id: 'overview', label: 'Overview', group: 'reports' },
  { id: 'recycle', label: 'Recycle report', group: 'reports' },
] as const;

export type ProspectingManagerTab = (typeof PROSPECTING_MANAGER_TABS)[number]['id'];
export type ProspectingManagerGroup = (typeof PROSPECTING_MANAGER_TABS)[number]['group'];

export const PROSPECTING_MANAGER_GROUPS = [
  { id: 'leads', label: 'Leads', tab: 'leads' },
  { id: 'imports', label: 'Imports', tab: 'imports' },
  { id: 'samples', label: 'Samples', tab: 'requests' },
  { id: 'hubspot', label: 'HubSpot', tab: 'hubspot_queue' },
  { id: 'reports', label: 'Reports', tab: 'overview' },
] as const;

export function normalizeManagerTab(value: string | string[] | undefined): ProspectingManagerTab {
  return PROSPECTING_MANAGER_TABS.some((tab) => tab.id === value) ? value as ProspectingManagerTab : 'leads';
}

export function managerTabFromSearch(search: Record<string, string | string[] | undefined> = {}): ProspectingManagerTab {
  // Existing bookmarks, export redirects, and paginated reports remain valid.
  if (search.tab) {
    const tab = normalizeManagerTab(search.tab);
    if (tab === 'add' && typeof search.toast === 'string' && search.toast.startsWith('import_')) return 'imports';
    return tab === 'leads' && search.bucket === 'hubspot' ? 'hubspot_queue' : tab;
  }
  if (search.review_rep || search.review_stage || search.review_page || search.review_page_size) return 'pipeline';
  if (search.sample_page || search.sample_page_size) return 'samples';
  if (search.recycle_page || search.recycle_page_size) return 'recycle';
  return search.bucket === 'hubspot' ? 'hubspot_queue' : 'leads';
}

export function managerGroupForTab(tab: ProspectingManagerTab): ProspectingManagerGroup {
  return PROSPECTING_MANAGER_TABS.find((item) => item.id === tab)!.group;
}

export function reviewedBulkCountMatches(value: FormDataEntryValue | null, actual: number) {
  const reviewed = Number(value);
  return Number.isSafeInteger(reviewed) && reviewed > 0 && reviewed === actual;
}
