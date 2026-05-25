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
      audit_logs: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: string
          payload: Json
          target: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          approver_role: string
          author_role: string
          code: string
          created_at: string
          department: string
          purpose: string
          retention: string
          section_spec: Json
          title: string
        }
        Insert: {
          approver_role: string
          author_role: string
          code: string
          created_at?: string
          department: string
          purpose: string
          retention: string
          section_spec?: Json
          title: string
        }
        Update: {
          approver_role?: string
          author_role?: string
          code?: string
          created_at?: string
          department?: string
          purpose?: string
          retention?: string
          section_spec?: Json
          title?: string
        }
        Relationships: []
      }
      generated_documents: {
        Row: {
          archived_at: string | null
          content: Json
          created_at: string
          id: string
          project_id: string
          released_at: string | null
          released_by: string | null
          run_id: string
          status: string
          storage_path: string | null
          superseded_by_id: string | null
          template_code: string
        }
        Insert: {
          archived_at?: string | null
          content?: Json
          created_at?: string
          id?: string
          project_id: string
          released_at?: string | null
          released_by?: string | null
          run_id: string
          status?: string
          storage_path?: string | null
          superseded_by_id?: string | null
          template_code: string
        }
        Update: {
          archived_at?: string | null
          content?: Json
          created_at?: string
          id?: string
          project_id?: string
          released_at?: string | null
          released_by?: string | null
          run_id?: string
          status?: string
          storage_path?: string | null
          superseded_by_id?: string | null
          template_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_code_fkey"
            columns: ["template_code"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["code"]
          },
        ]
      }
      generation_runs: {
        Row: {
          bundle_path: string | null
          created_by: string
          error: string | null
          finished_at: string | null
          id: string
          progress: Json
          project_id: string
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          summary: Json
          version: number
        }
        Insert: {
          bundle_path?: string | null
          created_by: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: Json
          project_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          summary?: Json
          version: number
        }
        Update: {
          bundle_path?: string | null
          created_by?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: Json
          project_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          summary?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "generation_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          current_step: number
          department_inputs: Json
          department_scope: Json
          device_portfolio: Json
          id: string
          name: string
          organisation_profile: Json
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          current_step?: number
          department_inputs?: Json
          department_scope?: Json
          device_portfolio?: Json
          id?: string
          name: string
          organisation_profile?: Json
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_step?: number
          department_inputs?: Json
          department_scope?: Json
          device_portfolio?: Json
          id?: string
          name?: string
          organisation_profile?: Json
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_findings: {
        Row: {
          created_at: string
          document_code: string | null
          field: string | null
          id: string
          message: string
          project_id: string
          run_id: string
          severity: Database["public"]["Enums"]["finding_severity"]
        }
        Insert: {
          created_at?: string
          document_code?: string | null
          field?: string | null
          id?: string
          message: string
          project_id: string
          run_id: string
          severity: Database["public"]["Enums"]["finding_severity"]
        }
        Update: {
          created_at?: string
          document_code?: string | null
          field?: string | null
          id?: string
          message?: string
          project_id?: string
          run_id?: string
          severity?: Database["public"]["Enums"]["finding_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "validation_findings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          plan: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          plan?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          plan?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_workspace_access: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      workspace_role: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
    }
    Enums: {
      finding_severity: "info" | "warning" | "error"
      project_status: "draft" | "in_progress" | "generated" | "archived"
      run_status:
        | "queued"
        | "rendering"
        | "enriching"
        | "validating"
        | "packaging"
        | "succeeded"
        | "failed"
      workspace_role: "owner" | "admin" | "editor" | "viewer"
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
      finding_severity: ["info", "warning", "error"],
      project_status: ["draft", "in_progress", "generated", "archived"],
      run_status: [
        "queued",
        "rendering",
        "enriching",
        "validating",
        "packaging",
        "succeeded",
        "failed",
      ],
      workspace_role: ["owner", "admin", "editor", "viewer"],
    },
  },
} as const
