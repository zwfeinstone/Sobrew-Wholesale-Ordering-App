export const LEGACY_CART_STORAGE_KEY = 'cart';

export function cartStorageKeyForUser(userId: string) {
  return `sobrew-cart:${userId}`;
}
