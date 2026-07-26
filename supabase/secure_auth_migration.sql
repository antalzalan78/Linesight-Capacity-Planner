-- LineSight secure cloud-sync migration
-- Run this in Supabase SQL Editor after creating the project.

create table if not exists public.plans (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.plans
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.plans enable row level security;

-- Remove the legacy policy that allowed every publishable-key request to
-- read and overwrite every plan.
drop policy if exists "open access" on public.plans;
drop policy if exists "Users can read own plans" on public.plans;
drop policy if exists "Users can create own plans" on public.plans;
drop policy if exists "Users can update own plans" on public.plans;
drop policy if exists "Users can delete own plans" on public.plans;

revoke all on table public.plans from anon;
grant select, insert, update, delete on table public.plans to authenticated;

create policy "Users can read own plans"
on public.plans for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create own plans"
on public.plans for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can update own plans"
on public.plans for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users can delete own plans"
on public.plans for delete
to authenticated
using ((select auth.uid()) = owner_id);

create index if not exists plans_owner_id_idx on public.plans(owner_id);

-- EXISTING DATA
-- After signing in once, copy your UUID from Authentication -> Users and run:
--
-- update public.plans
-- set owner_id = 'YOUR-USER-UUID'
-- where id = 'default' and owner_id is null;
--
-- Rows without owner_id are intentionally inaccessible through the public API.
