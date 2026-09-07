// Generated from the Supabase project schema. Do not hand-edit.
// Regenerate after every migration.
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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          created_at: string
          id: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: number
          created_at: string
          id: number
          role: Database["public"]["Enums"]["ai_role"]
          updated_at: string
        }
        Insert: {
          content: string
          conversation_id: number
          created_at?: string
          id?: never
          role: Database["public"]["Enums"]["ai_role"]
          updated_at?: string
        }
        Update: {
          content?: string
          conversation_id?: number
          created_at?: string
          id?: never
          role?: Database["public"]["Enums"]["ai_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      cut_phase_milestones: {
        Row: {
          actual_trend_weight_kg: number | null
          created_at: string
          cut_phase_id: number
          id: number
          milestone_date: string
          recommended_weight_kg: number
          recomputed_at: string | null
          stretch_weight_kg: number | null
          updated_at: string
          week_number: number
        }
        Insert: {
          actual_trend_weight_kg?: number | null
          created_at?: string
          cut_phase_id: number
          id?: never
          milestone_date: string
          recommended_weight_kg: number
          recomputed_at?: string | null
          stretch_weight_kg?: number | null
          updated_at?: string
          week_number: number
        }
        Update: {
          actual_trend_weight_kg?: number | null
          created_at?: string
          cut_phase_id?: number
          id?: never
          milestone_date?: string
          recommended_weight_kg?: number
          recomputed_at?: string | null
          stretch_weight_kg?: number | null
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "cut_phase_milestones_cut_phase_id_fkey"
            columns: ["cut_phase_id"]
            isOneToOne: false
            referencedRelation: "cut_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      cut_phases: {
        Row: {
          created_at: string
          duration_days: number
          end_date: string
          final_goal_weight_kg: number | null
          id: number
          initial_protein_g: number | null
          initial_target_kcal: number | null
          initial_tdee_kcal: number | null
          name: string
          phase_number: number
          recommended_target_high_kg: number | null
          recommended_target_low_kg: number | null
          start_date: string
          start_weight_kg: number
          status: Database["public"]["Enums"]["cut_phase_status"]
          stretch_target_kg: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_days?: number
          end_date: string
          final_goal_weight_kg?: number | null
          id?: never
          initial_protein_g?: number | null
          initial_target_kcal?: number | null
          initial_tdee_kcal?: number | null
          name?: string
          phase_number?: number
          recommended_target_high_kg?: number | null
          recommended_target_low_kg?: number | null
          start_date: string
          start_weight_kg: number
          status?: Database["public"]["Enums"]["cut_phase_status"]
          stretch_target_kg?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_days?: number
          end_date?: string
          final_goal_weight_kg?: number | null
          id?: never
          initial_protein_g?: number | null
          initial_target_kcal?: number | null
          initial_tdee_kcal?: number | null
          name?: string
          phase_number?: number
          recommended_target_high_kg?: number | null
          recommended_target_low_kg?: number | null
          start_date?: string
          start_weight_kg?: number
          status?: Database["public"]["Enums"]["cut_phase_status"]
          stretch_target_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_targets: {
        Row: {
          basis_tdee_kcal: number | null
          calories: number
          carbs_g: number
          created_at: string
          fat_g: number
          id: number
          protein_g: number
          source: Database["public"]["Enums"]["target_source"]
          target_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          basis_tdee_kcal?: number | null
          calories: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          id?: never
          protein_g?: number
          source?: Database["public"]["Enums"]["target_source"]
          target_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          basis_tdee_kcal?: number | null
          calories?: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          id?: never
          protein_g?: number
          source?: Database["public"]["Enums"]["target_source"]
          target_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      favorite_foods: {
        Row: {
          created_at: string
          food_id: number
          id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          food_id: number
          id?: never
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          food_id?: number
          id?: never
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_foods_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_logs: {
        Row: {
          amount: number
          carbs_g: number
          created_at: string
          fat_g: number
          food_id: number | null
          grams: number
          id: number
          kcal: number
          log_date: string
          meal_type_id: number
          notes: string | null
          protein_g: number
          recipe_id: number | null
          serving_id: number | null
          source: Database["public"]["Enums"]["log_source"]
          unit: Database["public"]["Enums"]["portion_unit"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          food_id?: number | null
          grams: number
          id?: never
          kcal: number
          log_date: string
          meal_type_id: number
          notes?: string | null
          protein_g?: number
          recipe_id?: number | null
          serving_id?: number | null
          source?: Database["public"]["Enums"]["log_source"]
          unit?: Database["public"]["Enums"]["portion_unit"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          food_id?: number | null
          grams?: number
          id?: never
          kcal?: number
          log_date?: string
          meal_type_id?: number
          notes?: string | null
          protein_g?: number
          recipe_id?: number | null
          serving_id?: number | null
          source?: Database["public"]["Enums"]["log_source"]
          unit?: Database["public"]["Enums"]["portion_unit"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_logs_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_logs_meal_type_id_fkey"
            columns: ["meal_type_id"]
            isOneToOne: false
            referencedRelation: "meal_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_logs_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_logs_serving_id_fkey"
            columns: ["serving_id"]
            isOneToOne: false
            referencedRelation: "food_servings"
            referencedColumns: ["id"]
          },
        ]
      }
      food_nutrients: {
        Row: {
          carbs_g: number
          created_at: string
          fat_g: number
          fiber_g: number | null
          food_id: number
          kcal: number
          protein_g: number
          sat_fat_g: number | null
          sodium_mg: number | null
          sugar_g: number | null
          updated_at: string
        }
        Insert: {
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number | null
          food_id: number
          kcal: number
          protein_g?: number
          sat_fat_g?: number | null
          sodium_mg?: number | null
          sugar_g?: number | null
          updated_at?: string
        }
        Update: {
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number | null
          food_id?: number
          kcal?: number
          protein_g?: number
          sat_fat_g?: number | null
          sodium_mg?: number | null
          sugar_g?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_nutrients_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: true
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_servings: {
        Row: {
          created_at: string
          food_id: number
          grams: number
          id: number
          is_default: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          food_id: number
          grams: number
          id?: never
          is_default?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          food_id?: number
          grams?: number
          id?: never
          is_default?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_servings_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      foods: {
        Row: {
          archived_at: string | null
          barcode: string | null
          brand: string | null
          created_at: string
          data_updated_at: string | null
          description: string | null
          id: number
          is_verified: boolean
          name: string
          refreshed_at: string
          search_text: string | null
          source: Database["public"]["Enums"]["food_source"]
          source_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          barcode?: string | null
          brand?: string | null
          created_at?: string
          data_updated_at?: string | null
          description?: string | null
          id?: never
          is_verified?: boolean
          name: string
          refreshed_at?: string
          search_text?: string | null
          source: Database["public"]["Enums"]["food_source"]
          source_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          barcode?: string | null
          brand?: string | null
          created_at?: string
          data_updated_at?: string | null
          description?: string | null
          id?: never
          is_verified?: boolean
          name?: string
          refreshed_at?: string
          search_text?: string | null
          source?: Database["public"]["Enums"]["food_source"]
          source_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          activity_level: Database["public"]["Enums"]["activity_level"]
          created_at: string
          final_goal_weight_kg: number | null
          goal_type: Database["public"]["Enums"]["goal_type"]
          id: number
          is_active: boolean
          protein_g_per_kg: number
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_level?: Database["public"]["Enums"]["activity_level"]
          created_at?: string
          final_goal_weight_kg?: number | null
          goal_type?: Database["public"]["Enums"]["goal_type"]
          id?: never
          is_active?: boolean
          protein_g_per_kg?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_level?: Database["public"]["Enums"]["activity_level"]
          created_at?: string
          final_goal_weight_kg?: number | null
          goal_type?: Database["public"]["Enums"]["goal_type"]
          id?: never
          is_active?: boolean
          protein_g_per_kg?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meal_types: {
        Row: {
          created_at: string
          id: number
          name: string
          slug: string
          sort_order: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_enabled: boolean
          birth_date: string | null
          created_at: string
          display_name: string | null
          height_cm: number | null
          id: string
          sex: Database["public"]["Enums"]["sex_type"]
          timezone: string
          unit_system: Database["public"]["Enums"]["unit_system"]
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          birth_date?: string | null
          created_at?: string
          display_name?: string | null
          height_cm?: number | null
          id: string
          sex?: Database["public"]["Enums"]["sex_type"]
          timezone?: string
          unit_system?: Database["public"]["Enums"]["unit_system"]
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          birth_date?: string | null
          created_at?: string
          display_name?: string | null
          height_cm?: number | null
          id?: string
          sex?: Database["public"]["Enums"]["sex_type"]
          timezone?: string
          unit_system?: Database["public"]["Enums"]["unit_system"]
          updated_at?: string
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          amount: number
          created_at: string
          food_id: number
          grams: number
          id: number
          recipe_id: number
          serving_id: number | null
          sort_order: number
          unit: Database["public"]["Enums"]["portion_unit"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          food_id: number
          grams: number
          id?: never
          recipe_id: number
          serving_id?: number | null
          sort_order?: number
          unit?: Database["public"]["Enums"]["portion_unit"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          food_id?: number
          grams?: number
          id?: never
          recipe_id?: number
          serving_id?: number | null
          sort_order?: number
          unit?: Database["public"]["Enums"]["portion_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_serving_id_fkey"
            columns: ["serving_id"]
            isOneToOne: false
            referencedRelation: "food_servings"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          id: number
          name: string
          notes: string | null
          servings: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          notes?: string | null
          servings?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          notes?: string | null
          servings?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_meal_items: {
        Row: {
          amount: number
          created_at: string
          food_id: number
          grams: number
          id: number
          saved_meal_id: number
          serving_id: number | null
          sort_order: number
          unit: Database["public"]["Enums"]["portion_unit"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          food_id: number
          grams: number
          id?: never
          saved_meal_id: number
          serving_id?: number | null
          sort_order?: number
          unit?: Database["public"]["Enums"]["portion_unit"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          food_id?: number
          grams?: number
          id?: never
          saved_meal_id?: number
          serving_id?: number | null
          sort_order?: number
          unit?: Database["public"]["Enums"]["portion_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_meal_items_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_meal_items_saved_meal_id_fkey"
            columns: ["saved_meal_id"]
            isOneToOne: false
            referencedRelation: "saved_meals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_meal_items_serving_id_fkey"
            columns: ["serving_id"]
            isOneToOne: false
            referencedRelation: "food_servings"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_meals: {
        Row: {
          created_at: string
          default_meal_type_id: number | null
          id: number
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_meal_type_id?: number | null
          id?: never
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_meal_type_id?: number | null
          id?: never
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_meals_default_meal_type_id_fkey"
            columns: ["default_meal_type_id"]
            isOneToOne: false
            referencedRelation: "meal_types"
            referencedColumns: ["id"]
          },
        ]
      }
      tdee_estimates: {
        Row: {
          computed_for: string
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          days_of_data: number
          estimated_tdee_kcal: number
          id: number
          mean_intake_kcal: number | null
          method: Database["public"]["Enums"]["tdee_method"]
          trend_change_kg_per_week: number | null
          trend_weight_kg: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          computed_for: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          days_of_data?: number
          estimated_tdee_kcal: number
          id?: never
          mean_intake_kcal?: number | null
          method: Database["public"]["Enums"]["tdee_method"]
          trend_change_kg_per_week?: number | null
          trend_weight_kg?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          computed_for?: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          days_of_data?: number
          estimated_tdee_kcal?: number
          id?: never
          mean_intake_kcal?: number | null
          method?: Database["public"]["Enums"]["tdee_method"]
          trend_change_kg_per_week?: number | null
          trend_weight_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_checkins: {
        Row: {
          adherence_pct: number | null
          adjustment_reason: string | null
          change_kg: number | null
          created_at: string
          end_trend_kg: number | null
          id: number
          logged_days: number
          mean_intake_kcal: number | null
          mean_protein_g: number | null
          new_target_kcal: number | null
          previous_target_kcal: number | null
          start_trend_kg: number | null
          updated_at: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          adherence_pct?: number | null
          adjustment_reason?: string | null
          change_kg?: number | null
          created_at?: string
          end_trend_kg?: number | null
          id?: never
          logged_days?: number
          mean_intake_kcal?: number | null
          mean_protein_g?: number | null
          new_target_kcal?: number | null
          previous_target_kcal?: number | null
          start_trend_kg?: number | null
          updated_at?: string
          user_id: string
          week_start_date: string
        }
        Update: {
          adherence_pct?: number | null
          adjustment_reason?: string | null
          change_kg?: number | null
          created_at?: string
          end_trend_kg?: number | null
          id?: never
          logged_days?: number
          mean_intake_kcal?: number | null
          mean_protein_g?: number | null
          new_target_kcal?: number | null
          previous_target_kcal?: number | null
          start_trend_kg?: number | null
          updated_at?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: []
      }
      weight_entries: {
        Row: {
          created_at: string
          entry_date: string
          id: number
          note: string | null
          updated_at: string
          user_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: never
          note?: string | null
          updated_at?: string
          user_id: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: never
          note?: string | null
          updated_at?: string
          user_id?: string
          weight_kg?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      save_custom_food: {
        Args: {
          p_barcode: string
          p_brand: string
          p_description?: string
          p_food_id: number
          p_name: string
          p_nutrients: Json
          p_servings: Json
          p_source_id?: string
        }
        Returns: number
      }
    }
    Enums: {
      activity_level: "sedentary" | "light" | "moderate" | "very" | "extra"
      ai_role: "user" | "assistant" | "system"
      confidence_level: "low" | "medium" | "high"
      cut_phase_status: "active" | "completed" | "abandoned"
      food_source: "usda" | "off" | "custom"
      goal_type: "lose" | "maintain" | "gain" | "recomp"
      log_source:
        | "manual"
        | "ai"
        | "barcode"
        | "saved_meal"
        | "recipe"
        | "favorite"
      portion_unit: "g" | "ml" | "serving"
      sex_type: "male" | "female" | "other"
      target_source: "initial" | "weekly_adjustment" | "phase" | "manual"
      tdee_method: "formula" | "adaptive"
      unit_system: "metric" | "imperial"
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
      activity_level: ["sedentary", "light", "moderate", "very", "extra"],
      ai_role: ["user", "assistant", "system"],
      confidence_level: ["low", "medium", "high"],
      cut_phase_status: ["active", "completed", "abandoned"],
      food_source: ["usda", "off", "custom"],
      goal_type: ["lose", "maintain", "gain", "recomp"],
      log_source: [
        "manual",
        "ai",
        "barcode",
        "saved_meal",
        "recipe",
        "favorite",
      ],
      portion_unit: ["g", "ml", "serving"],
      sex_type: ["male", "female", "other"],
      target_source: ["initial", "weekly_adjustment", "phase", "manual"],
      tdee_method: ["formula", "adaptive"],
      unit_system: ["metric", "imperial"],
    },
  },
} as const
