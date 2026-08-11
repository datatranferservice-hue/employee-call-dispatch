-- CallFlow Command v1.0 — production Supabase/PostgreSQL schema
-- Safe to re-run. Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  title text not null default 'Agent',
  role text not null default 'employee' check (role in ('owner','admin','employee')),
  phone_number text,
  pending_phone_number text,
  phone_verified_at timestamptz,
  phone_verification_sent_at timestamptz,
  phone_approved boolean not null default false,
  phone_approved_at timestamptz,
  phone_approved_by uuid references public.profiles(id) on delete set null,
  on_duty boolean not null default false,
  duty_changed_at timestamptz,
  last_assigned_at timestamptz,
  last_call_ended_at timestamptz,
  routed_calls_today integer not null default 0,
  answered_calls_today integer not null default 0,
  stats_date date,
  is_busy boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_e164 check (phone_number is null or phone_number ~ '^\\+[1-9][0-9]{7,14}$'),
  constraint pending_phone_e164 check (pending_phone_number is null or pending_phone_number ~ '^\\+[1-9][0-9]{7,14}$')
);

-- Migration support for older prototype tables.
alter table public.profiles add column if not exists pending_phone_number text;
alter table public.profiles add column if not exists phone_verified_at timestamptz;
alter table public.profiles add column if not exists phone_verification_sent_at timestamptz;
alter table public.profiles add column if not exists routed_calls_today integer not null default 0;
alter table public.profiles add column if not exists answered_calls_today integer not null default 0;
alter table public.profiles add column if not exists stats_date date;

create table if not exists public.org_settings (
  id integer primary key default 1 check (id=1),
  company_name text not null default 'CallFlow Command',
  timezone text not null default 'America/Phoenix',
  business_phone text,
  closed_override boolean not null default false,
  routing_strategy text not null default 'round_robin' check (routing_strategy in ('round_robin','least_calls','longest_idle')),
  ring_seconds integer not null default 25 check (ring_seconds between 10 and 45),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  overflow_action text not null default 'voicemail' check (overflow_action in ('voicemail','on_call','hangup')),
  on_call_number text,
  after_hours_sms_enabled boolean not null default false,
  after_hours_sms text not null default 'Thanks for calling {company}. We are currently closed. We will return your call when we reopen.',
  voicemail_message text not null default 'We are sorry we missed your call. Please leave your name, phone number, and a short message after the tone.',
  callback_queue_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint business_phone_e164 check (business_phone is null or business_phone ~ '^\\+[1-9][0-9]{7,14}$'),
  constraint on_call_e164 check (on_call_number is null or on_call_number ~ '^\\+[1-9][0-9]{7,14}$')
);
insert into public.org_settings(id) values(1) on conflict (id) do nothing;

create table if not exists public.business_hours (
  day_of_week smallint primary key check (day_of_week between 0 and 6),
  is_open boolean not null default false,
  open_time time not null default '08:00',
  close_time time not null default '17:00'
);
insert into public.business_hours(day_of_week,is_open,open_time,close_time) values
(0,false,'08:00','17:00'),(1,true,'08:00','17:00'),(2,true,'08:00','17:00'),(3,true,'08:00','17:00'),(4,true,'08:00','17:00'),(5,true,'08:00','17:00'),(6,false,'08:00','17:00')
on conflict(day_of_week) do nothing;

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  provider_call_sid text unique,
  from_number text,
  to_number text,
  direction text not null default 'inbound',
  status text not null default 'incoming',
  assigned_employee_id uuid references public.profiles(id) on delete set null,
  assigned_name text,
  attempt_count integer not null default 0,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  voicemail_sid text,
  voicemail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.calls add column if not exists voicemail_sid text;
create index if not exists calls_created_idx on public.calls(created_at desc);
create index if not exists calls_employee_idx on public.calls(assigned_employee_id,created_at desc);
create index if not exists calls_provider_idx on public.calls(provider_call_sid);

