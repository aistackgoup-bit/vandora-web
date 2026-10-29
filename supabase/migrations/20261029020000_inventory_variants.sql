-- Real inventory per product, color and size, shared by every sales channel.
--
-- * product_variants holds the stock of each color/size combination. Variants are created
--   automatically from products.colors x products.sizes.
-- * inventory_movements is the ledger: every change of stock (sale, cancellation, stock
--   received, count adjustment) is a row, and variant stock is only ever changed by it.
-- * Any order, web or manual, takes its units from the matching variant when it is inserted
--   and gives them back if it is cancelled or deleted.
-- * products.stock is kept as the total of its variants, so the storefront, Google feed and
--   existing admin screens keep working.
--
-- Stock that existed before this migration cannot be split by color/size, so it goes to a
-- per-product "sin asignar" pool (color '' / size ''). Sales use the pool when the exact
-- variant has no units, and staff move units from the pool to real variants over time.
-- Requires public.is_staff() from 20261029000000_protect_secret_settings.sql.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  color text not null default '',       -- color name as in products.colors, '' = none / pool
  size text not null default '',        -- size as in products.sizes, '' = none / pool
  sku text,
  stock int not null default 0,         -- may go negative when a channel oversells
  low_stock_threshold int not null default 2,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_variants_unique_idx
  on public.product_variants (product_id, lower(color), lower(size));

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  product_id uuid not null,
  quantity_change int not null,
  reason text not null,                 -- sale, cancel, order_deleted, restock, adjustment, return, damage, transfer, initial
  order_id uuid,
  channel text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);
create index if not exists inventory_movements_order_idx on public.inventory_movements (order_id);

alter table public.product_variants enable row level security;
drop policy if exists "variants are public" on public.product_variants;
create policy "variants are public" on public.product_variants for select using (true);
drop policy if exists "staff manage variants" on public.product_variants;
create policy "staff manage variants" on public.product_variants for update
  using (public.is_staff()) with check (public.is_staff());

-- The ledger is append-only and written by the functions below; staff can read it.
alter table public.inventory_movements enable row level security;
drop policy if exists "staff read inventory movements" on public.inventory_movements;
create policy "staff read inventory movements" on public.inventory_movements for select
  using (public.is_staff());

-- Staff may edit sku / threshold / active, but stock only moves through the ledger.
create or replace function public.inventory_guard_stock()
returns trigger
language plpgsql
as $$
begin
  if new.stock is distinct from old.stock and coalesce(current_setting('vandora.ledger', true), '') <> 'on' then
    raise exception 'Stock changes must be recorded as inventory movements (use adjust_inventory)';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists inventory_guard_stock on public.product_variants;
create trigger inventory_guard_stock before update on public.product_variants
  for each row execute function public.inventory_guard_stock();

-- ---------------------------------------------------------------------------
-- Ledger → variant stock → products.stock
-- ---------------------------------------------------------------------------
create or replace function public.inventory_apply_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('vandora.ledger', 'on', true);
  update product_variants set stock = stock + new.quantity_change where id = new.variant_id;
  perform set_config('vandora.ledger', 'off', true);

  update products p set stock = (
    select greatest(coalesce(sum(stock), 0), 0) from product_variants v where v.product_id = p.id
  ) where p.id = new.product_id;
  return new;
end;
$$;

drop trigger if exists inventory_apply_movement on public.inventory_movements;
create trigger inventory_apply_movement after insert on public.inventory_movements
  for each row execute function public.inventory_apply_movement();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Orders store "Único"/"Única" for products without color or size.
create or replace function public.inventory_key(raw text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(raw, ''))) in ('', 'único', 'unico', 'única', 'unica', 'n/a', 'default') then ''
    else lower(trim(raw))
  end;
$$;

