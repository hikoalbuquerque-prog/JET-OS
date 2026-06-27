// functions/src/relatorios.ts
// Relatórios automáticos Guard + Perdas via Telegram — Firebase Functions v2
// Já importado no index.ts via: export * from './relatorios';
import { gerarRelatorioGuard, enviarRelatorioTelegram } from './relatorio';

import { supabaseGet } from './lib/supabase-rest';
import { getAppSetting } from './config-supabase';
import { onCall }     from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

// ─── tipos ───────────────────────────────────────────────────────────
interface Ocorrencia {
  id: string;
  tipo?: string;
  status?: string;
  prioridade?: string;
  cidade_inicial?: string;
  bairro_inicial?: string;
  endereco_inicial?: string;
  responsavel?: string;
  ativo_tipo?: string;
  asset_id?: string;
  descricao?: string;
  lat_inicial?: number;
  lng_inicial?: number;
  foto1_url?: string;
  foto2_url?: string;
  criadoEm?: any;
  created_at?: string;
  filial?: string;
  procurando?: boolean;
}

// ─── helpers de data ─────────────────────────────────────────────────
function getDataOcorrencia(o: Ocorrencia): Date | null {
  if ((o.criadoEm as any)?.toDate) return (o.criadoEm as any).toDate();
  if (o.created_at) { const d = new Date(o.created_at); return isNaN(d.getTime()) ? null : d; }
  return null;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function getRange(tipo: 'ontem' | 'semana'): { ini: Date; fim: Date; label: string } {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (tipo === 'ontem') {
    const d = new Date(agora); d.setDate(d.getDate() - 1);
    const ini = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const fim = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    return { ini, fim, label: fmtDate(ini) };
  }
  // semana anterior: segunda a domingo
  const dow = agora.getDay();
  const diasAteUltimaSegunda = dow === 0 ? 6 : dow - 1;
  const ultSeg = new Date(agora);
  ultSeg.setDate(agora.getDate() - diasAteUltimaSegunda - 7);
  const ini = new Date(ultSeg.getFullYear(), ultSeg.getMonth(), ultSeg.getDate(), 0, 0, 0);
  const fim = new Date(ini); fim.setDate(ini.getDate() + 6); fim.setHours(23, 59, 59);
  return { ini, fim, label: `${fmtDate(ini)} a ${fmtDate(fim)}` };
}

async function buscarOcorrencias(ini: Date, fim: Date): Promise<Ocorrencia[]> {
  const rows = await supabaseGet<any>('ocorrencias', `select=*&created_at=gte.${encodeURIComponent(ini.toISOString())}&created_at=lte.${encodeURIComponent(fim.toISOString())}`);
  if (!rows) return [];
  return rows.map((r: any) => ({
    id: r.id,
    tipo: r.tipo,
    status: r.status,
    prioridade: r.prioridade,
    cidade_inicial: r.cidade_inicial,
    bairro_inicial: r.bairro_inicial,
    endereco_inicial: r.endereco_inicial,
    responsavel: r.responsavel,
    ativo_tipo: r.ativo_tipo,
    asset_id: r.asset_id,
    descricao: r.descricao,
    lat_inicial: r.lat_inicial,
    lng_inicial: r.lng_inicial,
    foto1_url: r.foto1_url,
    foto2_url: r.foto2_url,
    created_at: r.created_at,
    filial: r.filial,
    procurando: r.procurando,
  } as Ocorrencia));
}

async function getTelegramConfig(): Promise<{ token: string; chatId: string }> {
  // 1. Supabase telegram_config table (Onda G)
  try {
    const { getTelegramConfigSupa } = await import('./telegram-supabase');
    const supaCfg = await getTelegramConfigSupa('global');
    if (supaCfg) {
      const token  = String(supaCfg.bot_token || '').trim();
      const chatId = String(supaCfg.relatorios_chat_id || supaCfg.guard_chat_id || supaCfg.perdas_chat_id || '').trim();
      console.log('[telegram-config] Supabase telegram_config → token:', token ? 'OK' : 'VAZIO', 'chatId:', chatId || 'VAZIO');
      if (token && chatId) return { token, chatId };
    }
  } catch { /* fallback */ }

  // 2. Supabase app_settings/config_telegram (onde DashboardManager salva)
  const supa = await getAppSetting<Record<string, any>>('config_telegram');
  if (supa) {
    const token  = String(supa.bot_token  || supa.botToken || '').trim();
    const chatId = String(supa.chat_id    || supa.chatId   || supa.relatorios_chat_id || supa.relatoriosChatId || '').trim();
    console.log('[telegram-config] Supabase app_settings/config_telegram → token:', token ? 'OK' : 'VAZIO', 'chatId:', chatId || 'VAZIO');
    if (token && chatId) return { token, chatId };
  }

  // 3. Supabase app_settings/telegram (legacy key)
  const supaLegacy = await getAppSetting<Record<string, any>>('telegram');
  if (supaLegacy) {
    const token  = String(supaLegacy.bot_token  || supaLegacy.botToken || '').trim();
    const chatId = String(supaLegacy.chat_id    || supaLegacy.chatId   || supaLegacy.relatorios_chat_id || supaLegacy.relatoriosChatId || '').trim();
    console.log('[telegram-config] Supabase app_settings/telegram → token:', token ? 'OK' : 'VAZIO', 'chatId:', chatId || 'VAZIO');
    if (token && chatId) return { token, chatId };
  }

  throw new Error(
    'Config Telegram não encontrada no Supabase (app_settings/config_telegram ou telegram_config). ' +
    'No Dashboard → Guard Config → Telegram, salve o Token do Bot e o Chat ID do grupo.'
  );
}

// ─── geração de texto ─────────────────────────────────────────────────

// ─── emoji helpers ────────────────────────────────────────────────────

function emojiTipo(t: string): string {
  return t === 'Roubo' ? '🔴' : t === 'Tentativa' ? '🟠'
    : t === 'Vandalismo' ? '🟡' : t === 'Recuperacao' ? '🟢' : '⚪';
}

function emojiStatus(s: string): string {
  return /recuper/i.test(s) ? '✅' : /encerr/i.test(s) ? '🔒'
    : /apura/i.test(s)  ? '🔍' : '🔓';
}

function barra(v: number, max: number, len = 10): string {
  const filled = max > 0 ? Math.round((v / max) * len) : 0;
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

// ─── gerarTextoGuard — mensagem Telegram otimizada ────────────────────

function gerarTextoGuard(ocorrs: Ocorrencia[], label: string, semanal: boolean): string {
  const total     = ocorrs.length;
  const abertos   = ocorrs.filter(o => o.status === 'Aberto').length;
  const apuracao  = ocorrs.filter(o => o.status === 'Em apuração' || o.status === 'Em apuracao').length;
  const criticos  = ocorrs.filter(o => o.prioridade === 'Alta' || o.prioridade === 'Critica').length;
  const procurand = ocorrs.filter(o => !!o.procurando).length;
  const fora      = ocorrs.filter(o => !o.lat_inicial && !o.lng_inicial).length;
  // Por tipo
  const porTipo: Record<string, number> = {};
  ocorrs.forEach(o => { const t = o.tipo || 'Outro'; porTipo[t] = (porTipo[t] || 0) + 1; });
  const tiposOrd = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);

  // Por cidade
  const porCidade: Record<string, {
    total: number; roubos: number; recup: number; abertos: number;
    fora: number; criticos: number; procurando: number;
    tipos: Record<string, {ativos: {id:string;status:string;procurando:string|boolean}[]}>;
  }> = {};
  ocorrs.forEach(o => {
    const c = o.cidade_inicial || 'Desconhecida';
    if (!porCidade[c]) porCidade[c] = {
      total:0, roubos:0, recup:0, abertos:0, fora:0, criticos:0, procurando:0, tipos:{}
    };
    const cv = porCidade[c];
    cv.total++;
    if (o.tipo === 'Roubo' || o.tipo === 'Tentativa') cv.roubos++;
    if (/recuper/i.test(o.status||'')) cv.recup++;
    if (o.status === 'Aberto') cv.abertos++;
    if (!o.lat_inicial) cv.fora++;
    if (o.prioridade === 'Alta' || o.prioridade === 'Critica') cv.criticos++;
    if (o.procurando) cv.procurando++;
    const t = o.tipo || 'Outro';
    if (!cv.tipos[t]) cv.tipos[t] = { ativos: [] };
    cv.tipos[t].ativos.push({
      id: o.asset_id || o.id || '',
      status: o.status || '',
      procurando: o.procurando || false,
    });
  });

  const cidadesOrd = Object.entries(porCidade).sort((a, b) => b[1].total - a[1].total);
  const topCidade  = cidadesOrd[0];
  const tipoDom    = tiposOrd[0];
  const maxCidade  = topCidade ? topCidade[1].total : 1;

  const periodo = semanal ? '📆 SEMANAL' : '📅 DIÁRIO';
  const dt      = new Date();
  const dtFmt   = dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });

  let txt = '';
  txt += `🛡 *JET Guard • Relatório ${periodo}*\n`;
  txt += `📆 ${label}  •  Gerado ${dtFmt}\n`;
  txt += `${'─'.repeat(28)}\n\n`;

  // KPIs linha
  txt += `*📊 Resumo*\n`;
  txt += `┌ Total:      *${total}* ocorrências\n`;
  txt += `├ 🔓 Abertos: *${abertos}* | 🔍 Em apuração: *${apuracao}*\n`;
  txt += `├ 🚨 Críticos: *${criticos}*\n`;
  if (procurand > 0) txt += `└ ‼️ PROCURADOS: *${procurand}* ativo(s) em aberto!\n`;
  else txt += `└ Fora de zona: *${fora}*\n`;
  txt += `\n`;

  // Por tipo com barras
  if (tiposOrd.length) {
    txt += `*📍 Por tipo*\n`;
    const maxT = tiposOrd[0][1];
    tiposOrd.forEach(([t, n]) => {
      txt += `${emojiTipo(t)} ${t}: *${n}*  \`${barra(n, maxT, 8)}\`\n`;
    });
    txt += `\n`;
  }

  // Por cidade — detalhado
  if (cidadesOrd.length) {
    txt += `*🏙 Por cidade*\n`;
    cidadesOrd.slice(0, 8).forEach(([cidade, v]) => {
      const bar = barra(v.total, maxCidade, 6);
      txt += `\n*${cidade}* — ${v.total} ocorr  \`${bar}\`\n`;
      // Sub-linha de status
      const parts: string[] = [];
      if (v.roubos)    parts.push(`🔴 ${v.roubos} roubos`);
      if (v.recup)     parts.push(`✅ ${v.recup} recup.`);
      if (v.abertos)   parts.push(`🔓 ${v.abertos} abertos`);
      if (v.criticos)  parts.push(`🚨 ${v.criticos} crít.`);
      if (v.procurando)parts.push(`‼️ ${v.procurando} proc.`);
      if (parts.length) txt += `  ${parts.join('  ')}\n`;
      // Ativos por tipo
      Object.entries(v.tipos)
        .sort((a,b) => b[1].ativos.length - a[1].ativos.length)
        .forEach(([tipo, dados]) => {
          const ativos = dados.ativos.filter(a => a.id);
          if (!ativos.length) return;
          const ids = ativos.slice(0, 5).map(a => {
            const s = a.procurando ? '‼️' : emojiStatus(a.status);
            return `${s}${a.id}`;
          }).join(' ');
          txt += `  ${emojiTipo(tipo)} *${tipo}*: \`${ids}${ativos.length > 5 ? ' +' + (ativos.length-5) : ''}\`\n`;
        });
    });
    txt += `\n`;
  }

  // Alertas
  const alertas: string[] = [];
  if (procurand > 0) alertas.push(`‼️ *${procurand} ativo(s) PROCURADO(S)* — requer ação imediata!`);
  if (criticos > 0) alertas.push(`🚨 ${criticos} ocorrência(s) de alta prioridade`);
  if (abertos + apuracao > 0) alertas.push(`⏳ ${abertos + apuracao} pendente(s) de resolução`);
  if (total > 0 && fora / total > 0.25) alertas.push(`📍 ${Math.round(fora/total*100)}% fora de zona cadastrada`);
  if (tipoDom && tipoDom[1] >= 2) alertas.push(`📌 Tipo dominante: *${tipoDom[0]}* (${tipoDom[1]}x)`);
  if (topCidade && topCidade[1].total >= 2) alertas.push(`🔺 Concentração em *${topCidade[0]}* (${topCidade[1].total} ocorr.)`);

  if (alertas.length) {
    txt += `${'─'.repeat(28)}\n`;
    txt += `*⚠️ Alertas*\n`;
    alertas.forEach(a => { txt += `• ${a}\n`; });
    txt += `\n`;
  }

  if (total === 0) {
    txt += `${'─'.repeat(28)}\n`;
    txt += `✅ *Nenhuma ocorrência registrada no período.*\n`;
  }

  txt += `${'─'.repeat(28)}\n`;
  txt += `📎 _PDF completo em anexo com fotos e detalhes._`;
  return txt;
}

