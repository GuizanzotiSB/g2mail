import type { Step } from "./types";

export function validateSteps(steps: unknown, path = "steps"): string | null {
  if (!Array.isArray(steps)) return `${path} precisa ser uma lista`;
  const ids = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as Step;
    if (!s || typeof s !== "object") return `${path}[${i}] inválido`;
    if (!s.id) return `${path}[${i}] sem id`;
    if (!s.type) return `${path}[${i}] sem type`;
    if (s.type === "condition") {
      const e1 = validateSteps(s.yes ?? [], `${path}[${i}].yes`); if (e1) return e1;
      const e2 = validateSteps(s.no ?? [], `${path}[${i}].no`); if (e2) return e2;
    }
    if (s.type === "send_email" && !s.template_id) return `${path}[${i}] send_email sem template_id`;
    if (s.type === "wait" && (!s.amount || !s.unit)) return `${path}[${i}] wait precisa de amount e unit`;
    ids.add(s.id);
  }
  return null;
}
