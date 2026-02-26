import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function ProductsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Link href="/admin/products/new" className="btn-primary">New product</Link>
      </div>
      {data?.map((p) => (
        <Link className="card block" key={p.id} href={`/admin/products/${p.id}`}>{p.name} ({p.sku})</Link>
      ))}
    </div>
  );
}
