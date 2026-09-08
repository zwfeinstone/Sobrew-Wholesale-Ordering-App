export function parseCenterCatalog(form: FormData) {
  const selected = [...new Set(form.getAll('product_id').map(String))];
  return selected.map(product_id => {
    const raw = String(form.get(`price_${product_id}`) ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error('Enter a valid price for every selected product.');
    const price_cents = Math.round(Number(raw) * 100);
    const allow_zero_price = form.get(`complimentary_${product_id}`) === 'on';
    if (!Number.isSafeInteger(price_cents) || price_cents > 2147483647 || (price_cents === 0 && !allow_zero_price)) throw new Error('Approve complimentary pricing or enter a price greater than zero.');
    return { product_id, price_cents, allow_zero_price: price_cents === 0 && allow_zero_price };
  });
}
