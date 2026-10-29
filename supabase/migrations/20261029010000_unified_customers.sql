-- Unified customers across every sales channel.
--
-- One row per person in `customers`, matched by phone (E.164) or email. Every touchpoint
-- (web order, manual sale, WhatsApp CRM webhook, newsletter, abandoned cart, affiliate
-- application, account sign-up) is logged in `customer_events`, and every order carries
-- its channel (`orders.origin`) and a link to the customer.
--
-- Capture is done by triggers, so existing code paths feed the CRM without changes, and
-- the trigger functions swallow their own errors: a CRM problem can never block a sale.
-- Requires public.is_staff() from 20261029000000_protect_secret_settings.sql.

-- ---------------------------------------------------------------------------
-- Sales channels (configurable from the admin panel)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_channels (
  key text primary key,
  label text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.sales_channels (key, label, active, sort_order) values
  ('web', 'Tienda web', true, 10),
  ('whatsapp', 'WhatsApp', true, 20),
  ('instagram', 'Instagram', true, 30),
  ('facebook', 'Facebook', true, 40),
  ('marketplace', 'Facebook Marketplace', true, 50),
  ('tienda_fisica', 'Tienda física', false, 60),
  ('calle', 'Venta en la calle', false, 70),
  ('otro', 'Otro', true, 99)
on conflict (key) do nothing;

alter table public.sales_channels enable row level security;
drop policy if exists "sales channels are readable" on public.sales_channels;
create policy "sales channels are readable" on public.sales_channels for select using (true);
drop policy if exists "staff manage sales channels" on public.sales_channels;
create policy "staff manage sales channels" on public.sales_channels for all
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Customers and their touchpoints
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text unique,             -- E.164, e.g. +593991234567
  email text unique,             -- lower-case
  instagram text,
  user_id uuid,                  -- auth user, when she has a web account
  first_channel text,
  first_source text,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists customers_last_seen_idx on public.customers (last_seen_at desc);
create index if not exists customers_first_channel_idx on public.customers (first_channel);

create table if not exists public.customer_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text,
  event_type text not null,      -- order, manual_sale, whatsapp_contact, newsletter, abandoned_cart, ...
  source text,                   -- utm_source / referrer / CRM name
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists customer_events_customer_idx on public.customer_events (customer_id, created_at desc);

alter table public.customers enable row level security;
drop policy if exists "staff manage customers" on public.customers;
create policy "staff manage customers" on public.customers for all
  using (public.is_staff()) with check (public.is_staff());

alter table public.customer_events enable row level security;
drop policy if exists "staff manage customer events" on public.customer_events;
create policy "staff manage customer events" on public.customer_events for all
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Orders: channel, customer link, who registered it, marketing attribution
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists origin text;
alter table public.orders add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.orders add column if not exists created_by uuid;
alter table public.orders add column if not exists attribution jsonb;

update public.orders set origin = 'web' where origin is null;
alter table public.orders alter column origin set default 'web';

create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_origin_created_idx on public.orders (origin, created_at desc);

-- ---------------------------------------------------------------------------
-- Normalization helpers
-- ---------------------------------------------------------------------------

-- Ecuador-first phone normalization to E.164. Returns null for anything that is not a
-- plausible full number (checkout saves partial input while the customer types).
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
begin
  if digits = '' then return null; end if;
  if left(trim(raw), 1) = '+' or left(trim(raw), 2) = '00' then
    digits := regexp_replace(digits, '^00', '');
  elsif digits ~ '^0' then
    digits := '593' || substr(digits, 2);           -- national format: 099..., 02...
  elsif digits ~ '^9' and length(digits) = 9 then
    digits := '593' || digits;                     -- mobile without the leading 0
  end if;

  if digits ~ '^593' then
    -- Ecuador: mobiles are 593 9XXXXXXXX, landlines 593 [2-7]XXXXXXX
    return case when digits ~ '^5939\d{8}$' or digits ~ '^593[2-7]\d{7}$' then '+' || digits end;
  end if;
  return case when length(digits) between 10 and 15 then '+' || digits end;
end;
$$;

create or replace function public.normalize_email(raw text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(raw)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(trim(raw))
  end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_customer: the single entry point every channel goes through
-- ---------------------------------------------------------------------------
create or replace function public.upsert_customer(
  p_phone text,
  p_email text,
  p_name text default null,
  p_channel text default null,
  p_event_type text default null,
  p_source text default null,
  p_metadata jsonb default '{}',
  p_user_id uuid default null,
  p_instagram text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_email text := public.normalize_email(p_email);
  v_name text := nullif(trim(p_name), '');
  v_instagram text := nullif(regexp_replace(trim(coalesce(p_instagram, '')), '^@', ''), '');
  v_id uuid;
begin
  if v_phone is null and v_email is null then
    return null;
  end if;

  -- Phone is the strongest identifier (WhatsApp); fall back to email.
  if v_phone is not null then
    select id into v_id from customers where phone = v_phone;
  end if;
  if v_id is null and v_email is not null then
    select id into v_id from customers where email = v_email;
  end if;

  if v_id is null then
    insert into customers (full_name, phone, email, instagram, user_id, first_channel, first_source,
                           created_at, updated_at, last_seen_at)
    values (v_name, v_phone, v_email, v_instagram, p_user_id, p_channel, p_source,
            p_occurred_at, p_occurred_at, p_occurred_at)
    returning id into v_id;
  else
    -- Only fill gaps; never overwrite data and never steal an identifier from another customer.
    update customers c set
      full_name = coalesce(c.full_name, v_name),
      phone = coalesce(c.phone, case when not exists (select 1 from customers o where o.phone = v_phone) then v_phone end),
      email = coalesce(c.email, case when not exists (select 1 from customers o where o.email = v_email) then v_email end),
      instagram = coalesce(c.instagram, v_instagram),
      user_id = coalesce(c.user_id, p_user_id),
      first_channel = coalesce(c.first_channel, p_channel),
      first_source = coalesce(c.first_source, p_source),
      created_at = least(c.created_at, p_occurred_at),
      last_seen_at = greatest(c.last_seen_at, p_occurred_at),
      updated_at = now()
    where c.id = v_id;
  end if;

  if p_event_type is not null then
    insert into customer_events (customer_id, channel, event_type, source, metadata, created_at)
    values (v_id, p_channel, p_event_type, p_source, coalesce(p_metadata, '{}'), p_occurred_at);
  end if;

  return v_id;
end;
$$;

-- Only triggers and the service role (server webhooks) may call it directly.
revoke execute on function public.upsert_customer(text, text, text, text, text, text, jsonb, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Capture triggers. They read columns through to_jsonb(new) so a missing optional
-- column never breaks the insert, and they never raise.
-- ---------------------------------------------------------------------------
create or replace function public.crm_capture_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
begin
  new.origin := coalesce(nullif(new.origin, ''), 'web');
  if new.customer_id is null then
    begin
      new.customer_id := public.upsert_customer(
        j->>'customer_phone', j->>'customer_email', j->>'customer_name',
        new.origin,
        case when new.origin = 'web' then 'order' else 'manual_sale' end,
        j->'attribution'->>'source',
        jsonb_build_object('order_id', j->>'id', 'total', j->'total', 'status', j->>'status'),
        nullif(j->>'user_id', '')::uuid
      );
    exception when others then
      raise warning 'crm_capture_order: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_capture_order on public.orders;
create trigger crm_capture_order before insert on public.orders
  for each row execute function public.crm_capture_order();

-- Generic capture for the other contact tables. TG_ARGV: channel, event_type.
create or replace function public.crm_capture_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  v_user uuid;
  v_email text;
begin
  begin
    v_user := nullif(coalesce(j->>'user_id', case when TG_TABLE_NAME = 'profiles' then j->>'id' end), '')::uuid;
    v_email := coalesce(j->>'customer_email', j->>'email');
    if v_email is null and v_user is not null then
      select email into v_email from auth.users where id = v_user;
    end if;

    perform public.upsert_customer(
      coalesce(j->>'customer_phone', j->>'phone'),
      v_email,
      coalesce(j->>'customer_name', j->>'full_name', j->>'name'),
      TG_ARGV[0],
      -- Rows are re-saved often (carts while typing, profiles on any edit): log the event once.
      case when TG_OP = 'UPDATE' then null else TG_ARGV[1] end,
      j->>'source',
      jsonb_build_object('table', TG_TABLE_NAME, 'row_id', j->>'id'),
      v_user,
      j->>'social_media'
    );
  exception when others then
    raise warning 'crm_capture_contact(%): %', TG_TABLE_NAME, sqlerrm;
  end;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.abandoned_carts') is not null then
    drop trigger if exists crm_capture_contact on public.abandoned_carts;
    create trigger crm_capture_contact after insert or update on public.abandoned_carts
      for each row execute function public.crm_capture_contact('web', 'abandoned_cart');
  end if;
  if to_regclass('public.newsletter_subscribers') is not null then
    drop trigger if exists crm_capture_contact on public.newsletter_subscribers;
    create trigger crm_capture_contact after insert on public.newsletter_subscribers
      for each row execute function public.crm_capture_contact('web', 'newsletter');
  end if;
  if to_regclass('public.affiliate_applications') is not null then
    drop trigger if exists crm_capture_contact on public.affiliate_applications;
    create trigger crm_capture_contact after insert on public.affiliate_applications
      for each row execute function public.crm_capture_contact('web', 'affiliate_application');
  end if;
  if to_regclass('public.profiles') is not null then
    drop trigger if exists crm_capture_contact on public.profiles;
    create trigger crm_capture_contact after insert or update on public.profiles
      for each row execute function public.crm_capture_contact('web', 'account');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Customer summary for the admin panel (respects the caller's RLS)
-- ---------------------------------------------------------------------------
create or replace view public.customer_summary
with (security_invoker = true) as
select
  c.*,
  coalesce(o.orders_count, 0) as orders_count,
  coalesce(o.total_spent, 0) as total_spent,
  o.first_order_at,
  o.last_order_at,
  o.last_order_channel
from public.customers c
left join lateral (
  select
    count(*) as orders_count,
    sum(total) as total_spent,
    min(created_at) as first_order_at,
    max(created_at) as last_order_at,
    (array_agg(origin order by created_at desc))[1] as last_order_channel
  from public.orders
  where customer_id = c.id
    and coalesce(lower(status), '') not in ('cancelled', 'canceled', 'cancelado', 'rejected')
) o on true;

-- ---------------------------------------------------------------------------
-- Backfill from existing data, oldest first, so first_channel is right
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_id uuid;
begin
  create temp table _crm_src (
    phone text, email text, name text, instagram text, channel text, event_type text,
    source text, occurred_at timestamptz, user_id uuid, order_id text, row_table text
  ) on commit drop;

  insert into _crm_src
  select j->>'customer_phone', j->>'customer_email', j->>'customer_name', null,
         coalesce(nullif(j->>'origin', ''), 'web'),
         case when coalesce(nullif(j->>'origin', ''), 'web') = 'web' then 'order' else 'manual_sale' end,
         null, coalesce((j->>'created_at')::timestamptz, now()), nullif(j->>'user_id', '')::uuid, j->>'id', 'orders'
  from (select to_jsonb(o) j from public.orders o where o.customer_id is null) s;

  if to_regclass('public.abandoned_carts') is not null then
    execute $q$
      insert into _crm_src
      select j->>'customer_phone', j->>'customer_email', null, null, 'web', 'abandoned_cart', null,
             coalesce((j->>'created_at')::timestamptz, (j->>'updated_at')::timestamptz, now()),
             nullif(j->>'user_id', '')::uuid, null, 'abandoned_carts'
      from (select to_jsonb(t) j from public.abandoned_carts t) s
    $q$;
  end if;

  if to_regclass('public.newsletter_subscribers') is not null then
    execute $q$
      insert into _crm_src
      select null, j->>'email', null, null, 'web', 'newsletter', j->>'source',
             coalesce((j->>'created_at')::timestamptz, now()), null, null, 'newsletter_subscribers'
      from (select to_jsonb(t) j from public.newsletter_subscribers t) s
    $q$;
  end if;

  if to_regclass('public.affiliate_applications') is not null then
    execute $q$
      insert into _crm_src
      select null, j->>'email', j->>'full_name', j->>'social_media', 'web', 'affiliate_application', null,
             coalesce((j->>'created_at')::timestamptz, now()), nullif(j->>'user_id', '')::uuid, null, 'affiliate_applications'
      from (select to_jsonb(t) j from public.affiliate_applications t) s
    $q$;
  end if;

  if to_regclass('public.profiles') is not null then
    execute $q$
      insert into _crm_src
      select j->>'phone', u.email, j->>'full_name', null, 'web', 'account', null,
             coalesce((j->>'created_at')::timestamptz, u.created_at, now()), (j->>'id')::uuid, null, 'profiles'
      from (select to_jsonb(p) j from public.profiles p) s
      left join auth.users u on u.id = (s.j->>'id')::uuid
    $q$;
  end if;

  for r in select * from _crm_src order by occurred_at loop
    v_id := public.upsert_customer(
      r.phone, r.email, r.name, r.channel, r.event_type, r.source,
      jsonb_strip_nulls(jsonb_build_object('order_id', r.order_id, 'table', r.row_table, 'backfill', true)),
      r.user_id, r.instagram, r.occurred_at
    );
    if r.order_id is not null and v_id is not null then
      update public.orders set customer_id = v_id where id::text = r.order_id;
    end if;
  end loop;
end $$;
