import type { Step, Condition, Trigger } from "@/lib/automation/types";

const condText = (c: Condition): string => {
  switch (c.kind) {
    case "has_tag": return `tem tag "${c.tag}"`;
    case "not_has_tag": return `não tem tag "${c.tag}"`;
    case "in_list": return `está na lista "${c.list}"`;
    case "attribute": return `${c.field} ${c.op} ${c.value ?? ""}`;
    case "opened_email": return `abriu o email do passo ${c.step_id}`;
    case "clicked_email": return `clicou no email do passo ${c.step_id}`;
    case "event_since_start": return `aconteceu "${c.event}" depois de entrar`;
    case "all": return "(" + c.conditions.map(condText).join(" E ") + ")";
    case "any": return "(" + c.conditions.map(condText).join(" OU ") + ")";
  }
};

export const triggerText = (t: Trigger): string => {
  switch (t.type) {
    case "tag.added": return `quando a tag "${t.tag}" é adicionada`;
    case "tag.removed": return `quando a tag "${t.tag}" é removida`;
    case "list.added": return `quando entra na lista "${t.list}"`;
    case "contact.created": return `quando um contato é criado${t.source ? ` (origem ${t.source})` : ""}`;
    case "event": return `no evento "${t.event}"${t.filter ? ` com ${JSON.stringify(t.filter)}` : ""}`;
    case "webhook": return `via POST /api/automations/trigger/${t.key}`;
    case "manual": return "só manualmente";
  }
};

function stepText(s: Step, templates: Record<string, string>): string {
  switch (s.type) {
    case "send_email": return `Enviar email: ${templates[s.template_id] ?? s.template_id}`;
    case "add_tag": return `Adicionar tag "${s.tag}"`;
    case "remove_tag": return `Remover tag "${s.tag}"`;
    case "add_to_list": return `Entrar na lista "${s.list}"`;
    case "remove_from_list": return `Sair da lista "${s.list}"`;
    case "wait": return `Esperar ${s.amount} ${{ minutes: "min", hours: "h", days: "dia(s)" }[s.unit]}`;
    case "wait_until": return `Esperar até ${String(s.hour).padStart(2, "0")}:${String(s.minute ?? 0).padStart(2, "0")}`;
    case "condition": return `Se ${condText(s.condition)}`;
    case "webhook": return `Webhook ${s.method ?? "POST"} ${s.url}`;
    case "update_attribute": return `Atributo ${s.field} = ${JSON.stringify(s.value)}`;
    case "goal": return `Meta: ${condText(s.condition)}`;
    case "end": return "Fim";
  }
}

const colors: Record<string, string> = { send_email: "border-brand", wait: "border-amber-400", wait_until: "border-amber-400", condition: "border-blue-400", goal: "border-green-500", end: "border-gray-400" };

export function FlowView({ steps, templates, counts }: { steps: Step[]; templates: Record<string, string>; counts?: Record<string, number> }) {
  if (!steps.length) return <p className="text-sm text-muted">Sem passos ainda.</p>;
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.id}>
          <div className={`rounded-md border-l-4 bg-card border border-border px-3 py-2 text-sm ${colors[s.type] ?? "border-gray-300"}`}>
            <span className="text-xs text-muted mr-2">{s.id}</span>{stepText(s, templates)}
            {counts?.[s.id] ? <span className="badge ml-2">{counts[s.id]} aguardando</span> : null}
          </div>
          {s.type === "condition" && (
            <div className="grid grid-cols-2 gap-2 mt-2 ml-4">
              <div><div className="text-xs font-semibold text-green-700 mb-1">SIM</div><FlowView steps={s.yes ?? []} templates={templates} counts={counts} /></div>
              <div><div className="text-xs font-semibold text-red-700 mb-1">NÃO</div><FlowView steps={s.no ?? []} templates={templates} counts={counts} /></div>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
