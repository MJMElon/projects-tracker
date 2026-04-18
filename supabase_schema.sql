-- ============================================================
-- VIBE TRACKER — Supabase schema
-- Run in Supabase SQL Editor (one-shot). Safe to re-run.
-- After running:
--   Dashboard → Settings → API → "Exposed schemas" → add: project_tracker
-- ============================================================

create schema if not exists project_tracker;
grant usage on schema project_tracker to anon, authenticated;

-- Table-level grants (RLS still applies on top). Must be granted explicitly
-- for non-public schemas; they are not inherited from the public default.
grant select, insert, update, delete on all tables in schema project_tracker to authenticated;
grant usage, select on all sequences in schema project_tracker to authenticated;
alter default privileges in schema project_tracker
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema project_tracker
  grant usage, select on sequences to authenticated;

-- ── projects ────────────────────────────────────────────────
create table if not exists project_tracker.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phases     jsonb not null default '["Frontend","Backend","Testing","Bug Report","Design","DevOps"]'::jsonb,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on project_tracker.projects(owner_id);

-- ── project_members (join table) ────────────────────────────
create table if not exists project_tracker.project_members (
  project_id uuid not null references project_tracker.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner','editor')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists pm_user_idx on project_tracker.project_members(user_id);

-- ── tasks ────────────────────────────────────────────────────
create table if not exists project_tracker.tasks (
  id           text primary key,                     -- keep client-side uid() so local logic survives
  project_id   uuid not null references project_tracker.projects(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  title        text not null,
  descr        text default '',
  phase        text not null,
  urgency      text not null default 'medium',
  assignee     text default '',
  due          text default '',                      -- YYYY-MM-DD string, matches <input type="date">
  start_date   text default '',
  done         boolean not null default false,
  completed_at bigint,                                -- ms epoch
  started_at   bigint,
  screenshots  jsonb not null default '[]'::jsonb,
  subtasks     jsonb not null default '[]'::jsonb,
  history      jsonb not null default '[]'::jsonb,
  created_at   bigint not null,                      -- ms epoch (client-set)
  updated_at   timestamptz not null default now(),
  order_idx    integer                               -- manual drag order within phase (nullable = unset)
);
create index if not exists tasks_project_idx on project_tracker.tasks(project_id);
-- ensure column exists even if table was created before this was added
alter table project_tracker.tasks add column if not exists order_idx integer;

create or replace function project_tracker.touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end; $$ language plpgsql;
drop trigger if exists tasks_touch on project_tracker.tasks;
create trigger tasks_touch before update on project_tracker.tasks
for each row execute function project_tracker.touch_updated_at();

-- ── membership helper (SECURITY DEFINER avoids RLS recursion) ─
create or replace function project_tracker.is_member(pid uuid) returns boolean
language sql security definer set search_path = project_tracker, public as $$
  select exists (
    select 1 from project_tracker.project_members
    where project_id = pid and user_id = auth.uid()
  );
$$;
grant execute on function project_tracker.is_member(uuid) to authenticated;

create or replace function project_tracker.is_owner(pid uuid) returns boolean
language sql security definer set search_path = project_tracker, public as $$
  select exists (
    select 1 from project_tracker.projects
    where id = pid and owner_id = auth.uid()
  );
$$;
grant execute on function project_tracker.is_owner(uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────
alter table project_tracker.projects        enable row level security;
alter table project_tracker.project_members enable row level security;
alter table project_tracker.tasks           enable row level security;

-- projects
drop policy if exists projects_select on project_tracker.projects;
create policy projects_select on project_tracker.projects
  for select to authenticated
  using (project_tracker.is_member(id));

drop policy if exists projects_insert on project_tracker.projects;
create policy projects_insert on project_tracker.projects
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists projects_update on project_tracker.projects;
create policy projects_update on project_tracker.projects
  for update to authenticated
  -- owner check included so upsert() (INSERT ... ON CONFLICT DO UPDATE) works
  -- for brand-new projects, where membership isn't yet established by the trigger.
  using (project_tracker.is_member(id) or owner_id = auth.uid())
  with check (project_tracker.is_member(id) or owner_id = auth.uid());

drop policy if exists projects_delete on project_tracker.projects;
create policy projects_delete on project_tracker.projects
  for delete to authenticated
  using (owner_id = auth.uid());

-- project_members
drop policy if exists pm_select on project_tracker.project_members;
create policy pm_select on project_tracker.project_members
  for select to authenticated
  using (user_id = auth.uid() or project_tracker.is_member(project_id));

drop policy if exists pm_insert on project_tracker.project_members;
create policy pm_insert on project_tracker.project_members
  for insert to authenticated
  with check (project_tracker.is_owner(project_id));

drop policy if exists pm_delete on project_tracker.project_members;
create policy pm_delete on project_tracker.project_members
  for delete to authenticated
  using (project_tracker.is_owner(project_id) or user_id = auth.uid());

-- tasks
drop policy if exists tasks_select on project_tracker.tasks;
create policy tasks_select on project_tracker.tasks
  for select to authenticated
  using (project_tracker.is_member(project_id));

drop policy if exists tasks_insert on project_tracker.tasks;
create policy tasks_insert on project_tracker.tasks
  for insert to authenticated
  with check (project_tracker.is_member(project_id));

drop policy if exists tasks_update on project_tracker.tasks;
create policy tasks_update on project_tracker.tasks
  for update to authenticated
  using (project_tracker.is_member(project_id))
  with check (project_tracker.is_member(project_id));

drop policy if exists tasks_delete on project_tracker.tasks;
create policy tasks_delete on project_tracker.tasks
  for delete to authenticated
  using (project_tracker.is_member(project_id));

-- ── auto-add owner as member on project creation ────────────
create or replace function project_tracker.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = project_tracker, public as $$
begin
  insert into project_tracker.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end; $$;
drop trigger if exists projects_add_owner on project_tracker.projects;
create trigger projects_add_owner after insert on project_tracker.projects
for each row execute function project_tracker.add_owner_as_member();

-- ── invite by email RPC ─────────────────────────────────────
-- Owner-only. Looks up user in auth.users by email and adds as member.
create or replace function project_tracker.invite_member(pid uuid, email_in text)
returns json language plpgsql security definer set search_path = project_tracker, public as $$
declare
  uid uuid;
begin
  if not project_tracker.is_owner(pid) then
    raise exception 'only the project owner can invite members';
  end if;
  select id into uid from auth.users where lower(email) = lower(email_in) limit 1;
  if uid is null then
    return json_build_object('ok', false, 'error', 'no user with that email — ask them to sign up first');
  end if;
  insert into project_tracker.project_members (project_id, user_id, role)
  values (pid, uid, 'editor') on conflict do nothing;
  return json_build_object('ok', true, 'user_id', uid);
end; $$;
grant execute on function project_tracker.invite_member(uuid, text) to authenticated;

-- ── debug: what does Postgres see when a request comes in? ──
create or replace function project_tracker.whoami() returns json
language sql stable as $$
  select json_build_object(
    'auth_uid',      auth.uid(),
    'auth_role',     auth.role(),
    'current_user',  current_user,
    'session_user',  session_user,
    'jwt_claims',    nullif(current_setting('request.jwt.claims', true), '')::jsonb
  )
$$;
grant execute on function project_tracker.whoami() to anon, authenticated;

-- ── realtime (optional but nice for multi-user edits) ───────
do $$
begin
  begin alter publication supabase_realtime add table project_tracker.tasks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table project_tracker.projects; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table project_tracker.project_members; exception when duplicate_object then null; end;
end $$;
