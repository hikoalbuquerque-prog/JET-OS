-- ============================================================================
-- 0050 — RPCs de analytics operacional (P4)
-- operator_efficiency: score por worker baseado em entregas de tarefas
-- low_battery_bikes: top 20 bikes com menor bateria
-- ============================================================================

-- ── Eficiência por operador (últimos N dias) ────────────────────────────────
create or replace function public.operator_efficiency(p_days integer default 7)
returns table (
  user_id       uuid,
  nome          text,
  tasks_total   bigint,
  tasks_done    bigint,
  deliveries    bigint,
  bikes_moved   bigint,
  avg_minutes   double precision,
  score         double precision
)
language sql stable
set search_path = public
as $$
  with task_stats as (
    select
      t.assigned_to as uid,
      count(*)                                        as total,
      count(*) filter (where t.status = 'completed')  as done,
      avg(extract(epoch from (t.completed_at - t.started_at)) / 60.0)
        filter (where t.status = 'completed')         as avg_min
    from tasks t
    where t.criado_em >= now() - make_interval(days => p_days)
      and t.assigned_to is not null
    group by t.assigned_to
  ),
  del_stats as (
    select
      d.user_id as uid,
      count(*)           as deliveries,
      sum(d.bikes_count) as bikes
    from task_deliveries d
    where d.delivered_at >= now() - make_interval(days => p_days)
    group by d.user_id
  )
  select
    ts.uid                                       as user_id,
    u.nome,
    coalesce(ts.total, 0)                        as tasks_total,
    coalesce(ts.done, 0)                         as tasks_done,
    coalesce(ds.deliveries, 0)                   as deliveries,
    coalesce(ds.bikes, 0)                        as bikes_moved,
    round(coalesce(ts.avg_min, 0)::numeric, 1)::double precision as avg_minutes,
    case
      when coalesce(ts.total, 0) = 0 then 0
      else round(
        (coalesce(ts.done, 0)::numeric / ts.total * 60) +
        (coalesce(ds.bikes, 0)::numeric * 5) -
        (least(coalesce(ts.avg_min, 30), 120)::numeric * 0.2)
      , 1)::double precision
    end as score
  from task_stats ts
  left join del_stats ds on ds.uid = ts.uid
  left join usuarios u on u.id = ts.uid
  order by score desc;
$$;

grant execute on function public.operator_efficiency(integer) to authenticated;

-- ── Top 20 bikes com menor bateria ──────────────────────────────────────────
create or replace function public.low_battery_bikes(p_city_id text default null, p_limit integer default 20)
returns table (
  bike_id     text,
  city_id     text,
  cidade      text,
  status      text,
  bateria     integer,
  parking_id  text
)
language sql stable
set search_path = public
as $$
  select b.id, b.city_id, b.cidade, b.status, b.bateria,
         (b.dados->>'parking_id')::text as parking_id
  from bikes b
  where b.bateria is not null
    and (p_city_id is null or b.city_id = p_city_id)
  order by b.bateria asc
  limit p_limit;
$$;

grant execute on function public.low_battery_bikes(text, integer) to authenticated;