create table if not exists public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  employee_name text,
  phone_number text,
  attempt_number integer not null,
  status text not null default 'queued',
  provider_dial_sid text,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  unique(call_id,attempt_number)
);
alter table public.call_attempts add column if not exists answered_at timestamptz;
create index if not exists attempts_call_idx on public.call_attempts(call_id,attempt_number);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete set null,
  employee_id uuid references public.profiles(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  scheduled_for timestamptz not null,
  notes text,
  status text not null default 'booked' check(status in ('booked','confirmed','completed','cancelled','no_show')),
  created_at timestamptz not null default now()
);
create index if not exists appointments_when_idx on public.appointments(scheduled_for);

create table if not exists public.callback_queue (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete set null,
  caller_number text not null,
  status text not null default 'waiting' check(status in ('waiting','claimed','completed','cancelled')),
  assigned_employee_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists callback_waiting_idx on public.callback_queue(status,created_at);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  action text not null,
  detail text,
  target_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log(created_at desc);

create or replace function public.is_owner_or_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','admin') and p.is_active);
$$;
revoke all on function public.is_owner_or_admin() from public, anon;
grant execute on function public.is_owner_or_admin() to authenticated, service_role;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active);
$$;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,full_name,is_active)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),false)
  on conflict(id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.guard_profile_operational_state()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.phone_number is distinct from old.phone_number then
    new.phone_approved := false;
    new.phone_approved_at := null;
    new.phone_approved_by := null;
    new.on_duty := false;
  end if;
  if new.on_duty and (not new.is_active or new.phone_number is null or new.phone_verified_at is null or not new.phone_approved) then
    raise exception 'Routing phone must be verified and owner-approved before going on duty';
  end if;
  if not new.is_active then
    new.on_duty := false;
    new.is_busy := false;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile before update on public.profiles for each row execute function public.guard_profile_operational_state();

-- Atomically chooses exactly one eligible employee and marks them busy.
create or replace function public.claim_next_agent(p_exclude uuid[] default '{}', p_strategy text default 'round_robin')
returns table(id uuid, full_name text, phone_number text) language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update public.profiles set routed_calls_today=0,answered_calls_today=0,stats_date=current_date
  where stats_date is distinct from current_date;

  select p.id into v_id
  from public.profiles p
  where p.role in ('employee','admin')
    and p.is_active and p.on_duty and p.phone_verified_at is not null and p.phone_approved
    and p.phone_number is not null and not p.is_busy
    and not (p.id=any(coalesce(p_exclude,'{}'::uuid[])))
  order by
    case when p_strategy='least_calls' then p.routed_calls_today end asc nulls first,
    case when p_strategy='longest_idle' then p.last_call_ended_at end asc nulls first,
    p.last_assigned_at asc nulls first,
    p.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;
  update public.profiles p
  set is_busy=true,last_assigned_at=now(),routed_calls_today=p.routed_calls_today+1,stats_date=current_date,updated_at=now()
  where p.id=v_id;
  return query select p.id,p.full_name,p.phone_number from public.profiles p where p.id=v_id;
end; $$;
revoke all on function public.claim_next_agent(uuid[],text) from public, anon, authenticated;
grant execute on function public.claim_next_agent(uuid[],text) to service_role;

create or replace function public.release_agent(p_employee_id uuid, p_answered boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.profiles
  set is_busy=false,last_call_ended_at=now(),
      answered_calls_today=answered_calls_today + case when p_answered then 1 else 0 end,
      updated_at=now()
  where id=p_employee_id;
end; $$;
revoke all on function public.release_agent(uuid,boolean) from public, anon, authenticated;
grant execute on function public.release_agent(uuid,boolean) to service_role;

create or replace function public.audit_profile_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor text;
begin
  select full_name into actor from public.profiles where id=auth.uid();
  if old.phone_number is distinct from new.phone_number then
    insert into public.audit_log(actor_id,actor_name,action,detail,target_id)
    values(auth.uid(),coalesce(actor,'System'),'PHONE_VERIFIED','Routing phone changed; owner approval reset.',new.id);
  end if;
  if old.phone_approved is distinct from new.phone_approved then
    insert into public.audit_log(actor_id,actor_name,action,detail,target_id)
    values(auth.uid(),coalesce(actor,'System'),'PHONE_APPROVAL',case when new.phone_approved then 'Routing phone approved.' else 'Routing phone approval revoked.' end,new.id);
  end if;
  if old.on_duty is distinct from new.on_duty then
    insert into public.audit_log(actor_id,actor_name,action,detail,target_id)
    values(auth.uid(),coalesce(actor,'System'),'DUTY_CHANGED',case when new.on_duty then 'Went on duty.' else 'Went off duty.' end,new.id);
  end if;
  return new;
end; $$;
drop trigger if exists trg_audit_profile on public.profiles;
create trigger trg_audit_profile after update on public.profiles for each row execute function public.audit_profile_change();

alter table public.profiles enable row level security;
alter table public.org_settings enable row level security;
alter table public.business_hours enable row level security;
alter table public.calls enable row level security;
alter table public.call_attempts enable row level security;
alter table public.appointments enable row level security;
alter table public.callback_queue enable row level security;
alter table public.audit_log enable row level security;

-- Profiles: an employee sees only their own record; owner/admin sees the roster.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using(id=auth.uid() or public.is_owner_or_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
revoke all on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,title,on_duty,duty_changed_at) on public.profiles to authenticated;

-- Settings and hours: readable after login, writable by owner/admin only.
drop policy if exists settings_select on public.org_settings;
create policy settings_select on public.org_settings for select to authenticated using(public.is_active_user());
drop policy if exists settings_update on public.org_settings;
create policy settings_update on public.org_settings for update to authenticated using(public.is_owner_or_admin()) with check(public.is_owner_or_admin());
revoke all on public.org_settings from anon;
grant select,update on public.org_settings to authenticated;

drop policy if exists hours_select on public.business_hours;
create policy hours_select on public.business_hours for select to authenticated using(public.is_active_user());
drop policy if exists hours_owner on public.business_hours;
create policy hours_owner on public.business_hours for all to authenticated using(public.is_owner_or_admin()) with check(public.is_owner_or_admin());
revoke all on public.business_hours from anon;
grant select,insert,update on public.business_hours to authenticated;

-- Calls and attempts: owner sees all; employee sees only assignments to them.
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls for select to authenticated using(public.is_owner_or_admin() or assigned_employee_id=auth.uid());
revoke all on public.calls from anon;
grant select on public.calls to authenticated;

drop policy if exists attempts_select on public.call_attempts;
create policy attempts_select on public.call_attempts for select to authenticated using(public.is_owner_or_admin() or employee_id=auth.uid());
revoke all on public.call_attempts from anon;
grant select on public.call_attempts to authenticated;

-- Appointments: active employees can manage their own; owners can manage all.
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated using(public.is_owner_or_admin() or (employee_id=auth.uid() and public.is_active_user()));
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated with check(public.is_owner_or_admin() or (employee_id=auth.uid() and public.is_active_user()));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated using(public.is_owner_or_admin() or (employee_id=auth.uid() and public.is_active_user())) with check(public.is_owner_or_admin() or (employee_id=auth.uid() and public.is_active_user()));
revoke all on public.appointments from anon;
grant select,insert,update on public.appointments to authenticated;

-- Callback queue and audit are administrative.
drop policy if exists callbacks_select on public.callback_queue;
create policy callbacks_select on public.callback_queue for select to authenticated using(public.is_owner_or_admin());
revoke all on public.callback_queue from anon;
grant select on public.callback_queue to authenticated;

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using(public.is_owner_or_admin());
revoke all on public.audit_log from anon;
grant select on public.audit_log to authenticated;

-- Realtime subscriptions, idempotent.
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.appointments;
exception when duplicate_object then null; end $$;

-- FIRST OWNER BOOTSTRAP (run once after creating your first auth account):
-- update public.profiles
-- set role='owner', is_active=true
-- where email='YOUR-REAL-LOGIN-EMAIL';

-- Ensure future profiles default inactive even when upgrading from the older prototype.
alter table public.profiles alter column is_active set default false;
