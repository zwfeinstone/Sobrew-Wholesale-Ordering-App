import type { Database as GeneratedDatabase, Json, Tables } from './database.types';

type PublicSchema = GeneratedDatabase['public'];
type Functions = PublicSchema['Functions'];
type NullableArgs<F extends { Args: object }, K extends keyof F['Args']> = Omit<F, 'Args'> & {
  Args: Omit<F['Args'], K> & { [P in K]: F['Args'][P] | null };
};

// PostgreSQL introspection omits argument nullability. These RPCs explicitly use
// null for unrestricted scope / optional optimistic-concurrency input.
// The order-history additions match the pending local recovery migration.
type OrderTrashRow = {
  id: string;
  order_id: string;
  center_id: string | null;
  customer_name: string;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  reason: string;
  order_snapshot: Tables<'orders'>;
  items_snapshot: Tables<'order_items'>[];
  movements_snapshot: Json;
  boxes_snapshot: Json;
  commissions_snapshot: Json;
  schedules_snapshot: Json;
  restored_at: string | null;
  restored_by: string | null;
};

export type SampleQuoteRow = {
  id: string;
  order_id: string;
  lead_id: string;
  contact_id: string | null;
  sender_profile_id: string;
  created_by: string;
  sender_name: string;
  sender_email: string;
  recipient_name: string;
  recipient_email: string;
  cc_emails: string[];
  greeting_name: string | null;
  tracking_number: string;
  lines: Json;
  subject: string;
  body_text: string;
  body_html: string;
  created_at: string;
  sent_at: string | null;
  resend_email_id: string | null;
};

export type ShopifyProductFields = {
  shopify_shop_domain: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  shopify_sku: string | null;
  shopify_synced_at: string | null;
  shopify_updated_at: string | null;
};

