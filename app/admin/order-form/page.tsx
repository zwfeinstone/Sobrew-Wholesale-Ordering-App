import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { OrderFormPrint } from '@/components/order-form-print';

export default async function AdminOrderFormPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const centerId = typeof searchParams.center === 'string' ? searchParams.center : '';

  const { data: centers } = await supabase
    .from('profiles')
    .select('id,email,full_name')
    .eq('is_admin', false)
    .eq('is_active', true)
    .order('email', { ascending: true });

  let selectedCenter = centers?.find((c) => c.id === centerId) ?? null;
  if (!selectedCenter && centers?.length) {
    selectedCenter = centers[0];
  }

  let lines: Array<{
    product_id: string;
    name: string;
    sku: string;
    image_url: string | null;
    price_cents: number;
  }> = [];

  if (selectedCenter) {
    const { data } = await supabase
      .from('user_products')
      .select('product_id,products(name,sku,image_url),user_product_prices(price_cents)')
      .eq('user_id', selectedCenter.id);

    lines = (data ?? []).map((row: any) => ({
      product_id: row.product_id,
      name: row.products?.name ?? '',
      sku: row.products?.sku ?? '',
      image_url: row.products?.image_url ?? null,
      price_cents: row.user_product_prices?.[0]?.price_cents ?? 0
    }));
  }

  return (
    <div className="space-y-4">
      <div className="card print:hidden">
        <h1 className="mb-3 text-2xl font-semibold">Order Form</h1>
        {centers?.length ? (
          <form className="flex flex-wrap items-end gap-2" method="get">
            <div>
              <label className="mb-1 block text-sm font-medium">Center</label>
              <select className="input min-w-72" name="center" defaultValue={selectedCenter?.id ?? ''}>
                {centers.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.full_name || center.email}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary" type="submit">
              Load form
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">No active centers found. Create users in Admin → Users first.</p>
        )}
      </div>

      {selectedCenter ? (
        <OrderFormPrint center={selectedCenter} products={lines} />
      ) : (
        <div className="card">
          <p>No center selected.</p>
          <Link className="text-violet-700" href="/admin/users">
            Go to Users
          </Link>
        </div>
      )}
    </div>
  );
}
