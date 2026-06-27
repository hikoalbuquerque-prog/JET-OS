// ============================================================================
// JET OS — Portão GPS — checagem de pontos em gps_locations (detecção de buraco)
//
// Mostra os últimos pontos GPS de um usuário, com o INTERVALO (gap) entre cada
// ponto e o anterior, marcando atrasos e buracos. O tracker nativo amostra a
// cada ~30s, então gaps de minutos = app parou de enviar em background.
//
// Uso (cmd):
//   set "SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co"
//   set "SUPABASE_SERVICE_ROLE_KEY=<service_role>"
//   node check-gps.mjs email@do-usuario.com [horas]
//
//   email  = e-mail do usuário de teste (resolve o uid via public.usuarios)
//   horas  = janela de tempo a olhar (default 3)
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const EMAIL = process.argv[2];
const HORAS = Number(process.argv[3] || 3);
if (!EMAIL) { console.error('Uso: node check-gps.mjs email@usuario.com [horas]'); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const fmtHora = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });

(async () => {
  // 1) resolve o uid pelo e-mail
  const { data: u, error: eu } = await sb
    .from('usuarios').select('id, nome').ilike('email', EMAIL).maybeSingle();
  if (eu) { console.error('Erro ao buscar usuário:', eu.message); process.exit(1); }
  if (!u) { console.error(`Usuário não encontrado: ${EMAIL}`); process.exit(1); }

  const desde = new Date(Date.now() - HORAS * 3600_000).toISOString();

  // 2) busca os pontos da janela, em ordem cronológica
  const { data: pts, error: ep } = await sb
    .from('gps_locations')
    .select('captured_at, criado_em, bateria, accuracy, speed, estrategia, device_id, is_mock')
    .eq('uid', u.id)
    .gt('captured_at', desde)
    .order('captured_at', { ascending: true });
  if (ep) { console.error('Erro ao buscar pontos:', ep.message); process.exit(1); }

  console.log(`\n== GPS de ${u.nome || EMAIL} — últimas ${HORAS}h ==`);
  if (!pts?.length) {
    console.log('Nenhum ponto na janela. (turno iniciado? GPS permitido? login via auth-login OK?)');
    process.exit(0);
  }

  // 3) calcula gaps e marca status
  let maxGap = 0, buracos = 0, atrasos = 0, prev = null;
  const linhas = [];
  for (const p of pts) {
    const t = new Date(p.captured_at).getTime();
    const gap = prev == null ? null : Math.round((t - prev) / 1000);
    prev = t;
    let status = '';
    if (gap != null) {
      if (gap > maxGap) maxGap = gap;
      if (gap > 240) { status = '⛔ BURACO'; buracos++; }
      else if (gap > 90) { status = '⚠ atraso'; atrasos++; }
      else status = 'ok';
    }
    const mock = p.is_mock ? ' [MOCK]' : '';
    linhas.push(
      `${fmtHora(p.captured_at)}  gap=${gap == null ? '—' : gap + 's'}`.padEnd(28) +
      `${status.padEnd(10)} bat=${p.bateria ?? '?'}% acc=${p.accuracy != null ? Math.round(p.accuracy) + 'm' : '?'} ` +
      `estr=${p.estrategia ?? '-'}${mock}`
    );
  }

  // mostra os últimos 60 (mais recente embaixo)
  for (const l of linhas.slice(-60)) console.log(l);

  const span = Math.round((new Date(pts.at(-1).captured_at) - new Date(pts[0].captured_at)) / 60000);
  console.log(`\n-- Resumo --`);
  console.log(`pontos=${pts.length}  janela_coberta=${span}min  maior_gap=${maxGap}s (${(maxGap/60).toFixed(1)}min)`);
  console.log(`buracos(>4min)=${buracos}  atrasos(>90s)=${atrasos}`);
  console.log(buracos === 0
    ? '✅ Sem buracos — stream contínuo. Portão GPS OK nesta janela.'
    : `⛔ ${buracos} buraco(s) detectado(s) — o GPS parou de enviar em algum momento.`);
})().catch(e => { console.error(e); process.exit(1); });
