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
          mrn: string | null
          pay_date: string | null
          pri_ins: string | null
          prov_code: string | null
          prov_name: string | null
          pt_name: string | null
          revenue: number | null
          service_category: string | null
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
          mrn?: string | null
          pay_date?: string | null
          pri_ins?: string | null
          prov_code?: string | null
          prov_name?: string | null
          pt_name?: string | null
          revenue?: number | null
          service_category?: string | null
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
          mrn?: string | null
          pay_date?: string | null
          pri_ins?: string | null
          prov_code?: string | null
          prov_name?: string | null
          pt_name?: string | null
          revenue?: number | null
          service_category?: string | null
          uploaded_at?: string
          visit_type?: string | null
        }
        Relationships: []
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
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
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
          unknown_cpt_count: number
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
          unknown_cpt_count?: number
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
          unknown_cpt_count?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      app_role: ["admin", "viewer"],
    },
  },
} as const
