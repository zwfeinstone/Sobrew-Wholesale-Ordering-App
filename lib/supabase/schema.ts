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

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<PublicSchema, 'Tables' | 'Functions'> & {
    Tables: PublicSchema['Tables'] & {
      centers: PublicSchema['Tables']['centers'] & {
        Row: PublicSchema['Tables']['centers']['Row'] & { invoice_recipients_configured_at: string | null };
        Insert: PublicSchema['Tables']['centers']['Insert'] & { invoice_recipients_configured_at?: string | null };
        Update: PublicSchema['Tables']['centers']['Update'] & { invoice_recipients_configured_at?: string | null };
      };
      admin_weekly_sales_spiffs: PublicSchema['Tables']['admin_weekly_sales_spiffs'] & {
        Row: PublicSchema['Tables']['admin_weekly_sales_spiffs']['Row'] & { first_order_id: string | null };
        Insert: PublicSchema['Tables']['admin_weekly_sales_spiffs']['Insert'] & { first_order_id?: string | null };
        Update: PublicSchema['Tables']['admin_weekly_sales_spiffs']['Update'] & { first_order_id?: string | null };
      };
      monthly_commission_payouts: PublicSchema['Tables']['monthly_commission_payouts'] & {
        Row: PublicSchema['Tables']['monthly_commission_payouts']['Row'] & { paid_order_ids: string[] | null };
        Insert: PublicSchema['Tables']['monthly_commission_payouts']['Insert'] & { paid_order_ids?: string[] | null };
        Update: PublicSchema['Tables']['monthly_commission_payouts']['Update'] & { paid_order_ids?: string[] | null };
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
      prospecting_submission_receipts: { Row: { submission_id: string; actor_id: string; submission_signature: string | null; payload: Json; receipt: Json; created_at: string }; Insert: never; Update: never; Relationships: [] };
      order_trash: { Row: OrderTrashRow; Insert: never; Update: never; Relationships: [] };
      order_activity: { Row: { id: string; order_id: string; center_id: string | null; actor_name: string | null; action: string; before_value: Json; after_value: Json; created_at: string }; Insert: never; Update: never; Relationships: [] };
      user_product_prices: PublicSchema['Tables']['user_product_prices'] & { Row: PublicSchema['Tables']['user_product_prices']['Row'] & { allow_zero_price: boolean } };
    };
    Functions: Omit<Functions, 'admin_prospecting_report_v1' | 'save_prospecting_record_v1'> & {
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
