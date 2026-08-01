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
  quickbooks_item_id?: string | null;
  quickbooks_item_name?: string | null;
  quickbooks_item_type?: string | null;
  quickbooks_sync_status?: QuickBooksSyncStatus;
  quickbooks_synced_at?: string | null;
  quickbooks_sync_error?: string | null;
};

export type QuickBooksSyncStatus = 'unmapped' | 'matched' | 'created' | 'ignored' | 'sync_error';
export type CustomerTaxStatus = 'unknown' | 'for_profit' | 'tax_exempt';

export type Center = {
  id: string;
  name: string;
  notes: string | null;
  is_active: boolean;
  created_at: string | null;
  quickbooks_customer_id?: string | null;
  quickbooks_display_name?: string | null;
  quickbooks_company_name?: string | null;
  quickbooks_fully_qualified_name?: string | null;
  legal_name?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  billing_address1?: string | null;
  billing_address2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  customer_tax_note?: string | null;
  customer_tax_status?: CustomerTaxStatus;
  quickbooks_sync_status?: QuickBooksSyncStatus;
  quickbooks_synced_at?: string | null;
  quickbooks_sync_error?: string | null;
  quickbooks_mapping_note?: string | null;
};

export type PriceRow = {
  center_id: string;
  product_id: string;
  price_cents: number;
};
