-- ============================================================================
-- 0047 — Sistema de tarefas com entregas (foto+GPS) — portado do V2
-- tasks: tarefa atribuída a um worker (PONTO = encher estação, PATINETE = mover)
-- task_deliveries: cada entrega com foto, GPS, bike_ids
-- RPC add_task_delivery: insere entrega + auto-complete quando target atingido
-- ============================================================================

create table if not exists public.tasks (
  id              bigint generated always as identity primary key,
  city_id         text not null,
  task_type       text not null check (task_type in ('PONTO','PATINETE')),
  parking_id      text,
  parking_name    text,
  description     text,
  target_count    integer not null default 1,
  delivered_count integer not null default 0,
  status          text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  assigned_to     uuid references auth.users(id) on delete set null,
  assigned_by     uuid references auth.users(id) on delete set null,
  meta            jsonb not null default '{}'::jsonb,
  started_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  criado_em       timestamptz not null default now()
);

create index if not exists idx_tasks_assigned on public.tasks(assigned_to, status);
create index if not exists idx_tasks_city     on public.tasks(city_id, status);
create index if not exists idx_tasks_created  on public.tasks(criado_em desc);

alter table public.tasks enable row level security;

create policy tasks_sel_own on public.tasks
  for select to authenticated using (assigned_to = auth.uid());
create policy tasks_sel_gestor on public.tasks
  for select to authenticated using (public.is_gestor());
create policy tasks_ins_gestor on public.tasks
  for insert to authenticated with check (public.is_gestor());
create policy tasks_upd_gestor on public.tasks
  for update to authenticated using (public.is_gestor());

-- ── task_deliveries ─────────────────────────────────────────────────────────

create table if not exists public.task_deliveries (
  id              bigint generated always as identity primary key,
  task_id         bigint references public.tasks(id) on delete cascade not null,
  user_id         uuid references auth.users(id) on delete set null not null,
  bikes_count     integer not null check (bikes_count between 1 and 10),
  bike_ids        text[],
  photo_path      text not null,
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  gps_unavailable boolean default false,
  notes           text,
  delivered_at    timestamptz not null default now()
);

create index if not exists idx_taskdel_task on public.task_deliveries(task_id, delivered_at);
create index if not exists idx_taskdel_user on public.task_deliveries(user_id, delivered_at);

alter table public.task_deliveries enable row level security;

create policy taskdel_sel_own on public.task_deliveries
  for select to authenticated using (user_id = auth.uid());
create policy taskdel_sel_gestor on public.task_deliveries
  for select to authenticated using (public.is_gestor());
create policy taskdel_ins_own on public.task_deliveries
  for insert to authenticated with check (user_id = auth.uid());

-- ── RPC: add_task_delivery ──────────────────────────────────────────────────

create or replace function public.add_task_delivery(
  p_task_id bigint,
  p_bikes_count integer,
  p_bike_ids text[],
  p_photo_path text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_gps_unavailable boolean default false,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_new_total integer;
  v_completed boolean := false;
begin
  if p_photo_path is null or p_photo_path = '' then
    raise exception 'photo_path obrigatório';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'task % não encontrada', p_task_id;
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'task % não está atribuída ao usuário corrente', p_task_id;
  end if;
  if v_task.status not in ('pending', 'in_progress') then
    raise exception 'task % já está em estado terminal (%)', p_task_id, v_task.status;
  end if;

  insert into public.task_deliveries (
    task_id, user_id, bikes_count, bike_ids, photo_path,
    lat, lng, accuracy, gps_unavailable, notes
  ) values (
    p_task_id, auth.uid(), p_bikes_count, p_bike_ids, p_photo_path,
    p_lat, p_lng, p_accuracy, coalesce(p_gps_unavailable, false), p_notes
  );

  v_new_total := v_task.delivered_count + p_bikes_count;

  if v_new_total >= v_task.target_count then
    update public.tasks set
      delivered_count = v_new_total,
      status = 'completed',
      completed_at = now(),
      started_at = coalesce(v_task.started_at, now())
    where id = p_task_id;
    v_completed := true;
  else
    update public.tasks set
      delivered_count = v_new_total,
      status = 'in_progress',
      started_at = coalesce(v_task.started_at, now())
    where id = p_task_id;
  end if;

  return jsonb_build_object(
    'delivered', v_new_total,
    'target', v_task.target_count,
    'completed', v_completed
  );
end;
$$;

grant execute on function public.add_task_delivery(
  bigint, integer, text[], text, double precision, double precision,
  double precision, boolean, text
) to authenticated;
