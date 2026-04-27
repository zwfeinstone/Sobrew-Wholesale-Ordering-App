export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  notes: string | null;
  is_admin: boolean;
  is_active: boolean;
  center_id?: string | null;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  category: string | null;
  image_url: string | null;
  active: boolean;
};

export type PriceRow = {
  center_id: string;
  product_id: string;
  price_cents: number;
};
