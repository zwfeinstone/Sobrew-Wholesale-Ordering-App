import { isProductCategory, UNCATEGORIZED_PRODUCT_CATEGORY } from '@/lib/product-categories';

export const PLANNING_SORTS = [
  ['priority', 'Production priority'],
  ['date', 'Preparation date'],
  ['confidence_desc', 'Forecast confidence: high to low'],
  ['confidence_asc', 'Forecast confidence: low to high'],
  ['quantity', 'Quantity: largest first'],
  ['name', 'Product name'],
] as const;

export type PlanningView = {
  q: string;
  category: string;
  focus: 'all' | 'recurring' | 'attention';
  sort: typeof PLANNING_SORTS[number][0];
  covered: boolean;
};

export function planningView(params: Record<string, string | string[] | undefined>): PlanningView {
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  return {
    q: value('q').trim().slice(0, 200),
    category: isProductCategory(value('category')) || value('category') === UNCATEGORIZED_PRODUCT_CATEGORY ? value('category') : 'all',
    focus: value('focus') === 'recurring' ? 'recurring' : value('focus') === 'attention' ? 'attention' : 'all',
    sort: PLANNING_SORTS.find(([key]) => key === value('sort'))?.[0] ?? 'priority',
    covered: value('covered') === '1',
  };
}

export function planningViewHref(view: PlanningView, toast?: string) {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  if (view.category !== 'all') params.set('category', view.category);
  if (view.focus !== 'all') params.set('focus', view.focus);
  if (view.sort !== 'priority') params.set('sort', view.sort);
  if (view.covered) params.set('covered', '1');
  if (toast) params.set('toast', toast);
  return `/admin/planning${params.size ? `?${params}` : ''}`;
}

export function planningReturnHref(formData: FormData, toast?: string) {
  const raw = String(formData.get('return_to') ?? '');
  let url: URL;
  try {
    url = new URL(raw, 'http://planning.local');
  } catch {
    return planningViewHref(planningView({}), toast);
  }
  const params = url.origin === 'http://planning.local' && url.pathname === '/admin/planning'
    ? Object.fromEntries(url.searchParams)
    : {};
  return planningViewHref(planningView(params), toast);
}
