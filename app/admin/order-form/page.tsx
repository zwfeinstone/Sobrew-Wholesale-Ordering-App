import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { OrderFormPrint } from '@/components/order-form-print';

type CenterOption = {
  id: string;
  name: string;
  is_active: boolean;
};

export default async function AdminOrderFormPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const centerId = typeof searchParams.center === 'string' ? searchParams.center : '';

  const { data: centers } = await supabase
    .from('centers')
    .select('id,name,is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });

  let selectedCenter = (centers as CenterOption[] | null)?.find((center) => center.id === centerId) ?? null;
  if (!selectedCenter && centers?.length) {
    selectedCenter = centers[0] as CenterOption;
  }

  let selectedCenterEmail = '';
  let lines: Array<{
    product_id: string;
    name: string;
    sku: string;
    image_url: string | null;
    price_cents: number;
  }> = [];

  if (selectedCenter) {
    const [{ data: assigned }, { data: prices }, { data: products }, { data: centerLogin }] = await Promise.all([
      supabase.from('user_products').select('product_id').eq('center_id', selectedCenter.id),
      supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', selectedCenter.id),
      supabase.from('products').select('id,name,sku,image_url').eq('active', true),
      supabase
        .from('profiles')
        .select('email')
        .eq('center_id', selectedCenter.id)
        .eq('is_active', true)
        .eq('is_admin', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    selectedCenterEmail = centerLogin?.email ?? '';

    const assignedIds = new Set((assigned ?? []).map((row) => row.product_id));
    const priceMap = new Map((prices ?? []).map((row) => [row.product_id, row.price_cents]));

    lines = (products ?? [])
      .filter((product: any) => assignedIds.has(product.id))
      .map((product: any) => ({
        product_id: product.id,
        name: product.name ?? '',
        sku: product.sku ?? '',
        image_url: product.image_url ?? null,
        price_cents: priceMap.get(product.id) ?? 0
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
                {centers.map((center: any) => (
                  <option key={center.id} value={center.id}>
                    {center.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary" type="submit">
              Load form
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">No active centers found. Create centers in Admin {'>'} Centers first.</p>
        )}
      </div>

      {selectedCenter ? (
        <OrderFormPrint center={{ id: selectedCenter.id, name: selectedCenter.name, email: selectedCenterEmail }} products={lines} />
      ) : (
        <div className="card">
          <p>No center selected.</p>
          <Link className="text-violet-700" href="/admin/users">
            Go to Centers
          </Link>
        </div>
      )}
    </div>
  );
}
