export type OrderItemSummary = {
  name: string;
  qty: number;
};

export async function getOrderItemSummaries(supabase: any, orderId: string): Promise<OrderItemSummary[]> {
  const { data: items } = await supabase
    .from('order_items')
    .select('product_id,product_name_snapshot,qty')
    .eq('order_id', orderId);

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id).filter(Boolean))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };

  const productNameById = new Map((products ?? []).map((product: any) => [product.id, product.name]));

  return (items ?? []).map((item: any) => ({
    name: productNameById.get(item.product_id) || item.product_name_snapshot || 'Unknown product',
    qty: item.qty ?? 0,
  }));
}
