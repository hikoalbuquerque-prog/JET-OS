-- ============================================================================
-- 0016 — RPC analytics_gojet(p_city_id): KPIs GoJet por cidade (lê parkings/bikes)
-- Capturada do banco em 17/06/2026 (pg_get_functiondef). Corpo idêntico ao de produção.
-- Usada por GoJetAnalyticsPanel (flag VITE_ANALYTICS_PROVIDER=supabase).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_gojet(p_city_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with z as (
    select
      case substr(nome,1,1)
        when '🟥' then 'Z1 - Vermelha' when '⬛' then 'Z2 - Preta' when '🟧' then 'Z3 - Laranja'
        when '🟦' then 'Z4 - Azul' when '🟩' then 'Z5 - Verde' when '🟨' then 'Z6 - Amarela'
        when '🏁' then 'Zona Interlagos' else 'Sem zona' end as zona,
      bikes_disponiveis as disp,
      coalesce((dados->>'target_bikes_count')::int, 0) as tgt
    from public.parkings where city_id = p_city_id
  )
  select jsonb_build_object(
    'parkings_total',   (select count(*) from public.parkings where city_id = p_city_id),
    'monitores',        (select count(*) from public.parkings where city_id = p_city_id and (dados->>'monitor')::boolean),
    'bikes_total',      (select count(*) from public.bikes where city_id = p_city_id),
    'bikes_disponiveis',(select coalesce(sum(bikes_disponiveis),0) from public.parkings where city_id = p_city_id),
    'por_status',       (select coalesce(jsonb_object_agg(status, c),'{}') from
                          (select status, count(*) c from public.bikes where city_id = p_city_id group by status) s),
    'zonas',            (select coalesce(jsonb_agg(jsonb_build_object(
                            'zona', zona, 'parkings', n, 'disponiveis', disp, 'target', tgt,
                            'deficit', greatest(0, tgt - disp),
                            'ociosidade', case when tgt > 0 then round((tgt - disp)::numeric / tgt * 100) else 0 end
                          ) order by zona), '[]')
                          from (select zona, count(*) n, sum(disp) disp, sum(tgt) tgt from z group by zona) zz)
  );
$function$;
