# G2 Mail

Email marketing da G2 Educação, estilo ActiveCampaign: contatos, **tags**, **listas**, **automações** (gatilho → espera → condição → ação), campanhas, webhooks de entrada (Hubla/TMB) e API completa — incluindo um **servidor MCP** pra operar tudo pelo Claude.

O envio em si é feito pelo **Listmonk** (open-source) ligado ao **Amazon SES**. O app é o cérebro; o Listmonk é o motor.

```
Hubla / TMB / n8n ──webhook──▶ G2 Mail (Next.js + Supabase) ──API──▶ Listmonk ──SMTP──▶ Amazon SES ──▶ caixa de entrada
                                   │  contatos · tags · listas
                                   │  automações · eventos
                                   ▼
                              Claude (MCP) / painel web / REST
```

## 1. Banco (Supabase)

1. Abra o SQL editor do projeto Supabase e rode `supabase/migrations/001_schema.sql` (cria o schema `g2mail`).
2. Em **Settings → API → Exposed schemas**, adicione `g2mail`.
3. Copie `SUPABASE_URL` e a **service role key** pro `.env`.

## 2. Subir na VPS (Docker)

```bash
git clone <repo> g2mail && cd g2mail
cp .env.example .env && nano .env        # preencher
docker compose up -d --build
docker compose run --rm listmonk ./listmonk --install   # só na 1ª vez (cria tabelas do Listmonk)
docker compose restart listmonk
```

- App: `http://127.0.0.1:3000` · Listmonk: `http://127.0.0.1:9000` (login padrão `listmonk` / `listmonk` — troque).
- Coloque um Nginx/Caddy na frente com HTTPS. Exemplo Caddy:

```
mail.g2edu.com.br      { reverse_proxy 127.0.0.1:3000 }
listmonk.g2edu.com.br  { reverse_proxy 127.0.0.1:9000 }
```

### Listmonk → usuário de API

No Listmonk: **Users → New user → type: API** → copie o token → `.env`: `LISTMONK_USER=<nome>`, `LISTMONK_PASSWORD=<token>`, `LISTMONK_AUTH=token`. Depois `docker compose restart app worker`.

### Listmonk → Amazon SES

1. SES: verifique o domínio (`g2edu.com.br` ou um subdomínio só pra envio, ex. `mail.g2edu.com.br`) e crie **DKIM** (3 CNAMEs) + **SPF** + **DMARC** no DNS.
2. SES: peça saída do **sandbox** (Request production access). Até lá só envia pra emails verificados.
3. SES → SMTP settings → **Create SMTP credentials**.
4. Listmonk → **Settings → SMTP**: host `email-smtp.<região>.amazonaws.com`, porta `587`, STARTTLS, usuário/senha do passo 3, max conns 10.
5. Listmonk → Settings → General: URL raiz = `https://listmonk.g2edu.com.br` (usado nos links de descadastro).
6. **Bounces**: SES → SNS topic → Listmonk Settings → Bounces → ativar SES (cole a URL `https://listmonk.g2edu.com.br/webhooks/service/ses`). Sem isso a reputação cai.
7. **Aquecimento**: comece com poucos envios/dia pra base mais engajada e suba ao longo de 2–4 semanas.

## 3. Painel

`https://mail.g2edu.com.br` → senha `ADMIN_PASSWORD`.

- **Contatos**: busca, filtros por tag/lista, perfil com linha do tempo, tags, listas, automações e emails.
- **Tags / Listas**: listas são espelhadas no Listmonk; tags viram atributo `tags` no subscriber (dá pra segmentar lá também).
- **Templates**: HTML com `{{nome}}`, `{{email}}`, `{{qualquer_atributo}}`; preview e envio de teste. Links são rastreados (`/t/c/…`) e abertura por pixel (`/t/o/…`).
- **Automações**: gatilho + passos (JSON, com visualização do fluxo e contagem de quem está em cada espera).
- **Integrações**: chaves de API, webhooks de entrada e URL do MCP.

## 4. Conectar o Claude (MCP)

claude.ai → **Configurações → Conectores → Adicionar conector personalizado**

- URL: `https://mail.g2edu.com.br/api/mcp`
- Autenticação: header `Authorization: Bearer <chave>` (gere em Integrações com `read,write,admin`).

Ferramentas: `list_contacts`, `get_contact`, `upsert_contact`, `import_contacts`, `add_tags`, `remove_tags`, `bulk_tag`, `add_to_lists`, `segment`, `record_event`, `list_tags`, `create_tag`, `list_lists`, `create_list`, `list_templates`, `create_template`, `update_template`, `send_email`, `create_campaign`, `list_campaigns`, `list_automations`, `get_automation`, `create_automation`, `update_automation`, `set_automation_status`, `enroll_in_automation`, `automation_runs`, `list_webhooks`, `create_webhook`, `webhook_logs`, `stats`.

