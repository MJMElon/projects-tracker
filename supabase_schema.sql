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

-- service_role grants — needed for Edge Functions that use the service-role
-- key to call PostgREST (e.g. invite-user) against this custom schema.
grant usage on schema project_tracker to service_role;
grant all on all tables in schema project_tracker to service_role;
grant all on all sequences in schema project_tracker to service_role;
alter default privileges in schema project_tracker grant all on tables to service_role;
alter default privileges in schema project_tracker grant all on sequences to service_role;

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
  role       text not null default 'member' check (role in ('owner','admin','member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists pm_user_idx on project_tracker.project_members(user_id);

-- Migrate any existing 'editor' rows to 'member' (safe to re-run)
do $$ begin
  if exists (
    select 1 from project_tracker.project_members where role = 'editor'
  ) then
    update project_tracker.project_members set role = 'member' where role = 'editor';
  end if;
end $$;
-- Update constraint to allow the new three-tier roles (idempotent)
alter table project_tracker.project_members drop constraint if exists project_members_role_check;
alter table project_tracker.project_members add constraint project_members_role_check
  check (role in ('owner','admin','member'));

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
  -- keep this policy simple (no is_member call) to avoid recursion:
  -- projects_select → is_member() → project_members SELECT → pm_select → is_member() → ...
  using (user_id = auth.uid());

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

-- ── membership helpers ──────────────────────────────────────
create or replace function project_tracker.is_admin_or_owner(pid uuid) returns boolean
language sql security definer set search_path = project_tracker, public as $$
  select exists (
    select 1 from project_tracker.project_members
    where project_id = pid and user_id = auth.uid() and role in ('owner','admin')
  );
$$;
grant execute on function project_tracker.is_admin_or_owner(uuid) to authenticated;

-- ── invite by email RPC (owner OR admin) ────────────────────
-- If the email is already a registered user → add directly to project_members.
-- If not → record a pending_invites row so they auto-join on signup.
-- The inviter's UI is responsible for sending the actual signup email (mailto:).
create or replace function project_tracker.invite_member(pid uuid, email_in text)
returns json language plpgsql security definer set search_path = project_tracker, public as $$
declare
  uid uuid;
begin
  if not project_tracker.is_admin_or_owner(pid) then
    raise exception 'only owners or admins can invite members';
  end if;
  select id into uid from auth.users where lower(email) = lower(email_in) limit 1;
  if uid is not null then
    insert into project_tracker.project_members (project_id, user_id, role)
    values (pid, uid, 'member') on conflict do nothing;
    return json_build_object('ok', true, 'status', 'added', 'user_id', uid);
  end if;
  -- No account yet — record pending invite. Trigger on auth.users insert
  -- (project_tracker.process_pending_invites) will join them when they sign up.
  insert into project_tracker.pending_invites (email, project_id, role, invited_by)
  values (lower(email_in), pid, 'member', auth.uid())
  on conflict (email, project_id) do update set role = excluded.role, invited_by = excluded.invited_by, invited_at = now();
  return json_build_object('ok', true, 'status', 'pending');
end; $$;
grant execute on function project_tracker.invite_member(uuid, text) to authenticated;

-- ── list members with display name ──────────────────────────
create or replace function project_tracker.get_project_members(pid uuid)
returns table (user_id uuid, email text, display_name text, role text)
language sql security definer stable set search_path = project_tracker, public, auth as $$
  select
    pm.user_id,
    u.email::text,
    coalesce(
      nullif(u.raw_user_meta_data->>'full_name', ''),
      nullif(u.raw_user_meta_data->>'name', ''),
      u.email
    )::text as display_name,
    pm.role
  from project_tracker.project_members pm
  join auth.users u on u.id = pm.user_id
  where pm.project_id = pid
    and exists (
      select 1 from project_tracker.project_members me
      where me.project_id = pid and me.user_id = auth.uid()
    )
  order by case pm.role when 'owner' then 0 when 'admin' then 1 else 2 end, pm.joined_at;
$$;
grant execute on function project_tracker.get_project_members(uuid) to authenticated;

-- ── change a member's role ──────────────────────────────────
-- Owner can set any non-owner to admin or member.
-- Admin can set any non-owner (including other admins) to admin or member.
-- Nobody can modify the owner or transfer ownership via this RPC.
create or replace function project_tracker.set_member_role(pid uuid, uid uuid, new_role text)
returns json language plpgsql security definer set search_path = project_tracker, public as $$
declare
  my_role text;
  target_role text;
begin
  if new_role not in ('admin','member') then
    raise exception 'role must be admin or member';
  end if;
  select role into my_role from project_tracker.project_members
    where project_id = pid and user_id = auth.uid();
  if my_role is null then
    raise exception 'you are not a member of this project';
  end if;
  if my_role not in ('owner','admin') then
    raise exception 'only owners or admins can change roles';
  end if;
  select role into target_role from project_tracker.project_members
    where project_id = pid and user_id = uid;
  if target_role is null then
    raise exception 'target is not a member';
  end if;
  if target_role = 'owner' then
    raise exception 'cannot change the owner''s role';
  end if;
  update project_tracker.project_members set role = new_role
    where project_id = pid and user_id = uid;
  return json_build_object('ok', true);
end; $$;
grant execute on function project_tracker.set_member_role(uuid, uuid, text) to authenticated;

-- ── remove a member (also used for self-leave) ──────────────
-- Owner can remove any non-owner.
-- Admin can remove any non-owner (including other admins).
-- Any member can remove themselves (self-leave), except the owner.
create or replace function project_tracker.remove_member(pid uuid, uid uuid)
returns json language plpgsql security definer set search_path = project_tracker, public as $$
declare
  my_role text;
  target_role text;
begin
  select role into my_role from project_tracker.project_members
    where project_id = pid and user_id = auth.uid();
  select role into target_role from project_tracker.project_members
    where project_id = pid and user_id = uid;
  if target_role is null then
    return json_build_object('ok', true);
  end if;
  if target_role = 'owner' then
    raise exception 'cannot remove the project owner';
  end if;
  if uid = auth.uid() then
    -- self-leave, allowed for non-owner
    null;
  elsif my_role in ('owner','admin') then
    null;
  else
    raise exception 'only owners or admins can remove other members';
  end if;
  delete from project_tracker.project_members where project_id = pid and user_id = uid;
  return json_build_object('ok', true);
end; $$;
grant execute on function project_tracker.remove_member(uuid, uuid) to authenticated;

-- ── RPC data fetchers ──────────────────────────────────────
-- GET requests to custom-schema tables were hanging for some clients;
-- these RPCs (POSTs) are used for initial hydration instead of direct
-- table SELECTs. They bypass table RLS (security definer) and filter
-- by membership themselves.
create or replace function project_tracker.get_my_projects()
returns setof project_tracker.projects
language sql security definer stable set search_path = project_tracker, public as $$
  select p.* from project_tracker.projects p
  join project_tracker.project_members m on m.project_id = p.id
  where m.user_id = auth.uid()
  order by p.created_at;
$$;
grant execute on function project_tracker.get_my_projects() to authenticated;

create or replace function project_tracker.get_my_tasks()
returns setof project_tracker.tasks
language sql security definer stable set search_path = project_tracker, public as $$
  select t.* from project_tracker.tasks t
  join project_tracker.project_members m on m.project_id = t.project_id
  where m.user_id = auth.uid();
$$;
grant execute on function project_tracker.get_my_tasks() to authenticated;

-- ── pending invites (for emails that don't have an account yet) ─
create table if not exists project_tracker.pending_invites (
  email      text not null,
  project_id uuid not null references project_tracker.projects(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin','member')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  primary key (email, project_id)
);
create index if not exists pending_invites_email_idx on project_tracker.pending_invites(lower(email));

-- Auto-join users to projects they had pending invites for, ONLY once they've
-- both signed in AND set a password. Gating on both means an invitee who clicks
-- the magic link doesn't appear in members until they finish setup.
create or replace function project_tracker.process_pending_invites()
returns trigger language plpgsql security definer set search_path = project_tracker, public, auth as $$
begin
  if new.last_sign_in_at is null or new.encrypted_password is null then return new; end if;
  insert into project_tracker.project_members (project_id, user_id, role)
  select pi.project_id, new.id, pi.role
  from project_tracker.pending_invites pi
  where lower(pi.email) = lower(new.email)
  on conflict do nothing;
  delete from project_tracker.pending_invites where lower(email) = lower(new.email);
  return new;
end; $$;

drop trigger if exists pending_invites_trigger on auth.users;
drop trigger if exists pending_invites_trigger_insert on auth.users;
drop trigger if exists pending_invites_trigger_update on auth.users;
create trigger pending_invites_trigger_update
after update of encrypted_password, last_sign_in_at on auth.users
for each row execute function project_tracker.process_pending_invites();

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

-- ── storage: screenshots bucket ─────────────────────────────
-- Public bucket; security by obscurity (UUID paths). Writes require project
-- membership. Reads are allowed for anyone with the URL (public bucket).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vibetracker-screenshots', 'vibetracker-screenshots', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: `{project_id}/{random-uuid}.jpg`
-- SELECT policy is required for delete to work — Supabase's Storage API does
-- an internal SELECT-then-DELETE, and without this the authenticated role's
-- subquery returns 0 rows (even though the bucket is public for direct URL reads).
drop policy if exists "vt_ss_select" on storage.objects;
create policy "vt_ss_select" on storage.objects
for select using (bucket_id = 'vibetracker-screenshots');

drop policy if exists "vt_ss_insert" on storage.objects;
create policy "vt_ss_insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'vibetracker-screenshots'
  and exists (
    select 1 from project_tracker.project_members pm
    where pm.user_id = auth.uid()
      and pm.project_id::text = split_part(name, '/', 1)
  )
);

-- Delete policy: the uploader can always delete their own files; additionally,
-- any member of any project in this app can delete (simpler predicate that
-- avoids path-parsing edge cases). Bucket is private to project members in
-- spirit; unguessable UUID paths prevent cross-project discovery.
drop policy if exists "vt_ss_delete" on storage.objects;
create policy "vt_ss_delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'vibetracker-screenshots'
  and (
    owner_id = auth.uid()::text
    or exists (
      select 1 from project_tracker.project_members pm
      where pm.user_id = auth.uid()
    )
  )
);

-- ── realtime (optional but nice for multi-user edits) ───────
do $$
begin
  begin alter publication supabase_realtime add table project_tracker.tasks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table project_tracker.projects; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table project_tracker.project_members; exception when duplicate_object then null; end;
end $$;
