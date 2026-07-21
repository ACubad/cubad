export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_codes: {
        Row: {
          batch_id: string | null
          code_hash: string
          created_at: string
          created_by: string | null
          duration_days: number
          id: string
          max_redemptions: number
          note: string | null
          redeemed_count: number
          revoked_at: string | null
          scope_id: string | null
          scope_type: string
          tier_id: string
          valid_until: string | null
        }
        Insert: {
          batch_id?: string | null
          code_hash: string
          created_at?: string
          created_by?: string | null
          duration_days: number
          id?: string
          max_redemptions?: number
          note?: string | null
          redeemed_count?: number
          revoked_at?: string | null
          scope_id?: string | null
          scope_type: string
          tier_id: string
          valid_until?: string | null
        }
        Update: {
          batch_id?: string | null
          code_hash?: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          id?: string
          max_redemptions?: number
          note?: string | null
          redeemed_count?: number
          revoked_at?: string | null
          scope_id?: string | null
          scope_type?: string
          tier_id?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_codes_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          details: Json
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          details?: Json
          entity: string
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          details?: Json
          entity?: string
          entity_id?: string | null
          id?: never
        }
        Relationships: []
      }
      anonymous_preview_selections: {
        Row: {
          browser_hash: string
          expires_at: string
          selected_at: string
          unit_id: string
        }
        Insert: {
          browser_hash: string
          expires_at?: string
          selected_at?: string
          unit_id: string
        }
        Update: {
          browser_hash?: string
          expires_at?: string
          selected_at?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anonymous_preview_selections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      code_redemptions: {
        Row: {
          code_id: string
          created_at: string
          entitlement_id: string | null
          id: string
          user_id: string
        }
        Insert: {
          code_id: string
          created_at?: string
          entitlement_id?: string | null
          id?: string
          user_id: string
        }
        Update: {
          code_id?: string
          created_at?: string
          entitlement_id?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "access_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_redemptions_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          reminded_at: string | null
          reminder_claimed_at: string | null
          revoked_at: string | null
          scope_id: string | null
          scope_type: string
          source: string
          source_id: string | null
          starts_at: string
          tier_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          reminded_at?: string | null
          reminder_claimed_at?: string | null
          revoked_at?: string | null
          scope_id?: string | null
          scope_type: string
          source: string
          source_id?: string | null
          starts_at?: string
          tier_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          reminded_at?: string | null
          reminder_claimed_at?: string | null
          revoked_at?: string | null
          scope_id?: string | null
          scope_type?: string
          source?: string
          source_id?: string | null
          starts_at?: string
          tier_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_sync: {
        Row: {
          claimed_by: string | null
          id: string
          state: Json | null
          updated_at: string | null
        }
        Insert: {
          claimed_by?: string | null
          id: string
          state?: Json | null
          updated_at?: string | null
        }
        Update: {
          claimed_by?: string | null
          id?: string
          state?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_claims: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          id: string
          method: string
          payer_ref: string
          proof_path: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tier_id: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          method: string
          payer_ref?: string
          proof_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tier_id: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          method?: string
          payer_ref?: string
          proof_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_claims_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          country_code: string
          created_at: string
          email: string
          full_name: string
          onboarded_at: string | null
          phone: string
          preferred_lang: string
          role: string
          track_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          email?: string
          full_name?: string
          onboarded_at?: string | null
          phone?: string
          preferred_lang?: string
          role?: string
          track_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          country_code?: string
          created_at?: string
          email?: string
          full_name?: string
          onboarded_at?: string | null
          phone?: string
          preferred_lang?: string
          role?: string
          track_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          created_at: string
          id: number
          key: string
        }
        Insert: {
          created_at?: string
          id?: never
          key: string
        }
        Update: {
          created_at?: string
          id?: never
          key?: string
        }
        Relationships: []
      }
      redemption_attempts: {
        Row: {
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          created_at: string
          id: string
          section_order: string
          slug: string
          sort: number
          status: string
          tagline: Json
          title: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          section_order?: string
          slug: string
          sort?: number
          status?: string
          tagline: Json
          title: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          section_order?: string
          slug?: string
          sort?: number
          status?: string
          tagline?: Json
          title?: Json
          updated_at?: string
        }
        Relationships: []
      }
      tiers: {
        Row: {
          created_at: string
          description: Json
          duration_days: number
          id: string
          prices: Json
          scope_id: string | null
          scope_type: string
          slug: string
          sort: number
          status: string
          title: Json
        }
        Insert: {
          created_at?: string
          description?: Json
          duration_days?: number
          id?: string
          prices?: Json
          scope_id?: string | null
          scope_type?: string
          slug: string
          sort?: number
          status?: string
          title: Json
        }
        Update: {
          created_at?: string
          description?: Json
          duration_days?: number
          id?: string
          prices?: Json
          scope_id?: string | null
          scope_type?: string
          slug?: string
          sort?: number
          status?: string
          title?: Json
        }
        Relationships: []
      }
      track_subjects: {
        Row: {
          sort: number
          subject_id: string
          track_id: string
        }
        Insert: {
          sort?: number
          subject_id: string
          track_id: string
        }
        Update: {
          sort?: number
          subject_id?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "track_subjects_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          country_code: string
          created_at: string
          id: string
          level: string
          sort: number
          status: string
          system: string
          title: Json
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          level: string
          sort?: number
          status?: string
          system: string
          title: Json
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          level?: string
          sort?: number
          status?: string
          system?: string
          title?: Json
        }
        Relationships: []
      }
      units: {
        Row: {
          content: Json
          created_at: string
          id: string
          is_free: boolean
          published_content: Json | null
          slug: string
          status: string
          subject_id: string
          unit_number: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          is_free?: boolean
          published_content?: Json | null
          slug: string
          status?: string
          subject_id: string
          unit_number: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          is_free?: boolean
          published_content?: Json | null
          slug?: string
          status?: string
          subject_id?: string
          unit_number?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "units_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preview_selections: {
        Row: {
          selected_at: string
          unit_id: string
          user_id: string
        }
        Insert: {
          selected_at?: string
          unit_id: string
          user_id: string
        }
        Update: {
          selected_at?: string
          unit_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preview_selections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      user_state: {
        Row: {
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_generate_codes: {
        Args: {
          p_batch_id: string
          p_code_hashes: string[]
          p_duration_days: number
          p_max_redemptions: number
          p_note: string
          p_scope_id: string
          p_scope_type: string
          p_tier_id: string
          p_valid_until: string
        }
        Returns: {
          code_hash: string
        }[]
      }
      admin_grant_entitlement: {
        Args: {
          p_duration_days: number
          p_scope_id: string
          p_scope_type: string
          p_tier_id: string
          p_user_id: string
        }
        Returns: string
      }
      admin_overview_stats: { Args: never; Returns: Json }
      admin_revoke: {
        Args: { p_ids: string[]; p_table: string }
        Returns: number
      }
      admin_set_status: {
        Args: { p_id: string; p_status: string; p_table: string }
        Returns: undefined
      }
      admin_set_track_subjects: {
        Args: { p_subject_ids: string[]; p_track_id: string }
        Returns: undefined
      }
      admin_upsert_subject: {
        Args: {
          p_id: string
          p_section_order: string
          p_slug: string
          p_sort: number
          p_tagline: Json
          p_title: Json
          p_track_ids: string[]
        }
        Returns: string
      }
      admin_upsert_tier: {
        Args: {
          p_description: Json
          p_duration_days: number
          p_id: string
          p_prices: Json
          p_scope_id: string
          p_scope_type: string
          p_slug: string
          p_sort: number
          p_title: Json
        }
        Returns: string
      }
      admin_upsert_track: {
        Args: {
          p_country_code: string
          p_id: string
          p_level: string
          p_sort: number
          p_system: string
          p_title: Json
        }
        Returns: string
      }
      admin_upsert_unit: {
        Args: {
          p_content: Json
          p_slug: string
          p_subject_id: string
          p_unit_number: number
        }
        Returns: {
          id: string
          version: number
        }[]
      }
      approve_claim: {
        Args: {
          p_claim_id: string
          p_code_hash: string
          p_duration_days: number
          p_reviewer: string
        }
        Returns: Json
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window: string }
        Returns: boolean
      }
      claim_unit_preview: {
        Args: { p_preview_hash?: string; p_unit_id?: string }
        Returns: string
      }
      cleanup_rate_limit_events: { Args: never; Returns: undefined }
      get_current_preview_unit: { Args: never; Returns: string }
      get_unit_content: {
        Args: { p_subject_slug: string; p_unit_slug: string }
        Returns: Json
      }
      grant_entitlement: {
        Args: {
          p_duration_days: number
          p_scope_id: string
          p_scope_type: string
          p_source: string
          p_source_id: string
          p_tier_id: string
          p_user: string
        }
        Returns: string
      }
      has_subject_access: { Args: { p_subject_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      list_units_meta: {
        Args: { p_subject_slug: string }
        Returns: {
          is_free: boolean
          slug: string
          tagline: Json
          title: Json
          unit_number: number
          updated_at: string
          version: number
        }[]
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_entity: string
          p_entity_id: string
        }
        Returns: undefined
      }
      purge_expired_anonymous_preview_selections: {
        Args: never
        Returns: number
      }
      redeem_code: { Args: { p_code: string }; Returns: Json }
      reject_claim: {
        Args: { p_claim_id: string; p_note: string; p_reviewer: string }
        Returns: Json
      }
      request_preview_hash: { Args: never; Returns: string }
      set_app_setting: {
        Args: { p_actor: string; p_key: string; p_value: Json }
        Returns: undefined
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
