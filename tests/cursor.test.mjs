// Testa a navegação na árvore de passos (getStep/advance) sem banco.
import { strict as assert } from "node:assert";
import { getStep, advance } from "../src/lib/automation/engine.ts";

const steps = [
  { id: "s1", type: "send_email", template_id: "x" },
  { id: "s2", type: "condition", condition: { kind: "has_tag", tag: "a" },
    yes: [{ id: "s3", type: "add_tag", tag: "y" }, { id: "s4", type: "condition", condition: { kind: "has_tag", tag: "b" }, yes: [{ id: "s5", type: "end" }], no: [] }],
    no: [{ id: "s6", type: "wait", amount: 1, unit: "days" }] },
  { id: "s7", type: "goal", condition: { kind: "has_tag", tag: "z" } },
];
const id = (c) => getStep(steps, c)?.id ?? null;

assert.equal(id([0]), "s1");
assert.equal(id([1, "yes", 0]), "s3");
assert.equal(id([1, "yes", 1, "yes", 0]), "s5");
assert.equal(id([1, "no", 0]), "s6");
assert.equal(id([9]), null);

// avançar na raiz
assert.deepEqual(advance(steps, [0]), [1]);
// dentro do ramo yes: s3 -> s4
assert.deepEqual(advance(steps, [1, "yes", 0]), [1, "yes", 1]);
// fim do ramo mais interno (s5) sobe até s7
assert.deepEqual(advance(steps, [1, "yes", 1, "yes", 0]), [2]);
// fim do ramo no (s6) -> s7
assert.deepEqual(advance(steps, [1, "no", 0]), [2]);
// fim da raiz -> null
assert.equal(advance(steps, [2]), null);
console.log("cursor.test OK");
