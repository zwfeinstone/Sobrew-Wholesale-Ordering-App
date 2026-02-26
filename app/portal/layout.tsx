import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <div>
      <header className="mb-4 border-b bg-white p-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="font-semibold">SoBrew Portal</h1>
          <nav className="space-x-4 text-sm">
            <Link href="/portal">Catalog</Link>
            <Link href="/portal/cart">Cart</Link>
            <Link href="/portal/orders">Orders</Link>
            {profile?.is_admin ? <Link href="/admin">Admin</Link> : null}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