// gerarTextoPerdas — REMOVIDO (jun/2026): relatório de Perdas standalone aposentado.
// As perdas agora são data-driven (Supabase) e em 4 idiomas dentro do relatório Guard
// (relatorio.ts: buscarPerdasSupabase + seção de perdas no texto e no PDF).

// ─── helpers do gráfico ──────────────────────────────────────────────
function calcKpisGrafico(lista: Ocorrencia[]): {
  total: number; patinetes: number; bicicletas: number; baterias: number;
} {
  return {
    total:      lista.length,
    patinetes:  lista.filter(i => String(i.ativo_tipo||'').toLowerCase().includes('patinete')).length,
    bicicletas: lista.filter(i => String(i.ativo_tipo||'').toLowerCase().includes('bicicleta')).length,
    baterias:   lista.filter(i => String(i.ativo_tipo||'').toLowerCase().includes('bateria')).length,
  };
}

function gerarSvgBarras(
  dados: {label:string; valor:number; cor:string}[],
  titulo: string,
  W = 480, H = 160
): string {
  const maxV = Math.max(...dados.map(d => d.valor), 1);
  const PL = 8; const PR = 8; const PT = 28; const PB = 24;
  const CW = W - PL - PR; const CH = H - PT - PB;
  const bw = Math.floor(CW / dados.length * 0.65);
  const gap = Math.floor(CW / dados.length);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:Arial,sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#f8f9fa" rx="8"/>`;
  svg += `<text x="${W/2}" y="16" text-anchor="middle" fill="#1a1a2e" font-size="10" font-weight="bold">${titulo}</text>`;

  // Grade
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = PT + CH * (1 - f);
    const v = Math.round(maxV * f);
    svg += `<line x1="${PL}" x2="${W-PR}" y1="${y}" y2="${y}" stroke="#dee2e6" stroke-width="0.8"/>`;
    svg += `<text x="${PL-2}" y="${y+3}" text-anchor="end" fill="#aaa" font-size="8">${v}</text>`;
  });
  svg += `<line x1="${PL}" x2="${W-PR}" y1="${PT+CH}" y2="${PT+CH}" stroke="#adb5bd" stroke-width="1.5"/>`;

  dados.forEach((d, i) => {
    const bh = d.valor > 0 ? Math.max(4, Math.round((d.valor / maxV) * CH)) : 0;
    const x  = PL + i * gap + (gap - bw) / 2;
    const y  = PT + CH - bh;
    svg += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${d.cor}" rx="3" opacity="0.9"/>`;
    if (d.valor > 0) {
      if (bh > 14) {
        svg += `<text x="${x+bw/2}" y="${y+11}" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">${d.valor}</text>`;
      } else {
        svg += `<text x="${x+bw/2}" y="${y-3}" text-anchor="middle" fill="${d.cor}" font-size="9" font-weight="bold">${d.valor}</text>`;
      }
    }
    svg += `<text x="${x+bw/2}" y="${H-6}" text-anchor="middle" fill="#495057" font-size="8">${d.label}</text>`;
  });

  svg += `</svg>`;
  return svg;
}

