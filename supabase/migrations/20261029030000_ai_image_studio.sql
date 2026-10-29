-- AI photo studio (kie.ai): generation jobs and the review gallery.
--
-- Staff start a job from the admin panel; /api/kie-image sends it to kie.ai and the result
-- arrives on /api/kie-callback. Generated files are copied to our R2 bucket (kie.ai keeps them
-- only 14 days) and land in generated_images as "pending" until someone approves them.
-- Both tables are written by the server with the service role; staff read them and review.
-- Requires public.is_staff() from 20261029000000_protect_secret_settings.sql.

create table if not exists public.image_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  color text,
  preset text not null,
  prompt text not null,
  aspect_ratio text not null default '1:1',
  source_urls text[] not null default '{}',
  model text not null default 'google/nano-banana-edit',
  kie_task_id text unique,
  status text not null default 'queued',   -- queued, processing, finalizing, success, failed
  error text,
  credits_consumed numeric,
  callback_token text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists image_jobs_created_idx on public.image_jobs (created_at desc);
create index if not exists image_jobs_status_idx on public.image_jobs (status);

create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.image_jobs(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  color text,
  preset text,
  url text not null,                         -- copy in our R2 bucket
  status text not null default 'pending',    -- pending, approved, rejected
  added_to_product boolean not null default false,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists generated_images_product_idx on public.generated_images (product_id, created_at desc);
create index if not exists generated_images_status_idx on public.generated_images (status, created_at desc);

alter table public.image_jobs enable row level security;
drop policy if exists "staff read image jobs" on public.image_jobs;
create policy "staff read image jobs" on public.image_jobs for select using (public.is_staff());

-- The callback token must never reach the browser, even for staff
revoke select on public.image_jobs from anon, authenticated;
grant select (id, product_id, color, preset, prompt, aspect_ratio, source_urls, model, status, error,
              credits_consumed, created_by, created_at, completed_at)
  on public.image_jobs to authenticated;

alter table public.generated_images enable row level security;
drop policy if exists "staff read generated images" on public.generated_images;
create policy "staff read generated images" on public.generated_images for select using (public.is_staff());
drop policy if exists "staff review generated images" on public.generated_images;
create policy "staff review generated images" on public.generated_images for update
  using (public.is_staff()) with check (public.is_staff());
