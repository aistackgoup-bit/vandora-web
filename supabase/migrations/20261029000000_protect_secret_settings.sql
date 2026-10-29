-- Secret API keys stored in app_settings must never be readable by visitors.
-- A RESTRICTIVE policy is ANDed with whatever permissive policies already exist,
-- so public settings keep working and only these keys become staff-only.
-- Server code (Vercel /api functions, edge functions) uses the service role and bypasses RLS.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and lower(trim(role)) in ('superadmin', 'admin', 'editor', 'support')
  );
$$;

-- If RLS was off, turning it on with no permissive policy would hide every row,
-- so add the baseline policies first: everyone reads, only staff writes.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_settings'::regclass) then
    create policy "app settings are public" on public.app_settings for select using (true);
    create policy "staff manage app settings" on public.app_settings for all
      using (public.is_staff()) with check (public.is_staff());
    alter table public.app_settings enable row level security;
  end if;
end $$;

drop policy if exists "secret settings are staff only" on public.app_settings;
create policy "secret settings are staff only"
  on public.app_settings
  as restrictive
  for all
  using (
    key not in ('openai_api_key', 'klaviyo_private_api_key', 'meta_capi_token')
    or public.is_staff()
  )
  with check (
    key not in ('openai_api_key', 'klaviyo_private_api_key', 'meta_capi_token')
    or public.is_staff()
  );
