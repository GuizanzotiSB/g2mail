-- G2 Mail — schema base
-- Rodar no SQL editor do Supabase (projeto novo ou CONFIG). Tudo vive no schema "g2mail".

create schema if not exists g2mail;
set search_path to g2mail, public;

create extension if not exists pgcrypto;

-- =========================================================
-- CONTATOS
-- =========================================================
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  email_norm    text generated always as (lower(trim(email))) stored,
  name          text,
  phone         text,
  phone_norm    text,                              -- só dígitos, com DDI
  status        text not null default 'active'
                  check (status in ('active','unsubscribed','bounced','blocklisted')),
  attributes    jsonb not null default '{}'::jsonb, -- campos livres (produto, cidade, utm...)
  listmonk_id   integer,                           -- id do subscriber no Listmonk
  source        text,                              -- hubla, tmb, csv, api, manual
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_event_at timestamptz
);
create unique index if not exists contacts_email_norm_uq on contacts(email_norm);
create index if not exists contacts_phone_norm_idx on contacts(phone_norm);
create index if not exists contacts_status_idx on contacts(status);
create index if not exists contacts_attributes_gin on contacts using gin(attributes);

-- =========================================================
-- TAGS
-- =========================================================
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  color       text,
  description text,
  created_at  timestamptz not null default now()
);
create unique index if not exists tags_slug_uq on tags(slug);

create table if not exists contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   text,                                -- api, webhook:hubla, automation:<id>, manual
  primary key (contact_id, tag_id)
);
create index if not exists contact_tags_tag_idx on contact_tags(tag_id);

-- =========================================================
-- LISTAS
-- =========================================================
create table if not exists lists (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null,
  description   text,
  listmonk_id   integer,                          -- id da lista no Listmonk (espelho)
  created_at    timestamptz not null default now()
);
create unique index if not exists lists_slug_uq on lists(slug);

