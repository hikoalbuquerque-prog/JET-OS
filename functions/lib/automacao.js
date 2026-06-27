"use strict";
// functions/src/automacao.ts — v2
// Substitui n8n por Cloud Scheduler nativo do Firebase
// Sem custo extra — tudo dentro do free tier do Firebase
//
// Funções agendadas:
//   scraperGoJet       — a cada 5min: busca parkings+bikes, salva snapshot, gera tarefas monitor
//   gerarSlotsAgendado — todo dia 21h: gera slots para o dia seguinte
//   limpezaSnapshots   — todo dia 3h: remove snapshots > 7 dias
//
// Webhooks (chamados pelo app ou scripts):
//   gerarSlotsAutomatico — webhook seguro para trigger manual
//   gerarTarefasMonitor  — webhook para trigger manual/teste
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarTarefasMonitor = exports.gerarSlotsAutomatico = exports.limpezaSnapshots = exports.gerarSlotsAgendado = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const supabase_rest_1 = require("./lib/supabase-rest");
const CITY_ID = '669f89ebd06775867c31b984';
const GOJET_BASE = 'https://logistic.gojet.app/api/v0/urent';
// ─── Mapa de emojis → zonas ───────────────────────────────────────────────────
const ZONA_MAP = {
    '🟥': 'Z1 - Vermelha',
    '⬛': 'Z2 - Preta',
    '🟧': 'Z3 - Laranja',
    '🟦': 'Z4 - Azul',
    '🟩': 'Z5 - Verde',
    '🟨': 'Z6 - Amarela',
    '🏁': 'Zona Interlagos',
};
// ─── Helpers GoJet ────────────────────────────────────────────────────────────
async function fetchGoJet() {
    try {
        const [pRes, bRes] = await Promise.all([
            fetch(`${GOJET_BASE}/parkings?city_id=${CITY_ID}&page=1&limit=1000`),
            fetch(`${GOJET_BASE}/bikes?city_id=${CITY_ID}&page=1&limit=1000`),
        ]);
        if (!pRes.ok || !bRes.ok)
            return null;
        const pJson = await pRes.json();
        const bJson = await bRes.json();
        const parkings = pJson.data ?? pJson ?? [];
        const bikes = bJson.data ?? bJson ?? [];
        // Enriquecer parkings com contagem de bikes
        const bikesPorParking = {};
        for (const b of bikes) {
            if (b.parking_id) {
                bikesPorParking[b.parking_id] = (bikesPorParking[b.parking_id] || 0) + 1;
            }
        }
        for (const p of parkings) {
            p.bikes_count = bikesPorParking[p.id] ?? p.bikes_count ?? p.count ?? 0;
        }
        return { parkings, bikes };
    }
    catch (e) {
        console.error('[GoJet] fetch erro:', e);
        return null;
    }
}
function calcularStatsZonas(parkings) {
    const stats = {};
    for (const p of parkings) {
        // Detecta zona pelo emoji no início do nome
        const emoji = p.name?.match(/^([🟥⬛🟧🟦🟩🟨🏁])/u)?.[1];
        const zona = emoji ? ZONA_MAP[emoji] : null;
        if (!zona)
            continue;
        if (!stats[zona]) {
            stats[zona] = { zona, totalPontos: 0, disponiveis: 0, target: 0, deficit: 0, ociosidade: 0 };
        }
        stats[zona].totalPontos++;
        stats[zona].disponiveis += p.bikes_count ?? 0;
        stats[zona].target += p.target ?? 0;
        stats[zona].deficit += Math.max(0, (p.target ?? 0) - (p.bikes_count ?? 0));
    }
    // Calcular ociosidade por zona
    for (const z of Object.values(stats)) {
        z.ociosidade = z.target > 0
            ? Math.round(((z.target - z.disponiveis) / z.target) * 100)
            : 0;
    }
    return stats;
}
function turnoAtual() {
    const hora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
    if (hora >= 23 || hora < 7)
        return 'T0';
    if (hora >= 10 && hora < 15)
        return 'T1';
    return 'T2';
}
// ─── Core: gerar tarefas monitor ─────────────────────────────────────────────
async function _gerarTarefasMonitor(parkings, turno) {
    const hoje = new Date().toISOString().slice(0, 10);
    // Supabase-first for estacoes
    let estacoesData = [];
    try {
        const sbEstacoes = await (0, supabase_rest_1.supabaseGet)('estacoes', 'select=*&tipo_monitor=in.(M1,M2,M3)');
        if (!sbEstacoes || sbEstacoes.length === 0)
            return;
        estacoesData = sbEstacoes.map((r) => ({
            id: r.id,
            nome: r.nome,
            codigo: r.codigo,
            lat: r.lat,
            lng: r.lng,
            cidade: r.cidade,
            pais: r.pais,
            tipoMonitor: r.tipo_monitor,
            monitorConfig: r.monitor_config ?? {},
            gojetParkingId: r.gojet_parking_id,
            endereco: r.endereco,
        }));
    }
    catch (e) {
        console.error('[tarefasMonitor] Supabase estacoes falhou:', e);
        throw e;
    }
    if (estacoesData.length === 0)
        return;
    let criadas = 0;
    for (const est of estacoesData) {
        const monConfig = est.monitorConfig ?? {};
        // Encontra parking GoJet correspondente (por gojetParkingId ou proximidade)
        const parking = parkings.find((p) => p.id === est.gojetParkingId ||
            (est.lat && est.lng &&
                Math.abs(p.lat - est.lat) < 0.0005 &&
                Math.abs((p.lng ?? 0) - est.lng) < 0.0005));
        if (!parking)
            continue;
        const patinetes = parking.bikes_count ?? 0;
        let precisaTarefa = false;
        let prioridade = 3;
        let descricao = '';
        let cargo = 'scalt';
        if (est.tipoMonitor === 'M1') {
            if (patinetes === 0) {
                precisaTarefa = true;
                prioridade = 5;
                descricao = `🚨 URGENTE: ${est.nome ?? est.codigo} zerou — reposição imediata`;
                cargo = 'scalt';
            }
        }
        else if (est.tipoMonitor === 'M2') {
            const m2 = monConfig.M2 ?? {};
            const isFds = [0, 6].includes(new Date().getDay());
            const turnoKey = isFds ? 'Fds' : (turno === 'T0' || turno === 'T2') ? 'Noite' : 'Dia';
            const min = m2[`min${turnoKey}`] ?? 0;
            const max = m2[`max${turnoKey}`] ?? 99;
            if (patinetes < min) {
                precisaTarefa = true;
                prioridade = patinetes === 0 ? 5 : 4;
                descricao = `📉 ${est.nome}: ${patinetes} pat. abaixo do mínimo ${min} (${turnoKey})`;
                cargo = 'scalt';
            }
            else if (patinetes > max) {
                precisaTarefa = true;
                prioridade = 2;
                descricao = `📈 ${est.nome}: ${patinetes} pat. acima do máximo ${max} — coletar excesso`;
                cargo = 'scalt';
            }
        }
        else if (est.tipoMonitor === 'M3') {
            const m3 = monConfig.M3 ?? {};
            if (m3.promotorAtivo) {
                const slotPromoRows = await (0, supabase_rest_1.supabaseGet)('slots', `select=id&cargo=eq.promotor&cidade=eq.${encodeURIComponent(est.cidade)}&status=in.(aceito,em_andamento)&limit=1`);
                if (!slotPromoRows || slotPromoRows.length === 0) {
                    precisaTarefa = true;
                    prioridade = 3;
                    descricao = `👤 ${est.nome}: ponto M3 sem promotor ativo`;
                    cargo = 'promotor';
                }
            }
        }
        if (!precisaTarefa)
            continue;
        // Evita duplicata: verifica se já tem tarefa aberta para este ponto hoje
        const existRows = await (0, supabase_rest_1.supabaseGet)('tarefas', `select=id,estacao&status=in.(pendente,aceita,em_andamento)&criada_hoje=eq.${hoje}`);
        const hasDupe = (existRows ?? []).some((r) => r.estacao?.id === est.id);
        if (hasDupe)
            continue;
        await (0, supabase_rest_1.supabaseInsert)('tarefas', {
            tipo: est.tipoMonitor === 'M3' ? 'promo_abordagem' : 'rebalanceamento',
            titulo: descricao,
            status: 'pendente',
            prioridade,
            cargo,
            cidade: est.cidade ?? '',
            pais: est.pais ?? 'BR',
            slot_id: null,
            assignee_uid: null,
            assignee_nome: null,
            estacao: {
                id: est.id,
                nome: est.nome ?? est.codigo,
                endereco: est.endereco ?? '',
                lat: est.lat,
                lng: est.lng,
            },
            gojet_parking_id: parking.id,
            patinetes_atual: patinetes,
            gerado_automatico: true,
            tipo_monitor_origem: est.tipoMonitor,
            criada_hoje: hoje,
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
        });
        criadas++;
    }
    if (criadas > 0)
        console.log(`[tarefasMonitor] ${criadas} tarefas criadas`);
}
// DESATIVADO — geração de slots portada para Edge Function Supabase (gerar-slots).
// Mantém export para não quebrar deploy, mas é no-op.
exports.gerarSlotsAgendado = (0, scheduler_1.onSchedule)({ schedule: '0 21 * * *', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 120, region: 'southamerica-east1', maxInstances: 10 }, async () => {
    console.log('[gerarSlotsAgendado] no-op — portado para Edge Function Supabase');
});
// ─── Core: gerar slots ────────────────────────────────────────────────────────
async function _gerarSlots(cfg, statsZonas) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const dataStr = amanha.toISOString().slice(0, 10);
    // Supabase-first for slot_config overrides
    let overrides = {};
    try {
        const sbOverrides = await (0, supabase_rest_1.supabaseGetOne)('app_settings', 'select=valor&chave=eq.slot_config_overrides');
        if (sbOverrides?.valor) {
            overrides = sbOverrides.valor;
        }
    }
    catch (e) {
        console.error('[gerarSlots] Supabase overrides falhou:', e);
        throw e;
    }
    const turnoMap = {
        T0: { inicio: '23:00', fim: '07:00' },
        T1: { inicio: '10:00', fim: '15:00' },
        T2: { inicio: '15:00', fim: '23:00' },
    };
    let totalGerados = 0;
    const erros = [];
    for (const zonaCfg of cfg.zonas) {
        if (!zonaCfg.ativo)
            continue;
        const chave = `${zonaCfg.zona}_${zonaCfg.turno}`;
        if (overrides[chave]?.ativo === false)
            continue;
        let vagas = overrides[chave]?.vagasBase ?? zonaCfg.vagasBase;
        // Multiplicadores baseados em dados GoJet ao vivo
        const snap = statsZonas[zonaCfg.zona];
        if (snap && cfg.multiplicadores) {
            const m = cfg.multiplicadores;
            if (snap.ociosidade > m.limiarOciosidade)
                vagas += m.ociosidadeAlta;
            if (snap.deficit > m.limiarDeficit)
                vagas += m.deficitAlto;
            if (zonaCfg.cargo === 'charger')
                vagas += m.bateriasBaixa;
        }
        const turno = turnoMap[zonaCfg.turno];
        const inicio = `${dataStr}T${turno.inicio}:00`;
        let fim = `${dataStr}T${turno.fim}:00`;
        if (zonaCfg.turno === 'T0') {
            const depois = new Date(amanha);
            depois.setDate(depois.getDate() + 1);
            fim = `${depois.toISOString().slice(0, 10)}T${turno.fim}:00`;
        }
        try {
            for (let i = 0; i < vagas; i++) {
                const [yyyy, mm, dd] = dataStr.split('-');
                await (0, supabase_rest_1.supabaseInsert)('slots', {
                    titulo: `${zonaCfg.cargo === 'charger' ? 'Charger' : 'Scalt'} — ${zonaCfg.zona} ${zonaCfg.turno}`,
                    cargo: zonaCfg.cargo,
                    cidade: zonaCfg.cidade || cfg.cidade,
                    pais: cfg.pais,
                    turno_inicio: inicio,
                    turno_fim: fim,
                    data_slot: `${dd}/${mm}/${yyyy}`,
                    turno: zonaCfg.turno,
                    tipo: zonaCfg.cargo === 'charger' ? 'Charger' : 'Scalt',
                    status: 'aberto',
                    qtd_pessoas: 1,
                    criado_por: 'scheduler',
                    aceito_por: null,
                    tarefas_ids: [],
                    gerado_automatico: true,
                    zona_origem: zonaCfg.zona,
                    criado_em: new Date().toISOString(),
                    atualizado_em: new Date().toISOString(),
                });
                totalGerados++;
            }
        }
        catch (e) {
            erros.push(`${chave}: ${e.message}`);
        }
    }
    await (0, supabase_rest_1.supabaseInsert)('logs_automacao', {
        tipo: 'geracao_slots',
        data: dataStr,
        total_gerados: totalGerados,
        erros,
        criado_em: new Date().toISOString(),
    });
    console.log(`[gerarSlots] ${totalGerados} slots gerados para ${dataStr}`);
}
// ─── FUNCTION: limpezaSnapshots (todo dia 3h) ─────────────────────────────────
// DESATIVADO — gojet_snapshots migrado para Supabase (upsert por city_id, sem acúmulo).
exports.limpezaSnapshots = (0, scheduler_1.onSchedule)({
    schedule: '0 3 * * *',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    maxInstances: 10,
}, async () => {
    console.log('[limpeza] no-op — snapshots agora em Supabase (upsert, sem cleanup necessário)');
});
// ─── FUNCTION: gerarSlotsAutomatico (webhook manual/seguro) ──────────────────
exports.gerarSlotsAutomatico = (0, https_1.onRequest)(async (req, res) => {
    const secret = req.headers['x-n8n-secret'];
    // Supabase-only for slot_config global
    let cfg = null;
    try {
        const sbCfg = await (0, supabase_rest_1.supabaseGetOne)('app_settings', 'select=valor&chave=eq.slot_config_global');
        if (sbCfg?.valor) {
            cfg = sbCfg.valor;
        }
    }
    catch (e) {
        console.error('[gerarSlotsAutomatico] Supabase cfg falhou:', e);
    }
    if (!cfg) {
        res.status(400).json({ erro: 'sem config' });
        return;
    }
    if (secret !== cfg.webhookSecret) {
        res.status(401).json({ erro: 'não autorizado' });
        return;
    }
    const dados = await fetchGoJet();
    const statsZonas = dados ? calcularStatsZonas(dados.parkings) : {};
    await _gerarSlots(cfg, statsZonas);
    res.json({ sucesso: true });
});
// ─── FUNCTION: gerarTarefasMonitor (webhook manual/teste) ────────────────────
exports.gerarTarefasMonitor = (0, https_1.onRequest)(async (req, res) => {
    const secret = req.headers['x-n8n-secret'];
    // Supabase-only for slot_config global
    let cfg = null;
    try {
        const sbCfg = await (0, supabase_rest_1.supabaseGetOne)('app_settings', 'select=valor&chave=eq.slot_config_global');
        if (sbCfg?.valor) {
            cfg = sbCfg.valor;
        }
    }
    catch (e) {
        console.error('[gerarTarefasMonitor] Supabase cfg falhou:', e);
    }
    if (!cfg) {
        res.status(400).json({ erro: 'sem config' });
        return;
    }
    if (secret !== cfg.webhookSecret) {
        res.status(401).json({ erro: 'não autorizado' });
        return;
    }
    const dados = await fetchGoJet();
    if (!dados) {
        res.status(500).json({ erro: 'GoJet indisponível' });
        return;
    }
    const turno = turnoAtual();
    await _gerarTarefasMonitor(dados.parkings, turno);
    res.json({ sucesso: true, turno });
});
//# sourceMappingURL=automacao.js.map