import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ownerAccessMap } from '@/lib/admin-permission-definitions';

const state = vi.hoisted(() => ({ pathname: '/admin/orders', table: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw new Error('Unexpected redirect'); }, notFound: () => { throw new Error('Unexpected 404'); } }));
vi.mock('next/link', () => ({ default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a',props) }));
vi.mock('next/image', () => ({ default: ({ fill, priority: _priority, ...props }: Record<string, unknown>) => createElement('img',{ ...props, ...(fill ? { style:{ position:'absolute',inset:0,width:'100%',height:'100%' } } : {}) }) }));
vi.mock('@/components/admin-realtime-sync', () => ({ AdminRealtimeSync: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ user:{id:'preview-customer'},profile:{is_admin:false,center_id:center.id,center} }) }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: async () => ({ isOwner:true, access:ownerAccessMap(), centerScope:null }), requireAdminSectionEdit: vi.fn(), requireManageAdmins:vi.fn() }));

const center = { id:'00000000-0000-4000-8000-000000000001', name:'Lakeview Recovery', is_active:true, notes:'', customer_tax_status:'tax_exempt' };
const product = { id:'00000000-0000-4000-8000-000000000003', name:'House Blend · 5 lb', category:'coffee', shipping_box_count_required:false };
const order = { id:'00000000-0000-4000-8000-000000000002', center_id:center.id, status:'New', order_kind:'standard', notes:'Deliver to the receiving entrance.\nCall the front desk before unloading.', subtotal_cents:14400, created_at:'2026-09-08T14:15:00Z', archived_at:null, fulfillment_method:'carrier', shipping_name:'Receiving team', shipping_company:center.name, shipping_address1:'', shipping_city:'', shipping_state:'', shipping_zip:'', profiles:{ email:'orders@example.com' }, centers:{name:center.name} };
const orders = [order, ...['Harbor Wellness','Northside Treatment','Renewal Center','West Park Recovery'].map((name,index) => ({ ...order, id:`00000000-0000-4000-8000-${String(index+10).padStart(12,'0')}`, centers:{name}, status:index === 1 ? 'Shipped' : 'Processing', notes:'', subtotal_cents:9600 + index*3200 }))];
const items = orders.map(o => ({ id:`item-${o.id}`, order_id:o.id, product_id:product.id, product_name_snapshot:product.name, qty:4, unit_price_cents:3600, line_total_cents:14400, products:product }));
class Query {
  filters: Record<string,unknown> = {}; head = false;
  from = 0; to = Infinity;
  constructor(private table: string) {}
  select(_columns?: string, options?: { head?: boolean }) { this.head = Boolean(options?.head); return this; }
  eq(key: string,value: unknown) { this.filters[key]=value; return this; }
  is() { return this; } in() { return this; } or() { return this; } order() { return this; } limit() { return this; }
  range(from: number,to: number) { this.from=from;this.to=to;return this; }
  result(single=false) {
    const tables: Record<string, unknown[]> = { centers:[center], orders, order_items:items, products:[product,{ ...product,id:'product-2',name:'Recovery Roast · 12 oz' },{ ...product,id:'product-3',name:'Cold Brew Concentrate' }], user_products:[{product_id:product.id}], user_product_prices:[{ product_id:product.id,price_cents:3600,allow_zero_price:false }], profiles:[{ id:'member-1',email:'orders@example.com',full_name:'Receiving team',is_active:true }], center_locations:[], order_activity:[{id:'event-1',order_id:order.id,center_id:center.id,action:'received',actor_name:'Receiving team',created_at:order.created_at}], recurring_orders:[] };
    let data = tables[this.table] ?? [];
    for (const [key,value] of Object.entries(this.filters)) data = data.filter(row => !(key in (row as object)) || (row as Record<string,unknown>)[key] === value);
    return { data:this.head ? null : single ? data[0] ?? null : data.slice(this.from,this.to+1), error:null, count:data.length };
  }
  single() { return Promise.resolve(this.result(true)); } maybeSingle() { return this.single(); }
  then(resolve: (value: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}
const database = { from:(table:string) => new Query(table) };

describe('implemented workspace rendering', () => {
  it('renders real order, fulfillment and customer views with isolated fixtures', async () => {
    const { AdminShell } = await import('@/components/admin-shell');
    const Orders = (await import('@/app/admin/orders/page')).default;
    const Detail = (await import('@/app/admin/orders/[id]/page')).default;
    const Customer = (await import('@/app/admin/users/[id]/page')).default;
    const PortalLayout = (await import('@/app/portal/layout')).default;
    const { PortalRestockWorkspace } = await import('@/components/portal-restock-workspace');
    const portalProducts = [
      { product_id:'preview-1',name:'House Blend - 5 lb',description:'Medium roast. Whole bean.',category:'whole_bean',price_cents:3600,image_url:null },
      { product_id:'preview-2',name:'Recovery Roast - 5 lb',description:'Dark roast. Whole bean.',category:'whole_bean',price_cents:3800,image_url:null },
      { product_id:'preview-3',name:'House Blend - Ground',description:'Medium roast. 5 lb bag.',category:'ground',price_cents:3600,image_url:null },
      { product_id:'preview-4',name:'Decaf Blend - Ground',description:'Decaffeinated. 5 lb bag.',category:'ground',price_cents:4000,image_url:null },
    ];
    const screens: Array<[string,string,() => Promise<ReactNode>]> = [
      ['orders','/admin/orders',() => Orders({searchParams:Promise.resolve({})})],
      ['fulfillment',`/admin/orders/${order.id}`,() => Detail({params:Promise.resolve({id:order.id}),searchParams:Promise.resolve({})})],
      ['customer',`/admin/users/${center.id}`,() => Customer({params:Promise.resolve({id:center.id}),searchParams:Promise.resolve({})})],
      ['portal','/portal',() => PortalLayout({children:createElement(PortalRestockWorkspace,{cartStorageKey:'preview-cart',centerName:center.name,products:portalProducts,recurringSummary:{activeCount:1,nextDateLabel:'Sep 15'},recentOrder:{createdAtLabel:'Sep 1',historicalSubtotalLabel:'$144.00',itemCount:4,items:[{product_id:'preview-1',name:'House Blend - 5 lb',price_cents:3600,qty:4}],reorderSubtotalLabel:'$144.00',reorderTotalChanged:false,unavailableItemCount:0}})})],
    ];
    for (const [name,path,render] of screens) {
      state.pathname=path;
      const content = await render();
      const body = renderToStaticMarkup(name === 'portal' ? content : createElement(AdminShell,{access:ownerAccessMap(),isOwner:true,newOrders:1,children:content}));
      expect(body).toContain('Lakeview Recovery');
      if (name === 'fulfillment') { expect(body.indexOf('Deliver to the receiving entrance')).toBeLessThan(body.indexOf('Mark shipped')); expect(body).toContain('disabled=""'); }
      if (name === 'customer') { expect(body).toContain('Catalog &amp; pricing'); expect(body).toContain('role="tabpanel"'); }
      if (process.env.GENERATE_UI_PREVIEWS === '1') {
        const output = 'output/ui-review-2026-09-08/implemented'; mkdirSync(output,{recursive:true});
        writeFileSync(`${output}/${name}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="http://localhost:3000"><title>Sobrew ${name} · sample data</title><link rel="stylesheet" href="/_next/static/css/app/layout.css"><style>body{font-family:Arial,sans-serif}</style></head><body>${body}</body></html>`);
      }
    }
  });
});
