import { describe, it, expect } from 'vitest';
import { parseCenterCatalog } from './customer-pricing';
describe('customer pricing', () => {
  function form(price: string, free = false) { const f = new FormData(); f.append('product_id', 'a'); f.set('price_a',price); if (free) f.set('complimentary_a','on'); return f; }
  it('requires a complete price', () => { for (const price of ['', '-2', '3.999', 'abc', '0']) expect(() => parseCenterCatalog(form(price))).toThrow(); });
  it('converts exact cents and preserves approved free products', () => { expect(parseCenterCatalog(form('12.30'))[0].price_cents).toBe(1230); expect(parseCenterCatalog(form('0',true))[0].allow_zero_price).toBe(true); });
});
