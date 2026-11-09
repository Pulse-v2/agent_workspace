
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agent_run_events": {
                  Row: {
                    "created_at": string,"event_type": string,"id": string,"organization_id": string,"payload": NonNullable<Json>,"run_id": string,"sequence": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_type": string,"id"?: string,"organization_id": string,"payload"?: NonNullable<Json>,"run_id": string,"sequence": number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_type"?: string,"id"?: string,"organization_id"?: string,"payload"?: NonNullable<Json>,"run_id"?: string,"sequence"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_run_tenant_fk"
      columns: ["run_id","organization_id","workspace_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id","organization_id","workspace_id"]
    }
                  ]
                },"agent_run_steps": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"description": string,"error_message": string | null,"finished_at": string | null,"id": string,"input_json": Json | null,"organization_id": string,"output_json": Json | null,"requires_approval": boolean,"run_id": string,"started_at": string | null,"status": string,"step_index": number,"step_type": string,"title": string,"tool_name": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"description"?: string,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"input_json"?: Json | null,"organization_id": string,"output_json"?: Json | null,"requires_approval"?: boolean,"run_id": string,"started_at"?: string | null,"status"?: string,"step_index": number,"step_type": string,"title": string,"tool_name"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"description"?: string,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"input_json"?: Json | null,"organization_id"?: string,"output_json"?: Json | null,"requires_approval"?: boolean,"run_id"?: string,"started_at"?: string | null,"status"?: string,"step_index"?: number,"step_type"?: string,"title"?: string,"tool_name"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "steps_run_tenant_fk"
      columns: ["run_id","organization_id","workspace_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id","organization_id","workspace_id"]
    }
                  ]
                },"agent_runs": {
                  Row: {
                    "context": NonNullable<Json>,"created_at": string,"created_by": string,"error_code": string | null,"error_message": string | null,"estimated_cost_usd": number,"finished_at": string | null,"id": string,"input_tokens": number,"model": string | null,"objective": string,"organization_id": string,"output_tokens": number,"retry_count": number,"started_at": string | null,"status": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"created_by": string,"error_code"?: string | null,"error_message"?: string | null,"estimated_cost_usd"?: number,"finished_at"?: string | null,"id"?: string,"input_tokens"?: number,"model"?: string | null,"objective": string,"organization_id": string,"output_tokens"?: number,"retry_count"?: number,"started_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string,"error_code"?: string | null,"error_message"?: string | null,"estimated_cost_usd"?: number,"finished_at"?: string | null,"id"?: string,"input_tokens"?: number,"model"?: string | null,"objective"?: string,"organization_id"?: string,"output_tokens"?: number,"retry_count"?: number,"started_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_runs_workspace_org_fk"
      columns: ["workspace_id","organization_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"artifacts": {
                  Row: {
                    "artifact_type": string,"content_markdown": string,"created_at": string,"created_by": string,"id": string,"metadata": NonNullable<Json>,"organization_id": string,"run_id": string | null,"source_step_id": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_type": string,"content_markdown": string,"created_at"?: string,"created_by": string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id": string,"run_id"?: string | null,"source_step_id"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "artifact_type"?: string,"content_markdown"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id"?: string,"run_id"?: string | null,"source_step_id"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "artifacts_run_tenant_fk"
      columns: ["run_id","organization_id","workspace_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id","organization_id","workspace_id"]
    },{
      foreignKeyName: "artifacts_source_step_id_fkey"
      columns: ["source_step_id"]
isOneToOne: false
      referencedRelation: "agent_run_steps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artifacts_workspace_org_fk"
      columns: ["workspace_id","organization_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"created_at": string,"entity_id": string | null,"entity_type": string,"id": string,"metadata": NonNullable<Json>,"organization_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"document_chunks": {
                  Row: {
                    "chunk_index": number,"content": string,"created_at": string,"document_id": string,"embedding": string | null,"id": string,"metadata": NonNullable<Json>,"organization_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chunk_index": number,"content": string,"created_at"?: string,"document_id": string,"embedding"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id": string,"workspace_id": string
                  }
                  Update: {
                    "chunk_index"?: number,"content"?: string,"created_at"?: string,"document_id"?: string,"embedding"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chunks_document_tenant_fk"
      columns: ["document_id","organization_id","workspace_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id","organization_id","workspace_id"]
    }
                  ]
                },"document_rows": {
                  Row: {
                    "created_at": string,"document_id": string,"id": string,"organization_id": string,"row_data": NonNullable<Json>,"row_index": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"document_id": string,"id"?: string,"organization_id": string,"row_data": NonNullable<Json>,"row_index": number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"document_id"?: string,"id"?: string,"organization_id"?: string,"row_data"?: NonNullable<Json>,"row_index"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_rows_document_tenant_fk"
      columns: ["document_id","organization_id","workspace_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id","organization_id","workspace_id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "checksum": string,"created_at": string,"embedding_status": string,"file_name": string,"id": string,"mime_type": string,"organization_id": string,"processing_error": string | null,"processing_status": string,"size_bytes": number,"storage_path": string,"uploaded_by": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checksum": string,"created_at"?: string,"embedding_status"?: string,"file_name": string,"id"?: string,"mime_type": string,"organization_id": string,"processing_error"?: string | null,"processing_status"?: string,"size_bytes": number,"storage_path": string,"uploaded_by": string,"workspace_id": string
                  }
                  Update: {
                    "checksum"?: string,"created_at"?: string,"embedding_status"?: string,"file_name"?: string,"id"?: string,"mime_type"?: string,"organization_id"?: string,"processing_error"?: string | null,"processing_status"?: string,"size_bytes"?: number,"storage_path"?: string,"uploaded_by"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_workspace_org_fk"
      columns: ["workspace_id","organization_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string,"description": string | null,"id": string,"name": string,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "can_approve_agent_run":
{ Args: { "p_run_id": string }; Returns: boolean
                           },
"can_read_agent_run":
{ Args: { "p_run_id": string }; Returns: boolean
                           },
"cancel_agent_run":
{ Args: { "p_run_id": string }; Returns: undefined
                           },
"create_organization_with_workspace":
{ Args: { "p_organization_name": string,"p_organization_slug": string,"p_workspace_description"?: string,"p_workspace_name": string }; Returns: {
              "organization_id": string,"workspace_id": string
            }[]
                           },
"decide_agent_run_approval":
{ Args: { "p_decision": string,"p_reason"?: string,"p_run_id": string,"p_step_id": string }; Returns: undefined
                           },
"has_org_role":
{ Args: { "p_organization_id": string,"p_roles": (string)[] }; Returns: boolean
                           },
"has_workspace_role":
{ Args: { "p_organization_id": string,"p_roles": (string)[],"p_workspace_id": string }; Returns: boolean
                           },
"match_document_chunks":
{ Args: { "p_embedding": string,"p_match_count"?: number,"p_match_threshold"?: number,"p_organization_id": string,"p_workspace_id": string }; Returns: {
              "chunk_id": string,"content": string,"document_id": string,"file_name": string,"metadata": Json,"similarity": number
            }[]
                           },
"queue_status":
{ Args: { "p_organization_id": string }; Returns: Json
                           },
"retry_document_processing":
{ Args: { "p_document_id": string }; Returns: undefined
                           },
"usage_summary":
{ Args: { "p_days"?: number,"p_organization_id": string }; Returns: Json
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