## 5. Webhooks de entrada

Crie em **Integrações** (ou via MCP `create_webhook`). A URL fica `https://mail…/api/webhooks/{hubla|tmb|generic}/{segredo}`.

Config por webhook:
```json
{
  "product_tags": { "Máquina de Vendas": "comprou-mvs", "Loja Express": "comprou-loja-express", "Maverick": "comprou-cmp" },
  "default_tag": "cliente",
  "pending_tag": "pendente",
  "refund_tag": "reembolsou",
  "lists": ["clientes"]
}
```

O que acontece numa compra aprovada: contato criado/atualizado → tags `cliente` + `comprou-<produto>` → tag `pendente` removida → entra nas listas → evento `purchase` (com `product_slug`, `amount`…). Pendente/recusado → tag `pendente` + evento `purchase.pending`. Reembolso → tag `reembolsou`, remove a tag do produto, evento `refund`.

**Genérico** (pro n8n): `POST …/api/webhooks/generic/<segredo>` com `{"email","name","phone","event":"webinar.attended","product":"CMP"}`.

## 6. Automações

```json
{
  "name": "Boas-vindas MVS",
  "trigger": { "type": "event", "event": "purchase", "filter": { "product_slug": "maquina-de-vendas" } },
  "steps": [
    { "id": "s1", "type": "send_email", "template_id": "<uuid>" },
    { "id": "s2", "type": "wait", "amount": 2, "unit": "days" },
    { "id": "s3", "type": "condition", "condition": { "kind": "opened_email", "step_id": "s1" },
      "yes": [ { "id": "s4", "type": "add_tag", "tag": "engajado" } ],
      "no":  [ { "id": "s5", "type": "send_email", "template_id": "<uuid-2>" } ] },
    { "id": "s6", "type": "wait_until", "hour": 20 },
    { "id": "s7", "type": "webhook", "url": "https://n8n.plugu.com.br/webhook/convite-webinar" },
    { "id": "s8", "type": "goal", "condition": { "kind": "has_tag", "tag": "comprou-cmp" } }
  ]
}
```

Gatilhos: `tag.added`, `tag.removed`, `list.added`, `contact.created`, `event` (purchase, refund, purchase.pending, abandoned_cart, webhook.*, custom), `webhook` (`POST /api/automations/trigger/<key>`), `manual`.
Passos: `send_email`, `add_tag`, `remove_tag`, `add_to_list`, `remove_from_list`, `wait`, `wait_until`, `condition`, `webhook`, `update_attribute`, `goal`, `end`.
Condições: `has_tag`, `not_has_tag`, `in_list`, `attribute`, `opened_email`, `clicked_email`, `event_since_start`, `all`, `any`.

O worker (`scripts/worker.mjs`, serviço `worker` no compose) processa os passos a cada minuto. Alternativa: cron chamando `POST /api/cron/process` com `Authorization: Bearer $CRON_SECRET`.

## 7. API REST

Header `Authorization: Bearer <chave>`.

| Método | Rota | Para quê |
|---|---|---|
| GET/POST | `/api/contacts` | listar/buscar · criar/atualizar (1 ou `{contacts:[…]}`) |
| GET/PATCH/DELETE | `/api/contacts/:id\|email` | detalhe · editar · descadastrar |
| POST/DELETE | `/api/contacts/:id/tags` `{tags:[…]}` | tags |
| POST/DELETE | `/api/contacts/:id/lists` `{lists:[…]}` | listas |
| GET/POST/DELETE | `/api/tags`, `/api/lists` | |
| GET/POST | `/api/templates`, `/api/templates/:id` | |
| GET/POST | `/api/automations`, `/api/automations/:id` | |
| POST | `/api/automations/:id/enroll` `{contacts:[…]}` | entrada manual |
| POST | `/api/automations/trigger/:key` `{email,…}` | gatilho via webhook |
| GET/POST | `/api/events` | eventos custom |
| GET | `/api/segment?must=a,b&must_not=c` | segmento por tags |
| POST | `/api/send` `{contact, template_id}` | email transacional |
| GET/POST | `/api/campaigns` | campanha em massa (listas e/ou segmento) |
| GET/POST | `/api/keys` | chaves e webhooks (admin) |
| GET | `/api/health` | saúde |

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # pode deixar LISTMONK_URL vazio: emails ficam "failed" mas o resto funciona
npm run dev                  # http://localhost:3000
npm run worker               # em outro terminal
```
