// Generated from the Sobrew Supabase schema. Regenerate with npm run db:types.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounting_categories: {
        Row: {
          active: boolean
          category_type: string
          created_at: string
          display_order: number
          id: string
          is_system: boolean
          name: string
          pnl_section: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_type: string
          created_at?: string
          display_order?: number
          id?: string
          is_system?: boolean
          name: string
          pnl_section?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_type?: string
          created_at?: string
          display_order?: number
          id?: string
          is_system?: boolean
          name?: string
          pnl_section?: string
          updated_at?: string
        }
        Relationships: []
      }
      accounting_transaction_matches: {
        Row: {
          confidence: number
          created_at: string
          id: string
          match_status: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          target_id: string | null
          target_type: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          id?: string
          match_status?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          target_id?: string | null
          target_type: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          match_status?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          target_id?: string | null
          target_type?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_transaction_matches_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transaction_matches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_transaction_splits: {
        Row: {
          amount_cents: number
          category_id: string | null
          created_at: string
          id: string
          memo: string | null
          target_id: string | null
          target_type: string | null
          transaction_id: string
        }
        Insert: {
          amount_cents: number
          category_id?: string | null
          created_at?: string
          id?: string
          memo?: string | null
          target_id?: string | null
          target_type?: string | null
          transaction_id: string
        }
        Update: {
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          id?: string
          memo?: string | null
          target_id?: string | null
          target_type?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_transaction_splits_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "accounting_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transaction_splits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "accounting_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_transactions: {
        Row: {
          account_name: string | null
          account_type: string
          ai_review_flags: Json
          ai_review_model: string | null
          ai_review_prompt_version: string | null
          ai_review_status: string
          ai_review_summary: string | null
          ai_reviewed_at: string | null
          amount_cents: number
          category_id: string | null
          created_at: string
          external_id: string | null
          id: string
          merchant_name: string | null
          original_description: string
          posted_at: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_type: string
          status: string
          transaction_date: string
          transaction_fingerprint: string
          updated_at: string
          upload_batch_id: string | null
        }
        Insert: {
          account_name?: string | null
          account_type?: string
          ai_review_flags?: Json
          ai_review_model?: string | null
          ai_review_prompt_version?: string | null
          ai_review_status?: string
          ai_review_summary?: string | null
          ai_reviewed_at?: string | null
          amount_cents: number
          category_id?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          merchant_name?: string | null
          original_description: string
          posted_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_type?: string
          status?: string
          transaction_date: string
          transaction_fingerprint: string
          updated_at?: string
          upload_batch_id?: string | null
        }
        Update: {
          account_name?: string | null
          account_type?: string
          ai_review_flags?: Json
          ai_review_model?: string | null
          ai_review_prompt_version?: string | null
          ai_review_status?: string
          ai_review_summary?: string | null
          ai_reviewed_at?: string | null
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          merchant_name?: string | null
          original_description?: string
          posted_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_type?: string
          status?: string
          transaction_date?: string
          transaction_fingerprint?: string
          updated_at?: string
          upload_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "accounting_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_transactions_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "accounting_upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_upload_batches: {
        Row: {
          account_name: string | null
          account_type: string
          created_at: string
          file_name: string | null
          id: string
          notes: string | null
          source_type: string
          total_inflow_cents: number
          total_outflow_cents: number
          transaction_count: number
          uploaded_by: string | null
        }
        Insert: {
          account_name?: string | null
          account_type?: string
          created_at?: string
          file_name?: string | null
          id?: string
          notes?: string | null
          source_type?: string
          total_inflow_cents?: number
          total_outflow_cents?: number
          transaction_count?: number
          uploaded_by?: string | null
        }
        Update: {
          account_name?: string | null
          account_type?: string
          created_at?: string
          file_name?: string | null
          id?: string
          notes?: string | null
          source_type?: string
          total_inflow_cents?: number
          total_outflow_cents?: number
          transaction_count?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_upload_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_ai_business_qa: {
        Row: {
          answer_markdown: string
          archived_at: string | null
          as_of_date: string
          generated_at: string
          generated_by: string | null
          id: string
          input_summary_json: Json
          model: string
          prompt_version: string
          question: string
        }
        Insert: {
          answer_markdown: string
          archived_at?: string | null
          as_of_date: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          input_summary_json?: Json
          model: string
          prompt_version: string
          question: string
        }
        Update: {
          answer_markdown?: string
          archived_at?: string | null
          as_of_date?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          input_summary_json?: Json
          model?: string
          prompt_version?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_ai_business_qa_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_ai_business_reports: {
        Row: {
          as_of_date: string
          generated_at: string
          generated_by: string | null
          id: string
          input_summary_json: Json
          model: string
          prompt_version: string
          report_markdown: string
        }
        Insert: {
          as_of_date: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          input_summary_json?: Json
          model: string
          prompt_version: string
          report_markdown: string
        }
        Update: {
          as_of_date?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          input_summary_json?: Json
          model?: string
          prompt_version?: string
          report_markdown?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_ai_business_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          section_key: string | null
          target_profile_id: string | null
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          section_key?: string | null
          target_profile_id?: string | null
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          section_key?: string | null
          target_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_center_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          center_id: string
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          center_id: string
          profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          center_id?: string
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_center_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_center_assignments_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_center_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_center_assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_commission_settings: {
        Row: {
          active: boolean
          commission_percent: number
          created_at: string
          is_sales_rep: boolean
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          commission_percent?: number
          created_at?: string
          is_sales_rep?: boolean
          profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          commission_percent?: number
          created_at?: string
          is_sales_rep?: boolean
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_commission_settings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_commission_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_labor_tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          profile_id: string
          work_type: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          profile_id: string
          work_type: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          profile_id?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_labor_tag_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_labor_tag_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_payroll_locks: {
        Row: {
          created_at: string
          id: string
          lock_end_at: string
          lock_start_at: string
          locked_at: string
          locked_by: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lock_end_at: string
          lock_start_at: string
          locked_at?: string
          locked_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lock_end_at?: string
          lock_start_at?: string
          locked_at?: string
          locked_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_payroll_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          created_at: string
          profile_id: string
          section_key: string
          updated_at: string
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          profile_id: string
          section_key: string
          updated_at?: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          profile_id?: string
          section_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_permissions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_salary_payroll_payments: {
        Row: {
          approved_at: string
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          paid_at: string
          paid_by: string | null
          payroll_month: string
          period_end_date: string
          period_start_date: string
          profile_id: string
          salary_amount_cents: number
          salary_frequency: string
          salary_labor_work_type: string
          salary_pay_cents: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          payroll_month: string
          period_end_date: string
          period_start_date: string
          profile_id: string
          salary_amount_cents?: number
          salary_frequency?: string
          salary_labor_work_type?: string
          salary_pay_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          payroll_month?: string
          period_end_date?: string
          period_start_date?: string
          profile_id?: string
          salary_amount_cents?: number
          salary_frequency?: string
          salary_labor_work_type?: string
          salary_pay_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_salary_payroll_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_salary_payroll_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_salary_payroll_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_salary_payroll_payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_salary_payroll_payments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_time_breaks: {
        Row: {
          break_end_at: string | null
          break_start_at: string
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          manual_reason: string | null
          notes: string | null
          status: string
          time_entry_id: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          break_end_at?: string | null
          break_start_at: string
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_reason?: string | null
          notes?: string | null
          status?: string
          time_entry_id: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          break_end_at?: string | null
          break_start_at?: string
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_reason?: string | null
          notes?: string | null
          status?: string
          time_entry_id?: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_time_breaks_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_breaks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_breaks_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "admin_time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_breaks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_breaks_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_time_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          clock_in_at: string
          clock_out_at: string | null
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          correction_request_note: string | null
          created_at: string
          created_by: string | null
          hourly_rate_cents_snapshot: number
          id: string
          locked_at: string | null
          locked_by: string | null
          manual_reason: string | null
          notes: string | null
          profile_id: string
          status: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          work_type: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          clock_in_at: string
          clock_out_at?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          correction_request_note?: string | null
          created_at?: string
          created_by?: string | null
          hourly_rate_cents_snapshot?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          manual_reason?: string | null
          notes?: string | null
          profile_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          work_type?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          clock_in_at?: string
          clock_out_at?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          correction_request_note?: string | null
          created_at?: string
          created_by?: string | null
          hourly_rate_cents_snapshot?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          manual_reason?: string | null
          notes?: string | null
          profile_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_time_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entries_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entries_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entries_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_time_entry_allocations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          minutes: number
          notes: string | null
          production_run_id: string | null
          time_entry_id: string
          updated_at: string
          updated_by: string | null
          wage_cents: number
          work_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number
          notes?: string | null
          production_run_id?: string | null
          time_entry_id: string
          updated_at?: string
          updated_by?: string | null
          wage_cents?: number
          work_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number
          notes?: string | null
          production_run_id?: string | null
          time_entry_id?: string
          updated_at?: string
          updated_by?: string | null
          wage_cents?: number
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_time_entry_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entry_allocations_production_run_id_fkey"
            columns: ["production_run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entry_allocations_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "admin_time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_entry_allocations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_time_settings: {
        Row: {
          active: boolean
          compensation_type: string
          created_at: string
          hourly_rate_cents: number
          profile_id: string
          salary_amount_cents: number
          salary_frequency: string
          salary_labor_work_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          compensation_type?: string
          created_at?: string
          hourly_rate_cents?: number
          profile_id: string
          salary_amount_cents?: number
          salary_frequency?: string
          salary_labor_work_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          compensation_type?: string
          created_at?: string
          hourly_rate_cents?: number
          profile_id?: string
          salary_amount_cents?: number
          salary_frequency?: string
          salary_labor_work_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_time_settings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_time_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_weekly_sales_spiffs: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          profile_id: string
          updated_at: string
          updated_by: string | null
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          profile_id: string
          updated_at?: string
          updated_by?: string | null
          week_end_date: string
          week_start_date: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_weekly_sales_spiffs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_weekly_sales_spiffs_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_weekly_sales_spiffs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_weekly_sales_spiffs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          accent_color: string | null
          bootstrap_completed: boolean | null
          brand_name: string | null
          hero_image_url: string | null
          id: string
          logo_url: string | null
          quickbooks_product_reset_error: string | null
          quickbooks_product_reset_error_at: string | null
          quickbooks_product_reset_last_result: Json | null
          quickbooks_sales_tax_states: string[]
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          bootstrap_completed?: boolean | null
          brand_name?: string | null
          hero_image_url?: string | null
          id?: string
          logo_url?: string | null
          quickbooks_product_reset_error?: string | null
          quickbooks_product_reset_error_at?: string | null
          quickbooks_product_reset_last_result?: Json | null
          quickbooks_sales_tax_states?: string[]
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          bootstrap_completed?: boolean | null
          brand_name?: string | null
          hero_image_url?: string | null
          id?: string
          logo_url?: string | null
          quickbooks_product_reset_error?: string | null
          quickbooks_product_reset_error_at?: string | null
          quickbooks_product_reset_last_result?: Json | null
          quickbooks_sales_tax_states?: string[]
          updated_at?: string | null
        }
        Relationships: []
      }
      center_locations: {
        Row: {
          address1: string
          address2: string | null
          center_id: string
          city: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          state: string
          updated_at: string
          zip: string
        }
        Insert: {
          address1?: string
          address2?: string | null
          center_id: string
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          state?: string
          updated_at?: string
          zip?: string
        }
        Update: {
          address1?: string
          address2?: string | null
          center_id?: string
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          state?: string
          updated_at?: string
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "center_locations_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
        ]
      }
      center_sales_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          center_id: string
          sales_profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          center_id: string
          sales_profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          center_id?: string
          sales_profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "center_sales_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "center_sales_assignments_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: true
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "center_sales_assignments_sales_profile_id_fkey"
            columns: ["sales_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "center_sales_assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      centers: {
        Row: {
          billing_address1: string | null
          billing_address2: string | null
          billing_city: string | null
          billing_email: string | null
          billing_phone: string | null
          billing_state: string | null
          billing_zip: string | null
          created_at: string | null
          customer_tax_note: string | null
          customer_tax_status: string
          id: string
          is_active: boolean
          legal_name: string | null
          name: string
          notes: string | null
          quickbooks_company_name: string | null
          quickbooks_customer_id: string | null
          quickbooks_display_name: string | null
          quickbooks_fully_qualified_name: string | null
          quickbooks_mapping_note: string | null
          quickbooks_payment_method_brand: string | null
          quickbooks_payment_method_exp_month: string | null
          quickbooks_payment_method_exp_year: string | null
          quickbooks_payment_method_id: string | null
          quickbooks_payment_method_last4: string | null
          quickbooks_payment_method_note: string | null
          quickbooks_payment_method_type: string | null
          quickbooks_payment_method_updated_at: string | null
          quickbooks_sync_error: string | null
          quickbooks_sync_status: string
          quickbooks_synced_at: string | null
        }
        Insert: {
          billing_address1?: string | null
          billing_address2?: string | null
          billing_city?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          billing_state?: string | null
          billing_zip?: string | null
          created_at?: string | null
          customer_tax_note?: string | null
          customer_tax_status?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name: string
          notes?: string | null
          quickbooks_company_name?: string | null
          quickbooks_customer_id?: string | null
          quickbooks_display_name?: string | null
          quickbooks_fully_qualified_name?: string | null
          quickbooks_mapping_note?: string | null
          quickbooks_payment_method_brand?: string | null
          quickbooks_payment_method_exp_month?: string | null
          quickbooks_payment_method_exp_year?: string | null
          quickbooks_payment_method_id?: string | null
          quickbooks_payment_method_last4?: string | null
          quickbooks_payment_method_note?: string | null
          quickbooks_payment_method_type?: string | null
          quickbooks_payment_method_updated_at?: string | null
          quickbooks_sync_error?: string | null
          quickbooks_sync_status?: string
          quickbooks_synced_at?: string | null
        }
        Update: {
          billing_address1?: string | null
          billing_address2?: string | null
          billing_city?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          billing_state?: string | null
          billing_zip?: string | null
          created_at?: string | null
          customer_tax_note?: string | null
          customer_tax_status?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name?: string
          notes?: string | null
          quickbooks_company_name?: string | null
          quickbooks_customer_id?: string | null
          quickbooks_display_name?: string | null
          quickbooks_fully_qualified_name?: string | null
          quickbooks_mapping_note?: string | null
          quickbooks_payment_method_brand?: string | null
          quickbooks_payment_method_exp_month?: string | null
          quickbooks_payment_method_exp_year?: string | null
          quickbooks_payment_method_id?: string | null
          quickbooks_payment_method_last4?: string | null
          quickbooks_payment_method_note?: string | null
          quickbooks_payment_method_type?: string | null
          quickbooks_payment_method_updated_at?: string | null
          quickbooks_sync_error?: string | null
          quickbooks_sync_status?: string
          quickbooks_synced_at?: string | null
        }
        Relationships: []
      }
      cron_run_log: {
        Row: {
          active_recurring_count: number
          completed_at: string | null
          created_at: string
          created_count: number
          cron_schedule: string | null
          due_recurring_count: number
          error_count: number
          errors: Json
          force_run: boolean
          id: string
          invoked_at: string
          job_name: string
          request_method: string | null
          status: string
          user_agent: string | null
        }
        Insert: {
          active_recurring_count?: number
          completed_at?: string | null
          created_at?: string
          created_count?: number
          cron_schedule?: string | null
          due_recurring_count?: number
          error_count?: number
          errors?: Json
          force_run?: boolean
          id?: string
          invoked_at?: string
          job_name: string
          request_method?: string | null
          status?: string
          user_agent?: string | null
        }
        Update: {
          active_recurring_count?: number
          completed_at?: string | null
          created_at?: string
          created_count?: number
          cron_schedule?: string | null
          due_recurring_count?: number
          error_count?: number
          errors?: Json
          force_run?: boolean
          id?: string
          invoked_at?: string
          job_name?: string
          request_method?: string | null
          status?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      inventory_adjustments: {
        Row: {
          adjusted_at: string
          adjustment_type: string
          created_at: string
          id: string
          inventory_item_id: string
          lot_id: string | null
          notes: string | null
          quantity_change: number
          unit: string
          unit_cost_cents: number
        }
        Insert: {
          adjusted_at?: string
          adjustment_type: string
          created_at?: string
          id?: string
          inventory_item_id: string
          lot_id?: string | null
          notes?: string | null
          quantity_change: number
          unit: string
          unit_cost_cents?: number
        }
        Update: {
          adjusted_at?: string
          adjustment_type?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          lot_id?: string | null
          notes?: string | null
          quantity_change?: number
          unit?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_center_par_levels: {
        Row: {
          center_id: string
          minimum_qty: number
          notes: string | null
          par_qty: number
          product_id: string
          updated_at: string
        }
        Insert: {
          center_id: string
          minimum_qty?: number
          notes?: string | null
          par_qty?: number
          product_id: string
          updated_at?: string
        }
        Update: {
          center_id?: string
          minimum_qty?: number
          notes?: string | null
          par_qty?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_center_par_levels_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_center_par_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_center_par_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          active: boolean
          base_unit: string
          created_at: string
          description: string | null
          id: string
          item_type: string
          name: string
          product_id: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_unit: string
          created_at?: string
          description?: string | null
          id?: string
          item_type: string
          name: string
          product_id?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_unit?: string
          created_at?: string
          description?: string | null
          id?: string
          item_type?: string
          name?: string
          product_id?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          lot_code: string
          notes: string | null
          production_run_id: string | null
          quantity_received: number
          quantity_remaining: number
          received_at: string
          source_type: string
          unit_cost_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          lot_code: string
          notes?: string | null
          production_run_id?: string | null
          quantity_received: number
          quantity_remaining: number
          received_at?: string
          source_type?: string
          unit_cost_cents?: number
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          lot_code?: string
          notes?: string | null
          production_run_id?: string | null
          quantity_received?: number
          quantity_remaining?: number
          received_at?: string
          source_type?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_production_run_id_fkey"
            columns: ["production_run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          lot_id: string | null
          movement_type: string
          notes: string | null
          order_id: string | null
          order_item_id: string | null
          production_run_id: string | null
          quantity_change: number
          receipt_id: string | null
          sample_box_run_id: string | null
          sample_box_run_item_id: string | null
          unit: string
          unit_cost_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          lot_id?: string | null
          movement_type: string
          notes?: string | null
          order_id?: string | null
          order_item_id?: string | null
          production_run_id?: string | null
          quantity_change: number
          receipt_id?: string | null
          sample_box_run_id?: string | null
          sample_box_run_item_id?: string | null
          unit: string
          unit_cost_cents?: number
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          lot_id?: string | null
          movement_type?: string
          notes?: string | null
          order_id?: string | null
          order_item_id?: string | null
          production_run_id?: string | null
          quantity_change?: number
          receipt_id?: string | null
          sample_box_run_id?: string | null
          sample_box_run_item_id?: string | null
          unit?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_production_run_id_fkey"
            columns: ["production_run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "inventory_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_sample_box_run_id_fkey"
            columns: ["sample_box_run_id"]
            isOneToOne: false
            referencedRelation: "sample_box_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_sample_box_run_item_id_fkey"
            columns: ["sample_box_run_item_id"]
            isOneToOne: false
            referencedRelation: "sample_box_run_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_receipts: {
        Row: {
          created_at: string
          freight_cents: number
          id: string
          inventory_item_id: string
          item_unit_cost_cents: number
          landed_unit_cost_cents: number
          lot_id: string | null
          notes: string | null
          other_cost_cents: number
          quantity: number
          received_at: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          supplier: string | null
          unit: string
        }
        Insert: {
          created_at?: string
          freight_cents?: number
          id?: string
          inventory_item_id: string
          item_unit_cost_cents?: number
          landed_unit_cost_cents?: number
          lot_id?: string | null
          notes?: string | null
          other_cost_cents?: number
          quantity: number
          received_at?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          supplier?: string | null
          unit: string
        }
        Update: {
          created_at?: string
          freight_cents?: number
          id?: string
          inventory_item_id?: string
          item_unit_cost_cents?: number
          landed_unit_cost_cents?: number
          lot_id?: string | null
          notes?: string | null
          other_cost_cents?: number
          quantity?: number
          received_at?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          supplier?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_receipts_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_receipts_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_receipts_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_reorder_settings: {
        Row: {
          inventory_item_id: string
          lead_time_days: number
          notes: string | null
          preferred_supplier: string | null
          reorder_point: number
          target_stock: number
          updated_at: string
        }
        Insert: {
          inventory_item_id: string
          lead_time_days?: number
          notes?: string | null
          preferred_supplier?: string | null
          reorder_point?: number
          target_stock?: number
          updated_at?: string
        }
        Update: {
          inventory_item_id?: string
          lead_time_days?: number
          notes?: string | null
          preferred_supplier?: string | null
          reorder_point?: number
          target_stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reorder_settings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: true
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_weekly_recaps: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          next_week_notes: string | null
          profile_id: string
          results_notes: string | null
          updated_at: string
          updated_by: string | null
          week_end_date: string
          week_start_date: string
          work_notes: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          next_week_notes?: string | null
          profile_id: string
          results_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          week_end_date: string
          week_start_date: string
          work_notes?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          next_week_notes?: string | null
          profile_id?: string
          results_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          week_end_date?: string
          week_start_date?: string
          work_notes?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_weekly_recaps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_weekly_recaps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_weekly_recaps_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_commission_payouts: {
        Row: {
          commission_cents: number
          commission_month: string
          created_at: string
          donation_cogs_cents: number
          gross_profit_cents: number
          id: string
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          order_count: number
          paid_at: string | null
          paid_by: string | null
          processing_fee_cogs_cents: number
          product_cogs_cents: number
          revenue_cents: number
          sales_profile_id: string
          shipping_cogs_cents: number
          status: string
          total_cogs_cents: number
          updated_at: string
        }
        Insert: {
          commission_cents?: number
          commission_month: string
          created_at?: string
          donation_cogs_cents?: number
          gross_profit_cents?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          order_count?: number
          paid_at?: string | null
          paid_by?: string | null
          processing_fee_cogs_cents?: number
          product_cogs_cents?: number
          revenue_cents?: number
          sales_profile_id: string
          shipping_cogs_cents?: number
          status?: string
          total_cogs_cents?: number
          updated_at?: string
        }
        Update: {
          commission_cents?: number
          commission_month?: string
          created_at?: string
          donation_cogs_cents?: number
          gross_profit_cents?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          order_count?: number
          paid_at?: string | null
          paid_by?: string | null
          processing_fee_cogs_cents?: number
          product_cogs_cents?: number
          revenue_cents?: number
          sales_profile_id?: string
          shipping_cogs_cents?: number
          status?: string
          total_cogs_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_commission_payouts_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_commission_payouts_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_commission_payouts_sales_profile_id_fkey"
            columns: ["sales_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      non_inventory_expenses: {
        Row: {
          amount_cents: number
          created_at: string
          expense_type: string
          id: string
          notes: string | null
          spent_at: string
          vendor: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          expense_type: string
          id?: string
          notes?: string | null
          spent_at?: string
          vendor?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          expense_type?: string
          id?: string
          notes?: string | null
          spent_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      order_commission_snapshots: {
        Row: {
          center_id: string | null
          cogs_estimated: boolean
          commission_cents: number
          commission_month: string
          commission_percent: number
          created_at: string
          donation_cogs_cents: number
          gross_profit_cents: number
          id: string
          order_id: string
          processing_fee_cogs_cents: number
          product_cogs_cents: number
          revenue_cents: number
          sales_profile_id: string | null
          shipped_at: string
          shipping_cogs_cents: number
          snapshot_at: string
          total_cogs_cents: number
          updated_at: string
        }
        Insert: {
          center_id?: string | null
          cogs_estimated?: boolean
          commission_cents?: number
          commission_month: string
          commission_percent?: number
          created_at?: string
          donation_cogs_cents?: number
          gross_profit_cents?: number
          id?: string
          order_id: string
          processing_fee_cogs_cents?: number
          product_cogs_cents?: number
          revenue_cents?: number
          sales_profile_id?: string | null
          shipped_at: string
          shipping_cogs_cents?: number
          snapshot_at?: string
          total_cogs_cents?: number
          updated_at?: string
        }
        Update: {
          center_id?: string | null
          cogs_estimated?: boolean
          commission_cents?: number
          commission_month?: string
          commission_percent?: number
          created_at?: string
          donation_cogs_cents?: number
          gross_profit_cents?: number
          id?: string
          order_id?: string
          processing_fee_cogs_cents?: number
          product_cogs_cents?: number
          revenue_cents?: number
          sales_profile_id?: string | null
          shipped_at?: string
          shipping_cogs_cents?: number
          snapshot_at?: string
          total_cogs_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_commission_snapshots_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_commission_snapshots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_commission_snapshots_sales_profile_id_fkey"
            columns: ["sales_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_shipping_boxes: {
        Row: {
          cogs_estimated: boolean
          consumed_at: string | null
          created_at: string
          id: string
          inventory_item_id: string
          order_id: string
          order_item_id: string
          quantity: number
          total_cost_cents: number
          unit_cost_cents: number
          updated_at: string
        }
        Insert: {
          cogs_estimated?: boolean
          consumed_at?: string | null
          created_at?: string
          id?: string
          inventory_item_id: string
          order_id: string
          order_item_id: string
          quantity: number
          total_cost_cents?: number
          unit_cost_cents?: number
          updated_at?: string
        }
        Update: {
          cogs_estimated?: boolean
          consumed_at?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string
          order_id?: string
          order_item_id?: string
          quantity?: number
          total_cost_cents?: number
          unit_cost_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_shipping_boxes_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_shipping_boxes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_shipping_boxes_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cogs_branding_label_cents: number | null
          cogs_donation_cents: number | null
          cogs_estimated: boolean
          cogs_fixed_cents: number | null
          cogs_fixed_other_cents: number | null
          cogs_labor_cents: number | null
          cogs_material_cents: number | null
          cogs_processing_fee_cents: number | null
          cogs_product_cents: number | null
          cogs_shipping_cents: number | null
          cogs_shipping_label_cents: number | null
          cogs_snapshot_at: string | null
          cogs_source: string | null
          cogs_tape_cents: number | null
          cogs_total_cents: number | null
          cogs_unit_cents: number | null
          id: string
          line_total_cents: number
          order_id: string | null
          product_id: string | null
          product_name_snapshot: string | null
          qty: number
          shipping_boxes_used: number | null
          unit_price_cents: number
        }
        Insert: {
          cogs_branding_label_cents?: number | null
          cogs_donation_cents?: number | null
          cogs_estimated?: boolean
          cogs_fixed_cents?: number | null
          cogs_fixed_other_cents?: number | null
          cogs_labor_cents?: number | null
          cogs_material_cents?: number | null
          cogs_processing_fee_cents?: number | null
          cogs_product_cents?: number | null
          cogs_shipping_cents?: number | null
          cogs_shipping_label_cents?: number | null
          cogs_snapshot_at?: string | null
          cogs_source?: string | null
          cogs_tape_cents?: number | null
          cogs_total_cents?: number | null
          cogs_unit_cents?: number | null
          id?: string
          line_total_cents: number
          order_id?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          qty: number
          shipping_boxes_used?: number | null
          unit_price_cents: number
        }
        Update: {
          cogs_branding_label_cents?: number | null
          cogs_donation_cents?: number | null
          cogs_estimated?: boolean
          cogs_fixed_cents?: number | null
          cogs_fixed_other_cents?: number | null
          cogs_labor_cents?: number | null
          cogs_material_cents?: number | null
          cogs_processing_fee_cents?: number | null
          cogs_product_cents?: number | null
          cogs_shipping_cents?: number | null
          cogs_shipping_label_cents?: number | null
          cogs_snapshot_at?: string | null
          cogs_source?: string | null
          cogs_tape_cents?: number | null
          cogs_total_cents?: number | null
          cogs_unit_cents?: number | null
          id?: string
          line_total_cents?: number
          order_id?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          qty?: number
          shipping_boxes_used?: number | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          archived_at: string | null
          center_id: string | null
          center_location_id: string | null
          created_at: string | null
          donation_cogs_cents: number
          fulfillment_method: string
          id: string
          invoice_error: string | null
          invoice_status: string
          invoiced_at: string | null
          notes: string | null
          order_kind: string
          processing_fee_cents: number
          prospecting_lead_id: string | null
          quickbooks_invoice_doc_number: string | null
          quickbooks_invoice_email_sent_at: string | null
          quickbooks_invoice_email_to: string | null
          quickbooks_invoice_id: string | null
          quickbooks_invoice_url: string | null
          quickbooks_payment_charge_id: string | null
          quickbooks_payment_charged_at: string | null
          quickbooks_payment_error: string | null
          quickbooks_payment_id: string | null
          quickbooks_payment_method_label: string | null
          quickbooks_payment_method_type: string | null
          quickbooks_payment_status: string | null
          quickbooks_receipt_email_sent_at: string | null
          quickbooks_receipt_email_to: string | null
          recurring_order_id: string | null
          recurring_scheduled_for: string | null
          shipped_at: string | null
          shipping_address1: string | null
          shipping_address2: string | null
          shipping_city: string | null
          shipping_company: string | null
          shipping_cost_cents: number | null
          shipping_name: string | null
          shipping_state: string | null
          shipping_zip: string | null
          status: string | null
          submission_id: string | null
          subtotal_cents: number
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          center_id?: string | null
          center_location_id?: string | null
          created_at?: string | null
          donation_cogs_cents?: number
          fulfillment_method?: string
          id?: string
          invoice_error?: string | null
          invoice_status?: string
          invoiced_at?: string | null
          notes?: string | null
          order_kind?: string
          processing_fee_cents?: number
          prospecting_lead_id?: string | null
          quickbooks_invoice_doc_number?: string | null
          quickbooks_invoice_email_sent_at?: string | null
          quickbooks_invoice_email_to?: string | null
          quickbooks_invoice_id?: string | null
          quickbooks_invoice_url?: string | null
          quickbooks_payment_charge_id?: string | null
          quickbooks_payment_charged_at?: string | null
          quickbooks_payment_error?: string | null
          quickbooks_payment_id?: string | null
          quickbooks_payment_method_label?: string | null
          quickbooks_payment_method_type?: string | null
          quickbooks_payment_status?: string | null
          quickbooks_receipt_email_sent_at?: string | null
          quickbooks_receipt_email_to?: string | null
          recurring_order_id?: string | null
          recurring_scheduled_for?: string | null
          shipped_at?: string | null
          shipping_address1?: string | null
          shipping_address2?: string | null
          shipping_city?: string | null
          shipping_company?: string | null
          shipping_cost_cents?: number | null
          shipping_name?: string | null
          shipping_state?: string | null
          shipping_zip?: string | null
          status?: string | null
          submission_id?: string | null
          subtotal_cents?: number
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          center_id?: string | null
          center_location_id?: string | null
          created_at?: string | null
          donation_cogs_cents?: number
          fulfillment_method?: string
          id?: string
          invoice_error?: string | null
          invoice_status?: string
          invoiced_at?: string | null
          notes?: string | null
          order_kind?: string
          processing_fee_cents?: number
          prospecting_lead_id?: string | null
          quickbooks_invoice_doc_number?: string | null
          quickbooks_invoice_email_sent_at?: string | null
          quickbooks_invoice_email_to?: string | null
          quickbooks_invoice_id?: string | null
          quickbooks_invoice_url?: string | null
          quickbooks_payment_charge_id?: string | null
          quickbooks_payment_charged_at?: string | null
          quickbooks_payment_error?: string | null
          quickbooks_payment_id?: string | null
          quickbooks_payment_method_label?: string | null
          quickbooks_payment_method_type?: string | null
          quickbooks_payment_status?: string | null
          quickbooks_receipt_email_sent_at?: string | null
          quickbooks_receipt_email_to?: string | null
          recurring_order_id?: string | null
          recurring_scheduled_for?: string | null
          shipped_at?: string | null
          shipping_address1?: string | null
          shipping_address2?: string | null
          shipping_city?: string | null
          shipping_company?: string | null
          shipping_cost_cents?: number | null
          shipping_name?: string | null
          shipping_state?: string | null
          shipping_zip?: string | null
          status?: string | null
          submission_id?: string | null
          subtotal_cents?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_center_location_id_fkey"
            columns: ["center_location_id"]
            isOneToOne: false
            referencedRelation: "center_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_prospecting_lead_id_fkey"
            columns: ["prospecting_lead_id"]
            isOneToOne: false
            referencedRelation: "prospecting_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_recurring_order_id_fkey"
            columns: ["recurring_order_id"]
            isOneToOne: false
            referencedRelation: "recurring_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipe_components: {
        Row: {
          component_role: string | null
          id: string
          inventory_item_id: string
          notes: string | null
          quantity: number
          recipe_id: string
          sort_order: number
          unit: string
        }
        Insert: {
          component_role?: string | null
          id?: string
          inventory_item_id: string
          notes?: string | null
          quantity: number
          recipe_id: string
          sort_order?: number
          unit: string
        }
        Update: {
          component_role?: string | null
          id?: string
          inventory_item_id?: string
          notes?: string | null
          quantity?: number
          recipe_id?: string
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_recipe_components_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipe_components_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "product_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipes: {
        Row: {
          branding_label_qty: number
          created_at: string
          id: string
          labor_minutes: number
          labor_rate_cents: number
          notes: string | null
          output_qty: number
          product_id: string
          shipping_label_qty: number
          updated_at: string
          waste_percent: number
        }
        Insert: {
          branding_label_qty?: number
          created_at?: string
          id?: string
          labor_minutes?: number
          labor_rate_cents?: number
          notes?: string | null
          output_qty?: number
          product_id: string
          shipping_label_qty?: number
          updated_at?: string
          waste_percent?: number
        }
        Update: {
          branding_label_qty?: number
          created_at?: string
          id?: string
          labor_minutes?: number
          labor_rate_cents?: number
          notes?: string | null
          output_qty?: number
          product_id?: string
          shipping_label_qty?: number
          updated_at?: string
          waste_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_run_inputs: {
        Row: {
          cost_cents: number
          id: string
          inventory_item_id: string
          production_run_id: string
          quantity_expected: number
          quantity_used: number
          unit: string
        }
        Insert: {
          cost_cents?: number
          id?: string
          inventory_item_id: string
          production_run_id: string
          quantity_expected?: number
          quantity_used: number
          unit: string
        }
        Update: {
          cost_cents?: number
          id?: string
          inventory_item_id?: string
          production_run_id?: string
          quantity_expected?: number
          quantity_used?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_run_inputs_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_run_inputs_production_run_id_fkey"
            columns: ["production_run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      production_run_voids: {
        Row: {
          created_at: string
          id: string
          production_run_id: string
          quantity_voided: number
          reason: string
          voided_at: string
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          production_run_id: string
          quantity_voided: number
          reason: string
          voided_at?: string
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          production_run_id?: string
          quantity_voided?: number
          reason?: string
          voided_at?: string
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_run_voids_production_run_id_fkey"
            columns: ["production_run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_run_voids_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_runs: {
        Row: {
          actual_labor_cost_cents: number
          actual_unit_cost_cents: number | null
          created_at: string
          estimated_unit_cost_cents: number | null
          expected_labor_cost_cents: number
          finished_lot_id: string | null
          fixed_branding_label_cost_cents: number
          fixed_cost_cents: number
          fixed_other_cost_cents: number
          fixed_shipping_label_cost_cents: number
          fixed_tape_cost_cents: number
          id: string
          labor_minutes: number
          labor_rate_cents: number
          notes: string | null
          produced_at: string
          product_id: string
          quantity_produced: number
          quantity_voided: number
          status: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          waste_quantity: number
        }
        Insert: {
          actual_labor_cost_cents?: number
          actual_unit_cost_cents?: number | null
          created_at?: string
          estimated_unit_cost_cents?: number | null
          expected_labor_cost_cents?: number
          finished_lot_id?: string | null
          fixed_branding_label_cost_cents?: number
          fixed_cost_cents?: number
          fixed_other_cost_cents?: number
          fixed_shipping_label_cost_cents?: number
          fixed_tape_cost_cents?: number
          id?: string
          labor_minutes?: number
          labor_rate_cents?: number
          notes?: string | null
          produced_at?: string
          product_id: string
          quantity_produced: number
          quantity_voided?: number
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          waste_quantity?: number
        }
        Update: {
          actual_labor_cost_cents?: number
          actual_unit_cost_cents?: number | null
          created_at?: string
          estimated_unit_cost_cents?: number | null
          expected_labor_cost_cents?: number
          finished_lot_id?: string | null
          fixed_branding_label_cost_cents?: number
          fixed_cost_cents?: number
          fixed_other_cost_cents?: number
          fixed_shipping_label_cost_cents?: number
          fixed_tape_cost_cents?: number
          id?: string
          labor_minutes?: number
          labor_rate_cents?: number
          notes?: string | null
          produced_at?: string
          product_id?: string
          quantity_produced?: number
          quantity_voided?: number
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          waste_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_runs_finished_lot_id_fkey"
            columns: ["finished_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_runs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_runs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_runs_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          name: string
          quickbooks_item_id: string | null
          quickbooks_item_name: string | null
          quickbooks_item_type: string | null
          quickbooks_sync_error: string | null
          quickbooks_sync_status: string
          quickbooks_synced_at: string | null
          receivable_finished_good: boolean
          shipping_box_count_required: boolean
          sku: string
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          quickbooks_item_id?: string | null
          quickbooks_item_name?: string | null
          quickbooks_item_type?: string | null
          quickbooks_sync_error?: string | null
          quickbooks_sync_status?: string
          quickbooks_synced_at?: string | null
          receivable_finished_good?: boolean
          shipping_box_count_required?: boolean
          sku: string
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          quickbooks_item_id?: string | null
          quickbooks_item_name?: string | null
          quickbooks_item_type?: string | null
          quickbooks_sync_error?: string | null
          quickbooks_sync_status?: string
          quickbooks_synced_at?: string | null
          receivable_finished_good?: boolean
          shipping_box_count_required?: boolean
          sku?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          center_id: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          is_admin: boolean | null
          is_superadmin: boolean
          last_seen_at: string | null
          notes: string | null
        }
        Insert: {
          avatar_url?: string | null
          center_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          is_admin?: boolean | null
          is_superadmin?: boolean
          last_seen_at?: string | null
          notes?: string | null
        }
        Update: {
          avatar_url?: string | null
          center_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_admin?: boolean | null
          is_superadmin?: boolean
          last_seen_at?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_activities: {
        Row: {
          activity_type: string
          body: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          hubspot_note_id: string | null
          id: string
          lead_id: string
          next_follow_up_at: string | null
          next_stage: string | null
          previous_assigned_profile_id: string | null
          previous_stage: string | null
          result: string | null
        }
        Insert: {
          activity_type: string
          body?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          hubspot_note_id?: string | null
          id?: string
          lead_id: string
          next_follow_up_at?: string | null
          next_stage?: string | null
          previous_assigned_profile_id?: string | null
          previous_stage?: string | null
          result?: string | null
        }
        Update: {
          activity_type?: string
          body?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          hubspot_note_id?: string | null
          id?: string
          lead_id?: string
          next_follow_up_at?: string | null
          next_stage?: string | null
          previous_assigned_profile_id?: string | null
          previous_stage?: string | null
          result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "prospecting_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "prospecting_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_activities_previous_assigned_profile_id_fkey"
            columns: ["previous_assigned_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string | null
          id: string
          is_primary: boolean
          lead_id: string
          notes: string | null
          phone: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_primary?: boolean
          lead_id: string
          notes?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_primary?: boolean
          lead_id?: string
          notes?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "prospecting_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_duplicate_reviews: {
        Row: {
          company_name: string | null
          created_at: string
          existing_lead_id: string | null
          id: string
          import_id: string | null
          list_id: string | null
          phone: string | null
          raw_payload: Json
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          row_number: number
          status: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          existing_lead_id?: string | null
          id?: string
          import_id?: string | null
          list_id?: string | null
          phone?: string | null
          raw_payload?: Json
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          row_number: number
          status?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          existing_lead_id?: string | null
          id?: string
          import_id?: string | null
          list_id?: string | null
          phone?: string | null
          raw_payload?: Json
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          row_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_duplicate_reviews_existing_lead_id_fkey"
            columns: ["existing_lead_id"]
            isOneToOne: false
            referencedRelation: "prospecting_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_duplicate_reviews_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "prospecting_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_duplicate_reviews_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "prospecting_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_duplicate_reviews_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_hubspot_queue: {
        Row: {
          exported_at: string | null
          exported_by: string | null
          lead_id: string
          notes: string | null
          queued_at: string
          queued_by: string | null
          queued_stage: string
          status: string
        }
        Insert: {
          exported_at?: string | null
          exported_by?: string | null
          lead_id: string
          notes?: string | null
          queued_at?: string
          queued_by?: string | null
          queued_stage: string
          status?: string
        }
        Update: {
          exported_at?: string | null
          exported_by?: string | null
          lead_id?: string
          notes?: string | null
          queued_at?: string
          queued_by?: string | null
          queued_stage?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_hubspot_queue_exported_by_fkey"
            columns: ["exported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_hubspot_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "prospecting_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_hubspot_queue_queued_by_fkey"
            columns: ["queued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_imports: {
        Row: {
          created_at: string
          error_summary: string | null
          file_name: string | null
          id: string
          inserted_count: number
          list_id: string | null
          review_count: number
          skipped_count: number
          status: string
          updated_count: number
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error_summary?: string | null
          file_name?: string | null
          id?: string
          inserted_count?: number
          list_id?: string | null
          review_count?: number
          skipped_count?: number
          status?: string
          updated_count?: number
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error_summary?: string | null
          file_name?: string | null
          id?: string
          inserted_count?: number
          list_id?: string | null
          review_count?: number
          skipped_count?: number
          status?: string
          updated_count?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_imports_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "prospecting_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_imports_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_leads: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          assigned_profile_id: string | null
          city: string | null
          company_email: string | null
          company_name: string
          company_name_key: string
          company_website: string | null
          country: string | null
          created_at: string
          created_by: string | null
          do_not_contact: boolean
          hubspot_company_id: string | null
          hubspot_contact_id: string | null
          hubspot_deal_id: string | null
          hubspot_exported_at: string | null
          hubspot_exported_by: string | null
          hubspot_last_push_attempt_at: string | null
          hubspot_last_push_error: string | null
          hubspot_note_id: string | null
          hubspot_status: string
          id: string
          last_activity_at: string | null
          last_result: string | null
          next_follow_up_at: string | null
          notes: string | null
          phone: string | null
          phone_key: string
          postal_code: string | null
          priority: string
          source: string | null
          stage: string
          state: string | null
          state_key: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_profile_id?: string | null
          city?: string | null
          company_email?: string | null
          company_name: string
          company_name_key: string
          company_website?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          do_not_contact?: boolean
          hubspot_company_id?: string | null
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          hubspot_exported_at?: string | null
          hubspot_exported_by?: string | null
          hubspot_last_push_attempt_at?: string | null
          hubspot_last_push_error?: string | null
          hubspot_note_id?: string | null
          hubspot_status?: string
          id?: string
          last_activity_at?: string | null
          last_result?: string | null
          next_follow_up_at?: string | null
          notes?: string | null
          phone?: string | null
          phone_key?: string
          postal_code?: string | null
          priority?: string
          source?: string | null
          stage?: string
          state?: string | null
          state_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_profile_id?: string | null
          city?: string | null
          company_email?: string | null
          company_name?: string
          company_name_key?: string
          company_website?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          do_not_contact?: boolean
          hubspot_company_id?: string | null
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          hubspot_exported_at?: string | null
          hubspot_exported_by?: string | null
          hubspot_last_push_attempt_at?: string | null
          hubspot_last_push_error?: string | null
          hubspot_note_id?: string | null
          hubspot_status?: string
          id?: string
          last_activity_at?: string | null
          last_result?: string | null
          next_follow_up_at?: string | null
          notes?: string | null
          phone?: string | null
          phone_key?: string
          postal_code?: string | null
          priority?: string
          source?: string | null
          stage?: string
          state?: string | null
          state_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_leads_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_leads_assigned_profile_id_fkey"
            columns: ["assigned_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_leads_hubspot_exported_by_fkey"
            columns: ["hubspot_exported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_leads_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_list_leads: {
        Row: {
          added_at: string
          added_by: string | null
          import_id: string | null
          lead_id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          import_id?: string | null
          lead_id: string
          list_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          import_id?: string | null
          lead_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_list_leads_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_list_leads_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "prospecting_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_list_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "prospecting_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_list_leads_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "prospecting_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_lists: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          source: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          source?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          source?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_lists_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_connections: {
        Row: {
          access_token: string
          access_token_expires_at: string
          connected_at: string
          connected_by: string | null
          environment: string
          id: string
          realm_id: string
          refresh_token: string
          refresh_token_expires_at: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          connected_at?: string
          connected_by?: string | null
          environment?: string
          id?: string
          realm_id: string
          refresh_token: string
          refresh_token_expires_at?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          connected_at?: string
          connected_by?: string | null
          environment?: string
          id?: string
          realm_id?: string
          refresh_token?: string
          refresh_token_expires_at?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_order_items: {
        Row: {
          id: string
          line_total_cents: number
          product_id: string | null
          product_name_snapshot: string | null
          qty: number
          recurring_order_id: string
          unit_price_cents: number
        }
        Insert: {
          id?: string
          line_total_cents: number
          product_id?: string | null
          product_name_snapshot?: string | null
          qty: number
          recurring_order_id: string
          unit_price_cents: number
        }
        Update: {
          id?: string
          line_total_cents?: number
          product_id?: string | null
          product_name_snapshot?: string | null
          qty?: number
          recurring_order_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recurring_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_order_items_recurring_order_id_fkey"
            columns: ["recurring_order_id"]
            isOneToOne: false
            referencedRelation: "recurring_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_orders: {
        Row: {
          active: boolean
          amount_cents: number
          center_id: string | null
          created_at: string | null
          frequency: string
          id: string
          last_generated_at: string | null
          next_run_at: string | null
          source_order_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          amount_cents: number
          center_id?: string | null
          created_at?: string | null
          frequency: string
          id?: string
          last_generated_at?: string | null
          next_run_at?: string | null
          source_order_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          amount_cents?: number
          center_id?: string | null
          created_at?: string | null
          frequency?: string
          id?: string
          last_generated_at?: string | null
          next_run_at?: string | null
          source_order_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_orders_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_orders_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_prospecting_blocks: {
        Row: {
          activity_date: string
          block_label: string | null
          calls_contact: number
          calls_email: number
          calls_no_contact: number
          calls_text: number
          calls_voicemail: number
          created_at: string
          created_by: string | null
          deals_closed: number
          id: string
          notes: string | null
          samples_from_contact: number
          samples_from_email_reply: number
          samples_from_text_reply: number
          samples_from_voicemail_callback: number
          samples_other: number
          updated_at: string
        }
        Insert: {
          activity_date: string
          block_label?: string | null
          calls_contact?: number
          calls_email?: number
          calls_no_contact?: number
          calls_text?: number
          calls_voicemail?: number
          created_at?: string
          created_by?: string | null
          deals_closed?: number
          id?: string
          notes?: string | null
          samples_from_contact?: number
          samples_from_email_reply?: number
          samples_from_text_reply?: number
          samples_from_voicemail_callback?: number
          samples_other?: number
          updated_at?: string
        }
        Update: {
          activity_date?: string
          block_label?: string | null
          calls_contact?: number
          calls_email?: number
          calls_no_contact?: number
          calls_text?: number
          calls_voicemail?: number
          created_at?: string
          created_by?: string | null
          deals_closed?: number
          id?: string
          notes?: string | null
          samples_from_contact?: number
          samples_from_email_reply?: number
          samples_from_text_reply?: number
          samples_from_voicemail_callback?: number
          samples_other?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_prospecting_blocks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_prospecting_followup_blocks: {
        Row: {
          activity_date: string
          block_label: string | null
          created_at: string
          created_by: string | null
          deals_closed_email: number
          deals_closed_phone: number
          deals_closed_text: number
          deals_lost_email: number
          deals_lost_phone: number
          deals_lost_text: number
          followups_email: number
          followups_phone: number
          followups_text: number
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          activity_date: string
          block_label?: string | null
          created_at?: string
          created_by?: string | null
          deals_closed_email?: number
          deals_closed_phone?: number
          deals_closed_text?: number
          deals_lost_email?: number
          deals_lost_phone?: number
          deals_lost_text?: number
          followups_email?: number
          followups_phone?: number
          followups_text?: number
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          activity_date?: string
          block_label?: string | null
          created_at?: string
          created_by?: string | null
          deals_closed_email?: number
          deals_closed_phone?: number
          deals_closed_text?: number
          deals_lost_email?: number
          deals_lost_phone?: number
          deals_lost_text?: number
          followups_email?: number
          followups_phone?: number
          followups_text?: number
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_prospecting_followup_blocks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_box_run_items: {
        Row: {
          cogs_estimated: boolean
          created_at: string
          id: string
          inventory_item_id: string | null
          item_kind: string
          label: string | null
          notes: string | null
          product_id: string | null
          quantity: number
          run_id: string
          total_cost_cents: number
          unit: string
          unit_cost_cents: number
        }
        Insert: {
          cogs_estimated?: boolean
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_kind: string
          label?: string | null
          notes?: string | null
          product_id?: string | null
          quantity: number
          run_id: string
          total_cost_cents?: number
          unit: string
          unit_cost_cents?: number
        }
        Update: {
          cogs_estimated?: boolean
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_kind?: string
          label?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number
          run_id?: string
          total_cost_cents?: number
          unit?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "sample_box_run_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_run_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sample_box_run_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sample_box_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_box_runs: {
        Row: {
          center_id: string | null
          cogs_estimated: boolean
          created_at: string
          created_by: string | null
          fixed_misc_cents: number
          fixed_shipping_cents: number
          id: string
          inventory_cogs_cents: number
          notes: string | null
          product_cogs_cents: number
          prospect_name: string | null
          quantity_boxes: number
          sales_profile_id: string | null
          sent_at: string
          template_id: string | null
          total_cogs_cents: number
        }
        Insert: {
          center_id?: string | null
          cogs_estimated?: boolean
          created_at?: string
          created_by?: string | null
          fixed_misc_cents?: number
          fixed_shipping_cents?: number
          id?: string
          inventory_cogs_cents?: number
          notes?: string | null
          product_cogs_cents?: number
          prospect_name?: string | null
          quantity_boxes?: number
          sales_profile_id?: string | null
          sent_at?: string
          template_id?: string | null
          total_cogs_cents?: number
        }
        Update: {
          center_id?: string | null
          cogs_estimated?: boolean
          created_at?: string
          created_by?: string | null
          fixed_misc_cents?: number
          fixed_shipping_cents?: number
          id?: string
          inventory_cogs_cents?: number
          notes?: string | null
          product_cogs_cents?: number
          prospect_name?: string | null
          quantity_boxes?: number
          sales_profile_id?: string | null
          sent_at?: string
          template_id?: string | null
          total_cogs_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "sample_box_runs_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_runs_sales_profile_id_fkey"
            columns: ["sales_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "sample_box_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_box_template_items: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string | null
          item_kind: string
          label: string | null
          notes: string | null
          product_id: string | null
          quantity: number
          sort_order: number
          system_key: string | null
          template_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_kind: string
          label?: string | null
          notes?: string | null
          product_id?: string | null
          quantity: number
          sort_order?: number
          system_key?: string | null
          template_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_kind?: string
          label?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number
          sort_order?: number
          system_key?: string | null
          template_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sample_box_template_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_template_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sample_box_template_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "sample_box_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_box_templates: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          fixed_misc_cents: number
          fixed_shipping_cents: number
          id: string
          key: string | null
          name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          fixed_misc_cents?: number
          fixed_shipping_cents?: number
          id?: string
          key?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          fixed_misc_cents?: number
          fixed_shipping_cents?: number
          id?: string
          key?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sample_box_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_box_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_product_prices: {
        Row: {
          center_id: string
          price_cents: number
          product_id: string
          user_id: string | null
        }
        Insert: {
          center_id: string
          price_cents: number
          product_id: string
          user_id?: string | null
        }
        Update: {
          center_id?: string
          price_cents?: number
          product_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_product_prices_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "user_product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_product_prices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_products: {
        Row: {
          center_id: string
          product_id: string
          user_id: string | null
        }
        Insert: {
          center_id: string
          product_id: string
          user_id?: string | null
        }
        Update: {
          center_id?: string
          product_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_products_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "portal_catalog"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "user_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_products_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      portal_catalog: {
        Row: {
          category: string | null
          current_price_cents: number | null
          description: string | null
          image_url: string | null
          name: string | null
          product_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_prospecting_report_v1: {
        Args: {
          p_as_of_date: string
          p_center_ids: string[]
          p_range_end_exclusive: string
          p_range_start: string
          p_sales_profile_id: string
        }
        Returns: Json
      }
      assign_quickbooks_invoice_doc_number: {
        Args: { order_id: string }
        Returns: string
      }
      current_center_id: { Args: never; Returns: string }
      delete_order_and_restore_inventory: {
        Args: { p_order_id: string }
        Returns: {
          order_id: string
          recurring_source_count: number
          restored_lot_count: number
          restored_movement_count: number
        }[]
      }
      generate_recurring_order: {
        Args: { p_recurring_order_id: string; p_scheduled_for: string }
        Returns: {
          center_id: string
          center_location_id: string
          order_id: string
          placed_items: Json
          scheduled_for: string
          shipping_address1: string
          shipping_address2: string
          shipping_city: string
          shipping_name: string
          shipping_state: string
          shipping_zip: string
          subtotal_cents: number
          user_id: string
          was_created: boolean
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_owner_admin: { Args: never; Returns: boolean }
      place_portal_order: {
        Args: {
          items: Json
          location_id: string
          notes: string
          submission_id: string
        }
        Returns: {
          center_location_id: string
          order_id: string
          placed_items: Json
          shipping_address1: string
          shipping_address2: string
          shipping_city: string
          shipping_name: string
          shipping_state: string
          shipping_zip: string
          subtotal_cents: number
          was_created: boolean
        }[]
      }
      record_inventory_production_run: {
        Args: {
          p_actual_labor_cost_cents?: number
          p_components: Json
          p_estimated_unit_cost_cents: number
          p_expected_labor_cost_cents?: number
          p_fixed_branding_label_cost_cents?: number
          p_fixed_cost_cents?: number
          p_fixed_other_cost_cents?: number
          p_fixed_shipping_label_cost_cents?: number
          p_fixed_tape_cost_cents?: number
          p_labor_minutes?: number
          p_labor_rate_cents?: number
          p_notes: string
          p_product_id: string
          p_quantity_produced: number
          p_waste_quantity: number
        }
        Returns: string
      }
      reverse_inventory_receipt: {
        Args: { p_reason: string; p_receipt_id: string }
        Returns: string
      }
      save_prospecting_record_v1: {
        Args: {
          p_activity?: Json
          p_actor_id: string
          p_audit_activities?: Json
          p_contact_updates?: Json
          p_expected_updated_at: string
          p_lead: Json
          p_lead_id: string
          p_new_contact?: Json
        }
        Returns: Json
      }
      touch_profile_last_seen: { Args: never; Returns: string }
      void_inventory_production_run: {
        Args: {
          p_production_run_id: string
          p_quantity_to_void: number
          p_reason: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

