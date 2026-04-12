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
      ab_ledger: {
        Row: {
          agent_id: string | null
          amount: number
          branch_id: string | null
          category: Database["public"]["Enums"]["ledger_category"]
          counterparty_id: string | null
          counterparty_type: Database["public"]["Enums"]["ledger_counterparty_type"]
          created_at: string
          created_by_admin_id: string | null
          description: string | null
          id: string
          policy_id: string | null
          policy_type: string | null
          reference_id: string
          reference_type: Database["public"]["Enums"]["ledger_reference_type"]
          reversal_of: string | null
          reversed_by: string | null
          status: Database["public"]["Enums"]["ledger_status"]
          transaction_date: string
        }
        Insert: {
          agent_id?: string | null
          amount: number
          branch_id?: string | null
          category: Database["public"]["Enums"]["ledger_category"]
          counterparty_id?: string | null
          counterparty_type: Database["public"]["Enums"]["ledger_counterparty_type"]
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          id?: string
          policy_id?: string | null
          policy_type?: string | null
          reference_id: string
          reference_type: Database["public"]["Enums"]["ledger_reference_type"]
          reversal_of?: string | null
          reversed_by?: string | null
          status?: Database["public"]["Enums"]["ledger_status"]
          transaction_date?: string
        }
        Update: {
          agent_id?: string | null
          amount?: number
          branch_id?: string | null
          category?: Database["public"]["Enums"]["ledger_category"]
          counterparty_id?: string | null
          counterparty_type?: Database["public"]["Enums"]["ledger_counterparty_type"]
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          id?: string
          policy_id?: string | null
          policy_type?: string | null
          reference_id?: string
          reference_type?: Database["public"]["Enums"]["ledger_reference_type"]
          reversal_of?: string | null
          reversed_by?: string | null
          status?: Database["public"]["Enums"]["ledger_status"]
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ab_ledger_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_ledger_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_ledger_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "ab_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_ledger_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "ab_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_fee_services: {
        Row: {
          active: boolean
          agent_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          name_ar: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          name_ar?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          name_ar?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accident_fee_services_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_injured_persons: {
        Row: {
          accident_report_id: string
          agent_id: string | null
          created_at: string | null
          id: string
          injured_address: string | null
          injured_age: number | null
          injured_name: string
          injured_occupation: string | null
          injured_salary: string | null
          injury_type: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          accident_report_id: string
          agent_id?: string | null
          created_at?: string | null
          id?: string
          injured_address?: string | null
          injured_age?: number | null
          injured_name: string
          injured_occupation?: string | null
          injured_salary?: string | null
          injury_type?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          accident_report_id?: string
          agent_id?: string | null
          created_at?: string | null
          id?: string
          injured_address?: string | null
          injured_age?: number | null
          injured_name?: string
          injured_occupation?: string | null
          injured_salary?: string | null
          injury_type?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_injured_persons_accident_report_id_fkey"
            columns: ["accident_report_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_injured_persons_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_report_files: {
        Row: {
          accident_report_id: string
          agent_id: string | null
          created_at: string | null
          file_name: string | null
          file_type: string | null
          file_url: string
          id: string
        }
        Insert: {
          accident_report_id: string
          agent_id?: string | null
          created_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url: string
          id?: string
        }
        Update: {
          accident_report_id?: string
          agent_id?: string | null
          created_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accident_report_files_accident_report_id_fkey"
            columns: ["accident_report_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_report_files_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_report_notes: {
        Row: {
          accident_report_id: string
          agent_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          accident_report_id: string
          agent_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          accident_report_id?: string
          agent_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "accident_report_notes_accident_report_id_fkey"
            columns: ["accident_report_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_report_notes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_report_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_report_reminders: {
        Row: {
          accident_report_id: string
          agent_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_done: boolean | null
          reminder_date: string
          reminder_text: string | null
        }
        Insert: {
          accident_report_id: string
          agent_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_done?: boolean | null
          reminder_date: string
          reminder_text?: string | null
        }
        Update: {
          accident_report_id?: string
          agent_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_done?: boolean | null
          reminder_date?: string
          reminder_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_report_reminders_accident_report_id_fkey"
            columns: ["accident_report_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_report_reminders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_report_reminders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_reports: {
        Row: {
          accident_date: string
          accident_description: string | null
          accident_location: string | null
          accident_time: string | null
          additional_details: string | null
          agent_id: string | null
          branch_id: string | null
          car_id: string | null
          client_id: string
          company_id: string | null
          coverage_type: string | null
          created_at: string
          created_by_admin_id: string | null
          croquis_url: string | null
          customer_signature_ip: string | null
          customer_signature_url: string | null
          customer_signed_at: string | null
          deductible_amount: number | null
          driver_address: string | null
          driver_age: number | null
          driver_id_number: string | null
          driver_license_grade: string | null
          driver_license_issue_date: string | null
          driver_license_number: string | null
          driver_name: string | null
          driver_occupation: string | null
          driver_phone: string | null
          edited_fields_json: Json | null
          employee_notes: string | null
          employee_signature_date: string | null
          first_license_date: string | null
          generated_pdf_url: string | null
          id: string
          injuries_description: string | null
          license_expiry_date: string | null
          license_issue_place: string | null
          own_car_damages: string | null
          owner_address: string | null
          owner_name: string | null
          owner_phone: string | null
          passengers_count: number | null
          passengers_info: string | null
          police_report_number: string | null
          police_reported: boolean | null
          police_station: string | null
          policy_id: string
          report_number: number
          responsible_party: string | null
          selected_policy_group_id: string | null
          signature_phone_override: string | null
          signature_token: string | null
          signature_token_expires_at: string | null
          status: string
          updated_at: string
          vehicle_chassis_number: string | null
          vehicle_license_expiry: string | null
          vehicle_speed_at_accident: string | null
          vehicle_usage_purpose: string | null
          was_anyone_injured: boolean | null
          witnesses_info: string | null
        }
        Insert: {
          accident_date: string
          accident_description?: string | null
          accident_location?: string | null
          accident_time?: string | null
          additional_details?: string | null
          agent_id?: string | null
          branch_id?: string | null
          car_id?: string | null
          client_id: string
          company_id?: string | null
          coverage_type?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          croquis_url?: string | null
          customer_signature_ip?: string | null
          customer_signature_url?: string | null
          customer_signed_at?: string | null
          deductible_amount?: number | null
          driver_address?: string | null
          driver_age?: number | null
          driver_id_number?: string | null
          driver_license_grade?: string | null
          driver_license_issue_date?: string | null
          driver_license_number?: string | null
          driver_name?: string | null
          driver_occupation?: string | null
          driver_phone?: string | null
          edited_fields_json?: Json | null
          employee_notes?: string | null
          employee_signature_date?: string | null
          first_license_date?: string | null
          generated_pdf_url?: string | null
          id?: string
          injuries_description?: string | null
          license_expiry_date?: string | null
          license_issue_place?: string | null
          own_car_damages?: string | null
          owner_address?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          passengers_count?: number | null
          passengers_info?: string | null
          police_report_number?: string | null
          police_reported?: boolean | null
          police_station?: string | null
          policy_id: string
          report_number?: number
          responsible_party?: string | null
          selected_policy_group_id?: string | null
          signature_phone_override?: string | null
          signature_token?: string | null
          signature_token_expires_at?: string | null
          status?: string
          updated_at?: string
          vehicle_chassis_number?: string | null
          vehicle_license_expiry?: string | null
          vehicle_speed_at_accident?: string | null
          vehicle_usage_purpose?: string | null
          was_anyone_injured?: boolean | null
          witnesses_info?: string | null
        }
        Update: {
          accident_date?: string
          accident_description?: string | null
          accident_location?: string | null
          accident_time?: string | null
          additional_details?: string | null
          agent_id?: string | null
          branch_id?: string | null
          car_id?: string | null
          client_id?: string
          company_id?: string | null
          coverage_type?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          croquis_url?: string | null
          customer_signature_ip?: string | null
          customer_signature_url?: string | null
          customer_signed_at?: string | null
          deductible_amount?: number | null
          driver_address?: string | null
          driver_age?: number | null
          driver_id_number?: string | null
          driver_license_grade?: string | null
          driver_license_issue_date?: string | null
          driver_license_number?: string | null
          driver_name?: string | null
          driver_occupation?: string | null
          driver_phone?: string | null
          edited_fields_json?: Json | null
          employee_notes?: string | null
          employee_signature_date?: string | null
          first_license_date?: string | null
          generated_pdf_url?: string | null
          id?: string
          injuries_description?: string | null
          license_expiry_date?: string | null
          license_issue_place?: string | null
          own_car_damages?: string | null
          owner_address?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          passengers_count?: number | null
          passengers_info?: string | null
          police_report_number?: string | null
          police_reported?: boolean | null
          police_station?: string | null
          policy_id?: string
          report_number?: number
          responsible_party?: string | null
          selected_policy_group_id?: string | null
          signature_phone_override?: string | null
          signature_token?: string | null
          signature_token_expires_at?: string | null
          status?: string
          updated_at?: string
          vehicle_chassis_number?: string | null
          vehicle_license_expiry?: string | null
          vehicle_speed_at_accident?: string | null
          vehicle_usage_purpose?: string | null
          was_anyone_injured?: boolean | null
          witnesses_info?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_reports_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_third_parties: {
        Row: {
          accident_report_id: string
          address: string | null
          agent_id: string | null
          created_at: string
          damage_description: string | null
          full_name: string
          id: string
          id_number: string | null
          insurance_company: string | null
          insurance_policy_number: string | null
          phone: string | null
          sort_order: number
          updated_at: string
          vehicle_color: string | null
          vehicle_manufacturer: string | null
          vehicle_model: string | null
          vehicle_number: string | null
          vehicle_type: string | null
          vehicle_year: number | null
        }
        Insert: {
          accident_report_id: string
          address?: string | null
          agent_id?: string | null
          created_at?: string
          damage_description?: string | null
          full_name: string
          id?: string
          id_number?: string | null
          insurance_company?: string | null
          insurance_policy_number?: string | null
          phone?: string | null
          sort_order?: number
          updated_at?: string
          vehicle_color?: string | null
          vehicle_manufacturer?: string | null
          vehicle_model?: string | null
          vehicle_number?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
        }
        Update: {
          accident_report_id?: string
          address?: string | null
          agent_id?: string | null
          created_at?: string
          damage_description?: string | null
          full_name?: string
          id?: string
          id_number?: string | null
          insurance_company?: string | null
          insurance_policy_number?: string | null
          phone?: string | null
          sort_order?: number
          updated_at?: string
          vehicle_color?: string | null
          vehicle_manufacturer?: string | null
          vehicle_model?: string | null
          vehicle_number?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_third_parties_accident_report_id_fkey"
            columns: ["accident_report_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_third_parties_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_feature_flags: {
        Row: {
          agent_id: string
          enabled: boolean | null
          feature_key: string
          id: string
        }
        Insert: {
          agent_id: string
          enabled?: boolean | null
          feature_key: string
          id?: string
        }
        Update: {
          agent_id?: string
          enabled?: boolean | null
          feature_key?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_feature_flags_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_subscription_payments: {
        Row: {
          agent_id: string
          amount: number
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string
          period_end: string | null
          period_start: string | null
          plan: string
          received_by: string | null
          status: string
        }
        Insert: {
          agent_id: string
          amount: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          period_end?: string | null
          period_start?: string | null
          plan: string
          received_by?: string | null
          status?: string
        }
        Update: {
          agent_id?: string
          amount?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          period_end?: string | null
          period_start?: string | null
          plan?: string
          received_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_subscription_payments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_users: {
        Row: {
          agent_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_users_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_users_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          ai_assistant_prompt: string | null
          billing_cycle_day: number | null
          cancelled_at: string | null
          created_at: string | null
          email: string
          id: string
          logo_url: string | null
          monthly_price: number | null
          name: string
          name_ar: string | null
          notes: string | null
          pending_plan: string | null
          phone: string | null
          plan: string
          subscription_expires_at: string | null
          subscription_started_at: string | null
          subscription_status: string
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          ai_assistant_prompt?: string | null
          billing_cycle_day?: number | null
          cancelled_at?: string | null
          created_at?: string | null
          email: string
          id?: string
          logo_url?: string | null
          monthly_price?: number | null
          name: string
          name_ar?: string | null
          notes?: string | null
          pending_plan?: string | null
          phone?: string | null
          plan?: string
          subscription_expires_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_assistant_prompt?: string | null
          billing_cycle_day?: number | null
          cancelled_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          logo_url?: string | null
          monthly_price?: number | null
          name?: string
          name_ar?: string | null
          notes?: string | null
          pending_plan?: string | null
          phone?: string | null
          plan?: string
          subscription_expires_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          metadata: Json | null
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          agent_id: string
          created_at: string | null
          id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_dismissals: {
        Row: {
          announcement_id: string
          dismissed_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          dismissed_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          dismissed_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          agent_id: string | null
          content: string
          created_at: string | null
          created_by_admin_id: string | null
          end_date: string
          id: string
          is_active: boolean | null
          show_once: boolean | null
          start_date: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          content: string
          created_at?: string | null
          created_by_admin_id?: string | null
          end_date: string
          id?: string
          is_active?: boolean | null
          show_once?: boolean | null
          start_date?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          content?: string
          created_at?: string | null
          created_by_admin_id?: string | null
          end_date?: string
          id?: string
          is_active?: boolean | null
          show_once?: boolean | null
          start_date?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_settings: {
        Row: {
          agent_id: string | null
          created_at: string
          email_body_template: string | null
          email_otp_enabled: boolean
          email_subject_template: string | null
          gmail_app_password: string | null
          gmail_sender_email: string | null
          id: string
          ippbx_enabled: boolean | null
          ippbx_extension_password: string | null
          ippbx_token_id: string | null
          sms_019_source: string | null
          sms_019_token: string | null
          sms_019_user: string | null
          sms_message_template: string | null
          sms_otp_enabled: boolean
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_secure: boolean | null
          smtp_user: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          email_body_template?: string | null
          email_otp_enabled?: boolean
          email_subject_template?: string | null
          gmail_app_password?: string | null
          gmail_sender_email?: string | null
          id?: string
          ippbx_enabled?: boolean | null
          ippbx_extension_password?: string | null
          ippbx_token_id?: string | null
          sms_019_source?: string | null
          sms_019_token?: string | null
          sms_019_user?: string | null
          sms_message_template?: string | null
          sms_otp_enabled?: boolean
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean | null
          smtp_user?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          email_body_template?: string | null
          email_otp_enabled?: boolean
          email_subject_template?: string | null
          gmail_app_password?: string | null
          gmail_sender_email?: string | null
          id?: string
          ippbx_enabled?: boolean | null
          ippbx_extension_password?: string | null
          ippbx_token_id?: string | null
          sms_019_source?: string | null
          sms_019_token?: string | null
          sms_019_user?: string | null
          sms_message_template?: string | null
          sms_otp_enabled?: boolean
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean | null
          smtp_user?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_sms_log: {
        Row: {
          agent_id: string | null
          car_id: string | null
          client_id: string
          created_at: string
          error_message: string | null
          id: string
          message: string
          phone_number: string
          sent_for_date: string
          sms_type: string
          status: string
        }
        Insert: {
          agent_id?: string | null
          car_id?: string | null
          client_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          message: string
          phone_number: string
          sent_for_date: string
          sms_type: string
          status?: string
        }
        Update: {
          agent_id?: string | null
          car_id?: string | null
          client_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message?: string
          phone_number?: string
          sent_for_date?: string
          sms_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automated_sms_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_sms_log_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_sms_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_ar: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_ar?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_ar?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_settlement_items: {
        Row: {
          agent_id: string | null
          amount: number
          created_at: string
          id: string
          notes: string | null
          policy_id: string
          settlement_id: string
        }
        Insert: {
          agent_id?: string | null
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          policy_id: string
          settlement_id: string
        }
        Update: {
          agent_id?: string | null
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          policy_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_settlement_items_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_settlement_items_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "broker_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_settlements: {
        Row: {
          agent_id: string | null
          bank_reference: string | null
          branch_id: string | null
          broker_id: string
          card_expiry: string | null
          card_last_four: string | null
          cheque_image_url: string | null
          cheque_number: string | null
          created_at: string
          created_by_admin_id: string | null
          customer_cheque_ids: Json | null
          direction: string
          id: string
          installments_count: number | null
          notes: string | null
          payment_type: string | null
          receipt_images: Json | null
          refused: boolean | null
          settlement_date: string
          settlement_number: string | null
          status: string
          total_amount: number
          tranzila_approval_code: string | null
          tranzila_transaction_id: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          bank_reference?: string | null
          branch_id?: string | null
          broker_id: string
          card_expiry?: string | null
          card_last_four?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          customer_cheque_ids?: Json | null
          direction: string
          id?: string
          installments_count?: number | null
          notes?: string | null
          payment_type?: string | null
          receipt_images?: Json | null
          refused?: boolean | null
          settlement_date?: string
          settlement_number?: string | null
          status?: string
          total_amount?: number
          tranzila_approval_code?: string | null
          tranzila_transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          bank_reference?: string | null
          branch_id?: string | null
          broker_id?: string
          card_expiry?: string | null
          card_last_four?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          customer_cheque_ids?: Json | null
          direction?: string
          id?: string
          installments_count?: number | null
          notes?: string | null
          payment_type?: string | null
          receipt_images?: Json | null
          refused?: boolean | null
          settlement_date?: string
          settlement_number?: string | null
          status?: string
          total_amount?: number
          tranzila_approval_code?: string | null
          tranzila_transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_settlements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_settlements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_settlements_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_settlements_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          image_url: string | null
          legacy_wp_id: number | null
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          legacy_wp_id?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          legacy_wp_id?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brokers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      business_contacts: {
        Row: {
          agent_id: string | null
          category: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_contacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      car_accidents: {
        Row: {
          accident_date: string | null
          accident_name: string
          agent_id: string | null
          branch_id: string | null
          car_id: string
          created_at: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          accident_date?: string | null
          accident_name: string
          agent_id?: string | null
          branch_id?: string | null
          car_id: string
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          accident_date?: string | null
          accident_name?: string
          agent_id?: string | null
          branch_id?: string | null
          car_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_accidents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_accidents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_accidents_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          car_number: string
          car_type: Database["public"]["Enums"]["car_type"] | null
          car_value: number | null
          client_id: string
          color: string | null
          created_at: string
          created_by_admin_id: string | null
          deleted_at: string | null
          id: string
          last_license: string | null
          license_expiry: string | null
          license_type: string | null
          manufacturer_name: string | null
          model: string | null
          model_number: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          car_number: string
          car_type?: Database["public"]["Enums"]["car_type"] | null
          car_value?: number | null
          client_id: string
          color?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          deleted_at?: string | null
          id?: string
          last_license?: string | null
          license_expiry?: string | null
          license_type?: string | null
          manufacturer_name?: string | null
          model?: string | null
          model_number?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          car_number?: string
          car_type?: Database["public"]["Enums"]["car_type"] | null
          car_value?: number | null
          client_id?: string
          color?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          deleted_at?: string | null
          id?: string
          last_license?: string | null
          license_expiry?: string | null
          license_type?: string | null
          manufacturer_name?: string | null
          model?: string | null
          model_number?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cars_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_children: {
        Row: {
          agent_id: string | null
          birth_date: string | null
          client_id: string
          created_at: string | null
          full_name: string
          id: string
          id_number: string
          notes: string | null
          phone: string | null
          relation: string | null
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          birth_date?: string | null
          client_id: string
          created_at?: string | null
          full_name: string
          id?: string
          id_number: string
          notes?: string | null
          phone?: string | null
          relation?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          birth_date?: string | null
          client_id?: string
          created_at?: string | null
          full_name?: string
          id?: string
          id_number?: string
          notes?: string | null
          phone?: string | null
          relation?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_children_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_children_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_debits: {
        Row: {
          agent_id: string | null
          amount: number
          branch_id: string | null
          client_id: string
          created_at: string | null
          description: string | null
          id: string
          policy_id: string | null
        }
        Insert: {
          agent_id?: string | null
          amount: number
          branch_id?: string | null
          client_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          policy_id?: string | null
        }
        Update: {
          agent_id?: string | null
          amount?: number
          branch_id?: string | null
          client_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_debits_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_debits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_debits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_debits_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payments: {
        Row: {
          agent_id: string | null
          amount: number
          branch_id: string | null
          cheque_image_url: string | null
          cheque_number: string | null
          client_id: string
          created_at: string | null
          created_by_admin_id: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_type: string
          refused: boolean | null
          tranzila_transaction_id: string | null
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          amount: number
          branch_id?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          client_id: string
          created_at?: string | null
          created_by_admin_id?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_type: string
          refused?: boolean | null
          tranzila_transaction_id?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          amount?: number
          branch_id?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          client_id?: string
          created_at?: string | null
          created_by_admin_id?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_type?: string
          refused?: boolean | null
          tranzila_transaction_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_payments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payments_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          accident_notes: string | null
          agent_id: string | null
          birth_date: string | null
          branch_id: string | null
          broker_id: string | null
          created_at: string
          created_by_admin_id: string | null
          date_joined: string | null
          deleted_at: string | null
          file_number: string | null
          full_name: string
          id: string
          id_number: string
          image_url: string | null
          less_than_24: boolean | null
          notes: string | null
          phone_number: string | null
          phone_number_2: string | null
          signature_url: string | null
          under24_driver_id: string | null
          under24_driver_name: string | null
          under24_type: Database["public"]["Enums"]["under24_type"] | null
          updated_at: string
        }
        Insert: {
          accident_notes?: string | null
          agent_id?: string | null
          birth_date?: string | null
          branch_id?: string | null
          broker_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          date_joined?: string | null
          deleted_at?: string | null
          file_number?: string | null
          full_name: string
          id?: string
          id_number: string
          image_url?: string | null
          less_than_24?: boolean | null
          notes?: string | null
          phone_number?: string | null
          phone_number_2?: string | null
          signature_url?: string | null
          under24_driver_id?: string | null
          under24_driver_name?: string | null
          under24_type?: Database["public"]["Enums"]["under24_type"] | null
          updated_at?: string
        }
        Update: {
          accident_notes?: string | null
          agent_id?: string | null
          birth_date?: string | null
          branch_id?: string | null
          broker_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          date_joined?: string | null
          deleted_at?: string | null
          file_number?: string | null
          full_name?: string
          id?: string
          id_number?: string
          image_url?: string | null
          less_than_24?: boolean | null
          notes?: string | null
          phone_number?: string | null
          phone_number_2?: string | null
          signature_url?: string | null
          under24_driver_id?: string | null
          under24_driver_name?: string | null
          under24_type?: Database["public"]["Enums"]["under24_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_accident_fee_prices: {
        Row: {
          accident_fee_service_id: string
          agent_id: string | null
          company_cost: number
          company_id: string
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          notes: string | null
          selling_price: number
          updated_at: string
        }
        Insert: {
          accident_fee_service_id: string
          agent_id?: string | null
          company_cost?: number
          company_id: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          notes?: string | null
          selling_price?: number
          updated_at?: string
        }
        Update: {
          accident_fee_service_id?: string
          agent_id?: string | null
          company_cost?: number
          company_id?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          notes?: string | null
          selling_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_accident_fee_prices_accident_fee_service_id_fkey"
            columns: ["accident_fee_service_id"]
            isOneToOne: false
            referencedRelation: "accident_fee_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_accident_fee_prices_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_accident_fee_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_accident_templates: {
        Row: {
          agent_id: string | null
          company_id: string
          created_at: string
          created_by_admin_id: string | null
          id: string
          is_active: boolean
          mapping_json: Json
          notes: string | null
          template_pdf_url: string
          updated_at: string
          version: string
        }
        Insert: {
          agent_id?: string | null
          company_id: string
          created_at?: string
          created_by_admin_id?: string | null
          id?: string
          is_active?: boolean
          mapping_json?: Json
          notes?: string | null
          template_pdf_url: string
          updated_at?: string
          version?: string
        }
        Update: {
          agent_id?: string | null
          company_id?: string
          created_at?: string
          created_by_admin_id?: string | null
          id?: string
          is_active?: boolean
          mapping_json?: Json
          notes?: string | null
          template_pdf_url?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_accident_templates_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_accident_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_accident_templates_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_road_service_prices: {
        Row: {
          age_band: Database["public"]["Enums"]["age_band"]
          agent_id: string | null
          car_type: Database["public"]["Enums"]["car_type"]
          company_cost: number
          company_id: string
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          notes: string | null
          road_service_id: string
          selling_price: number
          updated_at: string
        }
        Insert: {
          age_band?: Database["public"]["Enums"]["age_band"]
          agent_id?: string | null
          car_type?: Database["public"]["Enums"]["car_type"]
          company_cost?: number
          company_id: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          notes?: string | null
          road_service_id: string
          selling_price?: number
          updated_at?: string
        }
        Update: {
          age_band?: Database["public"]["Enums"]["age_band"]
          agent_id?: string | null
          car_type?: Database["public"]["Enums"]["car_type"]
          company_cost?: number
          company_id?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          notes?: string | null
          road_service_id?: string
          selling_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_road_service_prices_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_road_service_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_road_service_prices_road_service_id_fkey"
            columns: ["road_service_id"]
            isOneToOne: false
            referencedRelation: "road_services"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settlements: {
        Row: {
          agent_id: string | null
          bank_reference: string | null
          branch_id: string | null
          card_expiry: string | null
          card_last_four: string | null
          cheque_image_url: string | null
          cheque_number: string | null
          company_id: string
          created_at: string
          created_by_admin_id: string | null
          customer_cheque_ids: Json | null
          id: string
          notes: string | null
          payment_type: string
          receipt_images: Json | null
          refused: boolean | null
          settlement_date: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          bank_reference?: string | null
          branch_id?: string | null
          card_expiry?: string | null
          card_last_four?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          company_id: string
          created_at?: string
          created_by_admin_id?: string | null
          customer_cheque_ids?: Json | null
          id?: string
          notes?: string | null
          payment_type?: string
          receipt_images?: Json | null
          refused?: boolean | null
          settlement_date?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          bank_reference?: string | null
          branch_id?: string | null
          card_expiry?: string | null
          card_last_four?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          company_id?: string
          created_at?: string
          created_by_admin_id?: string | null
          customer_cheque_ids?: Json | null
          id?: string
          notes?: string | null
          payment_type?: string
          receipt_images?: Json | null
          refused?: boolean | null
          settlement_date?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settlements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settlements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settlements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      correspondence_letters: {
        Row: {
          agent_id: string | null
          body_html: string | null
          branch_id: string | null
          created_at: string | null
          created_by_admin_id: string | null
          generated_url: string | null
          id: string
          recipient_name: string
          recipient_phone: string | null
          sent_at: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          body_html?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by_admin_id?: string | null
          generated_url?: string | null
          id?: string
          recipient_name: string
          recipient_phone?: string | null
          sent_at?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          body_html?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by_admin_id?: string | null
          generated_url?: string | null
          id?: string
          recipient_name?: string
          recipient_phone?: string | null
          sent_at?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "correspondence_letters_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_letters_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_letters_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_signatures: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          client_id: string
          created_at: string
          id: string
          ip_address: string | null
          policy_id: string | null
          signature_image_url: string
          signed_at: string
          token: string | null
          token_expires_at: string | null
          user_agent: string | null
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          client_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          policy_id?: string | null
          signature_image_url: string
          signed_at?: string
          token?: string | null
          token_expires_at?: string | null
          user_agent?: string | null
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          client_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          policy_id?: string | null
          signature_image_url?: string
          signed_at?: string
          token?: string | null
          token_expires_at?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_signatures_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_signatures_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_signatures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_signatures_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_wallet_transactions: {
        Row: {
          agent_id: string | null
          amount: number
          branch_id: string | null
          car_id: string | null
          client_id: string
          created_at: string
          created_by_admin_id: string | null
          description: string | null
          id: string
          notes: string | null
          payment_method: string | null
          policy_id: string | null
          refund_date: string | null
          transaction_type: string
        }
        Insert: {
          agent_id?: string | null
          amount: number
          branch_id?: string | null
          car_id?: string | null
          client_id: string
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          policy_id?: string | null
          refund_date?: string | null
          transaction_type?: string
        }
        Update: {
          agent_id?: string | null
          amount?: number
          branch_id?: string | null
          car_id?: string | null
          client_id?: string
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          policy_id?: string | null
          refund_date?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_wallet_transactions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_wallet_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_wallet_transactions_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_wallet_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_wallet_transactions_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_wallet_transactions_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          agent_id: string | null
          amount: number
          branch_id: string | null
          category: string
          contact_name: string | null
          created_at: string
          created_by_admin_id: string | null
          description: string | null
          expense_date: string
          id: string
          notes: string | null
          payment_method: string
          receipt_url: string | null
          reference_number: string | null
          updated_at: string
          voucher_type: string
        }
        Insert: {
          agent_id?: string | null
          amount: number
          branch_id?: string | null
          category: string
          contact_name?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_method?: string
          receipt_url?: string | null
          reference_number?: string | null
          updated_at?: string
          voucher_type?: string
        }
        Update: {
          agent_id?: string | null
          amount?: number
          branch_id?: string | null
          category?: string
          contact_name?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_method?: string
          receipt_url?: string | null
          reference_number?: string | null
          updated_at?: string
          voucher_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_template_files: {
        Row: {
          agent_id: string | null
          created_at: string
          created_by: string | null
          file_type: string
          file_url: string
          folder_id: string
          id: string
          mime_type: string | null
          name: string
          overlay_fields: Json | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          file_type: string
          file_url: string
          folder_id: string
          id?: string
          mime_type?: string | null
          name: string
          overlay_fields?: Json | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          file_type?: string
          file_url?: string
          folder_id?: string
          id?: string
          mime_type?: string | null
          name?: string
          overlay_fields?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_template_files_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_template_files_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_template_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "form_template_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      form_template_folders: {
        Row: {
          agent_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_template_folders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_template_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_template_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "form_template_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      import_progress: {
        Row: {
          created_at: string
          error_log: Json | null
          estimated_finish_at: string | null
          failed_items: number
          id: string
          import_type: string
          last_processed_id: string | null
          metadata: Json | null
          processed_items: number
          started_at: string | null
          status: string
          total_items: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_log?: Json | null
          estimated_finish_at?: string | null
          failed_items?: number
          id?: string
          import_type: string
          last_processed_id?: string | null
          metadata?: Json | null
          processed_items?: number
          started_at?: string | null
          status?: string
          total_items?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_log?: Json | null
          estimated_finish_at?: string | null
          failed_items?: number
          id?: string
          import_type?: string
          last_processed_id?: string | null
          metadata?: Json | null
          processed_items?: number
          started_at?: string | null
          status?: string
          total_items?: number
          updated_at?: string
        }
        Relationships: []
      }
      insurance_categories: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          mode: string
          name: string
          name_ar: string | null
          name_he: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          mode?: string
          name: string
          name_ar?: string | null
          name_he?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          mode?: string
          name?: string
          name_ar?: string | null
          name_he?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_categories_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_companies: {
        Row: {
          active: boolean | null
          agent_id: string | null
          broker_id: string | null
          category_parent: string[] | null
          created_at: string
          elzami_commission: number | null
          id: string
          legacy_wp_id: number | null
          name: string
          name_ar: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          agent_id?: string | null
          broker_id?: string | null
          category_parent?: string[] | null
          created_at?: string
          elzami_commission?: number | null
          id?: string
          legacy_wp_id?: number | null
          name: string
          name_ar?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          agent_id?: string | null
          broker_id?: string | null
          category_parent?: string[] | null
          created_at?: string
          elzami_commission?: number | null
          id?: string
          legacy_wp_id?: number | null
          name?: string
          name_ar?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_companies_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_companies_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_company_groups: {
        Row: {
          agent_id: string | null
          created_at: string
          display_name: string
          display_name_ar: string | null
          id: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          display_name: string
          display_name_ar?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          display_name?: string
          display_name_ar?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_company_groups_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_templates: {
        Row: {
          agent_id: string | null
          body_html: string | null
          created_at: string
          created_by_admin_id: string | null
          direction: string
          footer_html: string | null
          header_html: string | null
          id: string
          is_active: boolean | null
          language: string
          logo_url: string | null
          name: string
          template_layout_json: Json | null
          template_type: string
          updated_at: string
          version: number
        }
        Insert: {
          agent_id?: string | null
          body_html?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          direction?: string
          footer_html?: string | null
          header_html?: string | null
          id?: string
          is_active?: boolean | null
          language: string
          logo_url?: string | null
          name: string
          template_layout_json?: Json | null
          template_type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          agent_id?: string | null
          body_html?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          direction?: string
          footer_html?: string | null
          header_html?: string | null
          id?: string
          is_active?: boolean | null
          language?: string
          logo_url?: string | null
          name?: string
          template_layout_json?: Json | null
          template_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_templates_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_templates_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          created_at: string
          created_by_admin_id: string | null
          error_message: string | null
          id: string
          invoice_number: string
          issued_at: string
          language: string
          metadata_json: Json | null
          pdf_url: string | null
          policy_id: string
          status: string
          template_id: string | null
          template_version_used: number | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          error_message?: string | null
          id?: string
          invoice_number: string
          issued_at?: string
          language: string
          metadata_json?: Json | null
          pdf_url?: string | null
          policy_id: string
          status?: string
          template_id?: string | null
          template_version_used?: number | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          error_message?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string
          language?: string
          metadata_json?: Json | null
          pdf_url?: string | null
          policy_id?: string
          status?: string
          template_id?: string | null
          template_version_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_content: {
        Row: {
          content_type: string
          id: string
          image_url: string | null
          json_value: Json | null
          section_key: string
          text_value: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content_type?: string
          id?: string
          image_url?: string | null
          json_value?: Json | null
          section_key: string
          text_value?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content_type?: string
          id?: string
          image_url?: string | null
          json_value?: Json | null
          section_key?: string
          text_value?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "landing_content_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_messages: {
        Row: {
          agent_id: string | null
          content: string
          created_at: string
          id: string
          lead_id: string
          message_type: string
          metadata: Json | null
          phone: string
        }
        Insert: {
          agent_id?: string | null
          content: string
          created_at?: string
          id?: string
          lead_id: string
          message_type: string
          metadata?: Json | null
          phone: string
        }
        Update: {
          agent_id?: string | null
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
          message_type?: string
          metadata?: Json | null
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agent_id: string | null
          callback_notified_at: string | null
          car_color: string | null
          car_manufacturer: string | null
          car_model: string | null
          car_number: string | null
          car_year: string | null
          created_at: string | null
          customer_name: string | null
          driver_over_24: boolean | null
          has_accidents: boolean | null
          id: string
          insurance_types: string[] | null
          last_sync_at: string | null
          notes: string | null
          phone: string
          requires_callback: boolean | null
          source: string | null
          status: string | null
          total_price: number | null
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          callback_notified_at?: string | null
          car_color?: string | null
          car_manufacturer?: string | null
          car_model?: string | null
          car_number?: string | null
          car_year?: string | null
          created_at?: string | null
          customer_name?: string | null
          driver_over_24?: boolean | null
          has_accidents?: boolean | null
          id?: string
          insurance_types?: string[] | null
          last_sync_at?: string | null
          notes?: string | null
          phone: string
          requires_callback?: boolean | null
          source?: string | null
          status?: string | null
          total_price?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          callback_notified_at?: string | null
          car_color?: string | null
          car_manufacturer?: string | null
          car_model?: string | null
          car_number?: string | null
          car_year?: string | null
          created_at?: string | null
          customer_name?: string | null
          driver_over_24?: boolean | null
          has_accidents?: boolean | null
          id?: string
          insurance_types?: string[] | null
          last_sync_at?: string | null
          notes?: string | null
          phone?: string
          requires_callback?: boolean | null
          source?: string | null
          status?: string | null
          total_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          identifier: string | null
          ip_address: string | null
          method: string | null
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          identifier?: string | null
          ip_address?: string | null
          method?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          identifier?: string | null
          ip_address?: string | null
          method?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      marketing_sms_campaigns: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by_admin_id: string | null
          delivered_count: number | null
          dlr_failed_count: number | null
          failed_count: number
          id: string
          image_url: string | null
          last_dlr_check_at: string | null
          message: string
          recipients_count: number
          sent_count: number
          status: string
          title: string
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          delivered_count?: number | null
          dlr_failed_count?: number | null
          failed_count?: number
          id?: string
          image_url?: string | null
          last_dlr_check_at?: string | null
          message: string
          recipients_count?: number
          sent_count?: number
          status?: string
          title: string
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          delivered_count?: number | null
          dlr_failed_count?: number | null
          failed_count?: number
          id?: string
          image_url?: string | null
          last_dlr_check_at?: string | null
          message?: string
          recipients_count?: number
          sent_count?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_sms_campaigns_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_sms_campaigns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_sms_campaigns_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_sms_recipients: {
        Row: {
          agent_id: string | null
          campaign_id: string
          client_id: string
          created_at: string
          dlr_checked_at: string | null
          dlr_id: string | null
          dlr_message: string | null
          dlr_status: string | null
          error_message: string | null
          id: string
          phone_number: string
          sent_at: string | null
          status: string
        }
        Insert: {
          agent_id?: string | null
          campaign_id: string
          client_id: string
          created_at?: string
          dlr_checked_at?: string | null
          dlr_id?: string | null
          dlr_message?: string | null
          dlr_status?: string | null
          error_message?: string | null
          id?: string
          phone_number: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          agent_id?: string | null
          campaign_id?: string
          client_id?: string
          created_at?: string
          dlr_checked_at?: string | null
          dlr_id?: string | null
          dlr_message?: string | null
          dlr_status?: string | null
          error_message?: string | null
          id?: string
          phone_number?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_sms_recipients_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_sms_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_sms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_sms_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      media_files: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          cdn_url: string
          created_at: string
          deleted_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          mime_type: string
          original_name: string
          size: number
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          cdn_url: string
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          mime_type: string
          original_name: string
          size: number
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          cdn_url?: string
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          mime_type?: string
          original_name?: string
          size?: number
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_files_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agent_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          link: string | null
          message: string
          metadata: Json | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          metadata?: Json | null
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          expires_at: string
          id: string
          identifier: string
          max_attempts: number
          otp_hash: string
          used_at: string | null
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          expires_at: string
          id?: string
          identifier: string
          max_attempts?: number
          otp_hash: string
          used_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          expires_at?: string
          id?: string
          identifier?: string
          max_attempts?: number
          otp_hash?: string
          used_at?: string | null
        }
        Relationships: []
      }
      outside_cheques: {
        Row: {
          agent_id: string | null
          amount: number
          branch_id: string | null
          cheque_date: string | null
          cheque_image_url: string | null
          cheque_number: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          refused: boolean | null
          transferred_at: string | null
          transferred_payment_id: string | null
          transferred_to_id: string | null
          transferred_to_type: string | null
          used: boolean | null
        }
        Insert: {
          agent_id?: string | null
          amount: number
          branch_id?: string | null
          cheque_date?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          refused?: boolean | null
          transferred_at?: string | null
          transferred_payment_id?: string | null
          transferred_to_id?: string | null
          transferred_to_type?: string | null
          used?: boolean | null
        }
        Update: {
          agent_id?: string | null
          amount?: number
          branch_id?: string | null
          cheque_date?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          refused?: boolean | null
          transferred_at?: string | null
          transferred_payment_id?: string | null
          transferred_to_id?: string | null
          transferred_to_type?: string | null
          used?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "outside_cheques_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outside_cheques_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_images: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          image_type: string
          image_url: string
          payment_id: string
          sort_order: number
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          image_type?: string
          image_url: string
          payment_id: string
          sort_order?: number
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          image_type?: string
          image_url?: string
          payment_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_images_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_images_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "policy_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_settings: {
        Row: {
          agent_id: string | null
          api_password: string | null
          created_at: string
          fail_url: string | null
          id: string
          is_enabled: boolean
          notify_url: string | null
          provider: string
          sandbox_terminal_name: string | null
          success_url: string | null
          terminal_name: string | null
          test_mode: boolean
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          api_password?: string | null
          created_at?: string
          fail_url?: string | null
          id?: string
          is_enabled?: boolean
          notify_url?: string | null
          provider?: string
          sandbox_terminal_name?: string | null
          success_url?: string | null
          terminal_name?: string | null
          test_mode?: boolean
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          api_password?: string | null
          created_at?: string
          fail_url?: string | null
          id?: string
          is_enabled?: boolean
          notify_url?: string | null
          provider?: string
          sandbox_terminal_name?: string | null
          success_url?: string | null
          terminal_name?: string | null
          test_mode?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      pbx_extensions: {
        Row: {
          agent_id: string | null
          created_at: string | null
          extension_name: string | null
          extension_number: string
          id: string
          is_default: boolean | null
          password_md5: string
          password_plain: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          extension_name?: string | null
          extension_number: string
          id?: string
          is_default?: boolean | null
          password_md5: string
          password_plain: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          extension_name?: string | null
          extension_number?: string
          id?: string
          is_default?: boolean | null
          password_md5?: string
          password_plain?: string
        }
        Relationships: [
          {
            foreignKeyName: "pbx_extensions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          accident_fee_service_id: string | null
          agent_id: string | null
          branch_id: string | null
          broker_buy_price: number | null
          broker_direction:
            | Database["public"]["Enums"]["broker_direction"]
            | null
          broker_id: string | null
          calc_status: string | null
          cancellation_date: string | null
          cancellation_note: string | null
          cancelled: boolean | null
          cancelled_by_admin_id: string | null
          car_id: string | null
          category_id: string | null
          client_id: string
          company_cost_snapshot: number | null
          company_id: string | null
          created_at: string
          created_by_admin_id: string | null
          deleted_at: string | null
          elzami_cost: number | null
          end_date: string
          group_id: string | null
          id: string
          insurance_price: number
          invoices_sent_at: string | null
          is_under_24: boolean | null
          issue_date: string | null
          legacy_wp_id: number | null
          notes: string | null
          office_commission: number
          payed_for_company: number | null
          policy_number: string | null
          policy_type_child:
            | Database["public"]["Enums"]["policy_type_child"]
            | null
          policy_type_parent: Database["public"]["Enums"]["policy_type_parent"]
          profit: number | null
          road_service_id: string | null
          start_date: string
          transferred: boolean | null
          transferred_car_number: string | null
          transferred_from_policy_id: string | null
          transferred_to_car_number: string | null
          updated_at: string
        }
        Insert: {
          accident_fee_service_id?: string | null
          agent_id?: string | null
          branch_id?: string | null
          broker_buy_price?: number | null
          broker_direction?:
            | Database["public"]["Enums"]["broker_direction"]
            | null
          broker_id?: string | null
          calc_status?: string | null
          cancellation_date?: string | null
          cancellation_note?: string | null
          cancelled?: boolean | null
          cancelled_by_admin_id?: string | null
          car_id?: string | null
          category_id?: string | null
          client_id: string
          company_cost_snapshot?: number | null
          company_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          deleted_at?: string | null
          elzami_cost?: number | null
          end_date: string
          group_id?: string | null
          id?: string
          insurance_price: number
          invoices_sent_at?: string | null
          is_under_24?: boolean | null
          issue_date?: string | null
          legacy_wp_id?: number | null
          notes?: string | null
          office_commission?: number
          payed_for_company?: number | null
          policy_number?: string | null
          policy_type_child?:
            | Database["public"]["Enums"]["policy_type_child"]
            | null
          policy_type_parent: Database["public"]["Enums"]["policy_type_parent"]
          profit?: number | null
          road_service_id?: string | null
          start_date: string
          transferred?: boolean | null
          transferred_car_number?: string | null
          transferred_from_policy_id?: string | null
          transferred_to_car_number?: string | null
          updated_at?: string
        }
        Update: {
          accident_fee_service_id?: string | null
          agent_id?: string | null
          branch_id?: string | null
          broker_buy_price?: number | null
          broker_direction?:
            | Database["public"]["Enums"]["broker_direction"]
            | null
          broker_id?: string | null
          calc_status?: string | null
          cancellation_date?: string | null
          cancellation_note?: string | null
          cancelled?: boolean | null
          cancelled_by_admin_id?: string | null
          car_id?: string | null
          category_id?: string | null
          client_id?: string
          company_cost_snapshot?: number | null
          company_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          deleted_at?: string | null
          elzami_cost?: number | null
          end_date?: string
          group_id?: string | null
          id?: string
          insurance_price?: number
          invoices_sent_at?: string | null
          is_under_24?: boolean | null
          issue_date?: string | null
          legacy_wp_id?: number | null
          notes?: string | null
          office_commission?: number
          payed_for_company?: number | null
          policy_number?: string | null
          policy_type_child?:
            | Database["public"]["Enums"]["policy_type_child"]
            | null
          policy_type_parent?: Database["public"]["Enums"]["policy_type_parent"]
          profit?: number | null
          road_service_id?: string | null
          start_date?: string
          transferred?: boolean | null
          transferred_car_number?: string | null
          transferred_from_policy_id?: string | null
          transferred_to_car_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_accident_fee_service_id_fkey"
            columns: ["accident_fee_service_id"]
            isOneToOne: false
            referencedRelation: "accident_fee_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_cancelled_by_admin_id_fkey"
            columns: ["cancelled_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "insurance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "policy_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_road_service_id_fkey"
            columns: ["road_service_id"]
            isOneToOne: false
            referencedRelation: "road_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_transferred_from_policy_id_fkey"
            columns: ["transferred_from_policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_children: {
        Row: {
          agent_id: string | null
          child_id: string
          created_at: string | null
          id: string
          policy_id: string
        }
        Insert: {
          agent_id?: string | null
          child_id: string
          created_at?: string | null
          id?: string
          policy_id: string
        }
        Update: {
          agent_id?: string | null
          child_id?: string
          created_at?: string | null
          id?: string
          policy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_children_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "client_children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_children_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_groups: {
        Row: {
          agent_id: string | null
          car_id: string | null
          client_id: string
          created_at: string
          id: string
          name: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          car_id?: string | null
          client_id: string
          created_at?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          car_id?: string | null
          client_id?: string
          created_at?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_groups_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_groups_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_groups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_payments: {
        Row: {
          agent_id: string | null
          amount: number
          batch_id: string | null
          branch_id: string | null
          card_expiry: string | null
          card_last_four: string | null
          cheque_date: string | null
          cheque_image_url: string | null
          cheque_number: string | null
          cheque_status: string | null
          created_at: string
          created_by_admin_id: string | null
          id: string
          installments_count: number | null
          locked: boolean | null
          notes: string | null
          payment_date: string
          payment_type: Database["public"]["Enums"]["payment_type"]
          policy_id: string
          provider: string | null
          refused: boolean | null
          source: string | null
          transferred_at: string | null
          transferred_payment_id: string | null
          transferred_to_id: string | null
          transferred_to_type: string | null
          tranzila_approval_code: string | null
          tranzila_index: string | null
          tranzila_receipt_url: string | null
          tranzila_response_code: string | null
          tranzila_transaction_id: string | null
        }
        Insert: {
          agent_id?: string | null
          amount: number
          batch_id?: string | null
          branch_id?: string | null
          card_expiry?: string | null
          card_last_four?: string | null
          cheque_date?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          cheque_status?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          id?: string
          installments_count?: number | null
          locked?: boolean | null
          notes?: string | null
          payment_date?: string
          payment_type: Database["public"]["Enums"]["payment_type"]
          policy_id: string
          provider?: string | null
          refused?: boolean | null
          source?: string | null
          transferred_at?: string | null
          transferred_payment_id?: string | null
          transferred_to_id?: string | null
          transferred_to_type?: string | null
          tranzila_approval_code?: string | null
          tranzila_index?: string | null
          tranzila_receipt_url?: string | null
          tranzila_response_code?: string | null
          tranzila_transaction_id?: string | null
        }
        Update: {
          agent_id?: string | null
          amount?: number
          batch_id?: string | null
          branch_id?: string | null
          card_expiry?: string | null
          card_last_four?: string | null
          cheque_date?: string | null
          cheque_image_url?: string | null
          cheque_number?: string | null
          cheque_status?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          id?: string
          installments_count?: number | null
          locked?: boolean | null
          notes?: string | null
          payment_date?: string
          payment_type?: Database["public"]["Enums"]["payment_type"]
          policy_id?: string
          provider?: string | null
          refused?: boolean | null
          source?: string | null
          transferred_at?: string | null
          transferred_payment_id?: string | null
          transferred_to_id?: string | null
          transferred_to_type?: string | null
          tranzila_approval_code?: string | null
          tranzila_index?: string | null
          tranzila_receipt_url?: string | null
          tranzila_response_code?: string | null
          tranzila_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "policy_payments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_payments_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_payments_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_reminders: {
        Row: {
          agent_id: string | null
          id: string
          policy_id: string
          reminder_type: string
          sent_at: string
          sms_log_id: string | null
        }
        Insert: {
          agent_id?: string | null
          id?: string
          policy_id: string
          reminder_type: string
          sent_at?: string
          sms_log_id?: string | null
        }
        Update: {
          agent_id?: string | null
          id?: string
          policy_id?: string
          reminder_type?: string
          sent_at?: string
          sms_log_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "policy_reminders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_reminders_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_reminders_sms_log_id_fkey"
            columns: ["sms_log_id"]
            isOneToOne: false
            referencedRelation: "sms_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_renewal_tracking: {
        Row: {
          agent_id: string | null
          contacted_by: string | null
          created_at: string
          id: string
          last_contacted_at: string | null
          notes: string | null
          policy_id: string
          reminder_sent_at: string | null
          renewal_status: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          contacted_by?: string | null
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          policy_id: string
          reminder_sent_at?: string | null
          renewal_status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          contacted_by?: string | null
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          policy_id?: string
          reminder_sent_at?: string | null
          renewal_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_renewal_tracking_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_renewal_tracking_contacted_by_fkey"
            columns: ["contacted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_renewal_tracking_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_transfers: {
        Row: {
          adjustment_amount: number | null
          adjustment_type: string | null
          agent_id: string | null
          branch_id: string | null
          client_id: string
          created_at: string
          created_by_admin_id: string | null
          from_car_id: string
          id: string
          new_policy_id: string | null
          note: string | null
          policy_id: string
          to_car_id: string
          transfer_date: string
        }
        Insert: {
          adjustment_amount?: number | null
          adjustment_type?: string | null
          agent_id?: string | null
          branch_id?: string | null
          client_id: string
          created_at?: string
          created_by_admin_id?: string | null
          from_car_id: string
          id?: string
          new_policy_id?: string | null
          note?: string | null
          policy_id: string
          to_car_id: string
          transfer_date?: string
        }
        Update: {
          adjustment_amount?: number | null
          adjustment_type?: string | null
          agent_id?: string | null
          branch_id?: string | null
          client_id?: string
          created_at?: string
          created_by_admin_id?: string | null
          from_car_id?: string
          id?: string
          new_policy_id?: string | null
          note?: string | null
          policy_id?: string
          to_car_id?: string
          transfer_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_transfers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_from_car_id_fkey"
            columns: ["from_car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_new_policy_id_fkey"
            columns: ["new_policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_transfers_to_car_id_fkey"
            columns: ["to_car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          age_band: Database["public"]["Enums"]["age_band"] | null
          agent_id: string | null
          car_type: Database["public"]["Enums"]["car_type"] | null
          company_id: string
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          max_car_value: number | null
          min_car_value: number | null
          notes: string | null
          policy_type_parent: Database["public"]["Enums"]["policy_type_parent"]
          rule_type: Database["public"]["Enums"]["pricing_rule_type"]
          updated_at: string
          value: number
        }
        Insert: {
          age_band?: Database["public"]["Enums"]["age_band"] | null
          agent_id?: string | null
          car_type?: Database["public"]["Enums"]["car_type"] | null
          company_id: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          max_car_value?: number | null
          min_car_value?: number | null
          notes?: string | null
          policy_type_parent: Database["public"]["Enums"]["policy_type_parent"]
          rule_type: Database["public"]["Enums"]["pricing_rule_type"]
          updated_at?: string
          value: number
        }
        Update: {
          age_band?: Database["public"]["Enums"]["age_band"] | null
          agent_id?: string | null
          car_type?: Database["public"]["Enums"]["car_type"] | null
          company_id?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          max_car_value?: number | null
          min_car_value?: number | null
          notes?: string | null
          policy_type_parent?: Database["public"]["Enums"]["policy_type_parent"]
          rule_type?: Database["public"]["Enums"]["pricing_rule_type"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agent_id: string | null
          avatar_url: string | null
          branch_id: string | null
          created_at: string
          email: string
          email_confirmed: boolean | null
          full_name: string | null
          id: string
          last_seen_notifications_at: string | null
          onboarding_completed: boolean
          pbx_extension: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          email: string
          email_confirmed?: boolean | null
          full_name?: string | null
          id: string
          last_seen_notifications_at?: string | null
          onboarding_completed?: boolean
          pbx_extension?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          email?: string
          email_confirmed?: boolean | null
          full_name?: string | null
          id?: string
          last_seen_notifications_at?: string | null
          onboarding_completed?: boolean
          pbx_extension?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_claim_notes: {
        Row: {
          agent_id: string | null
          claim_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          agent_id?: string | null
          claim_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          agent_id?: string | null
          claim_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_claim_notes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_claim_notes_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "repair_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_claim_reminders: {
        Row: {
          agent_id: string | null
          claim_id: string
          created_at: string
          created_by: string | null
          id: string
          is_done: boolean | null
          message: string | null
          reminder_date: string
          reminder_time: string | null
          reminder_type: string | null
        }
        Insert: {
          agent_id?: string | null
          claim_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_done?: boolean | null
          message?: string | null
          reminder_date: string
          reminder_time?: string | null
          reminder_type?: string | null
        }
        Update: {
          agent_id?: string | null
          claim_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_done?: boolean | null
          message?: string | null
          reminder_date?: string
          reminder_time?: string | null
          reminder_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_claim_reminders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_claim_reminders_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "repair_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_claims: {
        Row: {
          accident_date: string | null
          agent_id: string | null
          car_type: string | null
          claim_number: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          expense_id: string | null
          external_car_model: string | null
          external_car_number: string | null
          garage_name: string
          id: string
          insurance_company_id: string | null
          insurance_file_number: string | null
          notes: string | null
          policy_id: string | null
          repairs_description: string | null
          status: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          accident_date?: string | null
          agent_id?: string | null
          car_type?: string | null
          claim_number?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expense_id?: string | null
          external_car_model?: string | null
          external_car_number?: string | null
          garage_name: string
          id?: string
          insurance_company_id?: string | null
          insurance_file_number?: string | null
          notes?: string | null
          policy_id?: string | null
          repairs_description?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          accident_date?: string | null
          agent_id?: string | null
          car_type?: string | null
          claim_number?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expense_id?: string | null
          external_car_model?: string | null
          external_car_number?: string | null
          garage_name?: string
          id?: string
          insurance_company_id?: string | null
          insurance_file_number?: string | null
          notes?: string | null
          policy_id?: string | null
          repairs_description?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_claims_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_claims_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_claims_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_claims_insurance_company_id_fkey"
            columns: ["insurance_company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_claims_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      road_services: {
        Row: {
          active: boolean
          agent_id: string | null
          allowed_car_types: Database["public"]["Enums"]["car_type"][]
          created_at: string
          description: string | null
          id: string
          name: string
          name_ar: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          allowed_car_types?: Database["public"]["Enums"]["car_type"][]
          created_at?: string
          description?: string | null
          id?: string
          name: string
          name_ar?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          allowed_car_types?: Database["public"]["Enums"]["car_type"][]
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          name_ar?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "road_services_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_supplements: {
        Row: {
          agent_id: string | null
          car_number: string | null
          car_value: number | null
          company_id: string
          company_payment: number
          created_at: string
          created_by_admin_id: string | null
          customer_name: string | null
          description: string
          end_date: string | null
          id: string
          insurance_price: number
          is_cancelled: boolean | null
          policy_type: string | null
          profit: number
          settlement_date: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          car_number?: string | null
          car_value?: number | null
          company_id: string
          company_payment?: number
          created_at?: string
          created_by_admin_id?: string | null
          customer_name?: string | null
          description?: string
          end_date?: string | null
          id?: string
          insurance_price?: number
          is_cancelled?: boolean | null
          policy_type?: string | null
          profit?: number
          settlement_date?: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          car_number?: string | null
          car_value?: number | null
          company_id?: string
          company_payment?: number
          created_at?: string
          created_by_admin_id?: string | null
          customer_name?: string | null
          description?: string
          end_date?: string | null
          id?: string
          insurance_price?: number
          is_cancelled?: boolean | null
          policy_type?: string | null
          profit?: number
          settlement_date?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_supplements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_supplements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_supplements_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_analytics_events: {
        Row: {
          country: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          page: string | null
          referrer: string | null
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          page?: string | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          page?: string | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          agent_id: string | null
          favicon_url: string | null
          id: string
          logo_url: string | null
          og_image_url: string | null
          signature_body_html: string | null
          signature_footer_html: string | null
          signature_header_html: string | null
          signature_primary_color: string | null
          site_description: string
          site_title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agent_id?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          og_image_url?: string | null
          signature_body_html?: string | null
          signature_footer_html?: string | null
          signature_header_html?: string | null
          signature_primary_color?: string | null
          site_description?: string
          site_title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agent_id?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          og_image_url?: string | null
          signature_body_html?: string | null
          signature_footer_html?: string | null
          signature_header_html?: string | null
          signature_primary_color?: string | null
          site_description?: string
          site_title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_logs: {
        Row: {
          agent_id: string | null
          branch_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          message: string
          phone_number: string
          policy_id: string | null
          sent_at: string | null
          sms_type: Database["public"]["Enums"]["sms_type"]
          status: string
        }
        Insert: {
          agent_id?: string | null
          branch_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          message: string
          phone_number: string
          policy_id?: string | null
          sent_at?: string | null
          sms_type?: Database["public"]["Enums"]["sms_type"]
          status?: string
        }
        Update: {
          agent_id?: string | null
          branch_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          message?: string
          phone_number?: string
          policy_id?: string | null
          sent_at?: string | null
          sms_type?: Database["public"]["Enums"]["sms_type"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_settings: {
        Row: {
          agent_id: string | null
          birthday_sms_enabled: boolean | null
          birthday_sms_template: string | null
          cancellation_sms_template: string | null
          company_email: string | null
          company_location: string | null
          company_phone_links: Json | null
          company_phones: string[] | null
          company_whatsapp: string | null
          created_at: string
          default_ab_invoice_template_id: string | null
          default_insurance_invoice_template_id: string | null
          default_signature_template_id: string | null
          enable_auto_reminders: boolean | null
          enable_auto_renewal_reminders: boolean | null
          id: string
          invoice_sms_template: string | null
          is_enabled: boolean
          license_expiry_sms_enabled: boolean | null
          license_expiry_sms_template: string | null
          payment_request_template: string | null
          provider: string
          reminder_1month_template: string | null
          reminder_1week_template: string | null
          renewal_reminder_1month_enabled: boolean | null
          renewal_reminder_1week_enabled: boolean | null
          renewal_reminder_cooldown_days: number | null
          renewal_reminder_days: number | null
          renewal_reminder_template: string | null
          signature_sms_template: string | null
          sms_source: string | null
          sms_token: string | null
          sms_user: string | null
          sms_verification_message: string | null
          sms_verification_status: string
          sms_verified_at: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          birthday_sms_enabled?: boolean | null
          birthday_sms_template?: string | null
          cancellation_sms_template?: string | null
          company_email?: string | null
          company_location?: string | null
          company_phone_links?: Json | null
          company_phones?: string[] | null
          company_whatsapp?: string | null
          created_at?: string
          default_ab_invoice_template_id?: string | null
          default_insurance_invoice_template_id?: string | null
          default_signature_template_id?: string | null
          enable_auto_reminders?: boolean | null
          enable_auto_renewal_reminders?: boolean | null
          id?: string
          invoice_sms_template?: string | null
          is_enabled?: boolean
          license_expiry_sms_enabled?: boolean | null
          license_expiry_sms_template?: string | null
          payment_request_template?: string | null
          provider?: string
          reminder_1month_template?: string | null
          reminder_1week_template?: string | null
          renewal_reminder_1month_enabled?: boolean | null
          renewal_reminder_1week_enabled?: boolean | null
          renewal_reminder_cooldown_days?: number | null
          renewal_reminder_days?: number | null
          renewal_reminder_template?: string | null
          signature_sms_template?: string | null
          sms_source?: string | null
          sms_token?: string | null
          sms_user?: string | null
          sms_verification_message?: string | null
          sms_verification_status?: string
          sms_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          birthday_sms_enabled?: boolean | null
          birthday_sms_template?: string | null
          cancellation_sms_template?: string | null
          company_email?: string | null
          company_location?: string | null
          company_phone_links?: Json | null
          company_phones?: string[] | null
          company_whatsapp?: string | null
          created_at?: string
          default_ab_invoice_template_id?: string | null
          default_insurance_invoice_template_id?: string | null
          default_signature_template_id?: string | null
          enable_auto_reminders?: boolean | null
          enable_auto_renewal_reminders?: boolean | null
          id?: string
          invoice_sms_template?: string | null
          is_enabled?: boolean
          license_expiry_sms_enabled?: boolean | null
          license_expiry_sms_template?: string | null
          payment_request_template?: string | null
          provider?: string
          reminder_1month_template?: string | null
          reminder_1week_template?: string | null
          renewal_reminder_1month_enabled?: boolean | null
          renewal_reminder_1week_enabled?: boolean | null
          renewal_reminder_cooldown_days?: number | null
          renewal_reminder_days?: number | null
          renewal_reminder_template?: string | null
          signature_sms_template?: string | null
          sms_source?: string | null
          sms_token?: string | null
          sms_user?: string | null
          sms_verification_message?: string | null
          sms_verification_status?: string
          sms_verified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_settings_default_ab_invoice_template_id_fkey"
            columns: ["default_ab_invoice_template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_settings_default_insurance_invoice_template_id_fkey"
            columns: ["default_insurance_invoice_template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_settings_default_signature_template_id_fkey"
            columns: ["default_signature_template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          badge: string | null
          created_at: string | null
          description: string | null
          features: Json
          id: string
          is_active: boolean
          is_hidden: boolean
          monthly_price: number
          name: string
          name_ar: string | null
          plan_key: string
          sort_order: number
          updated_at: string | null
          yearly_price: number
        }
        Insert: {
          badge?: string | null
          created_at?: string | null
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          is_hidden?: boolean
          monthly_price?: number
          name: string
          name_ar?: string | null
          plan_key: string
          sort_order?: number
          updated_at?: string | null
          yearly_price?: number
        }
        Update: {
          badge?: string | null
          created_at?: string | null
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          is_hidden?: boolean
          monthly_price?: number
          name?: string
          name_ar?: string | null
          plan_key?: string
          sort_order?: number
          updated_at?: string | null
          yearly_price?: number
        }
        Relationships: []
      }
      tasks: {
        Row: {
          agent_id: string | null
          assigned_to: string
          branch_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          created_by: string
          description: string | null
          due_date: string
          due_time: string
          id: string
          reminder_shown: boolean | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          assigned_to: string
          branch_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          due_date: string
          due_time: string
          id?: string
          reminder_shown?: boolean | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          assigned_to?: string
          branch_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          due_date?: string
          due_time?: string
          id?: string
          reminder_shown?: boolean | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      thiqa_platform_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      thiqa_super_admins: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
          id: string
          name: string | null
          phone: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
          id?: string
          name?: string | null
          phone?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          browser_name: string | null
          browser_version: string | null
          city: string | null
          country: string | null
          created_at: string | null
          device_type: string | null
          duration_minutes: number | null
          ended_at: string | null
          id: string
          ip_address: string | null
          is_active: boolean | null
          os_name: string | null
          started_at: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          browser_name?: string | null
          browser_version?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          device_type?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          os_name?: string | null
          started_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          browser_name?: string | null
          browser_version?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          device_type?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          os_name?: string | null
          started_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xservice_settings: {
        Row: {
          agent_id: string | null
          agent_name: string
          api_key: string
          api_url: string
          id: string
          invoice_base_url: string | null
          is_enabled: boolean
          sync_accident_fee: boolean
          sync_road_service: boolean
          updated_at: string
          xservice_agent_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string
          api_key?: string
          api_url?: string
          id?: string
          invoice_base_url?: string | null
          is_enabled?: boolean
          sync_accident_fee?: boolean
          sync_road_service?: boolean
          updated_at?: string
          xservice_agent_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          api_key?: string
          api_url?: string
          id?: string
          invoice_base_url?: string | null
          is_enabled?: boolean
          sync_accident_fee?: boolean
          sync_road_service?: boolean
          updated_at?: string
          xservice_agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "xservice_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      xservice_sync_log: {
        Row: {
          agent_id: string | null
          created_at: string
          error_message: string | null
          id: string
          policy_id: string
          request_payload: Json
          response_payload: Json | null
          retried_at: string | null
          status: string
          xservice_policy_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          policy_id: string
          request_payload?: Json
          response_payload?: Json | null
          retried_at?: string | null
          status?: string
          xservice_policy_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          policy_id?: string
          request_payload?: Json
          response_payload?: Json | null
          retried_at?: string | null
          status?: string
          xservice_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "xservice_sync_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xservice_sync_log_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agent_matches: {
        Args: { _row_agent_id: string; _user_id: string }
        Returns: boolean
      }
      calculate_policy_company_payment: {
        Args: {
          p_age_band: Database["public"]["Enums"]["age_band"]
          p_car_type: Database["public"]["Enums"]["car_type"]
          p_car_value: number
          p_car_year: number
          p_company_id: string
          p_insurance_price: number
          p_policy_type_child: Database["public"]["Enums"]["policy_type_child"]
          p_policy_type_parent: Database["public"]["Enums"]["policy_type_parent"]
        }
        Returns: {
          company_payment: number
          profit: number
        }[]
      }
      can_access_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_financials: { Args: { _user_id: string }; Returns: boolean }
      can_view_login_attempt: {
        Args: { _attempt_user_id: string }
        Returns: boolean
      }
      clear_data_for_import: { Args: never; Returns: Json }
      dashboard_company_debts: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          outstanding: number
        }[]
      }
      dashboard_company_production: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          company_id: string
          company_name: string
          full_amount: number
          full_count: number
          third_amount: number
          third_count: number
          total_amount: number
          total_count: number
        }[]
      }
      dashboard_insured_cars_count: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: number
      }
      dashboard_total_client_debt: { Args: never; Returns: number }
      enforce_agent_isolation: { Args: { _agent_id: string }; Returns: boolean }
      enforce_agent_isolation_insert: {
        Args: { _agent_id: string }
        Returns: boolean
      }
      find_missing_packages: {
        Args: never
        Returns: {
          car_id: string
          car_number: string
          client_id: string
          client_name: string
          first_created: string
          last_created: string
          policy_count: number
          policy_ids: string[]
          total_price: number
          types: string[]
        }[]
      }
      fix_service_policies_company: { Args: never; Returns: Json }
      generate_file_number: { Args: never; Returns: string }
      generate_invoice_number: { Args: never; Returns: string }
      get_ab_balance: {
        Args: { p_branch_id?: string; p_from_date?: string; p_to_date?: string }
        Returns: {
          broker_payables: number
          broker_receivables: number
          company_payables: number
          customer_refunds_due: number
          net_balance: number
          total_expense: number
          total_income: number
        }[]
      }
      get_active_users_for_tasks: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      get_admin_contact_emails: {
        Args: never
        Returns: {
          email: string
        }[]
      }
      get_all_companies_wallet_summary: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          company_name_ar: string
          elzami_costs: number
          outstanding: number
          total_paid: number
          total_payable: number
        }[]
      }
      get_client_balance: {
        Args: { p_client_id: string }
        Returns: {
          total_insurance: number
          total_paid: number
          total_refunds: number
          total_remaining: number
        }[]
      }
      get_client_renewal_policies:
        | {
            Args: { p_client_id: string; p_end_month: string }
            Returns: {
              car_number: string
              company_name_ar: string
              days_remaining: number
              end_date: string
              insurance_price: number
              policy_id: string
              policy_type_parent: string
              renewal_status: string
            }[]
          }
        | {
            Args: {
              p_client_id: string
              p_end_date?: string
              p_start_date?: string
            }
            Returns: {
              car_id: string
              car_number: string
              company_id: string
              company_name: string
              company_name_ar: string
              days_remaining: number
              end_date: string
              id: string
              insurance_price: number
              policy_type_child: string
              policy_type_parent: string
              reminder_sent_at: string
              renewal_notes: string
              renewal_status: string
              start_date: string
            }[]
          }
      get_client_wallet_balance: {
        Args: { p_client_id: string }
        Returns: {
          total_credits: number
          total_debits: number
          total_refunds: number
          wallet_balance: number
        }[]
      }
      get_company_balance: {
        Args: { p_company_id: string; p_from_date?: string; p_to_date?: string }
        Returns: {
          outstanding: number
          total_paid: number
          total_payable: number
        }[]
      }
      get_company_wallet_balance: {
        Args: { p_company_id: string; p_from_date?: string; p_to_date?: string }
        Returns: {
          elzami_costs: number
          outstanding: number
          total_paid: number
          total_payable: number
        }[]
      }
      get_my_agent_id: { Args: never; Returns: string }
      get_tasks_with_users: {
        Args: { target_date: string }
        Returns: {
          assigned_to: string
          assignee_email: string
          assignee_full_name: string
          assignee_id: string
          branch_id: string
          completed_at: string
          completed_by: string
          created_at: string
          created_by: string
          creator_email: string
          creator_full_name: string
          creator_id: string
          description: string
          due_date: string
          due_time: string
          id: string
          reminder_shown: boolean
          status: string
          title: string
          updated_at: string
        }[]
      }
      get_tasks_with_users_and_pending: {
        Args: { target_date: string }
        Returns: {
          assigned_to: string
          assignee_email: string
          assignee_full_name: string
          assignee_id: string
          branch_id: string
          completed_at: string
          completed_by: string
          created_at: string
          created_by: string
          creator_email: string
          creator_full_name: string
          creator_id: string
          description: string
          due_date: string
          due_time: string
          id: string
          is_overdue: boolean
          reminder_shown: boolean
          status: string
          title: string
          updated_at: string
        }[]
      }
      get_user_agent_id: { Args: { _user_id: string }; Returns: string }
      get_user_branch_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_usage_log: {
        Args: { p_agent_id: string; p_period: string; p_usage_type: string }
        Returns: undefined
      }
      insert_ledger_entry: {
        Args: {
          p_admin_id?: string
          p_amount: number
          p_branch_id?: string
          p_category: Database["public"]["Enums"]["ledger_category"]
          p_counterparty_id: string
          p_counterparty_type: Database["public"]["Enums"]["ledger_counterparty_type"]
          p_description?: string
          p_policy_id?: string
          p_policy_type?: string
          p_reference_id: string
          p_reference_type: Database["public"]["Enums"]["ledger_reference_type"]
          p_transaction_date?: string
        }
        Returns: string
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      is_agent_active: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      report_client_debts:
        | {
            Args: {
              p_branch_id?: string
              p_filter_days?: number
              p_page?: number
              p_page_size?: number
            }
            Returns: {
              cars_count: number
              client_id: string
              client_name: string
              client_phone: string
              days_until_oldest: number
              oldest_end_date: string
              policies_count: number
              total_owed: number
              total_paid: number
              total_remaining: number
            }[]
          }
        | {
            Args: {
              p_filter_days?: number
              p_limit?: number
              p_offset?: number
              p_search?: string
            }
            Returns: {
              client_id: string
              client_name: string
              client_phone: string
              days_until_oldest: number
              oldest_end_date: string
              policies_count: number
              total_insurance: number
              total_paid: number
              total_refunds: number
              total_remaining: number
              total_rows: number
            }[]
          }
      report_client_debts_summary:
        | {
            Args: { p_branch_id?: string; p_filter_days?: number }
            Returns: {
              total_clients: number
              total_owed: number
              total_remaining: number
            }[]
          }
        | {
            Args: { p_filter_days?: number; p_search?: string }
            Returns: {
              total_clients: number
              total_remaining: number
            }[]
          }
      report_company_settlement:
        | {
            Args: {
              p_broker_id?: string
              p_company_id?: string
              p_end_date?: string
              p_include_cancelled?: boolean
              p_policy_type_parent?: Database["public"]["Enums"]["policy_type_parent"]
              p_start_date?: string
            }
            Returns: {
              company_id: string
              company_name: string
              company_name_ar: string
              policy_count: number
              total_company_payment: number
              total_insurance_price: number
            }[]
          }
        | {
            Args: {
              p_broker_id?: string
              p_broker_ids?: string[]
              p_company_id?: string
              p_company_ids?: string[]
              p_end_date?: string
              p_include_cancelled?: boolean
              p_policy_type_parent?: Database["public"]["Enums"]["policy_type_parent"]
              p_policy_types?: string[]
              p_start_date?: string
            }
            Returns: {
              company_id: string
              company_name: string
              company_name_ar: string
              policy_count: number
              total_company_payment: number
              total_insurance_price: number
            }[]
          }
      report_company_settlement_company_options:
        | {
            Args: {
              p_broker_id?: string
              p_end_date?: string
              p_policy_type_parent?: Database["public"]["Enums"]["policy_type_parent"]
              p_start_date?: string
            }
            Returns: {
              company_id: string
              company_name: string
              company_name_ar: string
            }[]
          }
        | {
            Args: {
              p_broker_id?: string
              p_broker_ids?: string[]
              p_end_date?: string
              p_policy_type_parent?: Database["public"]["Enums"]["policy_type_parent"]
              p_policy_types?: string[]
              p_start_date?: string
            }
            Returns: {
              company_id: string
              company_name: string
              company_name_ar: string
            }[]
          }
      report_created_policies: {
        Args: {
          p_company_id?: string
          p_created_by?: string
          p_end_date: string
          p_page?: number
          p_page_size?: number
          p_policy_type?: string
          p_search?: string
          p_start_date: string
        }
        Returns: {
          branch_name: string
          car_id: string
          car_number: string
          client_file_number: string
          client_id: string
          client_name: string
          client_phone: string
          company_id: string
          company_name: string
          company_name_ar: string
          created_at: string
          created_by_admin_id: string
          created_by_name: string
          end_date: string
          group_key: string
          id: string
          insurance_price: number
          is_package: boolean
          package_companies: string[]
          package_count: number
          package_policy_ids: string[]
          package_service_names: string[]
          package_types: string[]
          payment_status: string
          policy_number: string
          policy_type_child: string
          policy_type_parent: string
          profit: number
          remaining: number
          start_date: string
          total_count: number
          total_paid: number
        }[]
      }
      report_debt_policies_for_clients: {
        Args: { p_client_ids: string[] }
        Returns: {
          car_number: string
          client_id: string
          days_until_expiry: number
          end_date: string
          group_id: string
          insurance_price: number
          paid: number
          policy_id: string
          policy_number: string
          policy_type_child: string
          policy_type_parent: string
          remaining: number
          status: string
        }[]
      }
      report_renewals:
        | {
            Args: {
              p_created_by?: string
              p_end_month: string
              p_policy_type?: string
              p_search?: string
            }
            Returns: {
              client_file_number: string
              client_id: string
              client_name: string
              client_phone: string
              earliest_end_date: string
              min_days_remaining: number
              policy_count: number
              total_insurance_price: number
            }[]
          }
        | {
            Args: {
              p_branch_id?: string
              p_broker_id?: string
              p_company_id?: string
              p_end_date?: string
              p_policy_type?: string
              p_show_cancelled?: boolean
              p_show_renewed?: boolean
              p_start_date?: string
            }
            Returns: {
              branch_id: string
              branch_name: string
              broker_id: string
              broker_name: string
              car_details: string
              car_id: string
              car_number: string
              client_id: string
              client_id_number: string
              client_name: string
              client_phone: string
              company_id: string
              company_name: string
              company_payment: number
              created_at: string
              end_date: string
              is_renewed: boolean
              policy_id: string
              policy_number: string
              policy_type: string
              policy_type_parent: string
              profit: number
              renewed_policy_id: string
              start_date: string
              status: string
              total_price: number
            }[]
          }
        | {
            Args: {
              p_created_by?: string
              p_end_date?: string
              p_page?: number
              p_page_size?: number
              p_policy_type?: string
              p_search?: string
              p_start_date?: string
            }
            Returns: {
              car_numbers: string[]
              client_file_number: string
              client_id: string
              client_name: string
              client_phone: string
              days_remaining: number
              earliest_end_date: string
              policies_count: number
              policy_ids: string[]
              policy_types: string[]
              renewal_notes: string
              total_count: number
              total_insurance_price: number
              worst_renewal_status: string
            }[]
          }
      report_renewals_service:
        | {
            Args: {
              p_days_remaining?: number
              p_end_month?: string
              p_limit?: number
              p_offset?: number
              p_policy_type?: string
            }
            Returns: {
              car_numbers: string[]
              client_file_number: string
              client_id: string
              client_name: string
              client_phone: string
              days_remaining: number
              earliest_end_date: string
              policies_count: number
              policy_types: string[]
              renewal_notes: string
              renewal_status: string
              total_price: number
              total_rows: number
            }[]
          }
        | {
            Args: {
              p_days_remaining?: number
              p_end_month?: string
              p_limit?: number
              p_offset?: number
              p_policy_type?: string
            }
            Returns: {
              car_numbers: string[]
              client_file_number: string
              client_id: string
              client_name: string
              client_phone: string
              days_remaining: number
              earliest_end_date: string
              policies_count: number
              policy_types: string[]
              renewal_notes: string
              renewal_status: string
              total_price: number
              total_rows: number
            }[]
          }
        | {
            Args: {
              p_branch_id?: string
              p_broker_id?: string
              p_company_id?: string
              p_end_date?: string
              p_page_number?: number
              p_page_size?: number
              p_policy_type?: string
              p_show_cancelled?: boolean
              p_show_renewed?: boolean
              p_start_date?: string
            }
            Returns: {
              branch_id: string
              branch_name: string
              broker_id: string
              broker_name: string
              car_details: string
              car_id: string
              car_number: string
              client_id: string
              client_id_number: string
              client_name: string
              client_phone: string
              company_id: string
              company_name: string
              company_payment: number
              created_at: string
              end_date: string
              is_renewed: boolean
              policy_id: string
              policy_number: string
              policy_type: string
              policy_type_parent: string
              profit: number
              renewed_policy_id: string
              start_date: string
              status: string
              total_count: number
              total_price: number
            }[]
          }
      report_renewals_service_detailed: {
        Args: {
          p_days_remaining?: number
          p_end_month: string
          p_policy_type?: string
        }
        Returns: {
          car_number: string
          client_file_number: string
          client_id: string
          client_name: string
          client_phone: string
          company_name_ar: string
          days_remaining: number
          end_date: string
          insurance_price: number
          policy_id: string
          policy_type_parent: string
          renewal_status: string
        }[]
      }
      report_renewals_summary: {
        Args: {
          p_created_by?: string
          p_end_month?: string
          p_policy_type?: string
          p_search?: string
        }
        Returns: {
          called: number
          not_contacted: number
          not_interested: number
          renewed: number
          sms_sent: number
          total_expiring: number
          total_packages: number
          total_single: number
          total_value: number
        }[]
      }
      report_renewed_clients: {
        Args: {
          p_created_by?: string
          p_end_month?: string
          p_limit?: number
          p_offset?: number
          p_policy_type?: string
          p_search?: string
        }
        Returns: {
          client_file_number: string
          client_id: string
          client_name: string
          client_phone: string
          earliest_end_date: string
          has_package: boolean
          new_policies_count: number
          new_policy_ids: string[]
          new_policy_types: string[]
          new_start_date: string
          new_total_price: number
          policies_count: number
          policy_ids: string[]
          policy_types: string[]
          renewed_by_admin_id: string
          renewed_by_name: string
          total_count: number
          total_insurance_price: number
        }[]
      }
      reverse_ledger_entry: {
        Args: { p_admin_id?: string; p_entry_id: string; p_reason?: string }
        Returns: string
      }
      set_features_for_plan: {
        Args: { p_agent_id: string; p_plan: string }
        Returns: undefined
      }
      user_belongs_to_agent: {
        Args: { _agent_id: string; _user_id: string }
        Returns: boolean
      }
      user_directory_get_by_ids: {
        Args: { p_ids: string[] }
        Returns: {
          display_name: string
          email: string
          id: string
        }[]
      }
      user_directory_list_active: {
        Args: never
        Returns: {
          display_name: string
          email: string
          id: string
        }[]
      }
    }
    Enums: {
      age_band: "UNDER_24" | "UP_24" | "ANY"
      app_role: "admin" | "worker"
      broker_direction: "from_broker" | "to_broker"
      car_type: "car" | "cargo" | "small" | "taxi" | "tjeradown4" | "tjeraup4"
      ledger_category:
        | "premium_income"
        | "company_payable"
        | "company_payable_reversal"
        | "commission_income"
        | "commission_expense"
        | "profit_share"
        | "receivable_collected"
        | "receivable_reversal"
        | "refund_payable"
        | "broker_receivable"
        | "broker_payable"
        | "broker_settlement_paid"
        | "broker_settlement_received"
        | "company_settlement_paid"
        | "adjustment"
        | "company_settlement_reversal"
      ledger_counterparty_type:
        | "insurance_company"
        | "customer"
        | "broker"
        | "internal"
      ledger_reference_type:
        | "policy_created"
        | "policy_cancelled"
        | "policy_transferred"
        | "payment_received"
        | "payment_refused"
        | "cheque_returned"
        | "cheque_restored"
        | "company_settlement"
        | "broker_settlement"
        | "customer_refund"
        | "manual_adjustment"
        | "company_settlement_reversal"
      ledger_status: "posted" | "reversed" | "pending"
      payment_status: "paid" | "partial" | "unpaid"
      payment_type: "cash" | "cheque" | "visa" | "transfer"
      policy_type_child: "THIRD" | "FULL"
      policy_type_parent:
        | "ELZAMI"
        | "THIRD_FULL"
        | "ROAD_SERVICE"
        | "ACCIDENT_FEE_EXEMPTION"
        | "HEALTH"
        | "LIFE"
        | "PROPERTY"
        | "TRAVEL"
        | "BUSINESS"
        | "OTHER"
      pricing_rule_type:
        | "THIRD_PRICE"
        | "FULL_PERCENT"
        | "DISCOUNT"
        | "MIN_PRICE"
        | "ROAD_SERVICE_PRICE"
        | "ROAD_SERVICE_BASE"
        | "ROAD_SERVICE_EXTRA_OLD_CAR"
      sms_type:
        | "invoice"
        | "signature"
        | "reminder_1month"
        | "reminder_1week"
        | "manual"
        | "payment_request"
      under24_type: "none" | "client" | "additional_driver"
      user_status: "pending" | "active" | "blocked"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      age_band: ["UNDER_24", "UP_24", "ANY"],
      app_role: ["admin", "worker"],
      broker_direction: ["from_broker", "to_broker"],
      car_type: ["car", "cargo", "small", "taxi", "tjeradown4", "tjeraup4"],
      ledger_category: [
        "premium_income",
        "company_payable",
        "company_payable_reversal",
        "commission_income",
        "commission_expense",
        "profit_share",
        "receivable_collected",
        "receivable_reversal",
        "refund_payable",
        "broker_receivable",
        "broker_payable",
        "broker_settlement_paid",
        "broker_settlement_received",
        "company_settlement_paid",
        "adjustment",
        "company_settlement_reversal",
      ],
      ledger_counterparty_type: [
        "insurance_company",
        "customer",
        "broker",
        "internal",
      ],
      ledger_reference_type: [
        "policy_created",
        "policy_cancelled",
        "policy_transferred",
        "payment_received",
        "payment_refused",
        "cheque_returned",
        "cheque_restored",
        "company_settlement",
        "broker_settlement",
        "customer_refund",
        "manual_adjustment",
        "company_settlement_reversal",
      ],
      ledger_status: ["posted", "reversed", "pending"],
      payment_status: ["paid", "partial", "unpaid"],
      payment_type: ["cash", "cheque", "visa", "transfer"],
      policy_type_child: ["THIRD", "FULL"],
      policy_type_parent: [
        "ELZAMI",
        "THIRD_FULL",
        "ROAD_SERVICE",
        "ACCIDENT_FEE_EXEMPTION",
        "HEALTH",
        "LIFE",
        "PROPERTY",
        "TRAVEL",
        "BUSINESS",
        "OTHER",
      ],
      pricing_rule_type: [
        "THIRD_PRICE",
        "FULL_PERCENT",
        "DISCOUNT",
        "MIN_PRICE",
        "ROAD_SERVICE_PRICE",
        "ROAD_SERVICE_BASE",
        "ROAD_SERVICE_EXTRA_OLD_CAR",
      ],
      sms_type: [
        "invoice",
        "signature",
        "reminder_1month",
        "reminder_1week",
        "manual",
        "payment_request",
      ],
      under24_type: ["none", "client", "additional_driver"],
      user_status: ["pending", "active", "blocked"],
    },
  },
} as const