create table if not exists list_members (
  list_id    uuid not null references lists(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status     text not null default 'confirmed'
               check (status in ('confirmed','unconfirmed','unsubscribed')),
  added_at   timestamptz not null default now(),
  primary key (list_id, contact_id)
);
create index if not exists list_members_contact_idx on list_members(contact_id);

-- =========================================================
-- TEMPLATES DE EMAIL (conteúdo mora aqui; envio vai pelo Listmonk como campanha ou transacional)
-- =========================================================
create table if not exists email_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subject       text not null,
  body_html     text not null,
  body_text     text,
  from_name     text,
  from_email    text,
  listmonk_tpl_id integer,                        -- id do template transacional no Listmonk (espelho)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- =========================================================
-- EVENTOS (linha do tempo do contato; base de gatilhos e condições)
-- =========================================================
create table if not exists events (
  id          bigserial primary key,
  contact_id  uuid references contacts(id) on delete cascade,
  type        text not null,      -- contact.created, tag.added, tag.removed, list.added, list.removed,
                                  -- email.sent, email.opened, email.clicked, email.bounced,
                                  -- purchase, refund, webhook.<nome>, custom
  data        jsonb not null default '{}'::jsonb,
  source      text,
  created_at  timestamptz not null default now()
);
create index if not exists events_contact_idx on events(contact_id, created_at desc);
create index if not exists events_type_idx on events(type, created_at desc);

-- =========================================================
-- AUTOMAÇÕES
-- =========================================================
-- Uma automação = gatilho + lista ordenada de passos (JSON).
-- Passos suportados (ver src/lib/automation/types.ts):
--   send_email, add_tag, remove_tag, add_to_list, remove_from_list,
--   wait, condition (if/else com ramos), webhook, goal, end
create table if not exists automations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  status        text not null default 'draft' check (status in ('draft','active','paused')),
  trigger       jsonb not null,    -- {type:'tag.added', tag:'comprou-mvs'} | {type:'list.added', list:'...'} |
                                   -- {type:'event', event:'purchase', filter:{...}} | {type:'webhook', key:'...'} | {type:'manual'}
  steps         jsonb not null default '[]'::jsonb,
  settings      jsonb not null default '{"allow_reentry": false}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Um contato dentro de uma automação
create table if not exists automation_runs (
  id             uuid primary key default gen_random_uuid(),
  automation_id  uuid not null references automations(id) on delete cascade,
  contact_id     uuid not null references contacts(id) on delete cascade,
  status         text not null default 'running'
                   check (status in ('running','waiting','completed','failed','cancelled','goal_reached')),
  current_step   text,                      -- id do passo atual
  next_run_at    timestamptz,               -- quando o worker deve processar
  context        jsonb not null default '{}'::jsonb, -- dados do gatilho (compra, webhook...)
  log            jsonb not null default '[]'::jsonb, -- [{at, step, result}]
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  error          text
);
create index if not exists automation_runs_due_idx on automation_runs(next_run_at) where status in ('running','waiting');
create index if not exists automation_runs_contact_idx on automation_runs(contact_id, automation_id);

-- =========================================================
-- ENVIOS (rastreio por contato — o Listmonk também guarda, aqui é a visão do app)
-- =========================================================
create table if not exists email_sends (
  id             bigserial primary key,
  contact_id     uuid not null references contacts(id) on delete cascade,
  template_id    uuid references email_templates(id) on delete set null,
  automation_id  uuid references automations(id) on delete set null,
  run_id         uuid references automation_runs(id) on delete set null,
  listmonk_campaign_id integer,
  subject        text,
  status         text not null default 'queued'
                   check (status in ('queued','sent','failed','bounced')),
  opened_at      timestamptz,
  clicked_at     timestamptz,
  error          text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists email_sends_contact_idx on email_sends(contact_id, created_at desc);

-- =========================================================
-- CHAVES DE API (REST + MCP + webhooks de entrada)
-- =========================================================
create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  key_hash    text not null,          -- sha256 da chave
  key_prefix  text not null,          -- primeiros 8 chars, pra identificar
  scopes      text[] not null default '{read,write}',
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index if not exists api_keys_hash_uq on api_keys(key_hash);

-- Webhooks de entrada (cada integração tem um segredo próprio na URL)
create table if not exists inbound_webhooks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,          -- hubla, tmb, generic:xyz
  provider    text not null,          -- hubla | tmb | generic
  secret      text not null,          -- vai na URL: /api/webhooks/<provider>/<secret>
  config      jsonb not null default '{}'::jsonb, -- ex.: mapa produto -> tag
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists inbound_webhooks_secret_uq on inbound_webhooks(secret);

create table if not exists webhook_logs (
  id          bigserial primary key,
  webhook_id  uuid references inbound_webhooks(id) on delete set null,
  provider    text,
  payload     jsonb,
  result      jsonb,
  ok          boolean,
  created_at  timestamptz not null default now()
);
create index if not exists webhook_logs_created_idx on webhook_logs(created_at desc);

-- =========================================================
-- FUNÇÕES ÚTEIS
-- =========================================================
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists contacts_updated_at on contacts;
create trigger contacts_updated_at before update on contacts for each row execute function set_updated_at();
drop trigger if exists automations_updated_at on automations;
create trigger automations_updated_at before update on automations for each row execute function set_updated_at();
drop trigger if exists email_templates_updated_at on email_templates;
create trigger email_templates_updated_at before update on email_templates for each row execute function set_updated_at();

-- Segmentação: contatos que TÊM todas as tags de `must` e NÃO têm nenhuma de `must_not`
create or replace function segment_contacts(must text[] default '{}', must_not text[] default '{}', lim int default 1000, off int default 0)
returns setof contacts language sql stable as $$
  select c.* from contacts c
  where c.status = 'active'
    and (cardinality(must) = 0 or (
      select count(distinct t.slug) from contact_tags ct join tags t on t.id = ct.tag_id
      where ct.contact_id = c.id and t.slug = any(must)
    ) = cardinality(must))
    and not exists (
      select 1 from contact_tags ct join tags t on t.id = ct.tag_id
      where ct.contact_id = c.id and t.slug = any(must_not)
    )
  order by c.created_at desc
  limit lim offset off
$$;

-- Pega runs vencidos e trava (FOR UPDATE SKIP LOCKED) pro worker processar sem concorrência
create or replace function claim_due_runs(batch int default 100)
returns setof automation_runs language sql as $$
  update automation_runs r
  set status = 'running', next_run_at = null
  where r.id in (
    select id from automation_runs
    where status in ('running','waiting') and next_run_at is not null and next_run_at <= now()
    order by next_run_at
    limit batch
    for update skip locked
  )
  returning r.*
$$;

-- Expor o schema no PostgREST (Supabase): Settings > API > Exposed schemas: adicionar "g2mail"
grant usage on schema g2mail to anon, authenticated, service_role;
grant all on all tables in schema g2mail to service_role;
grant all on all sequences in schema g2mail to service_role;
grant execute on all functions in schema g2mail to service_role;
alter default privileges in schema g2mail grant all on tables to service_role;
alter default privileges in schema g2mail grant all on sequences to service_role;
alter default privileges in schema g2mail grant execute on functions to service_role;
