import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function ProductsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="eyebrow">Catalog Admin</span>
          <h1 className="page-title mt-4">Products</h1>
        </div>
        <Link href="/admin/products/new" className="btn-primary">New product</Link>
      </div>
      {data?.map((p) => (
        <Link className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95" key={p.id} href={`/admin/products/${p.id}`}>
          <p className="text-lg font-semibold text-slate-950">{p.name}</p>
          <p className="mt-2 text-sm text-slate-500">SKU: {p.sku}</p>
        </Link>
      ))}
    </div>
  );
}