export type ShopifyProductImport = {
  id: string;
  shop_domain: string;
  shopify_product_id: string;
  webhook_id: string;
  topic: string;
  payload: Json;
  status: 'pending' | 'imported' | 'error';
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ShopifyOrderFields = {
  order_source: 'portal' | 'shopify';
  shopify_shop_domain: string | null;
  shopify_order_id: string | null;
  shopify_order_name: string | null;
  shopify_email: string | null;
  shopify_line_items: Json;
  shopify_fulfillment_id: string | null;
  shopify_sync_status: 'pending' | 'syncing' | 'synced' | 'error' | null;
  shopify_sync_error: string | null;
  shopify_synced_at: string | null;
  shopify_sync_started_at: string | null;
  shopify_sync_token: string | null;
  shipping_tracking_numbers: string[];
  shipping_country: string | null;
};

export type ShopifyOrderImport = {
  id: string;
  shop_domain: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  topic: string;
  payload: Json;
  status: 'pending' | 'imported' | 'ignored' | 'error';
  error: string | null;
  order_id: string | null;
  received_at: string;
  updated_at: string;
};

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<PublicSchema, 'Tables' | 'Functions' | 'Views'> & {
    Tables: PublicSchema['Tables'] & {
      held_stock_sales: {
        Row: { order_id: string; processing_fee_cents: number; donation_cogs_cents: number; invoice_only: boolean; tax_exempt: boolean };
        Insert: { order_id: string; processing_fee_cents: number; donation_cogs_cents?: number; invoice_only?: boolean; tax_exempt?: boolean };
        Update: { processing_fee_cents?: number; donation_cogs_cents?: number; invoice_only?: boolean; tax_exempt?: boolean };
        Relationships: [{ foreignKeyName: 'held_stock_sales_order_id_fkey'; columns: ['order_id']; isOneToOne: true; referencedRelation: 'orders'; referencedColumns: ['id'] }];
      };
      customer_stock_allocations: {
        Row: { id: string; center_id: string; product_id: string; initial_order_id: string; initial_quantity: number; created_at: string };
        Insert: { id?: string; center_id: string; product_id: string; initial_order_id: string; initial_quantity: number; created_at?: string };
        Update: { initial_quantity?: number };
        Relationships: [];
      };
      customer_stock_reservations: {
        Row: { allocation_id: string; order_item_id: string; quantity: number; status: 'reserved' | 'shipped'; consumed_at: string | null };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      customer_stock_products: {
        Row: { product_id: string; allocation_id: string };
        Insert: { product_id: string; allocation_id: string };
        Update: never;
        Relationships: [];
      };
      product_material_fallbacks: {
        Row: { product_id: string; primary_inventory_item_id: string; fallback_inventory_item_id: string };
        Insert: { product_id: string; primary_inventory_item_id: string; fallback_inventory_item_id: string };
        Update: { product_id?: string; primary_inventory_item_id?: string; fallback_inventory_item_id?: string };
        Relationships: [];
      };
      products: PublicSchema['Tables']['products'] & {
        Row: PublicSchema['Tables']['products']['Row'] & ShopifyProductFields;
        Insert: PublicSchema['Tables']['products']['Insert'] & Partial<ShopifyProductFields>;
        Update: PublicSchema['Tables']['products']['Update'] & Partial<ShopifyProductFields>;
      };
      shopify_product_imports: {
        Row: ShopifyProductImport;
        Insert: Omit<ShopifyProductImport, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<ShopifyProductImport, 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<ShopifyProductImport>;
        Relationships: [];
      };
      orders: PublicSchema['Tables']['orders'] & {
        Row: PublicSchema['Tables']['orders']['Row'] & ShopifyOrderFields;
        Insert: PublicSchema['Tables']['orders']['Insert'] & Partial<ShopifyOrderFields>;
        Update: PublicSchema['Tables']['orders']['Update'] & Partial<ShopifyOrderFields>;
      };
      shopify_order_imports: {
        Row: ShopifyOrderImport;
        Insert: Omit<ShopifyOrderImport, 'id' | 'received_at' | 'updated_at'> & Partial<Pick<ShopifyOrderImport, 'id' | 'received_at' | 'updated_at'>>;
        Update: Partial<ShopifyOrderImport>;
        Relationships: [];
      };
      centers: PublicSchema['Tables']['centers'] & {
        Row: PublicSchema['Tables']['centers']['Row'] & { invoice_recipients_configured_at: string | null; automatic_invoice_only: boolean };
        Insert: PublicSchema['Tables']['centers']['Insert'] & { invoice_recipients_configured_at?: string | null; automatic_invoice_only?: boolean };
        Update: PublicSchema['Tables']['centers']['Update'] & { invoice_recipients_configured_at?: string | null; automatic_invoice_only?: boolean };
      };
      admin_weekly_sales_spiffs: PublicSchema['Tables']['admin_weekly_sales_spiffs'] & {
        Row: PublicSchema['Tables']['admin_weekly_sales_spiffs']['Row'] & { first_order_id: string | null };
        Insert: PublicSchema['Tables']['admin_weekly_sales_spiffs']['Insert'] & { first_order_id?: string | null };
        Update: PublicSchema['Tables']['admin_weekly_sales_spiffs']['Update'] & { first_order_id?: string | null };
      };
      monthly_commission_payouts: PublicSchema['Tables']['monthly_commission_payouts'] & {
        Row: PublicSchema['Tables']['monthly_commission_payouts']['Row'] & { paid_order_ids: string[] | null; gross_commission_cents: number | null; hourly_base_offset_cents: number };
        Insert: PublicSchema['Tables']['monthly_commission_payouts']['Insert'] & { paid_order_ids?: string[] | null; gross_commission_cents?: number | null; hourly_base_offset_cents?: number };
        Update: PublicSchema['Tables']['monthly_commission_payouts']['Update'] & { paid_order_ids?: string[] | null; gross_commission_cents?: number | null; hourly_base_offset_cents?: number };
      };
      admin_commission_settings: PublicSchema['Tables']['admin_commission_settings'] & {
        Row: PublicSchema['Tables']['admin_commission_settings']['Row'] & { hourly_offset_enabled: boolean; hourly_offset_start_month: string | null };
        Insert: PublicSchema['Tables']['admin_commission_settings']['Insert'] & { hourly_offset_enabled?: boolean; hourly_offset_start_month?: string | null };
        Update: PublicSchema['Tables']['admin_commission_settings']['Update'] & { hourly_offset_enabled?: boolean; hourly_offset_start_month?: string | null };
      };
      prospecting_sample_requests: {
        Row: { id: string; lead_id: string; requested_by: string | null; contact_id: string | null; status: 'pending' | 'order_created' | 'legacy_review'; order_id: string | null; details: Json; created_at: string; updated_at: string; closed_at: string | null };
        Insert: never; Update: never;
        Relationships: [
          { foreignKeyName: 'prospecting_sample_requests_lead_id_fkey'; columns: ['lead_id']; isOneToOne: false; referencedRelation: 'prospecting_leads'; referencedColumns: ['id'] },
          { foreignKeyName: 'prospecting_sample_requests_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'prospecting_contacts'; referencedColumns: ['id'] },
          { foreignKeyName: 'prospecting_sample_requests_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ];
      };
      prospecting_sample_quotes: {
        Row: SampleQuoteRow;
        Insert: Omit<SampleQuoteRow, 'id' | 'created_at' | 'sent_at' | 'resend_email_id' | 'greeting_name' | 'cc_emails'> & Partial<Pick<SampleQuoteRow, 'id' | 'created_at' | 'sent_at' | 'resend_email_id' | 'greeting_name' | 'cc_emails'>>;
        Update: Partial<Pick<SampleQuoteRow, 'sent_at' | 'resend_email_id'>>;
        Relationships: [
          { foreignKeyName: 'prospecting_sample_quotes_lead_id_fkey'; columns: ['lead_id']; isOneToOne: false; referencedRelation: 'prospecting_leads'; referencedColumns: ['id'] },
          { foreignKeyName: 'prospecting_sample_quotes_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'prospecting_contacts'; referencedColumns: ['id'] },
          { foreignKeyName: 'prospecting_sample_quotes_sender_profile_id_fkey'; columns: ['sender_profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'prospecting_sample_quotes_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ];
      };
      prospecting_submission_receipts: { Row: { submission_id: string; actor_id: string; submission_signature: string | null; payload: Json; receipt: Json; created_at: string }; Insert: never; Update: never; Relationships: [] };
      order_trash: { Row: OrderTrashRow; Insert: never; Update: never; Relationships: [] };
      order_activity: { Row: { id: string; order_id: string; center_id: string | null; actor_name: string | null; action: string; before_value: Json; after_value: Json; created_at: string }; Insert: never; Update: never; Relationships: [] };
      user_product_prices: PublicSchema['Tables']['user_product_prices'] & { Row: PublicSchema['Tables']['user_product_prices']['Row'] & { allow_zero_price: boolean } };
    };
    Views: PublicSchema['Views'] & {
      customer_stock_product_allocations: {
        Row: { allocation_id: string; product_id: string; inventory_product_id: string; center_id: string; initial_order_id: string; initial_quantity: number };
        Relationships: [];
      };
    };
    Functions: Omit<Functions, 'admin_prospecting_report_v1' | 'save_prospecting_record_v1'> & {
      get_customer_stock_balances: { Args: { p_center_id: string }; Returns: { allocation_id: string; product_id: string; initial_quantity: number; available_quantity: number; reserved_quantity: number; on_hand_quantity: number; shared_product_count: number }[] };
      consume_customer_stock_for_order_item: { Args: { p_order_item_id: string; p_shipping_cost_cents: number }; Returns: number };
      sync_shopify_product_variant: { Args: { p_variant: Json }; Returns: Json };
      save_shopify_order_import: { Args: { p_shop_domain: string; p_shopify_order_id: string; p_shopify_order_name: string | null; p_topic: string; p_payload: Json }; Returns: string };
      import_shopify_order: { Args: { p_order: Json; p_items: Json }; Returns: string };
      read_prospecting_receipt_v2: { Args: { p_actor_id: string; p_submission_id: string; p_submission_signature?: string | null }; Returns: Json };
      commit_prospecting_record_v2: { Args: { p_actor_id: string; p_submission_id: string; p_lead_id: string | null; p_expected_updated_at: string | null; p_lead?: Json; p_contact_updates?: Json; p_new_contact?: Json; p_activity?: Json; p_audit_activities?: Json; p_contact_delete_ids?: string[]; p_sample?: Json; p_submission_signature?: string | null; p_next_href?: string | null }; Returns: Json };
      admin_prospecting_report_v1: NullableArgs<Functions['admin_prospecting_report_v1'], 'p_center_ids' | 'p_sales_profile_id'>;
      save_prospecting_record_v1: NullableArgs<Functions['save_prospecting_record_v1'], 'p_expected_updated_at'>;
      move_order_to_trash: { Args: { p_order_id: string; p_reason: string }; Returns: string };
      restore_order_from_trash: { Args: { p_trash_id: string }; Returns: string };
      save_center_catalog: { Args: { p_center_id: string; p_entries: Json }; Returns: undefined };
    };
  };
};
