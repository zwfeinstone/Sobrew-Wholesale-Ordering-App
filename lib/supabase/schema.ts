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
      order_trash: { Row: OrderTrashRow; Insert: never; Update: never; Relationships: [] };
      order_activity: { Row: { id: string; order_id: string; center_id: string | null; actor_name: string | null; action: string; before_value: Json; after_value: Json; created_at: string }; Insert: never; Update: never; Relationships: [] };
      user_product_prices: PublicSchema['Tables']['user_product_prices'] & { Row: PublicSchema['Tables']['user_product_prices']['Row'] & { allow_zero_price: boolean } };
    };
    Functions: Omit<Functions, 'admin_prospecting_report_v1' | 'save_prospecting_record_v1'> & {
      admin_prospecting_report_v1: NullableArgs<Functions['admin_prospecting_report_v1'], 'p_center_ids' | 'p_sales_profile_id'>;
      save_prospecting_record_v1: NullableArgs<Functions['save_prospecting_record_v1'], 'p_expected_updated_at'>;
      move_order_to_trash: { Args: { p_order_id: string; p_reason: string }; Returns: string };
      restore_order_from_trash: { Args: { p_trash_id: string }; Returns: string };
      save_center_catalog: { Args: { p_center_id: string; p_entries: Json }; Returns: undefined };
    };
  };
};