-- Creates the variant rows for every color x size of a product (and the pool when the
-- product has neither) and deactivates combinations the product no longer offers.
create or replace function public.ensure_product_variants(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
  colors text[];
  sizes text[];
begin
  select to_jsonb(p) into j from products p where id = p_product_id;
  if j is null then return; end if;

  select coalesce(array_agg(distinct name) filter (where name <> ''), '{}') into colors
  from (
    select trim(case when jsonb_typeof(c) = 'object' then c->>'name' else c #>> '{}' end) as name
    from jsonb_array_elements(case when jsonb_typeof(j->'colors') = 'array' then j->'colors' else '[]' end) c
  ) s;

  select coalesce(array_agg(distinct name) filter (where name <> ''), '{}') into sizes
  from (
    select trim(s #>> '{}') as name
    from jsonb_array_elements(case when jsonb_typeof(j->'sizes') = 'array' then j->'sizes' else '[]' end) s
  ) s;

  if cardinality(colors) = 0 then colors := array['']; end if;
  if cardinality(sizes) = 0 then sizes := array['']; end if;

  insert into product_variants (product_id, color, size)
  select p_product_id, c, s from unnest(colors) c cross join unnest(sizes) s
  on conflict (product_id, lower(color), lower(size)) do update set active = true;

  update product_variants v set active = false
  where v.product_id = p_product_id
    and v.active
    and not exists (
      select 1 from unnest(colors) c cross join unnest(sizes) s
      where lower(c) = lower(v.color) and lower(s) = lower(v.size)
    )
    and not (v.color = '' and v.size = '');   -- the pool stays visible while it has units
end;
$$;

-- Internal: writes one ledger row. Not callable by clients.
create or replace function public.inventory_record(
  p_variant_id uuid, p_delta int, p_reason text,
  p_order_id uuid default null, p_channel text default null, p_note text default null, p_created_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_delta = 0 then return; end if;
  insert into inventory_movements (variant_id, product_id, quantity_change, reason, order_id, channel, note, created_by)
  select p_variant_id, v.product_id, p_delta, p_reason, p_order_id, p_channel, p_note, p_created_by
  from product_variants v where v.id = p_variant_id;
end;
$$;

-- Internal: takes the units of one order line from the best variant.
create or replace function public.inventory_consume(
  p_product_id uuid, p_color text, p_size text, p_qty int, p_order_id uuid, p_channel text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exact product_variants;
  v_pool product_variants;
  v_target uuid;
begin
  if p_qty is null or p_qty <= 0 then return; end if;

  select * into v_exact from product_variants
  where product_id = p_product_id
    and lower(color) = inventory_key(p_color) and lower(size) = inventory_key(p_size);

  -- Products with a single color or size: match on the other attribute alone
  if v_exact.id is null then
    select * into v_exact from product_variants
    where product_id = p_product_id and active
      and (inventory_key(p_color) = '' or lower(color) = inventory_key(p_color))
      and (inventory_key(p_size) = '' or lower(size) = inventory_key(p_size))
      and not (color = '' and size = '')
    order by stock desc
    limit 1;
  end if;

  select * into v_pool from product_variants where product_id = p_product_id and color = '' and size = '';

  if v_exact.id is not null and v_exact.stock >= p_qty then
    v_target := v_exact.id;
  elsif v_pool.id is not null and v_pool.id is distinct from v_exact.id and v_pool.stock >= p_qty then
    v_target := v_pool.id;
  elsif v_exact.id is not null then
    v_target := v_exact.id;            -- oversold: goes negative and shows up in the panel
  else
    if v_pool.id is null then
      insert into product_variants (product_id, color, size) values (p_product_id, '', '')
      on conflict (product_id, lower(color), lower(size)) do nothing;
      select * into v_pool from product_variants where product_id = p_product_id and color = '' and size = '';
    end if;
    v_target := v_pool.id;
  end if;

  perform inventory_record(v_target, -p_qty, 'sale', p_order_id, p_channel);
end;
$$;

-- Internal: undoes whatever an order still holds (cancel / delete).
create or replace function public.inventory_release_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select variant_id, sum(quantity_change)::int as net
    from inventory_movements where order_id = p_order_id
    group by variant_id having sum(quantity_change) <> 0
  loop
    perform inventory_record(r.variant_id, -r.net, p_reason, p_order_id);
  end loop;
end;
$$;

create or replace function public.inventory_consume_order(p_order jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_product uuid;
begin
  for item in select * from jsonb_array_elements(case when jsonb_typeof(p_order->'items') = 'array' then p_order->'items' else '[]' end)
  loop
    begin
      v_product := nullif(coalesce(item->>'product_id', item->>'id'), '')::uuid;
    exception when others then
      v_product := null;
    end;
    if v_product is not null and exists (select 1 from products where id = v_product) then
      perform inventory_consume(
        v_product, item->>'color', item->>'size',
        coalesce(nullif(item->>'quantity', '')::int, 1),
        (p_order->>'id')::uuid, p_order->>'origin'
      );
    end if;
  end loop;
end;
$$;

revoke execute on function public.inventory_record(uuid, int, text, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.inventory_consume(uuid, text, text, int, uuid, text) from public, anon, authenticated;
revoke execute on function public.inventory_release_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.inventory_consume_order(jsonb) from public, anon, authenticated;
revoke execute on function public.ensure_product_variants(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff API: adjust_inventory (receive stock, count adjustments, moves from the pool)
-- ---------------------------------------------------------------------------
create or replace function public.adjust_inventory(
  p_variant_id uuid, p_delta int, p_reason text default 'adjustment', p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede ajustar el inventario';
  end if;
  if p_reason not in ('restock', 'adjustment', 'return', 'damage', 'transfer', 'initial') then
    raise exception 'Motivo de inventario no válido: %', p_reason;
  end if;
  perform inventory_record(p_variant_id, p_delta, p_reason, null, null, p_note, auth.uid());
  select stock into v_stock from product_variants where id = p_variant_id;
  return v_stock;
end;
$$;

grant execute on function public.adjust_inventory(uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers on products and orders (never block the write)
-- ---------------------------------------------------------------------------
create or replace function public.inventory_sync_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool uuid;
begin
  begin
    perform ensure_product_variants(new.id);
    -- A product created with a starting stock (old form) puts it in the pool
    if TG_OP = 'INSERT' and coalesce(new.stock, 0) > 0 then
      insert into product_variants (product_id, color, size) values (new.id, '', '')
      on conflict (product_id, lower(color), lower(size)) do nothing;
      select id into v_pool from product_variants where product_id = new.id and color = '' and size = '';
      perform inventory_record(v_pool, new.stock, 'initial', null, null, 'Stock inicial del producto');
    end if;
  exception when others then
    raise warning 'inventory_sync_product: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists inventory_sync_product on public.products;
create trigger inventory_sync_product after insert or update of colors, sizes on public.products
  for each row execute function public.inventory_sync_product();

create or replace function public.inventory_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cancelled_states text[] := array['cancelled', 'canceled', 'cancelado', 'rejected'];
  was_cancelled boolean;
  is_cancelled boolean;
begin
  begin
    if TG_OP = 'INSERT' then
      if not (coalesce(lower(new.status), '') = any (cancelled_states)) then
        perform inventory_consume_order(to_jsonb(new));
      end if;
    elsif TG_OP = 'UPDATE' then
      was_cancelled := coalesce(lower(old.status), '') = any (cancelled_states);
      is_cancelled := coalesce(lower(new.status), '') = any (cancelled_states);
      if is_cancelled and not was_cancelled then
        perform inventory_release_order(new.id, 'cancel');
      elsif was_cancelled and not is_cancelled then
        perform inventory_consume_order(to_jsonb(new));
      end if;
    elsif TG_OP = 'DELETE' then
      perform inventory_release_order(old.id, 'order_deleted');
    end if;
  exception when others then
    raise warning 'inventory_on_order: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists inventory_on_order on public.orders;
create trigger inventory_on_order after insert or update of status or delete on public.orders
  for each row execute function public.inventory_on_order();

-- ---------------------------------------------------------------------------
-- Inventory overview with sales velocity (last 30 days, every channel)
-- ---------------------------------------------------------------------------
create or replace view public.inventory_overview
with (security_invoker = true) as
with sold as (
  select
    nullif(coalesce(i->>'product_id', i->>'id'), '') as product_id,
    inventory_key(i->>'color') as color_key,
    inventory_key(i->>'size') as size_key,
    sum(coalesce(nullif(i->>'quantity', '')::int, 1)) as units
  from public.orders o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]' end) i
  where o.created_at >= now() - interval '30 days'
    and coalesce(lower(o.status), '') not in ('cancelled', 'canceled', 'cancelado', 'rejected')
  group by 1, 2, 3
)
select
  v.id, v.product_id, p.name as product_name, p.category, p.price, p.slug,
  v.color, v.size, v.sku, v.stock, v.low_stock_threshold, v.active,
  (v.color = '' and v.size = '' and (
    coalesce(jsonb_array_length(case when jsonb_typeof(to_jsonb(p)->'colors') = 'array' then to_jsonb(p)->'colors' end), 0) > 0
    or coalesce(jsonb_array_length(case when jsonb_typeof(to_jsonb(p)->'sizes') = 'array' then to_jsonb(p)->'sizes' end), 0) > 0
  )) as is_pool,
  coalesce(s.units, 0) as sold_30d,
  case when coalesce(s.units, 0) > 0 then round(v.stock / (s.units / 30.0)) end as days_of_cover,
  v.updated_at
from public.product_variants v
join public.products p on p.id = v.product_id
left join sold s on s.product_id = v.product_id::text and s.color_key = lower(v.color) and s.size_key = lower(v.size);

-- ---------------------------------------------------------------------------
-- Backfill: variants for every product, current stock into the pool
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_pool uuid;
begin
  for r in select id, coalesce(stock, 0) as stock from public.products loop
    perform public.ensure_product_variants(r.id);
    if r.stock > 0 and not exists (select 1 from public.inventory_movements where product_id = r.id) then
      insert into public.product_variants (product_id, color, size) values (r.id, '', '')
      on conflict (product_id, lower(color), lower(size)) do nothing;
      select id into v_pool from public.product_variants where product_id = r.id and color = '' and size = '';
      perform public.inventory_record(v_pool, r.stock, 'initial', null, null, 'Stock previo a inventario por variante');
    end if;
  end loop;
end $$;
