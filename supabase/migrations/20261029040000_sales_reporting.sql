-- Weekly sales by channel and marketing source, for the "Previsión" dashboard.
--
-- One row per (week, channel, source) with orders, revenue, units and how many orders came
-- from first-time vs returning customers. Weeks start on Monday in Ecuador time.
-- Cancelled orders are excluded. security_invoker: only staff can read orders/customers.

create or replace view public.sales_weekly
with (security_invoker = true) as
with valid_orders as (
  select
    o.id,
    o.created_at,
    coalesce(nullif(o.origin, ''), 'web') as channel,
    coalesce(nullif(o.attribution->>'source', ''), case when coalesce(nullif(o.origin, ''), 'web') = 'web' then 'sin_dato' end) as source,
    coalesce(o.total, 0) as total,
    o.customer_id,
    (select coalesce(sum(coalesce(nullif(i->>'quantity', '')::int, 1)), 0)
       from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]' end) i) as units
  from public.orders o
  where coalesce(lower(o.status), '') not in ('cancelled', 'canceled', 'cancelado', 'rejected')
),
ranked as (
  select v.*,
    case when v.customer_id is null then null
         else row_number() over (partition by v.customer_id order by v.created_at) = 1 end as first_order
  from valid_orders v
)
select
  (date_trunc('week', created_at at time zone 'America/Guayaquil'))::date as week,
  channel,
  source,
  count(*)::int as orders,
  sum(total)::numeric(12, 2) as revenue,
  sum(units)::int as units,
  count(*) filter (where first_order)::int as new_customer_orders,
  count(*) filter (where first_order = false)::int as returning_orders
from ranked
group by 1, 2, 3;
