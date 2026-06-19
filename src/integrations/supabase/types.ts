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
      ai_insights_runs: {
        Row: {
          generated_at: string
          id: string
          insights: Json
          model: string | null
          stats_summary: Json | null
          user_id: string
        }
        Insert: {
          generated_at?: string
          id?: string
          insights: Json
          model?: string | null
          stats_summary?: Json | null
          user_id: string
        }
        Update: {
          generated_at?: string
          id?: string
          insights?: Json
          model?: string | null
          stats_summary?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_training_instructions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          instruction_text: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          instruction_text: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          instruction_text?: string
          is_active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_instructions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          last_evaluated_at: string | null
          name: string
          rule_type: Database["public"]["Enums"]["alert_rule_type"]
          severity: Database["public"]["Enums"]["alert_severity"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_evaluated_at?: string | null
          name: string
          rule_type: Database["public"]["Enums"]["alert_rule_type"]
          severity?: Database["public"]["Enums"]["alert_severity"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_evaluated_at?: string | null
          name?: string
          rule_type?: Database["public"]["Enums"]["alert_rule_type"]
          severity?: Database["public"]["Enums"]["alert_severity"]
          updated_at?: string
        }
        Relationships: []
      }
      alert_settings: {
        Row: {
          id: string
          threshold_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          threshold_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          threshold_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      claims_raw: {
        Row: {
          acct: string | null
          avg_days_to_pmt: number | null
          company: string
          cpt: string | null
          days_to_pmt: number | null
          denied_claim: boolean | null
          dob: string | null
          dos: string | null
          id: string
          is_primary_billable: boolean | null
          last_updated_upload_id: string | null
          mrn: string | null
          pay_date: string | null
          pri_ins: string | null
          prov_code: string | null
          prov_name: string | null
          pt_name: string | null
          revenue: number | null
          service_category: string | null
          source_file_id: string | null
          upload_id: string | null
          uploaded_at: string
          visit_type: string | null
        }
        Insert: {
          acct?: string | null
          avg_days_to_pmt?: number | null
          company: string
          cpt?: string | null
          days_to_pmt?: number | null
          denied_claim?: boolean | null
          dob?: string | null
          dos?: string | null
          id?: string
          is_primary_billable?: boolean | null
          last_updated_upload_id?: string | null
          mrn?: string | null
          pay_date?: string | null
          pri_ins?: string | null
          prov_code?: string | null
          prov_name?: string | null
          pt_name?: string | null
          revenue?: number | null
          service_category?: string | null
          source_file_id?: string | null
          upload_id?: string | null
          uploaded_at?: string
          visit_type?: string | null
        }
        Update: {
          acct?: string | null
          avg_days_to_pmt?: number | null
          company?: string
          cpt?: string | null
          days_to_pmt?: number | null
          denied_claim?: boolean | null
          dob?: string | null
          dos?: string | null
          id?: string
          is_primary_billable?: boolean | null
          last_updated_upload_id?: string | null
          mrn?: string | null
          pay_date?: string | null
          pri_ins?: string | null
          prov_code?: string | null
          prov_name?: string | null
          pt_name?: string | null
          revenue?: number | null
          service_category?: string | null
          source_file_id?: string | null
          upload_id?: string | null
          uploaded_at?: string
          visit_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_raw_last_updated_upload_id_fkey"
            columns: ["last_updated_upload_id"]
            isOneToOne: false
            referencedRelation: "upload_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_raw_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_raw_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "upload_history"
            referencedColumns: ["id"]
          },
        ]
      }
      company_access: {
        Row: {
          company_name: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cpt_insurance_overrides: {
        Row: {
          billing_type_override: string | null
          cpt_code: string
          created_at: string
          id: string
          insurance_code: string
          note: string | null
        }
        Insert: {
          billing_type_override?: string | null
          cpt_code: string
          created_at?: string
          id?: string
          insurance_code: string
          note?: string | null
        }
        Update: {
          billing_type_override?: string | null
          cpt_code?: string
          created_at?: string
          id?: string
          insurance_code?: string
          note?: string | null
        }
        Relationships: []
      }
      cpt_reference: {
        Row: {
          billing_type: string | null
          cpt_code: string
          created_at: string
          description: string | null
          service_category: string | null
        }
        Insert: {
          billing_type?: string | null
          cpt_code: string
          created_at?: string
          description?: string | null
          service_category?: string | null
        }
        Update: {
          billing_type?: string | null
          cpt_code?: string
          created_at?: string
          description?: string | null
          service_category?: string | null
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          file_bytes: string | null
          filename: string | null
          filters: Json
          id: string
          name: string | null
          requested_by: string
          row_count: number | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          file_bytes?: string | null
          filename?: string | null
          filters?: Json
          id?: string
          name?: string | null
          requested_by: string
          row_count?: number | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          file_bytes?: string | null
          filename?: string | null
          filters?: Json
          id?: string
          name?: string | null
          requested_by?: string
          row_count?: number | null
          status?: string
        }
        Relationships: []
      }
      field_definitions: {
        Row: {
          created_at: string
          data_type: string
          display_order: number
          field_key: string
          id: string
          is_active: boolean
          label: string
          synonyms: string[]
          updated_at: string
          validation_regex: string | null
        }
        Insert: {
          created_at?: string
          data_type: string
          display_order?: number
          field_key: string
          id?: string
          is_active?: boolean
          label: string
          synonyms?: string[]
          updated_at?: string
          validation_regex?: string | null
        }
        Update: {
          created_at?: string
          data_type?: string
          display_order?: number
          field_key?: string
          id?: string
          is_active?: boolean
          label?: string
          synonyms?: string[]
          updated_at?: string
          validation_regex?: string | null
        }
        Relationships: []
      }
      mapping_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          mapping: Json
          match_company: string | null
          match_filename_pattern: string | null
          name: string
          priority: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          mapping?: Json
          match_company?: string | null
          match_filename_pattern?: string | null
          name: string
          priority?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          mapping?: Json
          match_company?: string | null
          match_filename_pattern?: string | null
          name?: string
          priority?: number
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedup_key: string | null
          id: string
          link: string | null
          read_at: string | null
          rule_id: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          rule_id?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          rule_id?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_row_edits: {
        Row: {
          edited_at: string
          edited_by: string
          field_key: string
          id: string
          new_value: Json | null
          old_value: Json | null
          parsed_row_id: string
          source_file_id: string
        }
        Insert: {
          edited_at?: string
          edited_by: string
          field_key: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          parsed_row_id: string
          source_file_id: string
        }
        Update: {
          edited_at?: string
          edited_by?: string
          field_key?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          parsed_row_id?: string
          source_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parsed_row_edits_parsed_row_id_fkey"
            columns: ["parsed_row_id"]
            isOneToOne: false
            referencedRelation: "parsed_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_row_edits_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_rows: {
        Row: {
          confidence: Json
          created_at: string
          data: Json
          duplicate_key: string | null
          duplicate_of_source_file_id: string | null
          edited: boolean
          edited_at: string | null
          edited_by: string | null
          id: string
          is_duplicate: boolean
          raw_data: Json | null
          row_index: number
          source_file_id: string
          source_row: number | null
          source_sheet: string | null
          validation_errors: Json
        }
        Insert: {
          confidence?: Json
          created_at?: string
          data?: Json
          duplicate_key?: string | null
          duplicate_of_source_file_id?: string | null
          edited?: boolean
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          is_duplicate?: boolean
          raw_data?: Json | null
          row_index: number
          source_file_id: string
          source_row?: number | null
          source_sheet?: string | null
          validation_errors?: Json
        }
        Update: {
          confidence?: Json
          created_at?: string
          data?: Json
          duplicate_key?: string | null
          duplicate_of_source_file_id?: string | null
          edited?: boolean
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          is_duplicate?: boolean
          raw_data?: Json | null
          row_index?: number
          source_file_id?: string
          source_row?: number | null
          source_sheet?: string | null
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "parsed_rows_duplicate_of_source_file_id_fkey"
            columns: ["duplicate_of_source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_rows_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      phi_access_log: {
        Row: {
          action: string
          created_at: string
          details: Json
          id: string
          row_count: number | null
          source_file_id: string | null
          target_id: string | null
          target_table: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          id?: string
          row_count?: number | null
          source_file_id?: string | null
          target_id?: string | null
          target_table?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          id?: string
          row_count?: number | null
          source_file_id?: string | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      source_files: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          column_mapping: Json | null
          detected_company: string | null
          error: string | null
          file_bytes: string | null
          filename: string
          header_row: number | null
          id: string
          kind: string
          mapping_template_id: string | null
          mime: string | null
          row_count: number
          sha256: string | null
          size_bytes: number
          status: string
          unmapped_columns: Json | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          column_mapping?: Json | null
          detected_company?: string | null
          error?: string | null
          file_bytes?: string | null
          filename: string
          header_row?: number | null
          id?: string
          kind?: string
          mapping_template_id?: string | null
          mime?: string | null
          row_count?: number
          sha256?: string | null
          size_bytes?: number
          status?: string
          unmapped_columns?: Json | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          column_mapping?: Json | null
          detected_company?: string | null
          error?: string | null
          file_bytes?: string | null
          filename?: string
          header_row?: number | null
          id?: string
          kind?: string
          mapping_template_id?: string | null
          mime?: string | null
          row_count?: number
          sha256?: string | null
          size_bytes?: number
          status?: string
          unmapped_columns?: Json | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_files_mapping_template_id_fkey"
            columns: ["mapping_template_id"]
            isOneToOne: false
            referencedRelation: "mapping_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_history: {
        Row: {
          company: string
          created_at: string
          errors: Json | null
          filename: string
          id: string
          rows_inserted: number
          rows_processed: number
          rows_skipped: number
          rows_updated: number
          skipped_rows: Json | null
          unknown_cpt_count: number
          unknown_cpts: Json | null
          uploaded_by: string | null
        }
        Insert: {
          company: string
          created_at?: string
          errors?: Json | null
          filename: string
          id?: string
          rows_inserted?: number
          rows_processed?: number
          rows_skipped?: number
          rows_updated?: number
          skipped_rows?: Json | null
          unknown_cpt_count?: number
          unknown_cpts?: Json | null
          uploaded_by?: string | null
        }
        Update: {
          company?: string
          created_at?: string
          errors?: Json | null
          filename?: string
          id?: string
          rows_inserted?: number
          rows_processed?: number
          rows_skipped?: number
          rows_updated?: number
          skipped_rows?: Json | null
          unknown_cpt_count?: number
          unknown_cpts?: Json | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_history_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_jobs: {
        Row: {
          company: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          filename: string
          id: string
          inserted: number
          processed_rows: number
          skipped: number
          status: string
          total_rows: number
          unknown_cpt: number
          updated: number
          user_id: string
        }
        Insert: {
          company?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          filename: string
          id?: string
          inserted?: number
          processed_rows?: number
          skipped?: number
          status?: string
          total_rows?: number
          unknown_cpt?: number
          updated?: number
          user_id: string
        }
        Update: {
          company?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          filename?: string
          id?: string
          inserted?: number
          processed_rows?: number
          skipped?: number
          status?: string
          total_rows?: number
          unknown_cpt?: number
          updated?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      evaluate_alert_rules: { Args: never; Returns: Json }
      flag_duplicate_parsed_rows: {
        Args: { _source_file_id: string }
        Returns: number
      }
      get_dashboard_stats: {
        Args: {
          _categories?: string[]
          _companies?: string[]
          _date_from?: string
          _date_to?: string
          _insurances?: string[]
          _providers?: string[]
          _threshold?: number
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      user_has_company_access: {
        Args: { _company: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      alert_rule_type:
        | "unpaid_over_days"
        | "denial_rate"
        | "no_revenue_days"
        | "large_balance"
      alert_severity: "info" | "warning" | "critical"
      app_role: "admin" | "viewer"
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
      alert_rule_type: [
        "unpaid_over_days",
        "denial_rate",
        "no_revenue_days",
        "large_balance",
      ],
      alert_severity: ["info", "warning", "critical"],
      app_role: ["admin", "viewer"],
    },
  },
} as const
