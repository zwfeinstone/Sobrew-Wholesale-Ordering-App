import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createProspectingSampleOrder } from '@/lib/prospecting-sample-orders';

const RUN_LIVE = process.env.RUN_LIVE_SUPABASE_TEST === '1';

type Related<T> = T | T[] | null | undefined;

function relatedList<T>(value: Related<T>): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

describe.skipIf(!RUN_LIVE)('createProspectingSampleOrder live Supabase', () => {
  it('creates and cleans up a standalone prospecting sample order', async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is required').toBeTruthy();
    expect(serviceRole, 'SUPABASE_SERVICE_ROLE_KEY is required').toBeTruthy();

    const supabase = createClient(supabaseUrl!, serviceRole!, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id,name,sku,active,category,product_recipes(id)')
      .eq('active', true)
      .eq('category', 'sample_boxes')
      .order('name', { ascending: true });
    expect(productsError).toBeNull();
    const sampleProduct = (products ?? []).find((product) => relatedList(product.product_recipes).some((recipe) => Boolean(recipe?.id)));
    expect(sampleProduct?.id, 'active sample box product with recipe is required').toBeTruthy();

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('is_admin', true)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    expect(profileError).toBeNull();
    expect(profile?.id, 'active admin profile is required').toBeTruthy();

    const result = await createProspectingSampleOrder({
      currentProfileId: profile!.id,
      input: {
        address1: '123 Verification Ave',
        attentionName: 'Codex Test Receiver',
        centerName: 'Codex Standalone Sample Test',
        city: 'Chicago',
        items: (products ?? []).map((product) => ({
          productId: product.id,
          quantity: product.id === sampleProduct!.id ? 1 : 0,
        })),
        notes: 'Codex live verification, safe to delete.',
        state: 'IL',
        zip: '60601',
      },
      isOwner: true,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(result.orderId).toBeTruthy();

    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id,order_kind,status,shipping_company,shipping_name,subtotal_cents,order_items(qty,unit_price_cents,line_total_cents,product_id)')
        .eq('id', result.orderId!)
        .maybeSingle();

      expect(orderError).toBeNull();
      expect(order).toMatchObject({
        order_kind: 'prospecting_sample',
        shipping_company: 'Codex Standalone Sample Test',
        shipping_name: 'Codex Test Receiver',
        status: 'New',
        subtotal_cents: 0,
      });
      expect(order?.order_items).toEqual([
        expect.objectContaining({
          line_total_cents: 0,
          product_id: sampleProduct!.id,
          qty: 1,
          unit_price_cents: 0,
        }),
      ]);
    } finally {
      if (result.orderId) {
        await supabase.from('orders').delete().eq('id', result.orderId);
      }
    }

    const { data: deleted } = await supabase
      .from('orders')
      .select('id')
      .eq('id', result.orderId!)
      .maybeSingle();
    expect(deleted).toBeNull();
  });
});
