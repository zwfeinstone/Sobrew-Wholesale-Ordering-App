export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  notes: string | null;
  is_admin: boolean;
  is_active: boolean;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  image_url: string | null;
  active: boolean;
};

export type PriceRow = {
  user_id: string;
  product_id: string;
  price_cents: number;
};