function gerarSvgPizza(
  dados: {label:string; valor:number; cor:string}[],
  titulo: string,
  W = 220, H = 160
): string {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  if (total === 0) return '';
  const cx = 70; const cy = H/2; const r = 55;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:Arial,sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#f8f9fa" rx="8"/>`;
  svg += `<text x="${W/2}" y="14" text-anchor="middle" fill="#1a1a2e" font-size="10" font-weight="bold">${titulo}</text>`;

  let startAngle = -Math.PI / 2;
  dados.filter(d => d.valor > 0).forEach(d => {
    const angle = (d.valor / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    svg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z" fill="${d.cor}" opacity="0.9"/>`;
    startAngle = endAngle;
  });

  // Legenda
  dados.filter(d => d.valor > 0).forEach((d, i) => {
    const lx = 145; const ly = 28 + i * 22;
    const pct = Math.round(d.valor / total * 100);
    svg += `<rect x="${lx}" y="${ly-8}" width="10" height="10" fill="${d.cor}" rx="2"/>`;
    svg += `<text x="${lx+13}" y="${ly}" fill="#333" font-size="9">${d.label}: ${d.valor} (${pct}%)</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function gerarSvgGrafico(
  ocorrsOntem: Ocorrencia[],
  ocorrsMes: Ocorrencia[],
  tipo: 'guard' | 'perdas'
): string {
  const kOntem = calcKpisGrafico(ocorrsOntem);
  const kMes   = calcKpisGrafico(ocorrsMes);
  const kAcum  = kMes; // perdas standalone aposentado (perdas agora no relatório Guard)

  const dadosBarras = [
    { label: 'Ontem',    valor: kOntem.total, cor: '#2980b9' },
    { label: 'Este mês', valor: kMes.total,   cor: '#1a1a2e' },
    { label: 'Acumulado',valor: kAcum.total,  cor: '#c0392b' },
  ];
  return gerarSvgBarras(dadosBarras, tipo === 'guard' ? 'Ocorrências por período' : 'Perdas por período');
}

// ─── HTML executivo premium ───────────────────────────────────────────

function gerarHtmlPdf(
  ocorrs: Ocorrencia[],
  titulo: string,
  label: string,
  tipo: 'guard' | 'perdas',
  ocorrsAcum?: Ocorrencia[]
): string {
  const agora    = new Date();
  const ontemDt  = new Date(agora); ontemDt.setDate(ontemDt.getDate() - 1);
  const iniMes   = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const todas    = ocorrsAcum || ocorrs;
  const ocorrsOntem = todas.filter(o => {
    const dt = getDataOcorrencia(o); if (!dt) return false;
    return dt.getDate() === ontemDt.getDate() && dt.getMonth() === ontemDt.getMonth() && dt.getFullYear() === ontemDt.getFullYear();
  });
  const ocorrsMes = todas.filter(o => {
    const dt = getDataOcorrencia(o); if (!dt) return false;
    return dt >= iniMes;
  });

  const abertos   = ocorrs.filter(o => o.status === 'Aberto').length;
  const apuracao  = ocorrs.filter(o => /apura/i.test(o.status || '')).length;
  const recup     = ocorrs.filter(o => /recuper/i.test(o.status || '')).length;
  const encerr    = ocorrs.filter(o => /encerr/i.test(o.status || '')).length;
  const criticos  = ocorrs.filter(o => o.prioridade === 'Alta' || o.prioridade === 'Critica').length;
  const roubos    = ocorrs.filter(o => o.tipo === 'Roubo').length;
  const procurand = ocorrs.filter(o => !!o.procurando).length;
  const taxaResol = ocorrs.length > 0 ? Math.round(((recup + encerr) / ocorrs.length) * 100) : 0;

  // Por tipo
  const porTipo: Record<string, number> = {};
  ocorrs.forEach(o => { const t = o.tipo || 'Outro'; porTipo[t] = (porTipo[t] || 0) + 1; });

  // Por cidade
  const porCidade: Record<string, {total:number;criticos:number;abertos:number;recup:number;fora:number}> = {};
  ocorrs.forEach(o => {
    const c = o.cidade_inicial || 'Desconhecida';
    if (!porCidade[c]) porCidade[c] = {total:0,criticos:0,abertos:0,recup:0,fora:0};
    porCidade[c].total++;
    if (o.prioridade === 'Alta' || o.prioridade === 'Critica') porCidade[c].criticos++;
    if (o.status === 'Aberto') porCidade[c].abertos++;
    if (/recuper/i.test(o.status||'')) porCidade[c].recup++;
    if (!o.lat_inicial) porCidade[c].fora++;
  });
  const cidadesOrd = Object.entries(porCidade).sort((a, b) => b[1].total - a[1].total);

  // SVGs
  const TIPO_CORES: Record<string,string> = {
    'Roubo':'#c0392b','Tentativa':'#e67e22','Vandalismo':'#f1c40f',
    'Recuperacao':'#27ae60','Outro':'#95a5a6'
  };
  const dadosPizza = Object.entries(porTipo).map(([t, v]) => ({
    label: t, valor: v, cor: TIPO_CORES[t] || '#7f8c8d'
  }));
  const dadosCidade = cidadesOrd.slice(0, 8).map(([c, v]) => ({
    label: c.split(' ')[0], valor: v.total, cor: '#2980b9'
  }));

  const svgPeriodo  = gerarSvgGrafico(ocorrsOntem.length ? ocorrsOntem : ocorrs, ocorrsMes.length ? ocorrsMes : ocorrs, tipo);
  const svgTipos    = dadosPizza.length ? gerarSvgPizza(dadosPizza, 'Por tipo', 240, 170) : '';
  const svgCidades  = dadosCidade.length ? gerarSvgBarras(dadosCidade, 'Por cidade', 480, 160) : '';

  // Alertas
  const alertas: string[] = [];
  if (procurand > 0) alertas.push(`‼️ <b>${procurand} ativo(s) PROCURADO(S)</b> — requer ação imediata!`);
  if (criticos > 0) alertas.push(`🚨 ${criticos} ocorrência(s) de alta prioridade`);
  if (abertos + apuracao > 0) alertas.push(`⏳ ${abertos + apuracao} pendente(s) de resolução`);
  if (roubos > 0) alertas.push(`🔴 ${roubos} roubo(s) registrado(s)`);
  if (ocorrs.length > 0 && cidadesOrd[0]?.[1].total / ocorrs.length > 0.5) alertas.push(`📍 Concentração: mais de 50% em ${cidadesOrd[0][0]}`);

  // Linhas da tabela de cidades
  const cityRows = cidadesOrd.map(([c, v]) =>
    `<tr><td><b>${c}</b></td><td class="n">${v.total}</td><td class="n r">${v.abertos}</td>`+
    `<td class="n g">${v.recup}</td><td class="n c">${v.criticos}</td><td class="n">${v.fora}</td></tr>`
  ).join('');

  // Ocorrências detalhadas agrupadas por cidade
  const porCidadeDetalhe: Record<string, Ocorrencia[]> = {};
  ocorrs.forEach(o => {
    const c = o.cidade_inicial || 'Desconhecida';
    if (!porCidadeDetalhe[c]) porCidadeDetalhe[c] = [];
    porCidadeDetalhe[c].push(o);
  });

  let detalhesHtml = '';
  Object.entries(porCidadeDetalhe).sort((a,b) => b[1].length - a[1].length).forEach(([cidade, ocs]) => {
    detalhesHtml += `<div class="cidade-header">${cidade} — ${ocs.length} ocorrência(s)</div>`;
    ocs.forEach(o => {
      const dt = getDataOcorrencia(o);
      const statusCls = /recuper/i.test(o.status||'') ? 'status-g'
        : o.status === 'Aberto' ? 'status-r'
        : /apura/i.test(o.status||'') ? 'status-o' : 'status-n';
      const isCrit = o.prioridade === 'Alta' || o.prioridade === 'Critica';
      const isProc = !!o.procurando;

      detalhesHtml += `<div class="ocorr${isCrit ? ' crit' : ''}${isProc ? ' proc' : ''}">`;
      detalhesHtml += `<div class="ocorr-header">`;
      detalhesHtml += `<span class="ocorr-id">${o.id || ''}</span>`;
      detalhesHtml += `<span class="badge tipo-${(o.tipo||'Outro').toLowerCase().replace(/ã/g,'a').replace(/ç/g,'c')}">${o.tipo||'Outro'}</span>`;
      detalhesHtml += `<span class="badge ${statusCls}">${o.status||''}</span>`;
      if (isCrit) detalhesHtml += `<span class="badge crit-badge">CRÍTICO</span>`;
      if (isProc) detalhesHtml += `<span class="badge proc-badge">‼️ PROCURADO</span>`;
      detalhesHtml += `<span class="ocorr-data">${dt ? dt.toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : ''}</span>`;
      detalhesHtml += `</div>`;

      const infos: string[] = [];
      if (o.asset_id || o.ativo_tipo) infos.push(`Ativo: <b>${[o.ativo_tipo, o.asset_id].filter(Boolean).join(' ')}</b>`);
      if (o.responsavel) infos.push(`Resp.: <b>${o.responsavel}</b>`);
      if (o.bairro_inicial) infos.push(`Bairro: ${o.bairro_inicial}`);
      if (o.endereco_inicial) infos.push(`Endereço: ${o.endereco_inicial}`);
      if (infos.length) detalhesHtml += `<div class="ocorr-info">${infos.join('  •  ')}</div>`;

      if (o.descricao) detalhesHtml += `<div class="ocorr-desc">${o.descricao}</div>`;
      if (isProc && o.procurando && typeof o.procurando === 'string') {
        detalhesHtml += `<div class="ocorr-proc">🔍 Procurando: ${o.procurando}</div>`;
      }

      // Fotos
      const fotos = [o.foto1_url, o.foto2_url].filter((u): u is string => {
        if (!u) return false;
        if (u.includes('drive.google.com')) return false;
        if (u.includes('lh3.googleusercontent.com')) return false;
        return true;
      });
      if (fotos.length) {
        detalhesHtml += `<div class="fotos">`;
        fotos.forEach(url => {
          detalhesHtml += `<img src="${url}" alt="foto" onerror="this.style.display='none'"/>`;
        });
        detalhesHtml += `</div>`;
      }

      detalhesHtml += `</div>`;
    });
  });

  const dtGerado = new Date().toLocaleString('pt-BR', {
    day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${titulo}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #f0f2f5; }

  .page { max-width: 860px; margin: 0 auto; background: #fff; }

  /* Header */
  .header { background: linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%);
    color: #fff; padding: 28px 32px; }
  .header-logo { font-size: 11px; color: rgba(255,255,255,.5); letter-spacing: 2px;
    text-transform: uppercase; margin-bottom: 8px; }
  .header-title { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
  .header-sub { font-size: 12px; color: rgba(255,255,255,.65); }
  .header-date { font-size: 10px; color: rgba(255,255,255,.4); margin-top: 8px; }

  /* KPIs */
  .kpis { display: flex; gap: 12px; padding: 20px 32px; background: #fff;
    border-bottom: 1px solid #e9ecef; flex-wrap: wrap; }
  .kpi { flex: 1; min-width: 80px; background: #f8f9fa; border-radius: 10px;
    padding: 12px 16px; text-align: center; border-top: 3px solid #dee2e6; }
  .kpi.red   { border-top-color: #e74c3c; }
  .kpi.orange{ border-top-color: #e67e22; }
  .kpi.green { border-top-color: #27ae60; }
  .kpi.blue  { border-top-color: #2980b9; }
  .kpi.dark  { border-top-color: #1a1a2e; }
  .kpi.amber { border-top-color: #f39c12; }
  .kpi-v { font-size: 28px; font-weight: 900; line-height: 1; color: #1a1a2e; }
  .kpi-l { font-size: 9px; color: #6c757d; margin-top: 4px; text-transform: uppercase; letter-spacing: .5px; }

  /* Alertas */
  .alertas { margin: 0 32px 20px; background: #fff9f0;
    border: 1px solid #f0ad4e; border-left: 4px solid #e67e22; border-radius: 8px; padding: 12px 16px; }
  .alertas-title { font-size: 11px; font-weight: 700; color: #e67e22;
    text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
  .alertas ul { list-style: none; }
  .alertas li { font-size: 11px; color: #5d4037; padding: 2px 0; }

  /* Seções */
  .section { padding: 20px 32px; }
  .section-title { font-size: 11px; font-weight: 700; color: #495057;
    text-transform: uppercase; letter-spacing: .8px; padding-bottom: 8px;
    border-bottom: 2px solid #1a1a2e; margin-bottom: 14px; display: flex;
    align-items: center; gap: 6px; }

  /* Gráficos lado a lado */
  .charts-row { display: flex; gap: 16px; margin: 0 32px 20px; flex-wrap: wrap; }
  .charts-row svg { flex: 1; min-width: 200px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }

  /* Tabela cidades */
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #1a1a2e; color: #fff; padding: 8px 10px; text-align: left;
    font-size: 9px; text-transform: uppercase; letter-spacing: .5px; }
  th.n, td.n { text-align: center; }
  td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; }
  tr:nth-child(even) td { background: #f8f9fa; }
  td.r { color: #e74c3c; font-weight: 700; }
  td.g { color: #27ae60; font-weight: 700; }
  td.c { color: #e67e22; font-weight: 700; }

  /* Cards ocorrências */
  .cidade-header { background: #1a1a2e; color: #fff; font-weight: 700; font-size: 11px;
    padding: 8px 12px; margin: 0 32px 8px; border-radius: 6px 6px 0 0; }
  .ocorr { background: #fff; border: 1px solid #e9ecef; border-radius: 0 0 6px 6px;
    margin: 0 32px 10px; padding: 10px 14px; page-break-inside: avoid; }
  .ocorr.crit { border-left: 4px solid #e74c3c; }
  .ocorr.proc { border-left: 4px solid #9b59b6; }
  .ocorr-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .ocorr-id { font-family: monospace; font-size: 10px; color: #6c757d; }
  .ocorr-data { margin-left: auto; font-size: 10px; color: #6c757d; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px;
    font-size: 9px; font-weight: 700; text-transform: uppercase; }
  .tipo-roubo    { background: #fde8e8; color: #c0392b; }
  .tipo-tentativa{ background: #fef3e2; color: #d35400; }
  .tipo-vandalismo{background: #fefce8; color: #b7950b; }
  .tipo-recuperacao{background:#e8f8ee; color: #1e8449; }
  .tipo-outro    { background: #f0f0f0; color: #6c757d; }
  .status-r { background: #fde8e8; color: #c0392b; }
  .status-o { background: #fef3e2; color: #d35400; }
  .status-g { background: #e8f8ee; color: #1e8449; }
  .status-n { background: #f0f0f0; color: #6c757d; }
  .crit-badge { background: #e74c3c; color: #fff; }
  .proc-badge { background: #9b59b6; color: #fff; }
  .ocorr-info { font-size: 10px; color: #495057; margin-bottom: 4px; }
  .ocorr-desc { font-size: 10px; color: #6c757d; font-style: italic;
    background: #f8f9fa; border-radius: 4px; padding: 6px 8px; margin-top: 4px; line-height: 1.5; }
  .ocorr-proc { font-size: 10px; color: #7d3c98; background: #f4ecf7;
    border-radius: 4px; padding: 6px 8px; margin-top: 4px; font-weight: 600; }
  .fotos { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .fotos img { width: 140px; height: 100px; object-fit: cover; border-radius: 6px;
    border: 1px solid #dee2e6; }

  /* Footer */
  .footer { background: #1a1a2e; color: rgba(255,255,255,.5); font-size: 9px;
    padding: 16px 32px; text-align: center; margin-top: 20px; }

  @media print {
    body { background: #fff; }
    .page { max-width: 100%; }
    .ocorr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-logo">JET GUARD • RELATÓRIO EXECUTIVO</div>
    <div class="header-title">${titulo}</div>
    <div class="header-sub">Período: ${label}</div>
    <div class="header-date">Gerado em ${dtGerado} • Sistema automático JET OS v2</div>
  </div>

  <!-- KPIs -->
  <div class="kpis">
    <div class="kpi dark"><div class="kpi-v">${ocorrs.length}</div><div class="kpi-l">Total</div></div>
    <div class="kpi red"><div class="kpi-v">${abertos}</div><div class="kpi-l">Abertos</div></div>
    <div class="kpi orange"><div class="kpi-v">${apuracao}</div><div class="kpi-l">Em apuração</div></div>
    <div class="kpi green"><div class="kpi-v">${recup}</div><div class="kpi-l">Recuperados</div></div>
    <div class="kpi blue"><div class="kpi-v">${encerr}</div><div class="kpi-l">Encerrados</div></div>
    <div class="kpi red"><div class="kpi-v">${criticos}</div><div class="kpi-l">Críticos</div></div>
    <div class="kpi amber"><div class="kpi-v">${taxaResol}%</div><div class="kpi-l">Taxa resolução</div></div>
    ${roubos > 0 ? `<div class="kpi red"><div class="kpi-v">${roubos}</div><div class="kpi-l">Roubos</div></div>` : ''}
    ${procurand > 0 ? `<div class="kpi" style="border-top-color:#9b59b6"><div class="kpi-v" style="color:#9b59b6">${procurand}</div><div class="kpi-l">Procurados</div></div>` : ''}
  </div>

  ${alertas.length ? `
  <!-- Alertas -->
  <div class="alertas">
    <div class="alertas-title">⚠️ Alertas automáticos</div>
    <ul>${alertas.map(a => `<li>• ${a}</li>`).join('')}</ul>
  </div>` : ''}

  <!-- Gráficos -->
  <div class="charts-row">
    ${svgPeriodo}
    ${svgTipos}
  </div>

  ${svgCidades ? `<div class="charts-row">${svgCidades}</div>` : ''}

  <!-- Tabela por cidade -->
  ${cidadesOrd.length ? `
  <div class="section">
    <div class="section-title">🏙 Ranking por cidade</div>
    <table>
      <thead><tr>
        <th>Cidade</th>
        <th class="n">Total</th>
        <th class="n">Abertos</th>
        <th class="n">Recup.</th>
        <th class="n">Críticos</th>
        <th class="n">Fora zona</th>
      </tr></thead>
      <tbody>${cityRows}</tbody>
    </table>
  </div>` : ''}

  <!-- Apêndice detalhado -->
  <div class="section">
    <div class="section-title">📋 Apêndice — Ocorrências detalhadas por cidade</div>
  </div>
  ${detalhesHtml}

  <!-- Footer -->
  <div class="footer">
    JET OS Guard System • Relatório gerado automaticamente • ${dtGerado}
  </div>

</div>
</body>
</html>`;
}


// ─── envio Telegram ───────────────────────────────────────────────────
async function enviarTexto(token: string, chatId: string, texto: string): Promise<void> {
  const https = await import('https');
  const body  = JSON.stringify({ chat_id: chatId, text: texto });
  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      { hostname:'api.telegram.org', path:`/bot${token}/sendMessage`, method:'POST',
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} },
      res => { res.resume(); res.statusCode === 200 ? resolve() : reject(new Error(`TG ${res.statusCode}`)); }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

async function enviarDocumento(
  token: string, chatId: string, htmlContent: string, filename: string, caption: string
): Promise<void> {
  const FormData = (await import('form-data')).default;
  const https    = (await import('https')).default;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption.slice(0, 1024));
  form.append('document', Buffer.from(htmlContent, 'utf-8'), { filename, contentType: 'text/html' });

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      { hostname:'api.telegram.org', path:`/bot${token}/sendDocument`, method:'POST',
        headers: form.getHeaders() },
      res => { res.resume(); res.statusCode === 200 ? resolve() : reject(new Error(`TG doc ${res.statusCode}`)); }
    );
    req.on('error', reject);
    form.pipe(req);
  });
}

