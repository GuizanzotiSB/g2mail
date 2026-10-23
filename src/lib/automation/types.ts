/**
 * Modelo de automação — estilo ActiveCampaign.
 *
 * Automação = gatilho + lista ordenada de passos. Passos são processados em sequência.
 * "condition" tem dois ramos (yes/no), cada um com sua própria lista de passos.
 */

export type Trigger =
  | { type: "tag.added"; tag: string }                 // slug da tag
  | { type: "tag.removed"; tag: string }
  | { type: "list.added"; list: string }               // slug da lista
  | { type: "contact.created"; source?: string }
  | { type: "event"; event: string; filter?: Record<string, unknown> } // ex.: purchase com {product:"MVS"}
  | { type: "webhook"; key: string }                   // POST /api/automations/trigger/<key>
  | { type: "manual" };

export type Condition =
  | { kind: "has_tag"; tag: string }
  | { kind: "not_has_tag"; tag: string }
  | { kind: "in_list"; list: string }
  | { kind: "attribute"; field: string; op: "eq" | "neq" | "contains" | "exists" | "gt" | "lt"; value?: unknown }
  | { kind: "opened_email"; step_id: string }           // abriu o email enviado no passo X
  | { kind: "clicked_email"; step_id: string }
  | { kind: "event_since_start"; event: string }        // ex.: purchase depois que entrou na automação
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] };

export type Step =
  | { id: string; type: "send_email"; template_id: string; from_email?: string; data?: Record<string, unknown> }
  | { id: string; type: "add_tag"; tag: string }
  | { id: string; type: "remove_tag"; tag: string }
  | { id: string; type: "add_to_list"; list: string }
  | { id: string; type: "remove_from_list"; list: string }
  | { id: string; type: "wait"; amount: number; unit: "minutes" | "hours" | "days" }
  | { id: string; type: "wait_until"; hour: number; minute?: number }   // espera até o próximo HH:MM (fuso do app)
  | { id: string; type: "condition"; condition: Condition; yes: Step[]; no: Step[] }
  | { id: string; type: "webhook"; url: string; method?: "POST" | "GET"; body?: Record<string, unknown>; headers?: Record<string, string> }
  | { id: string; type: "update_attribute"; field: string; value: unknown }
  | { id: string; type: "goal"; condition: Condition }   // se atingir, a automação encerra (goal_reached)
  | { id: string; type: "end" };

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  trigger: Trigger;
  steps: Step[];
  settings: { allow_reentry?: boolean; timezone?: string };
};

export type RunLogEntry = { at: string; step: string; type: string; result: string; detail?: unknown };

export type Run = {
  id: string;
  automation_id: string;
  contact_id: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled" | "goal_reached";
  current_step: string | null;       // "path" do passo: ex. "s3" ou "s3.yes.1" (índices no ramo)
  next_run_at: string | null;
  context: Record<string, unknown>;
  log: RunLogEntry[];
  started_at: string;
};