// ─── orquestrador interno ─────────────────────────────────────────────
// Perdas standalone APOSENTADO (perdas agora data-driven dentro do relatório Guard —
// relatorio.ts). Esta função ficou guard-only.
async function enviarRelatorio(
  periodo: 'ontem' | 'semana'
): Promise<{ ok: boolean; total: number; periodo: string }> {
  const { token, chatId } = await getTelegramConfig();
  const { ini, fim, label } = getRange(periodo);
  const semanal = periodo === 'semana';
  const ocorrs  = await buscarOcorrencias(ini, fim);

  const texto      = gerarTextoGuard(ocorrs, label, semanal);
  const tituloHtml = semanal ? 'JET Guard – Semanal' : 'JET Guard – Diário';
  const html       = gerarHtmlPdf(ocorrs, tituloHtml, label, 'guard');
  const filename   = `guard_${periodo}_${label.replace(/\//g, '-')}.html`;

  await enviarTexto(token, chatId, texto);
  await enviarDocumento(token, chatId, html, filename, `📎 ${tituloHtml} — ${label}`);

  return { ok: true, total: ocorrs.length, periodo: label };
}

// ─── Callable (botão manual no app) ──────────────────────────────────
export const enviarRelatorioManual = onCall(
  {
    timeoutSeconds: 120,
    memory: '256MiB',
    region: 'southamerica-east1',
    maxInstances: 10,
    cors: [
      'https://jet-os-1.web.app',
      'https://jet-os-1.firebaseapp.com',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
  },
  async (r: any) => {
    if (!r.auth) throw new Error('Auth required');
    // tipo 'perdas' aposentado — sempre relatório Guard (que já inclui perdas data-driven).
    const periodo = r.data?.periodo === 'semana' ? 'semana'  : 'ontem';
    return enviarRelatorio(periodo);
  }
);

// ─── Schedules ────────────────────────────────────────────────────────
// Guard semanal — toda segunda às 7h (reporta dom anterior → sab anterior)
export const relatorioGuardSemanal = onSchedule(
  { schedule: '0 7 * * 1', timeZone: 'America/Sao_Paulo', memory: '512MiB', timeoutSeconds: 300, maxInstances: 10 },
  async () => {
    // Calcula dom anterior → sab anterior (semana passada completa)
    const agora   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    // Hoje é segunda → sábado passado = 2 dias atrás, domingo passado = 8 dias atrás
    const sabPassado  = new Date(agora); sabPassado.setDate(agora.getDate() - 2); // sáb
    const domPassado  = new Date(agora); domPassado.setDate(agora.getDate() - 8); // dom

    domPassado.setHours(0, 0, 0, 0);
    sabPassado.setHours(23, 59, 59, 999);

    const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', timeZone:'America/Sao_Paulo' });
    const label = fmtDate(domPassado) + ' a ' + fmtDate(sabPassado);

    // Busca ocorrências da semana
    const ocorrs = await buscarOcorrencias(domPassado, sabPassado);

    // Gera relatório com base no domingo
    const relatorio = await gerarRelatorioGuard(domPassado.toISOString().slice(0, 10));
    // Substitui ocorrências pelo período semanal completo
    const relatorioSemanal = {
      ...relatorio,
      data: domPassado.toISOString().slice(0, 10),
      semana: label,
      totalOcorrencias: ocorrs.length,
      ocorrencias: ocorrs,
    };
    // Recalcula por tipo/status/cidade
    for (const o of ocorrs as any[]) {
      relatorioSemanal.porTipo[o.tipo]   = (relatorioSemanal.porTipo[o.tipo]   || 0) + 1;
      relatorioSemanal.porStatus[o.status] = (relatorioSemanal.porStatus[o.status] || 0) + 1;
      relatorioSemanal.porCidade[o.cidade_inicial||'Sem info'] = (relatorioSemanal.porCidade[o.cidade_inicial||'Sem info'] || 0) + 1;
      if (o.prioridade === 'Alta' || o.prioridade === 'Critica') relatorioSemanal.altaPrioridade++;
      if (o.bo_numero) relatorioSemanal.comBO++;
    }

    await enviarRelatorioTelegram(relatorioSemanal);
    console.log('[guard-semanal] Semana', label, '—', ocorrs.length, 'ocorrências');
  }
);

// relatorioPerdasDiario / relatorioPerdasSemanal — APOSENTADOS (jun/2026).
// As perdas (BRPD) agora são data-driven (Supabase) e em 4 idiomas DENTRO do relatório
// Guard (relatorio.ts). Manter relatórios separados duplicava o envio das 7h e usava o
// número fixo 416. Removidos os exports; deletar no Cloud com:
//   firebase functions:delete relatorioPerdasDiario relatorioPerdasSemanal --region southamerica-east1
