"use strict";
// functions/src/relatorio.ts — JET OS V2
// Relatório Guard executivo: texto Telegram + PDF premium
// Seções: Guard (ocorrências) + Roubos 24h/7d/total + Perdas (planilha)
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarRelatorioGuard = gerarRelatorioGuard;
exports.enviarRelatorioTelegram = enviarRelatorioTelegram;
const admin = __importStar(require("firebase-admin"));
// ── TIPOS ──────────────────────────────────────────────────────────────────
const REPORT_TR = {
    title_daily: { pt: '🛡 JET Guard — Relatório Diário', en: '🛡 JET Guard — Daily Report', es: '🛡 JET Guard — Informe Diario', ru: '🛡 JET Guard — Ежедневный отчёт' },
    title_weekly: { pt: '🛡 JET Guard — Relatório Semanal', en: '🛡 JET Guard — Weekly Report', es: '🛡 JET Guard — Informe Semanal', ru: '🛡 JET Guard — Еженедельный отчёт' },
    highlight: { pt: '🔴 Destaque — Em aberto', en: '🔴 Highlights — Open', es: '🔴 Destacados — Abiertos', ru: '🔴 Внимание — Открытые' },
    robbery: { pt: 'Roubo', en: 'Robbery', es: 'Robo', ru: 'Кража' },
    vandalism: { pt: 'Vandalismo', en: 'Vandalism', es: 'Vandalismo', ru: 'Вандализм' },
    attempt: { pt: 'Tentativa', en: 'Attempt', es: 'Tentativa', ru: 'Попытка' },
    recovery: { pt: 'Recuperação', en: 'Recovery', es: 'Recuperación', ru: 'Возврат' },
    wanted: { pt: 'PROCURADOS', en: 'WANTED', es: 'BUSCADOS', ru: 'РОЗЫСК' },
    no_open: { pt: 'Nenhum roubo ou vandalismo em aberto', en: 'No open robberies or vandalism', es: 'Sin robos ni vandalismo abiertos', ru: 'Нет открытых краж или вандализма' },
    summary: { pt: '📊 Resumo do dia', en: '📊 Daily Summary', es: '📊 Resumen del día', ru: '📊 Сводка за день' },
    total: { pt: 'Total', en: 'Total', es: 'Total', ru: 'Всего' },
    open: { pt: 'Abertos', en: 'Open', es: 'Abiertos', ru: 'Открыто' },
    critical: { pt: 'Críticos', en: 'Critical', es: 'Críticos', ru: 'Критических' },
    with_bo: { pt: '📋 Com BO', en: '📋 Police report', es: '📋 Con parte', ru: '📋 С рапортом' },
    by_type: { pt: '📍 Por tipo (aberto | recuperado)', en: '📍 By type (open | recovered)', es: '📍 Por tipo (abierto | recuperado)', ru: '📍 По типу (открыто | восстановлено)' },
    open_lbl: { pt: 'aberto', en: 'open', es: 'abierto', ru: 'открыто' },
    recov_lbl: { pt: 'recup.', en: 'recov.', es: 'recup.', ru: 'восст.' },
    by_city: { pt: '🏙 Por cidade', en: '🏙 By city', es: '🏙 Por ciudad', ru: '🏙 По городам' },
    open_lbl2: { pt: 'abertos', en: 'open', es: 'abiertos', ru: 'откр.' },
    technical: { pt: '📋 Dados técnicos', en: '📋 Technical data', es: '📋 Datos técnicos', ru: '📋 Технические данные' },
    rob_open: { pt: 'Roubo em aberto', en: 'Open robberies', es: 'Robos abiertos', ru: 'Кража — открыто' },
    vand_open: { pt: 'Vandalismo em aberto', en: 'Open vandalism', es: 'Vandalismo abierto', ru: 'Вандализм — открыто' },
    recovered: { pt: 'Recuperado', en: 'Recovered', es: 'Recuperado', ru: 'восст.' },
    yesterday: { pt: 'Ontem', en: 'Yesterday', es: 'Ayer', ru: 'Вчера' },
    last7d: { pt: 'Últimos 7d', en: 'Last 7d', es: 'Últimos 7d', ru: 'За 7 дней' },
    month_lbl: { pt: 'Mês', en: 'Month', es: 'Mes', ru: 'Месяц' },
    brpd: { pt: 'BRPD acumulado', en: 'BRPD accumulated', es: 'BRPD acumulado', ru: 'BRPD' },
    top_branches: { pt: 'Top filiais BRPD', en: 'Top branches BRPD', es: 'Top filiales BRPD', ru: 'Топ филиалов BRPD' },
    responsible: { pt: '👤 Responsáveis', en: '👤 Responsible', es: '👤 Responsables', ru: '👤 Ответственные' },
    alerts: { pt: '⚠️ Alertas', en: '⚠️ Alerts', es: '⚠️ Alertas', ru: '⚠️ Предупреждения' },
    alert_wanted: { pt: 'PROCURADO(S) — ação imediata!', en: 'WANTED — immediate action!', es: 'BUSCADO(S) — ¡acción inmediata!', ru: 'САМОКАТ(ОВ) В РОЗЫСКЕ — срочно!' },
    alert_critical: { pt: 'ocorrência(s) crítica(s)', en: 'critical incident(s)', es: 'incidente(s) crítico(s)', ru: 'критических инцидента' },
    alert_rob_open: { pt: 'roubo(s) em aberto', en: 'open robbery(ies)', es: 'robo(s) abierto(s)', ru: 'кража(и) не закрыты' },
    alert_multiple: { pt: 'Múltiplos roubos nas últimas 24h', en: 'Multiple robberies in last 24h', es: 'Múltiples robos en las últimas 24h', ru: 'Множество краж за последние 24ч' },
    alert_concentrated: { pt: '50%+ concentrado em', en: '50%+ concentrated in', es: '50%+ concentrado en', ru: '50%+ сосредоточено в' },
    pdf_footer: { pt: '📎 _PDF executivo completo em anexo_', en: '📎 _Full executive PDF attached_', es: '📎 _PDF ejecutivo completo adjunto_', ru: '📎 _PDF с деталями в приложении_' },
    robberies: { pt: 'roubos', en: 'robberies', es: 'robos', ru: 'краж' },
    vandalisms: { pt: 'vandalismos', en: 'vandalisms', es: 'vandalismos', ru: 'вандализм' },
    open_since: { pt: 'ocorr.', en: 'inc.', es: 'ocurr.', ru: 'инц.' },
    pdf_exec_report: { pt: 'Relatório Executivo', en: 'Executive Report', es: 'Informe Ejecutivo', ru: 'Исполнительный отчёт' },
    pdf_ref_date: { pt: 'Data de referência', en: 'Reference date', es: 'Fecha de referencia', ru: 'Дата отчёта' },
    pdf_open_rob: { pt: 'Roubos em aberto', en: 'Open Robberies', es: 'Robos Abiertos', ru: 'Открытые кражи' },
    pdf_open_vand: { pt: 'Vandalismos em aberto', en: 'Open Vandalism', es: 'Vandalismos Abiertos', ru: 'Открытый вандализм' },
    pdf_wanted: { pt: 'Procurados', en: 'Wanted', es: 'Buscados', ru: 'В розыске' },
    pdf_temporal: { pt: '📅 Evolução temporal', en: '📅 Temporal evolution', es: '📅 Evolución temporal', ru: '📅 Динамика по времени' },
    pdf_yesterday: { pt: 'Ontem', en: 'Yesterday', es: 'Ayer', ru: 'Вчера' },
    pdf_7d: { pt: '7 dias', en: '7 days', es: '7 días', ru: '7 дней' },
    pdf_month: { pt: 'Mês atual', en: 'Current month', es: 'Mes actual', ru: 'Текущий месяц' },
    pdf_accum: { pt: 'Acumulado', en: 'Accumulated', es: 'Acumulado', ru: 'Накопленный' },
    pdf_rob_by_city: { pt: 'Roubos por cidade', en: 'Robberies by city', es: 'Robos por ciudad', ru: 'Кражи по городам' },
    pdf_vand_by_city: { pt: 'Vandalismo por cidade', en: 'Vandalism by city', es: 'Vandalismo por ciudad', ru: 'Вандализм по городам' },
    pdf_city: { pt: 'Cidade', en: 'City', es: 'Ciudad', ru: 'Город' },
    pdf_open_col: { pt: 'Abertos', en: 'Open', es: 'Abiertos', ru: 'Открыто' },
    pdf_critical_col: { pt: 'Críticos', en: 'Critical', es: 'Críticos', ru: 'Крит.' },
    pdf_24h_rob: { pt: 'Ocorrências de roubo — últimas 24h', en: 'Robbery incidents — last 24h', es: 'Incidentes de robo — últimas 24h', ru: 'Кражи — последние 24ч' },
    pdf_24h_vand: { pt: 'Ocorrências de vandalismo — últimas 24h', en: 'Vandalism incidents — last 24h', es: 'Incidentes de vandalismo — últimas 24h', ru: 'Вандализм — последние 24ч' },
    pdf_datetime: { pt: 'Data/hora', en: 'Date/time', es: 'Fecha/hora', ru: 'Дата/время' },
    pdf_type: { pt: 'Tipo', en: 'Type', es: 'Tipo', ru: 'Тип' },
    pdf_asset: { pt: 'Ativo', en: 'Asset', es: 'Activo', ru: 'Актив' },
    pdf_guard_col: { pt: 'Guard', en: 'Guard', es: 'Guard', ru: 'Guard' },
    pdf_bo: { pt: 'BO', en: 'Report', es: 'Parte', ru: 'Рапорт' },
    pdf_damage: { pt: 'Dano / Foto', en: 'Damage / Photo', es: 'Daño / Foto', ru: 'Ущерб / Фото' },
    pdf_no_24h_rob: { pt: 'Nenhum roubo nas últimas 24h', en: 'No robberies in the last 24h', es: 'Sin robos en las últimas 24h', ru: 'Краж за последние 24ч нет' },
    pdf_no_24h_vand: { pt: 'Nenhum vandalismo nas últimas 24h', en: 'No vandalism in the last 24h', es: 'Sin vandalismo en las últimas 24h', ru: 'Вандализма за последние 24ч нет' },
    pdf_vand_section: { pt: '🟡 Vandalismo', en: '🟡 Vandalism', es: '🟡 Vandalismo', ru: '🟡 Вандализм' },
    pdf_workshop: { pt: '🔧 Avaliação da oficina', en: '🔧 Workshop assessment', es: '🔧 Evaluación del taller', ru: '🔧 Оценка мастерской' },
    pdf_total_period: { pt: 'Total período', en: 'Total period', es: 'Total período', ru: 'Всего за период' },
    pdf_losses: { pt: 'Perdas BRPD', en: 'BRPD Losses', es: 'Pérdidas BRPD', ru: 'Потери BRPD' },
    pdf_branch: { pt: 'Filial', en: 'Branch', es: 'Filial', ru: 'Филиал' },
    pdf_region: { pt: 'Região', en: 'Region', es: 'Región', ru: 'Регион' },
    pdf_resp: { pt: 'Responsável', en: 'Responsible', es: 'Responsable', ru: 'Ответственный' },
    pdf_scooters: { pt: 'Patins', en: 'Scooters', es: 'Patines', ru: 'Самокаты' },
    pdf_bikes: { pt: 'Bikes', en: 'Bikes', es: 'Bikes', ru: 'Велосипеды' },
    pdf_total_col: { pt: 'Total', en: 'Total', es: 'Total', ru: 'Итого' },
    pdf_vandalism_ttl: { pt: 'Vand.', en: 'Vand.', es: 'Vand.', ru: 'Вандал.' },
    pdf_not_found: { pt: 'Não enc.', en: 'Not found', es: 'No encontr.', ru: 'Не найдено' },
    pdf_status_24h: { pt: 'Status 24h', en: 'Status 24h', es: 'Status 24h', ru: 'Статус 24ч' },
    pdf_status_7d: { pt: 'Status 7d', en: 'Status 7d', es: 'Status 7d', ru: 'Статус 7д' },
    pdf_appendix: { pt: 'Apêndice — Todas as ocorrências', en: 'Appendix — All incidents', es: 'Apéndice — Todos los incidentes', ru: 'Приложение — Все инциденты' },
    pdf_shift: { pt: 'Turno', en: 'Shift', es: 'Turno', ru: 'Смена' },
    pdf_address: { pt: 'Endereço', en: 'Address', es: 'Dirección', ru: 'Адрес' },
    pdf_description: { pt: 'Descrição', en: 'Description', es: 'Descripción', ru: 'Описание' },
    pdf_status_col: { pt: 'Status', en: 'Status', es: 'Estado', ru: 'Статус' },
    pdf_interactive: { pt: '📊 Evolução interativa — Roubos, Tentativas e Vandalismo', en: '📊 Interactive evolution — Robberies, Attempts and Vandalism', es: '📊 Evolución interactiva — Robos, Tentativas y Vandalismo', ru: '📊 Интерактивная динамика — Кражи, Попытки и Вандализм' },
    chart_day: { pt: 'Por Dia', en: 'By Day', es: 'Por Día', ru: 'По дням' },
    chart_week: { pt: 'Por Semana', en: 'By Week', es: 'Por Semana', ru: 'По неделям' },
    chart_month: { pt: 'Por Mês/Ano', en: 'By Month/Year', es: 'Por Mes/Año', ru: 'По месяцам' },
    pdf_kpis: { pt: 'KPIs do período', en: 'Period KPIs', es: 'KPIs del período', ru: 'KPI за период' },
    pdf_caption: { pt: 'Relatório Executivo', en: 'Executive Report', es: 'Informe Ejecutivo', ru: 'Исполнительный отчёт' },
};
function tr(lang, key) {
    return REPORT_TR[key]?.[lang] ?? REPORT_TR[key]?.['pt'] ?? key;
}
// Dados acumulados das planilhas (atualizar periodicamente)
// Dados base acumulados — colunas dinâmicas (vand/nao_enc/status) vêm do Firestore
const PERDAS_ACUM = {
    atualizadoEm: '06/06/2026',
    totalPatins: 406, totalBikes: 10, totalBRPD: 416,
    filiais: [
        { regiao: 'Norte', filial: 'Minas Gerais (BH)', resp: 'Emerson Simões', patins: 128, bikes: 0, brpd: 128 },
        { regiao: 'Centro', filial: 'SP Capital', resp: 'Eliel Alves', patins: 152, bikes: 0, brpd: 152 },
        { regiao: 'Norte', filial: 'E.S (VV/Serra/Guarapari)', resp: 'Jean Fraga', patins: 20, bikes: 4, brpd: 24 },
        { regiao: 'Norte', filial: 'Pernambuco (Recife)', resp: 'Geova Francisco', patins: 12, bikes: 0, brpd: 12 },
        { regiao: 'Sul', filial: 'SC (BC/Florip/Joinville)', resp: 'Gilberto Onofre', patins: 13, bikes: 2, brpd: 15 },
        { regiao: 'Sul', filial: 'R.G.Sul (Poa/Gramado/Tram)', resp: 'Ewerton Silveira', patins: 16, bikes: 0, brpd: 16 },
        { regiao: 'Norte', filial: 'R.G. Norte (Natal)', resp: 'Daniel Augusto da Silva', patins: 8, bikes: 0, brpd: 8 },
        { regiao: 'Norte', filial: 'Bahia (Salvador/Ilhéus)', resp: 'Jackson Imperial', patins: 5, bikes: 0, brpd: 5 },
        { regiao: 'Sul', filial: 'Distr. Fed. (Brasília)', resp: 'Matheus Henrique', patins: 7, bikes: 0, brpd: 7 },
        { regiao: 'Norte', filial: 'Sergipe (Aracajú)', resp: 'Gabriel Peres', patins: 1, bikes: 4, brpd: 5 },
        { regiao: 'Centro', filial: 'SP Litoral', resp: 'Jean Alves Ramos', patins: 23, bikes: 0, brpd: 23 },
        { regiao: 'Centro', filial: 'SP Estado', resp: 'Marcos Allan', patins: 15, bikes: 0, brpd: 15 },
        { regiao: 'Norte', filial: 'Ceará (Fortaleza)', resp: 'Abel Holando', patins: 2, bikes: 0, brpd: 2 },
        { regiao: 'Norte', filial: 'Pará (Belém)', resp: 'Willian', patins: 1, bikes: 0, brpd: 1 },
        { regiao: 'Sul', filial: 'Paraná (Crt/Londri/Guar)', resp: 'Valmir Ferreira Jr', patins: 3, bikes: 0, brpd: 3 },
        { regiao: 'Norte', filial: 'Alagoas (Maceió)', resp: 'Diego Alves', patins: 0, bikes: 0, brpd: 0 },
    ],
};
// Busca dados dinâmicos (vand 24h, não enc. 24h, status) do Firestore (guard_config/controle_perdas)
async function buscarDadosDinamicosFiliais() {
    try {
        const snap = await admin.firestore().collection('guard_config').doc('controle_perdas').get();
        if (!snap.exists)
            return {};
        const filiais = snap.data()?.filiais || [];
        const mapa = {};
        filiais.forEach(f => {
            if (f.filial)
                mapa[f.filial] = {
                    vand_patins: f.vand_patins || 0,
                    vand_bikes: f.vand_bikes || 0,
                    vand_total: f.vand_total || 0,
                    nao_enc_patins: f.nao_enc_patins || 0,
                    nao_enc_bikes: f.nao_enc_bikes || 0,
                    nao_enc_bat: f.nao_enc_bat || 0,
                    status1_24h: f.status1_24h || '',
                    status2_7d: f.status2_7d || '',
                };
        });
        return mapa;
    }
    catch {
        return {};
    }
}
// ── HELPERS ────────────────────────────────────────────────────────────────
function semanaISO(d) {
    const onejan = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}
function faixaSemana(d) {
    const dow = d.getDay();
    const inicio = new Date(d);
    inicio.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    const fmt = (x) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    return 'Semana ' + String(semanaISO(d)).padStart(2, '0') + '  ' + fmt(inicio) + ' - ' + fmt(fim);
}
function fmtDt(ts) {
    if (!ts)
        return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}
function sanitizarFoto(url) {
    if (!url)
        return null;
    if (url.includes('drive.google.com'))
        return null;
    if (url.includes('lh3.googleusercontent.com'))
        return null;
    return url;
}
function emojiTipo(t) {
    return t === 'Roubo' ? '🔴' : t === 'Tentativa' ? '🟠'
        : t === 'Vandalismo' ? '🟡' : t === 'Recuperacao' ? '🟢'
            : t === 'Perda' ? '🟣' : '⚪';
}
function barra(v, max, len = 8) {
    const f = max > 0 ? Math.round((v / max) * len) : 0;
    return '█'.repeat(f) + '░'.repeat(len - f);
}
// Converte cargo/role em sigla para relatório
function siglaResponsavel(cargo) {
    const c = (cargo || '').toLowerCase();
    if (c.includes('seg') || c.includes('guard'))
        return 'SEG';
    if (c.includes('mot') || c.includes('driver'))
        return 'MOT';
    if (c.includes('gest'))
        return 'GST';
    if (c.includes('camp'))
        return 'CAM';
    return cargo ? cargo.slice(0, 3).toUpperCase() : '---';
}
function pct(v, total) {
    return total > 0 ? Math.round((v / total) * 100) + '%' : '0%';
}
// ── BUSCAR OCORRÊNCIAS ─────────────────────────────────────────────────────
// ── GERAR RELATÓRIO (interface legada mantida) ─────────────────────────────
async function gerarRelatorioGuard(dataStr) {
    const db = admin.firestore();
    let dataRef;
    if (dataStr) {
        dataRef = new Date(dataStr + 'T00:00:00-03:00');
    }
    else {
        dataRef = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    }
    dataRef.setHours(0, 0, 0, 0);
    const dataFim = new Date(dataRef);
    dataFim.setHours(23, 59, 59, 999);
    const snap = await db.collection('ocorrencias')
        .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(dataRef))
        .where('criadoEm', '<=', admin.firestore.Timestamp.fromDate(dataFim))
        .orderBy('criadoEm', 'desc')
        .get();
    const docs = snap.docs.map(d => d.data());
    const porTipo = {};
    const porStatus = {};
    const porCidade = {};
    const porTurno = {};
    let altaPrioridade = 0;
    let comBO = 0;
    for (const o of docs) {
        porTipo[o.tipo] = (porTipo[o.tipo] || 0) + 1;
        porStatus[o.status] = (porStatus[o.status] || 0) + 1;
        porCidade[o.cidade_inicial || 'Sem info'] = (porCidade[o.cidade_inicial || 'Sem info'] || 0) + 1;
        porTurno[o.turno] = (porTurno[o.turno] || 0) + 1;
        if (o.prioridade === 'Alta' || o.prioridade === 'Critica')
            altaPrioridade++;
        if (o.bo_numero)
            comBO++;
    }
    return {
        data: dataRef.toISOString().slice(0, 10),
        semana: faixaSemana(dataRef),
        totalOcorrencias: docs.length,
        porTipo, porStatus, porCidade, porTurno,
        altaPrioridade, comBO,
        ocorrencias: docs,
    };
}
// ── FORMATAR MENSAGEM TELEGRAM ─────────────────────────────────────────────
// Labels de período com datas reais
function labelMes(dataRef) {
    const ini = new Date(dataRef.getFullYear(), dataRef.getMonth(), 1);
    const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    return `${fmt(ini)} a ${fmt(dataRef)}`;
}
function labelAcumulado(ocs) {
    if (!ocs.length)
        return 'Acumulado';
    const anos = ocs.map(o => {
        const d = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm);
        return d?.getFullYear?.() ?? 0;
    }).filter(Boolean);
    if (!anos.length)
        return 'Acumulado';
    const min = Math.min(...anos);
    const max = Math.max(...anos);
    return min === max ? String(min) : `${min}–${max}`;
}
function formatarMensagem(lang, r, ocs24h, ocs7d) {
    return buildMensagem(lang, r, ocs24h, ocs7d);
}
function buildMensagem(lang, r, ocs24h, ocs7d) {
    const locale = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', ru: 'ru-RU' }[lang] ?? 'pt-BR';
    const dataRef = new Date(r.data + 'T12:00:00');
    const dataFmt = dataRef.toLocaleDateString(locale, {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });
    const fmt2 = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    const ontemFmt = fmt2(new Date(dataRef.getTime() - 86400000));
    const mesFmt = labelMes(dataRef);
    const acumFmt = labelAcumulado(r.ocorrencias);
    const total = r.totalOcorrencias;
    const ocs = r.ocorrencias;
    const roubosTotal = ocs.filter(o => o.tipo === 'Roubo').length;
    const roubosAbertos = ocs.filter(o => o.tipo === 'Roubo' && !/recuper|encerr/i.test(o.status || '')).length;
    const roubosRecup = ocs.filter(o => o.tipo === 'Roubo' && /recuper/i.test(o.status || '')).length;
    const vandTotal = ocs.filter(o => o.tipo === 'Vandalismo').length;
    const vandAbertos = ocs.filter(o => o.tipo === 'Vandalismo' && !/recuper|encerr/i.test(o.status || '')).length;
    const vandRecup = ocs.filter(o => o.tipo === 'Vandalismo' && /recuper/i.test(o.status || '')).length;
    const abertos = (r.porStatus['Aberto'] || 0) + (r.porStatus['Em apuração'] || 0) + (r.porStatus['Em apuracao'] || 0);
    const crit = r.altaPrioridade;
    const procurand = ocs.filter(o => !!o.procurando && o.procurando !== 'false').length;
    const roubos24h = ocs24h.filter(o => o.tipo === 'Roubo').length;
    const vand24h = ocs24h.filter(o => o.tipo === 'Vandalismo').length;
    const roubos7d = ocs7d.filter(o => o.tipo === 'Roubo').length;
    const sep = '━━━━━━━━━━━━━━━━━━━━━━━━';
    let txt = '';
    txt += `🛡 *${tr(lang, 'title_daily')}*\n`;
    txt += `📅 *${dataFmt}*\n`;
    txt += `${r.semana}\n`;
    txt += `${sep}\n\n`;
    txt += `*${tr(lang, 'highlight')}*\n`;
    if (roubosAbertos > 0)
        txt += `• 🚨 ${tr(lang, 'robbery')}: *${roubosAbertos}*\n`;
    if (vandAbertos > 0)
        txt += `• 🟡 ${tr(lang, 'vandalism')}: *${vandAbertos}*\n`;
    if (procurand > 0)
        txt += `• ‼️ *${tr(lang, 'wanted')}: ${procurand}*\n`;
    if (roubosAbertos === 0 && vandAbertos === 0 && procurand === 0)
        txt += `• ✅ ${tr(lang, 'no_open')}\n`;
    txt += `\n`;
    txt += `*${tr(lang, 'summary')}*\n`;
    txt += `• ${tr(lang, 'total')}: *${total}*  |  ${tr(lang, 'open')}: *${abertos}*  |  ${tr(lang, 'critical')}: *${crit}*\n`;
    if (r.comBO)
        txt += `• ${tr(lang, 'with_bo')}: *${r.comBO}*\n`;
    txt += `\n`;
    if (Object.keys(r.porTipo).length) {
        txt += `*${tr(lang, 'by_type')}*\n`;
        const tiposOrd = Object.entries(r.porTipo).sort((a, b) => b[1] - a[1]);
        const maxT = tiposOrd[0]?.[1] || 1;
        tiposOrd.forEach(([t, n]) => {
            const ab = ocs.filter(o => o.tipo === t && !/recuper|encerr/i.test(o.status || '')).length;
            const rc = ocs.filter(o => o.tipo === t && /recuper/i.test(o.status || '')).length;
            txt += `${emojiTipo(t)} ${t}: *${n}* total — \`${barra(n, maxT, 6)}\`\n`;
            txt += `  ${tr(lang, 'open_lbl')}: *${ab}* | ${tr(lang, 'recov_lbl')}: *${rc}*\n`;
        });
        txt += `\n`;
    }
    const porCidadeOrd = Object.entries(r.porCidade).sort((a, b) => b[1] - a[1]);
    const maxCid = porCidadeOrd[0]?.[1] || 1;
    if (porCidadeOrd.length) {
        txt += `*${tr(lang, 'by_city')}*\n`;
        porCidadeOrd.slice(0, 6).forEach(([cidade, n]) => {
            const oc2 = ocs.filter(o => o.cidade_inicial === cidade);
            const ab = oc2.filter(o => !/recuper|encerr/i.test(o.status || '')).length;
            const rc = oc2.filter(o => /recuper/i.test(o.status || '')).length;
            txt += `*${cidade}*: ${n}  \`${barra(n, maxCid, 6)}\`  🔓${ab} ${tr(lang, 'open_lbl2')}  ✅${rc} ${tr(lang, 'recov_lbl')}\n`;
        });
        txt += `\n`;
    }
    txt += `${sep}\n`;
    txt += `*${tr(lang, 'technical')}*\n`;
    txt += `🔴 ${tr(lang, 'rob_open')}: *${roubosAbertos}* | ${tr(lang, 'recovered')}: *${roubosRecup}* | ${tr(lang, 'total')}: *${roubosTotal}*\n`;
    txt += `🟡 ${tr(lang, 'vand_open')}: *${vandAbertos}* | ${tr(lang, 'recovered')}: *${vandRecup}* | ${tr(lang, 'total')}: *${vandTotal}*\n`;
    txt += `📅 ${tr(lang, 'yesterday')} (${ontemFmt}): *${roubos24h}* ${tr(lang, 'robberies')} | *${vand24h}* ${tr(lang, 'vandalisms')}\n`;
    txt += `📅 ${tr(lang, 'last7d')}: *${roubos7d}* ${tr(lang, 'robberies')}\n`;
    txt += `📅 (${mesFmt}): acum. abaixo\n`;
    txt += `📉 ${tr(lang, 'brpd')} ${acumFmt}: *${PERDAS_ACUM.totalBRPD}* (🛴${PERDAS_ACUM.totalPatins} 🚲${PERDAS_ACUM.totalBikes})\n`;
    txt += `\n`;
    const top3 = PERDAS_ACUM.filiais.sort((a, b) => b.brpd - a.brpd).slice(0, 3);
    txt += `*${tr(lang, 'top_branches')}:* `;
    txt += top3.map((f, i) => `${i + 1}.${f.filial.split('(')[0].trim()}: *${f.brpd}*`).join(' · ') + `\n`;
    txt += `\n`;
    const guardsCont = {};
    ocs.forEach(o => {
        const nome = o.registradoPorNome || '?';
        if (!guardsCont[nome])
            guardsCont[nome] = { n: 0, cargo: o.cargo || o.role || '' };
        guardsCont[nome].n++;
    });
    const guards = Object.entries(guardsCont).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
    if (guards.length) {
        txt += `*${tr(lang, 'responsible')}*\n`;
        guards.forEach(([nome, { n, cargo }]) => {
            txt += `• ${nome} [${siglaResponsavel(cargo)}]: *${n}* ${tr(lang, 'open_since')}\n`;
        });
        txt += `\n`;
    }
    const alertas = [];
    if (procurand > 0)
        alertas.push(`‼️ *${procurand} ${tr(lang, 'alert_wanted')}*`);
    if (crit > 0)
        alertas.push(`🚨 ${crit} ${tr(lang, 'alert_critical')}`);
    if (roubosAbertos > 0)
        alertas.push(`🔴 ${roubosAbertos} ${tr(lang, 'alert_rob_open')}`);
    if (roubos24h >= 3)
        alertas.push(`🔺 ${tr(lang, 'alert_multiple')}: ${roubos24h}`);
    if (total > 0 && porCidadeOrd[0]?.[1] / total > 0.5)
        alertas.push(`📍 ${tr(lang, 'alert_concentrated')} ${porCidadeOrd[0][0]}`);
    if (alertas.length) {
        txt += `${sep}\n`;
        txt += `*${tr(lang, 'alerts')}*\n`;
        alertas.forEach(a => { txt += `• ${a}\n`; });
        txt += `\n`;
    }
    txt += `${sep}\n`;
    txt += `${tr(lang, 'pdf_footer')}`;
    return txt;
}
async function gerarPdfHtml(r, ocs24h, ocs7d, ocsMes, ocsAcum, lang = 'pt') {
    const tipoLabels = {
        Roubo: { pt: 'Roubo', en: 'Robbery', es: 'Robo', ru: 'Кража' },
        Vandalismo: { pt: 'Vandalismo', en: 'Vandalism', es: 'Vandalismo', ru: 'Вандализм' },
        Tentativa: { pt: 'Tentativa', en: 'Attempt', es: 'Tentativa', ru: 'Попытка' },
        Recuperação: { pt: 'Recuperação', en: 'Recovery', es: 'Recuperación', ru: 'Возврат' },
        Perda: { pt: 'Perda', en: 'Loss', es: 'Pérdida', ru: 'Потеря' },
        Outro: { pt: 'Outro', en: 'Other', es: 'Otro', ru: 'Другое' },
    };
    const tTipo = (tipo) => tipoLabels[tipo]?.[lang] ?? tipo;
    const dadosDinamicos = await buscarDadosDinamicosFiliais();
    const dataFmt = new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });
    const geradoEm = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
    });
    const total = r.totalOcorrencias;
    const abertos = (r.porStatus['Aberto'] || 0) + (r.porStatus['Em apuração'] || 0) + (r.porStatus['Em apuracao'] || 0);
    const apurac = r.porStatus['Em apuração'] || r.porStatus['Em apuracao'] || 0;
    const recup = r.porStatus['Recuperado'] || 0;
    const encerr = r.porStatus['Encerrado'] || 0;
    const crit = r.altaPrioridade;
    const taxa = total > 0 ? Math.round(((recup + encerr) / total) * 100) : 0;
    const procurand = r.ocorrencias.filter(o => !!o.procurando).length;
    const fora = r.ocorrencias.filter(o => !o.lat_inicial).length;
    // Roubos 24h e 7d
    const roubos24h = ocs24h.filter(o => o.tipo === 'Roubo');
    const tent24h = ocs24h.filter(o => o.tipo === 'Tentativa');
    const vand24h = ocs24h.filter(o => o.tipo === 'Vandalismo');
    const roubos7d = ocs7d.filter(o => o.tipo === 'Roubo');
    const tent7d = ocs7d.filter(o => o.tipo === 'Tentativa');
    // Alias conveniente para as ocorrências do período
    const ocorrs = r.ocorrencias;
    // Danos vandalismo
    const vandComDano = ocorrs.filter(o => o.tipo === 'Vandalismo' && o.danoValor > 0).length;
    const danoValorTotal = ocorrs.filter(o => o.tipo === 'Vandalismo')
        .reduce((s, o) => s + (o.danoValor || 0), 0);
    const danoPctMedio = (() => {
        const com = ocorrs.filter(o => o.tipo === 'Vandalismo' && o.danoPct > 0);
        return com.length > 0
            ? Math.round(com.reduce((s, o) => s + (o.danoPct || 0), 0) / com.length) : 0;
    })();
    // Etiqueta período real
    const fmt2 = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dataRefObj = new Date(r.data + 'T12:00:00');
    const ontemLabel = fmt2(new Date(dataRefObj.getTime() - 86400000));
    const mesLabel = labelMes(dataRefObj);
    const acumLabel = labelAcumulado(ocsAcum.length ? ocsAcum : ocorrs);
    // Quantidades para Mês e Acumulado (usa queries passadas como parâmetro)
    const roubosMes = ocsMes.filter(o => o.tipo === 'Roubo').length;
    const tentMes = ocsMes.filter(o => o.tipo === 'Tentativa').length;
    const roubosAcum = ocsAcum.filter(o => o.tipo === 'Roubo').length;
    const vandMes = ocsMes.filter(o => o.tipo === 'Vandalismo').length;
    const vandAcumAll = ocsAcum.filter(o => o.tipo === 'Vandalismo').length;
    // Roubo/Vandalismo aberto vs recuperado (usados no destaque PT e na página RU)
    const roubos = ocorrs.filter(o => o.tipo === 'Roubo').length;
    const roubosAb = ocorrs.filter(o => o.tipo === 'Roubo' && !/recuper|encerr/i.test(o.status || '')).length;
    // roubosRec removed — not used in PDF template (RU KPIs simplified)
    const vand = ocorrs.filter(o => o.tipo === 'Vandalismo').length;
    const vandAb = ocorrs.filter(o => o.tipo === 'Vandalismo' && !/recuper|encerr/i.test(o.status || '')).length;
    // Por cidade detalhado
    const porCidadeMap = {};
    r.ocorrencias.forEach(o => {
        const c = o.cidade_inicial || 'Desconhecida';
        if (!porCidadeMap[c])
            porCidadeMap[c] = { total: 0, roubos: 0, vand: 0, tent: 0, recup: 0, abertos: 0, crit: 0, fora: 0, ocorrs: [] };
        const v = porCidadeMap[c];
        v.total++;
        v.ocorrs.push(o);
        if (o.tipo === 'Roubo')
            v.roubos++;
        if (o.tipo === 'Tentativa')
            v.tent++;
        if (o.tipo === 'Vandalismo')
            v.vand++;
        if (/recuper/i.test(o.status || ''))
            v.recup++;
        if (o.status === 'Aberto')
            v.abertos++;
        if (o.prioridade === 'Alta' || o.prioridade === 'Critica')
            v.crit++;
        if (!o.lat_inicial)
            v.fora++;
    });
    const cidadesOrd = Object.entries(porCidadeMap).sort((a, b) => b[1].total - a[1].total);
    // SVG gráfico de tipos (barras horizontais)
    const tiposData = Object.entries(r.porTipo).sort((a, b) => b[1] - a[1]);
    const maxTipo = tiposData[0]?.[1] || 1;
    const TIPO_CORES = {
        'Roubo': '#c0392b', 'Tentativa': '#e67e22', 'Vandalismo': '#f39c12',
        'Recuperacao': '#27ae60', 'Outro': '#7f8c8d'
    };
    let svgTipos = '';
    if (tiposData.length) {
        const H = 24 * tiposData.length + 24;
        svgTipos = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="${H}" style="font-family:Arial,sans-serif">`;
        svgTipos += `<rect width="320" height="${H}" fill="#f8f9fa" rx="6"/>`;
        tiposData.forEach(([tipo, n], i) => {
            const y = 12 + i * 24;
            const barW = Math.max(4, Math.round((n / maxTipo) * 200));
            const cor = TIPO_CORES[tipo] || '#7f8c8d';
            svgTipos += `<text x="8" y="${y + 10}" fill="#333" font-size="10">${tipo}</text>`;
            svgTipos += `<rect x="90" y="${y}" width="${barW}" height="16" fill="${cor}" rx="3" opacity="0.85"/>`;
            svgTipos += `<text x="${93 + barW}" y="${y + 11}" fill="${cor}" font-size="10" font-weight="bold">${n}</text>`;
        });
        svgTipos += `</svg>`;
    }
    // SVG gráfico status (pizza simples)
    const statusData = Object.entries(r.porStatus).filter(([, v]) => v > 0);
    const STATUS_CORES = {
        'Aberto': '#e74c3c', 'Em apuração': '#e67e22', 'Em apuracao': '#e67e22',
        'Recuperado': '#27ae60', 'Encerrado': '#7f8c8d'
    };
    let svgStatus = '';
    if (statusData.length && total > 0) {
        const W2 = 220;
        const H2 = 120;
        const cx = 60;
        const cy = 55;
        const r2 = 45;
        svgStatus = `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}" style="font-family:Arial,sans-serif">`;
        svgStatus += `<rect width="${W2}" height="${H2}" fill="#f8f9fa" rx="6"/>`;
        let ang = -Math.PI / 2;
        statusData.forEach(([s, n]) => {
            const a2 = (n / total) * 2 * Math.PI;
            const x1 = cx + r2 * Math.cos(ang);
            const y1 = cy + r2 * Math.sin(ang);
            const x2 = cx + r2 * Math.cos(ang + a2);
            const y2 = cy + r2 * Math.sin(ang + a2);
            const large = a2 > Math.PI ? 1 : 0;
            const cor2 = STATUS_CORES[s] || '#95a5a6';
            svgStatus += `<path d="M${cx},${cy} L${x1},${y1} A${r2},${r2} 0 ${large} 1 ${x2},${y2} Z" fill="${cor2}" opacity="0.88"/>`;
            ang += a2;
        });
        statusData.forEach(([s, n], i) => {
            const cor2 = STATUS_CORES[s] || '#95a5a6';
            svgStatus += `<rect x="115" y="${8 + i * 20}" width="10" height="10" fill="${cor2}" rx="2"/>`;
            svgStatus += `<text x="128" y="${18 + i * 20}" fill="#333" font-size="9">${s}: ${n} (${pct(n, total)})</text>`;
        });
        svgStatus += `</svg>`;
    }
    // SVG cidades (barras)
    let svgCidades = '';
    if (cidadesOrd.length) {
        const top = cidadesOrd.slice(0, 8);
        const maxC = top[0][1].total;
        const H3 = 20 * top.length + 24;
        svgCidades = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${H3}" style="font-family:Arial,sans-serif">`;
        svgCidades += `<rect width="480" height="${H3}" fill="#f8f9fa" rx="6"/>`;
        top.forEach(([c, v], i) => {
            const y = 10 + i * 20;
            const bw = Math.max(4, Math.round((v.total / maxC) * 300));
            const cor3 = v.roubos > 0 ? '#c0392b' : v.vand > 0 ? '#f39c12' : '#2980b9';
            svgCidades += `<text x="6" y="${y + 12}" fill="#333" font-size="9" font-weight="600">${c.slice(0, 16)}</text>`;
            svgCidades += `<rect x="130" y="${y + 2}" width="${bw}" height="12" fill="${cor3}" rx="2" opacity="0.8"/>`;
            svgCidades += `<text x="${135 + bw}" y="${y + 12}" fill="${cor3}" font-size="9" font-weight="bold">${v.total}</text>`;
        });
        svgCidades += `</svg>`;
    }
    // Alertas
    const alertas = [];
    if (procurand > 0)
        alertas.push(`<b>‼️ ${procurand} ativo(s) PROCURADO(S)</b> — requer ação imediata!`);
    if (crit > 0)
        alertas.push(`🚨 ${crit} ocorrência(s) crítica(s) no período`);
    if (abertos + apurac > 0)
        alertas.push(`⏳ ${abertos + apurac} pendente(s) de resolução`);
    if (roubos24h.length >= 3)
        alertas.push(`🔺 Múltiplos roubos nas últimas 24h: ${roubos24h.length}`);
    if (total > 0 && fora / total > 0.25)
        alertas.push(`📍 ${pct(fora, total)} das ocorrências fora de zona cadastrada`);
    if (cidadesOrd[0]?.[1].total / total > 0.5)
        alertas.push(`📌 Concentração: +50% em ${cidadesOrd[0][0]}`);
    // Tabela por cidade
    // Tabela roubos 24h detalhada
    const roubosRows24h = [...roubos24h, ...tent24h].sort((a, b) => {
        const da = a.criadoEm?.toDate?.()?.getTime() || 0;
        const db2 = b.criadoEm?.toDate?.()?.getTime() || 0;
        return db2 - da;
    }).map(o => {
        const proc = o.procurando ? `<span style="background:#9b59b6;color:#fff;padding:1px 5px;border-radius:10px;font-size:8px">‼️ PROC.</span>` : '';
        const f1 = sanitizarFoto(o.foto1_url);
        const f2 = sanitizarFoto(o.foto2_url);
        const fotosHtml = [f1, f2].filter(Boolean).map((url, i) => `<div style="display:inline-block;margin:2px;position:relative">` +
            `<img src="${url}" alt="foto${i + 1}" onclick="abrirFoto('${url}')" ` +
            `style="width:52px;height:40px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer;vertical-align:middle" ` +
            `onerror="this.parentElement.style.display='none'"/>` +
            `</div>`).join('');
        const btnFotos = (f1 || f2) ? `<div style="margin-top:3px">${fotosHtml}</div>` : '';
        return `<tr><td>${fmtDt(o.criadoEm)}</td>
      <td><span style="background:${TIPO_CORES[o.tipo] || '#7f8c8d'}20;color:${TIPO_CORES[o.tipo] || '#7f8c8d'};padding:2px 6px;border-radius:10px;font-weight:700;font-size:9px">${tTipo(o.tipo)}</span>${proc}</td>
      <td>${o.asset_id || o.ativo_tipo || '—'}</td>
      <td>${o.cidade_inicial || '—'}</td>
      <td>${o.registradoPorNome || '—'}</td>
      <td>${o.bo_numero || '—'}</td>
      <td>${o.descricao?.slice(0, 80) || '—'}${btnFotos}</td></tr>`;
    }).join('');
    const vandRows24h = vand24h.sort((a, b) => {
        const da = a.criadoEm?.toDate?.()?.getTime() || 0;
        const db2 = b.criadoEm?.toDate?.()?.getTime() || 0;
        return db2 - da;
    }).map(o => {
        const f1 = sanitizarFoto(o.foto1_url);
        const f2 = sanitizarFoto(o.foto2_url);
        const fotosHtml = [f1, f2].filter(Boolean).map((url, i) => `<div style="display:inline-block;margin:2px">` +
            `<img src="${url}" alt="foto${i + 1}" onclick="abrirFoto('${url}')" ` +
            `style="width:52px;height:40px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer;vertical-align:middle" ` +
            `onerror="this.parentElement.style.display='none'"/>` +
            `</div>`).join('');
        const btnFotos = (f1 || f2) ? `<div style="margin-top:3px">${fotosHtml}</div>` : '';
        return `<tr><td>${fmtDt(o.criadoEm)}</td>
      <td><span style="background:#b7950b20;color:#b7950b;padding:2px 6px;border-radius:10px;font-weight:700;font-size:9px">${tTipo(o.tipo)}</span></td>
      <td>${o.asset_id || o.ativo_tipo || '—'}</td>
      <td>${o.cidade_inicial || '—'}</td>
      <td>${o.registradoPorNome || '—'}</td>
      <td>${o.bo_numero || '—'}</td>
      <td>${o.danoValor > 0 ? `R$${o.danoValor}` : o.danoPct > 0 ? `${o.danoPct}%` : '—'}${btnFotos}</td></tr>`;
    }).join('');
    // Dados para gráfico interativo (últimos 365 dias)
    const chartData = (() => {
        const now = new Date();
        // Por dia — últimos 30 dias
        const dayLabels = [];
        const dayR = [];
        const dayT = [];
        const dayV = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            const next = new Date(d);
            next.setDate(next.getDate() + 1);
            dayLabels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
            dayR.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Roubo' && t >= d && t < next; }).length);
            dayT.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Tentativa' && t >= d && t < next; }).length);
            dayV.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Vandalismo' && t >= d && t < next; }).length);
        }
        // Por semana — últimas 12 semanas
        const wkLabels = [];
        const wkR = [];
        const wkT = [];
        const wkV = [];
        for (let i = 11; i >= 0; i--) {
            const ini = new Date(now.getTime() - (i + 1) * 7 * 86400000);
            const fim = new Date(now.getTime() - i * 7 * 86400000);
            wkLabels.push(ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
            wkR.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Roubo' && t >= ini && t < fim; }).length);
            wkT.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Tentativa' && t >= ini && t < fim; }).length);
            wkV.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Vandalismo' && t >= ini && t < fim; }).length);
        }
        // Por mês — 12 meses do ano atual
        const moLabels = [];
        const moR = [];
        const moT = [];
        const moV = [];
        const yr = now.getFullYear();
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        for (let m = 0; m < 12; m++) {
            const ini = new Date(yr, m, 1);
            const fim = new Date(yr, m + 1, 1);
            moLabels.push(meses[m]);
            moR.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Roubo' && t >= ini && t < fim; }).length);
            moT.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Tentativa' && t >= ini && t < fim; }).length);
            moV.push(ocsAcum.filter(o => { const t = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm); return o.tipo === 'Vandalismo' && t >= ini && t < fim; }).length);
        }
        return { dayLabels, dayR, dayT, dayV, wkLabels, wkR, wkT, wkV, moLabels, moR, moT, moV };
    })();
    const chartJson = JSON.stringify(chartData);
    const trJson = JSON.stringify(REPORT_TR).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    // Tabela perdas acumuladas com colunas dinâmicas (vand 24h, não enc, status)
    const filiaisOrdenadas = [...PERDAS_ACUM.filiais].sort((a, b) => b.brpd - a.brpd);
    const perdasRows = filiaisOrdenadas
        .filter(f => f.brpd > 0)
        .map((f, i) => {
        const d = dadosDinamicos[f.filial] || {};
        const pctTotal = pct(f.brpd, PERDAS_ACUM.totalBRPD);
        const barW = Math.max(4, Math.round((f.brpd / (filiaisOrdenadas[0].brpd || 1)) * 100));
        const corBar = f.brpd > 100 ? '#c0392b' : f.brpd > 20 ? '#e67e22' : '#2980b9';
        // Vandalismo 24h
        const vp = d.vand_patins || 0;
        const vb = d.vand_bikes || 0;
        const vt = d.vand_total || (vp + vb);
        // Não encontrado 24h
        const np = d.nao_enc_patins || 0;
        const nb = d.nao_enc_bikes || 0;
        const nbat = d.nao_enc_bat || 0;
        // Status
        const s1 = d.status1_24h || '—';
        const s2 = d.status2_7d || '—';
        const nCell = (v, cor = '#333') => v > 0
            ? `<td class="n" style="font-weight:700;color:${cor}">${v}</td>`
            : `<td class="n" style="color:#ccc">—</td>`;
        return `<tr>
        <td class="n" style="color:#999;font-size:9px">${i + 1}</td>
        <td style="color:#6c757d;font-size:8px">${f.regiao}</td>
        <td><b style="font-size:10px">${f.filial}</b><br><span style="font-size:8px;color:#999">${f.resp}</span></td>
        <td class="n">${f.patins || 0}</td>
        <td class="n">${f.bikes || 0}</td>
        <td class="n" style="font-weight:800;color:#c0392b;font-size:12px">${f.brpd}</td>
        <td style="padding:4px 8px"><svg width="110" height="14" style="vertical-align:middle">
          <rect width="${barW}" height="12" fill="${corBar}" rx="3" opacity="0.8" y="1"/>
          <text x="${barW + 3}" y="11" fill="#666" font-size="9">${pctTotal}</text>
        </svg></td>
        ${nCell(vp, '#e67e22')}${nCell(vb, '#e67e22')}
        <td class="n" style="font-weight:700;color:${vt > 0 ? '#c0392b' : '#ccc'};border-right:2px solid #ddd">${vt > 0 ? vt : '—'}</td>
        ${nCell(np, '#9b59b6')}${nCell(nb, '#9b59b6')}${nCell(nbat, '#9b59b6')}
        <td style="font-size:9px;color:#2980b9;max-width:120px;word-break:break-word;border-left:2px solid #ddd">${s1}</td>
        <td style="font-size:9px;color:#e67e22;max-width:120px;word-break:break-word">${s2}</td>
      </tr>`;
    }).join('');
    // Apêndice detalhado por cidade
    let apendice = '';
    cidadesOrd.forEach(([cidade, v]) => {
        apendice += `<div class="cidade-header">
      <span>${cidade}</span>
      <span style="opacity:.7;font-size:10px">${v.total} ocorr. | ${v.roubos} roubos | ${v.recup} recup.</span>
    </div>`;
        v.ocorrs.sort((a, b) => {
            const order = { 'Aberto': 0, 'Em apuração': 1, 'Em apuracao': 1, 'Recuperado': 2, 'Encerrado': 3 };
            return (order[a.status] || 4) - (order[b.status] || 4);
        }).forEach((o) => {
            const isCrit = o.prioridade === 'Alta' || o.prioridade === 'Critica';
            const isProc = !!o.procurando;
            const statusCor = /recuper/i.test(o.status) ? '#27ae60' : o.status === 'Aberto' ? '#c0392b' : '#e67e22';
            const tipoCor = TIPO_CORES[o.tipo] || '#7f8c8d';
            const f1 = sanitizarFoto(o.foto1_url);
            const f2 = sanitizarFoto(o.foto2_url);
            apendice += `<div class="ocorr${isCrit ? ' ocorr-crit' : ''}${isProc ? ' ocorr-proc' : ''}">`;
            apendice += `<div class="ocorr-top">`;
            apendice += `<span class="ocorr-id">${o.id || ''}</span>`;
            apendice += `<span style="background:${tipoCor}20;color:${tipoCor};padding:2px 8px;border-radius:12px;font-size:9px;font-weight:700">${o.tipo || ''}</span>`;
            apendice += `<span style="background:${statusCor}20;color:${statusCor};padding:2px 8px;border-radius:12px;font-size:9px;font-weight:700">${o.status || ''}</span>`;
            if (isCrit)
                apendice += `<span style="background:#c0392b;color:#fff;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:700">CRÍTICO</span>`;
            if (isProc)
                apendice += `<span style="background:#9b59b6;color:#fff;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:700">‼️ PROCURADO</span>`;
            apendice += `<span style="margin-left:auto;color:#999;font-size:9px">${fmtDt(o.criadoEm)}</span>`;
            apendice += `</div>`;
            const sigla = siglaResponsavel(o.cargo || o.role || '');
            const infos = [];
            if (o.ativo_tipo || o.asset_id)
                infos.push(`Ativo: <b>${[o.ativo_tipo, o.asset_id].filter(Boolean).join(' ')}</b>`);
            if (o.registradoPorNome)
                infos.push(`Guard: <b>${o.registradoPorNome}</b> <span style="background:#1a1a2e;color:#fff;padding:1px 5px;border-radius:4px;font-size:8px;font-weight:700">${sigla}</span>`);
            if (o.turno)
                infos.push(`Turno: ${o.turno}`);
            if (o.prioridade)
                infos.push(`Prioridade: <b style="color:${isCrit ? '#c0392b' : 'inherit'}">${o.prioridade}</b>`);
            if (o.bo_numero)
                infos.push(`BO: <b>${o.bo_numero}</b>`);
            if (infos.length)
                apendice += `<div class="ocorr-info">${infos.join('  ·  ')}</div>`;
            if (o.bairro_inicial || o.endereco_inicial) {
                apendice += `<div class="ocorr-local">📍 ${[o.bairro_inicial, o.endereco_inicial].filter(Boolean).join(' — ')}</div>`;
            }
            if (o.descricao) {
                apendice += `<div class="ocorr-desc">"${o.descricao}"</div>`;
            }
            if (isProc && typeof o.procurando === 'string') {
                apendice += `<div class="ocorr-procinfo">🔍 Procurando: ${o.procurando}</div>`;
            }
            if (f1 || f2) {
                apendice += `<div class="fotos">`;
                [f1, f2].filter(Boolean).forEach((url, i) => {
                    apendice +=
                        `<div class="foto-thumb">` +
                            `<img src="${url}" alt="foto${i + 1}" onclick="abrirFoto('${url}')" onerror="this.parentElement.style.display='none'"/>` +
                            `<button class="btn-foto" onclick="abrirFoto('${url}')">🔍 Ampliar</button>` +
                            `</div>`;
                });
                apendice += `</div>`;
            }
            apendice += `</div>`;
        });
    });
    const css = `
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:'Segoe UI',Arial,sans-serif; font-size:11px; color:#1a1a2e; background:#0d121e; }
.page { max-width:900px; margin:0 auto; background:#fff; }
.lang-bar { background:#7c3aed; padding:10px 20px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* Header */
.header { background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%); color:#fff; padding:28px 32px; }
.hlogo  { font-size:9px; color:rgba(255,255,255,.4); letter-spacing:3px; text-transform:uppercase; margin-bottom:8px; }
.htitle { font-size:24px; font-weight:900; letter-spacing:-0.5px; margin-bottom:4px; }
.hsub   { font-size:13px; color:rgba(255,255,255,.7); }
.hdate  { font-size:9px; color:rgba(255,255,255,.35); margin-top:10px; }
.hsemana{ font-size:10px; color:rgba(255,255,255,.45); margin-top:3px; }

/* KPIs */
.kpis { display:flex; gap:10px; padding:20px 32px; flex-wrap:wrap; background:#fff; border-bottom:1px solid #e9ecef; }
.kpi  { flex:1; min-width:75px; background:#f8f9fa; border-radius:10px; padding:12px 10px; text-align:center; border-top:3px solid #dee2e6; }
.kpi.k-total  { border-top-color:#1a1a2e; }
.kpi.k-aberto { border-top-color:#c0392b; }
.kpi.k-apuracao{border-top-color:#e67e22; }
.kpi.k-recup  { border-top-color:#27ae60; }
.kpi.k-encerr { border-top-color:#7f8c8d; }
.kpi.k-crit   { border-top-color:#e74c3c; }
.kpi.k-taxa   { border-top-color:#2980b9; }
.kpi.k-proc   { border-top-color:#9b59b6; }
.kv { font-size:30px; font-weight:900; color:#1a1a2e; line-height:1; }
.kl { font-size:8px; color:#6c757d; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }

/* Alertas */
.alertas { margin:16px 32px 0; background:#fffbf0; border:1px solid #f0ad4e;
  border-left:4px solid #e67e22; border-radius:8px; padding:12px 16px; }
.alertas-t { font-size:11px; font-weight:700; color:#d35400; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; }
.alertas li { font-size:10.5px; color:#5d4037; padding:2px 0; list-style:none; }

/* Seções */
.section { padding:20px 32px; }
.sec-title { font-size:11px; font-weight:800; color:#1a1a2e; text-transform:uppercase;
  letter-spacing:1px; padding-bottom:8px; border-bottom:2px solid #1a1a2e; margin-bottom:14px;
  display:flex; align-items:center; gap:6px; }

/* Gráficos */
.charts { display:flex; gap:16px; flex-wrap:wrap; margin:0 32px 16px; }
.charts svg { border-radius:8px; box-shadow:0 1px 6px rgba(0,0,0,.08); }
.chart-full { margin:0 32px 16px; }
.chart-full svg { border-radius:8px; box-shadow:0 1px 6px rgba(0,0,0,.08); }

/* Tabelas */
table { width:100%; border-collapse:collapse; font-size:10px; }
th { background:#1a1a2e; color:#fff; padding:8px 10px; text-align:left; font-size:9px;
  text-transform:uppercase; letter-spacing:.5px; }
th.n, td.n { text-align:center; }
td { padding:7px 10px; border-bottom:1px solid #f0f0f0; vertical-align:middle; }
tr:nth-child(even) td { background:#f8f9fa; }
tr:hover td { background:#f0f4ff; }

/* Seção Roubos highlight */
.roubos-box { background:#fdf2f2; border:1px solid #f5c6c6; border-left:4px solid #c0392b;
  border-radius:8px; padding:14px 16px; margin:0 32px 16px; }
.roubos-kpis { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
.rkpi { background:#fff; border:1px solid #f5c6c6; border-radius:8px; padding:10px 14px; flex:1; text-align:center; }
.rkv  { font-size:24px; font-weight:900; color:#c0392b; }
.rkl  { font-size:8px; color:#999; text-transform:uppercase; letter-spacing:.5px; margin-top:3px; }

/* Seção Perdas */
.perdas-box { background:#fafbff; border:1px solid #d4e1f7; border-left:4px solid #2980b9;
  border-radius:8px; padding:14px 16px; margin:0 32px 16px; }
.perdas-total { display:flex; gap:12px; margin-bottom:12px; }
.ptotal { background:#fff; border:1px solid #d4e1f7; border-radius:8px; padding:10px 14px; flex:1; text-align:center; }
.ptv { font-size:22px; font-weight:900; color:#1a1a2e; }
.ptl { font-size:8px; color:#999; text-transform:uppercase; letter-spacing:.5px; margin-top:3px; }

/* Ocorrências apêndice */
.cidade-header { background:#1a1a2e; color:#fff; font-weight:700; font-size:11px;
  padding:9px 14px; margin:0 32px 6px; border-radius:6px 6px 0 0;
  display:flex; justify-content:space-between; align-items:center; }
.ocorr { background:#fff; border:1px solid #e9ecef; margin:0 32px 10px;
  border-radius:0 0 6px 6px; padding:12px 14px; page-break-inside:avoid; }
.ocorr-crit { border-left:4px solid #c0392b; }
.ocorr-proc { border-left:4px solid #9b59b6; }
.ocorr-top  { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
.ocorr-id   { font-family:monospace; font-size:9px; color:#999; }
.ocorr-info { font-size:10px; color:#495057; margin-bottom:4px; }
.ocorr-local{ font-size:10px; color:#2980b9; margin-bottom:4px; }
.ocorr-desc { font-size:10px; color:#6c757d; font-style:italic; background:#f8f9fa;
  border-radius:4px; padding:6px 8px; margin-top:4px; line-height:1.55; }
.ocorr-procinfo { font-size:10px; color:#7d3c98; background:#f4ecf7; font-weight:600;
  border-radius:4px; padding:6px 8px; margin-top:4px; }
.fotos { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:flex-start; }
.foto-thumb { display:flex; flex-direction:column; align-items:center; gap:3px; }
.foto-thumb img { width:90px; height:68px; object-fit:cover; border-radius:6px;
  border:1px solid #dee2e6; cursor:pointer; transition:transform .15s;
  box-shadow:0 1px 4px rgba(0,0,0,.15); }
.foto-thumb img:hover { transform:scale(1.05); box-shadow:0 3px 10px rgba(0,0,0,.25); }
.btn-foto { font-size:8px; padding:2px 7px; border-radius:10px; border:1px solid #2980b9;
  background:#f0f7ff; color:#2980b9; cursor:pointer; white-space:nowrap; font-weight:600; }
.btn-foto:hover { background:#2980b9; color:#fff; }

/* Lightbox */
#lightbox { display:none; position:fixed; inset:0; background:rgba(0,0,0,.92);
  z-index:9999; align-items:center; justify-content:center; cursor:zoom-out; }
#lightbox.ativo { display:flex; }
#lightbox img { max-width:92vw; max-height:88vh; border-radius:8px;
  box-shadow:0 8px 40px rgba(0,0,0,.6); object-fit:contain; cursor:default; }
#lightbox-close { position:fixed; top:16px; right:20px; color:#fff; font-size:32px;
  cursor:pointer; background:rgba(0,0,0,.4); border-radius:50%; width:40px; height:40px;
  display:flex; align-items:center; justify-content:center; border:none;
  font-weight:300; z-index:10000; }
#lightbox-close:hover { background:rgba(255,255,255,.2); }
#lightbox-caption { position:fixed; bottom:16px; left:50%; transform:translateX(-50%);
  color:rgba(255,255,255,.7); font-size:11px; background:rgba(0,0,0,.5);
  padding:6px 14px; border-radius:20px; pointer-events:none; }

/* Footer */
.footer { background:#1a1a2e; color:rgba(255,255,255,.4); font-size:9px;
  padding:16px 32px; text-align:center; margin-top:24px; }

@media print { body { background:#fff; } .page { max-width:100%; } .ocorr { page-break-inside:avoid; } }
`;
    return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8">
<title>JET Guard • ${tr(lang, 'pdf_exec_report')} • ${r.data}</title>
<script>
const __TR = ${trJson};
let __lang = '${lang}';
function applyLang(l) {
  __lang = l;
  document.querySelectorAll('[data-lk]').forEach(function(el) {
    var key = el.getAttribute('data-lk');
    var val = (__TR[key] && (__TR[key][l] || __TR[key]['pt'])) || key;
    if (el.children.length === 0) {
      el.textContent = val;
    } else {
      var nodes = el.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 3 && nodes[i].textContent.trim()) {
          nodes[i].textContent = val;
          break;
        }
      }
    }
  });
  document.querySelectorAll('.lang-btn').forEach(function(b) {
    var active = b.dataset.lang === l;
    b.style.background = active ? '#7c3aed' : 'rgba(255,255,255,.08)';
    b.style.color = active ? '#fff' : 'rgba(255,255,255,.5)';
    b.style.border = active ? '1px solid #9f67fa' : '1px solid rgba(255,255,255,.15)';
    b.style.fontWeight = active ? '700' : '500';
  });
  if (window.__guardChart && window.__guardChart.data) {
    var ds = window.__guardChart.data.datasets;
    if (ds[0]) ds[0].label = (__TR['robbery'] && __TR['robbery'][l]) || 'Roubo';
    if (ds[1]) ds[1].label = (__TR['attempt'] && __TR['attempt'][l]) || 'Tentativa';
    if (ds[2]) ds[2].label = (__TR['vandalism'] && __TR['vandalism'][l]) || 'Vandalismo';
    window.__guardChart.update();
  }
  var btnDay  = document.getElementById('btn-day');
  var btnWeek = document.getElementById('btn-week');
  var btnYear = document.getElementById('btn-year');
  if (btnDay)  btnDay.textContent  = (__TR['chart_day']  && __TR['chart_day'][l])  || 'Por Dia';
  if (btnWeek) btnWeek.textContent = (__TR['chart_week'] && __TR['chart_week'][l]) || 'Por Semana';
  if (btnYear) btnYear.textContent = (__TR['chart_month']&& __TR['chart_month'][l])|| 'Por Mês/Ano';
  try { localStorage.setItem('jet_report_lang', l); } catch(e) {}
}
document.addEventListener('DOMContentLoaded', function() {
  var stored = null;
  try { stored = localStorage.getItem('jet_report_lang'); } catch(e) {}
  applyLang(stored || '${lang}');
});
</script>
<style>${css}
/* Extra page styles */
.pg-header { padding:22px 32px; color:#fff; }
.pg-kpis   { display:flex; gap:8px; padding:14px 32px; flex-wrap:wrap; background:#fff;
              border-bottom:1px solid #e9ecef; }
.pk        { flex:1; min-width:70px; background:#f8f9fa; border-radius:8px; padding:10px;
              text-align:center; border-top:3px solid #dee2e6; }
.pv        { font-size:26px; font-weight:900; color:#1a1a2e; line-height:1; }
.pl        { font-size:8px; color:#6c757d; margin-top:3px; text-transform:uppercase; letter-spacing:.5px; }
.alerta-box{ margin:12px 32px 0; background:#fdf2f2; border:1px solid #f5c6c6;
              border-left:4px solid #c0392b; border-radius:8px; padding:12px 16px; }
.alerta-row{ display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.ab-card   { background:#fff; border:1px solid #f5c6c6; border-radius:8px; padding:8px 16px;
              text-align:center; min-width:80px; }
.ab-val    { font-size:28px; font-weight:900; color:#c0392b; }
.ab-lbl    { font-size:8px; color:#999; text-transform:uppercase; margin-top:2px; }
.ab-sub    { font-size:9px; color:#27ae60; margin-top:2px; }
.vd-card   { background:#fff; border:1px solid #f9e08a; border-radius:8px; padding:8px 16px;
              text-align:center; min-width:80px; }
.vd-val    { font-size:28px; font-weight:900; color:#b7950b; }
.vd-lbl    { font-size:8px; color:#999; text-transform:uppercase; margin-top:2px; }
.proc-card { background:#f4ecf7; border:2px solid #9b59b6; border-radius:8px; padding:8px 16px;
              text-align:center; min-width:80px; }
.proc-val  { font-size:28px; font-weight:900; color:#9b59b6; }
</style>
</head><body>
<div class="page">
<div class="lang-bar">
  <span style="font-size:14px;margin-right:6px">🌐</span>
  <span style="font-size:12px;color:#fff;font-weight:700;margin-right:8px">Idioma / Language:</span>
  <button class="lang-btn" data-lang="pt" onclick="applyLang('pt')" style="padding:6px 20px;border-radius:16px;border:2px solid #fff;background:#fff;color:#7c3aed;font-size:13px;font-weight:800;cursor:pointer">PT</button>
  <button class="lang-btn" data-lang="en" onclick="applyLang('en')" style="padding:6px 20px;border-radius:16px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:13px;font-weight:700;cursor:pointer">EN</button>
  <button class="lang-btn" data-lang="es" onclick="applyLang('es')" style="padding:6px 20px;border-radius:16px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:13px;font-weight:700;cursor:pointer">ES</button>
  <button class="lang-btn" data-lang="ru" onclick="applyLang('ru')" style="padding:6px 20px;border-radius:16px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:13px;font-weight:700;cursor:pointer">RU</button>
  <span style="margin-left:auto;font-size:11px;color:rgba(255,255,255,.8);font-weight:700;letter-spacing:1px">JET GUARD</span>
</div>

<!-- ════════════════════════════════════════════════════
     PÁGINA 1 — ROUBOS (PT-BR)
     ════════════════════════════════════════════════════ -->
<div class="pg-header" style="background:linear-gradient(135deg,#1a1a2e,#0f3460)">
  <div class="hlogo">JET OS • <span data-lk="pdf_exec_report" style="text-transform:uppercase">${tr(lang, 'pdf_exec_report')}</span></div>
  <div class="htitle">🔴 <span data-lk="pdf_open_rob">${tr(lang, 'pdf_open_rob')}</span> — ${dataFmt}</div>
  <div class="hsub">${r.semana} &nbsp;•&nbsp; ${geradoEm} &nbsp;•&nbsp; 1/3</div>
</div>

<!-- Destaque: só abertos -->
<div class="alerta-box">
  <div class="alerta-row">
    <div style="font-size:11px;font-weight:800;color:#c0392b;text-transform:uppercase;letter-spacing:1px">
      🚨 <span data-lk="pdf_open_rob">${tr(lang, 'pdf_open_rob')}</span>
    </div>
    <div class="ab-card"><div class="ab-val">${roubosAb}</div><div class="ab-lbl" data-lk="pdf_open_rob">${tr(lang, 'pdf_open_rob')}</div></div>
    <div class="ab-card"><div class="ab-val" style="color:#f97316">${ocorrs.filter((o) => o.tipo === 'Tentativa' && !/recuper|encerr/i.test(o.status || '')).length}</div><div class="ab-lbl"><span data-lk="attempt">${tr(lang, 'attempt')}</span> <span data-lk="open_lbl">${tr(lang, 'open_lbl')}</span></div></div>
    ${procurand > 0 ? `<div class="proc-card"><div class="proc-val">${procurand}</div><div style="font-size:9px;color:#9b59b6;font-weight:700">‼️ <span data-lk="wanted">${tr(lang, 'wanted')}</span></div></div>` : ''}
  </div>
</div>

<!-- KPIs Roubos -->
<div class="pg-kpis">
  <div class="pk" style="border-top-color:#c0392b"><div class="pv">${roubos}</div><div class="pl">🔴 <span data-lk="robbery">${tr(lang, 'robbery')}</span></div></div>
  <div class="pk" style="border-top-color:#c0392b"><div class="pv" style="color:#c0392b">${roubosAb}</div><div class="pl" data-lk="pdf_open_col">${tr(lang, 'pdf_open_col')}</div></div>
  <div class="pk" style="border-top-color:#f97316"><div class="pv">${ocorrs.filter((o) => o.tipo === 'Tentativa').length}</div><div class="pl">🟠 <span data-lk="attempt">${tr(lang, 'attempt')}</span></div></div>
  <div class="pk" style="border-top-color:#e74c3c"><div class="pv">${crit}</div><div class="pl" data-lk="pdf_critical_col">${tr(lang, 'pdf_critical_col')}</div></div>
  ${r.comBO ? `<div class="pk" style="border-top-color:#7f8c8d"><div class="pv">${r.comBO}</div><div class="pl" data-lk="with_bo">${tr(lang, 'with_bo')}</div></div>` : ''}
</div>

<!-- Roubos evolução temporal -->
<div class="section">
  <div class="sec-title" data-lk="pdf_temporal">${tr(lang, 'pdf_temporal')}</div>
  <div class="roubos-box">
    <div class="roubos-kpis">
      <div class="rkpi"><div class="rkv">${roubos24h.length}</div><div class="rkl">🔴 <span data-lk="robbery">${tr(lang, 'robbery')}</span><br><b style="font-size:8px;color:#999"><span data-lk="pdf_yesterday">${tr(lang, 'pdf_yesterday')}</span> ${ontemLabel}</b></div></div>
      <div class="rkpi"><div class="rkv">${tent24h.length}</div><div class="rkl">🟠 <span data-lk="attempt">${tr(lang, 'attempt')}</span><br><b style="font-size:8px;color:#999" data-lk="pdf_yesterday">${tr(lang, 'pdf_yesterday')}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#e67e22">${roubos7d.length}</div><div class="rkl">🔴 <span data-lk="robbery">${tr(lang, 'robbery')}</span><br><b style="font-size:8px;color:#999" data-lk="pdf_7d">${tr(lang, 'pdf_7d')}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#e67e22">${tent7d.length}</div><div class="rkl">🟠 <span data-lk="attempt">${tr(lang, 'attempt')}</span><br><b style="font-size:8px;color:#999" data-lk="pdf_7d">${tr(lang, 'pdf_7d')}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#2980b9">${roubosMes}<div style="font-size:7px;font-weight:400;color:#999">+${tentMes} <span data-lk="attempt">${tr(lang, 'attempt').toLowerCase()}</span></div></div><div class="rkl" data-lk="pdf_month">${tr(lang, 'pdf_month')}<br><b style="font-size:8px;color:#999">${mesLabel}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#7f8c8d">${roubosAcum}</div><div class="rkl" data-lk="pdf_accum">${tr(lang, 'pdf_accum')}<br><b style="font-size:8px;color:#999">${acumLabel}</b></div></div>
    </div>
  </div>
</div>

<!-- Gráfico SVG evolução roubos semana a semana -->
${(() => {
        // Agrupa por semana (últimas 10 semanas)
        const semanas = 10;
        const entries = [];
        for (let i = semanas - 1; i >= 0; i--) {
            const ini = new Date(Date.now() - (i + 1) * 7 * 86400000);
            const fim = new Date(Date.now() - i * 7 * 86400000);
            const semOcs = r.ocorrencias.filter(o => {
                const d = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm);
                return d >= ini && d < fim;
            });
            const iniLabel = ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            entries.push({
                label: iniLabel,
                roubos: semOcs.filter(o => o.tipo === 'Roubo').length,
                tent: semOcs.filter(o => o.tipo === 'Tentativa').length,
            });
        }
        const maxVal = Math.max(...entries.flatMap(e => [e.roubos, e.tent]), 1);
        const W = 820;
        const PL = 8;
        const PR = 8;
        const PT = 30;
        const PB = 36;
        const barW = Math.floor((W - PL - PR) / entries.length);
        const singleW = Math.max(4, Math.floor(barW * 0.42));
        const H = PT + 120 + PB;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:Arial,sans-serif;display:block">`;
        svg += `<rect width="${W}" height="${H}" fill="#fdf2f2" rx="8"/>`;
        svg += `<text x="${W / 2}" y="20" text-anchor="middle" fill="#c0392b" font-size="11" font-weight="bold">📈 Roubos &amp; Tentativas — Evolução semanal (últimas 10 semanas)</text>`;
        // Grade
        [0.25, 0.5, 0.75, 1].forEach(f => {
            const y = PT + Math.round((1 - f) * 120);
            svg += `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="#f5c6c6" stroke-width="1"/>`;
            svg += `<text x="${W - PR + 2}" y="${y + 4}" fill="#aaa" font-size="8">${Math.round(maxVal * f)}</text>`;
        });
        entries.forEach((e, i) => {
            const x = PL + i * barW + Math.floor((barW - 2 * singleW - 3) / 2);
            const bR = e.roubos > 0 ? Math.max(3, Math.round((e.roubos / maxVal) * 120)) : 0;
            const bT = e.tent > 0 ? Math.max(3, Math.round((e.tent / maxVal) * 120)) : 0;
            if (bR > 0) {
                svg += `<rect x="${x}" y="${PT + 120 - bR}" width="${singleW}" height="${bR}" fill="#c0392b" rx="2" opacity="0.85"/>`;
                svg += `<text x="${x + singleW / 2}" y="${PT + 120 - bR - 3}" text-anchor="middle" fill="#c0392b" font-size="8" font-weight="bold">${e.roubos}</text>`;
            }
            if (bT > 0) {
                svg += `<rect x="${x + singleW + 3}" y="${PT + 120 - bT}" width="${singleW}" height="${bT}" fill="#e67e22" rx="2" opacity="0.85"/>`;
                svg += `<text x="${x + singleW + 3 + singleW / 2}" y="${PT + 120 - bT - 3}" text-anchor="middle" fill="#e67e22" font-size="8" font-weight="bold">${e.tent}</text>`;
            }
            svg += `<text x="${x + singleW}" y="${PT + 120 + 14}" text-anchor="middle" fill="#666" font-size="7" font-weight="${i === entries.length - 1 ? 'bold' : 'normal'}">${e.label}</text>`;
        });
        // Legenda
        svg += `<rect x="${PL}" y="${H - 14}" width="10" height="8" fill="#c0392b" rx="2"/>`;
        svg += `<text x="${PL + 13}" y="${H - 7}" fill="#c0392b" font-size="9">Roubos</text>`;
        svg += `<rect x="${PL + 65}" y="${H - 14}" width="10" height="8" fill="#e67e22" rx="2"/>`;
        svg += `<text x="${PL + 78}" y="${H - 7}" fill="#e67e22" font-size="9">Tentativas</text>`;
        svg += '</svg>';
        return svg;
    })()}

<!-- Tabela roubos por cidade -->
${cidadesOrd.length ? `
<div class="section">
  <div class="sec-title">🏙 <span data-lk="pdf_rob_by_city">${tr(lang, 'pdf_rob_by_city')}</span></div>
  <table>
    <thead><tr>
      <th data-lk="pdf_city">${tr(lang, 'pdf_city')}</th>
      <th class="n" data-lk="robbery">${tr(lang, 'robbery')}</th><th class="n" data-lk="attempt">${tr(lang, 'attempt')}</th>
      <th class="n" data-lk="pdf_open_col">${tr(lang, 'pdf_open_col')}</th><th class="n" data-lk="pdf_critical_col">${tr(lang, 'pdf_critical_col')}</th>
    </tr></thead>
    <tbody>${cidadesOrd.map(([c, v]) => `<tr><td><b>${c}</b></td>
      <td class="n" style="color:#c0392b;font-weight:700">${v.roubos || 0}</td>
      <td class="n" style="color:#e67e22">${ocorrs.filter((o) => o.tipo === 'Tentativa' && o.cidade_inicial === c).length}</td>
      <td class="n" style="color:#c0392b">${v.abertos || 0}</td>
      <td class="n" style="color:#e74c3c">${v.crit || 0}</td></tr>`).join('')}</tbody>
  </table>
</div>` : ''}

<!-- Gráfico interativo Chart.js -->
<div class="section">
  <div class="sec-title" data-lk="pdf_interactive">${tr(lang, 'pdf_interactive')}</div>
  <div style="background:#f8f9fa;border-radius:10px;padding:16px 20px;margin:0 0 0">
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button onclick="switchChart('day')" id="btn-day" style="padding:5px 14px;border-radius:20px;border:none;background:#1a1a2e;color:#fff;font-size:11px;font-weight:700;cursor:pointer">${tr(lang, 'chart_day')}</button>
      <button onclick="switchChart('week')" id="btn-week" style="padding:5px 14px;border-radius:20px;border:1px solid #ccc;background:#fff;font-size:11px;font-weight:700;cursor:pointer">${tr(lang, 'chart_week')}</button>
      <button onclick="switchChart('year')" id="btn-year" style="padding:5px 14px;border-radius:20px;border:1px solid #ccc;background:#fff;font-size:11px;font-weight:700;cursor:pointer">${tr(lang, 'chart_month')}</button>
    </div>
    <canvas id="guardChart" height="80"></canvas>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
const CD = ${chartJson};
let guardChartInst = null;
function switchChart(mode) {
  ['day','week','year'].forEach(function(m) {
    var btn = document.getElementById('btn-'+m);
    btn.style.background = m===mode ? '#1a1a2e' : '#fff';
    btn.style.color = m===mode ? '#fff' : '#333';
    btn.style.border = m===mode ? 'none' : '1px solid #ccc';
  });
  var labels = mode==='day' ? CD.dayLabels : mode==='week' ? CD.wkLabels : CD.moLabels;
  var r = mode==='day' ? CD.dayR : mode==='week' ? CD.wkR : CD.moR;
  var t = mode==='day' ? CD.dayT : mode==='week' ? CD.wkT : CD.moT;
  var v = mode==='day' ? CD.dayV : mode==='week' ? CD.wkV : CD.moV;
  if (guardChartInst) guardChartInst.destroy();
  window.__guardChart = guardChartInst = new Chart(document.getElementById('guardChart'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label:'Roubos', data: r, backgroundColor:'rgba(192,57,43,0.8)', borderColor:'#c0392b', borderWidth:1 },
        { label:'Tentativas', data: t, backgroundColor:'rgba(230,126,34,0.7)', borderColor:'#e67e22', borderWidth:1 },
        { label:'Vandalismo', data: v, backgroundColor:'rgba(183,149,11,0.7)', borderColor:'#b7950b', borderWidth:1 },
      ]
    },
    options: {
      responsive: true, plugins: { legend: { position:'top' }, tooltip: { mode:'index', intersect:false } },
      scales: { x: { stacked:false }, y: { beginAtZero:true, ticks:{ stepSize:1 } } }
    }
  });
}
document.addEventListener('DOMContentLoaded', function(){ switchChart('day'); });
</script>

<!-- Tabela detalhada roubos 24h -->
${roubosRows24h ? `
<div class="section">
  <div class="sec-title">📋 <span data-lk="pdf_24h_rob">${tr(lang, 'pdf_24h_rob')}</span></div>
  <div class="roubos-box">
    <table>
      <thead><tr><th data-lk="pdf_datetime">${tr(lang, 'pdf_datetime')}</th><th data-lk="pdf_type">${tr(lang, 'pdf_type')}</th><th data-lk="pdf_asset">${tr(lang, 'pdf_asset')}</th><th data-lk="pdf_city">${tr(lang, 'pdf_city')}</th><th data-lk="pdf_guard_col">${tr(lang, 'pdf_guard_col')}</th><th data-lk="pdf_bo">${tr(lang, 'pdf_bo')}</th><th data-lk="pdf_description">${tr(lang, 'pdf_description')} / Foto</th></tr></thead>
      <tbody>${roubosRows24h}</tbody>
    </table>
  </div>
</div>` : `<div class="section"><div style="color:#999;font-size:11px;padding:8px 32px" data-lk="pdf_no_24h_rob">${tr(lang, 'pdf_no_24h_rob')}</div></div>`}

<div class="footer">JET OS Guard System • <span data-lk="pdf_open_rob">${tr(lang, 'pdf_open_rob')}</span> • 1/3 • ${geradoEm}</div>

<!-- ════════════════════════════════════════════════════
     PÁGINA 2 — VANDALISMO
     ════════════════════════════════════════════════════ -->
<div style="page-break-before:always"></div>
<div class="pg-header" style="background:linear-gradient(135deg,#7d5a00,#b7950b,#c8a415)">
  <div class="hlogo">JET OS • <span data-lk="vandalism" style="text-transform:uppercase">${tr(lang, 'vandalism')}</span></div>
  <div class="htitle">🟡 <span data-lk="vandalism">${tr(lang, 'vandalism')}</span> — ${dataFmt}</div>
  <div class="hsub">${r.semana} &nbsp;•&nbsp; 2/3</div>
</div>

<div style="margin:12px 32px 0;background:#fffbf0;border:1px solid #f0ad4e;border-left:4px solid #b7950b;border-radius:8px;padding:12px 16px;">
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div style="font-size:11px;font-weight:800;color:#b7950b;text-transform:uppercase">🟡 <span data-lk="vand_open">${tr(lang, 'vand_open')}</span></div>
    <div class="vd-card"><div class="vd-val">${vandAb}</div><div class="vd-lbl" data-lk="pdf_open_col">${tr(lang, 'pdf_open_col')}</div></div>
    <div class="vd-card"><div class="vd-val" style="color:#666">${vand}</div><div class="vd-lbl" data-lk="pdf_total_period">${tr(lang, 'pdf_total_period')}</div></div>
    ${procurand > 0 ? `<div class="proc-card"><div class="proc-val">${procurand}</div><div style="font-size:9px;color:#9b59b6;font-weight:700">‼️ <span data-lk="wanted">${tr(lang, 'wanted')}</span></div></div>` : ''}
  </div>
</div>

<div class="pg-kpis">
  <div class="pk" style="border-top-color:#b7950b"><div class="pv">${vand}</div><div class="pl">🟡 <span data-lk="vandalism">${tr(lang, 'vandalism')}</span></div></div>
  <div class="pk" style="border-top-color:#b7950b"><div class="pv" style="color:#b7950b">${vandAb}</div><div class="pl" data-lk="pdf_open_col">${tr(lang, 'pdf_open_col')}</div></div>
  <div class="pk" style="border-top-color:#e67e22"><div class="pv">${vand24h.length}</div><div class="pl"><span data-lk="pdf_yesterday">${tr(lang, 'pdf_yesterday')}</span> (${ontemLabel})</div></div>
  <div class="pk" style="border-top-color:#2980b9"><div class="pv" style="color:#2980b9">${vandMes}</div><div class="pl"><span data-lk="pdf_month">${tr(lang, 'pdf_month')}</span> (${mesLabel})</div></div>
  <div class="pk" style="border-top-color:#7f8c8d"><div class="pv" style="color:#7f8c8d">${vandAcumAll}</div><div class="pl"><span data-lk="pdf_accum">${tr(lang, 'pdf_accum')}</span> (${acumLabel})</div></div>
  ${danoValorTotal > 0 ? `<div class="pk" style="border-top-color:#ef4444"><div class="pv" style="font-size:14px;color:#ef4444">R$${danoValorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div><div class="pl">Dano R$ total</div></div>` : ''}
  ${danoPctMedio > 0 ? `<div class="pk" style="border-top-color:#f59e0b"><div class="pv" style="color:#f59e0b">${danoPctMedio}%</div><div class="pl">% médio dano</div></div>` : ''}
</div>

<!-- Vandalismo evolução temporal -->
<div class="section">
  <div class="sec-title" data-lk="pdf_temporal">${tr(lang, 'pdf_temporal')}</div>
  <div class="roubos-box" style="border-color:#f0ad4e;border-left-color:#b7950b;background:#fffbf0">
    <div class="roubos-kpis">
      <div class="rkpi"><div class="rkv" style="color:#b7950b">${vand24h.length}</div><div class="rkl">🟡 <span data-lk="vandalism">${tr(lang, 'vandalism')}</span><br><b style="font-size:8px;color:#999"><span data-lk="pdf_yesterday">${tr(lang, 'pdf_yesterday')}</span> ${ontemLabel}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#e67e22">${ocs7d.filter((o) => o.tipo === 'Vandalismo').length}</div><div class="rkl">🟡 <span data-lk="vandalism">${tr(lang, 'vandalism')}</span><br><b style="font-size:8px;color:#999" data-lk="pdf_7d">${tr(lang, 'pdf_7d')}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#2980b9">${vandMes}</div><div class="rkl" data-lk="pdf_month">${tr(lang, 'pdf_month')}<br><b style="font-size:8px;color:#999">${mesLabel}</b></div></div>
      <div class="rkpi"><div class="rkv" style="color:#7f8c8d">${vandAcumAll}</div><div class="rkl" data-lk="pdf_accum">${tr(lang, 'pdf_accum')}<br><b style="font-size:8px;color:#999">${acumLabel}</b></div></div>
    </div>
  </div>
</div>

<!-- Gráfico SVG evolução vandalismo semana a semana -->
${(() => {
        const semanas = 10;
        const entries = [];
        for (let i = semanas - 1; i >= 0; i--) {
            const ini = new Date(Date.now() - (i + 1) * 7 * 86400000);
            const fim = new Date(Date.now() - i * 7 * 86400000);
            const semOcs = r.ocorrencias.filter(o => {
                const d = o.criadoEm?.toDate?.() ?? new Date(o.criadoEm);
                return d >= ini && d < fim;
            });
            const iniLabel = ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            entries.push({ label: iniLabel, vand: semOcs.filter(o => o.tipo === 'Vandalismo').length });
        }
        const maxVal = Math.max(...entries.map(e => e.vand), 1);
        const W = 820;
        const PL = 8;
        const PR = 24;
        const PT = 30;
        const PB = 36;
        const barW = Math.floor((W - PL - PR) / entries.length);
        const singleW = Math.max(6, Math.floor(barW * 0.7));
        const H = PT + 120 + PB;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:Arial,sans-serif;display:block">`;
        svg += `<rect width="${W}" height="${H}" fill="#fffbf0" rx="8"/>`;
        svg += `<text x="${W / 2}" y="20" text-anchor="middle" fill="#b7950b" font-size="11" font-weight="bold">📈 Vandalismo — Evolução semanal (últimas 10 semanas)</text>`;
        [0.25, 0.5, 0.75, 1].forEach(f => {
            const y = PT + Math.round((1 - f) * 120);
            svg += `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="#f0e0a0" stroke-width="1"/>`;
            svg += `<text x="${W - PR + 2}" y="${y + 4}" fill="#aaa" font-size="8">${Math.round(maxVal * f)}</text>`;
        });
        entries.forEach((e, i) => {
            const x = PL + i * barW + Math.floor((barW - singleW) / 2);
            const bH = e.vand > 0 ? Math.max(3, Math.round((e.vand / maxVal) * 120)) : 0;
            const cor = e.vand >= 5 ? '#b7950b' : e.vand >= 2 ? '#e67e22' : '#f59e0b';
            if (bH > 0) {
                svg += `<rect x="${x}" y="${PT + 120 - bH}" width="${singleW}" height="${bH}" fill="${cor}" rx="3" opacity="0.85"/>`;
                svg += `<text x="${x + singleW / 2}" y="${PT + 120 - bH - 3}" text-anchor="middle" fill="${cor}" font-size="9" font-weight="bold">${e.vand}</text>`;
            }
            svg += `<text x="${x + singleW / 2}" y="${PT + 120 + 14}" text-anchor="middle" fill="#666" font-size="7" font-weight="${i === entries.length - 1 ? 'bold' : 'normal'}">${e.label}</text>`;
        });
        svg += `<rect x="${PL}" y="${H - 14}" width="10" height="8" fill="#b7950b" rx="2"/>`;
        svg += `<text x="${PL + 13}" y="${H - 7}" fill="#b7950b" font-size="9">Vandalismo por semana</text>`;
        svg += '</svg>';
        return svg;
    })()}

<!-- Gráfico vandalismo + por tipo de ativo -->
<div style="display:flex;gap:16px;padding:0 32px 16px;flex-wrap:wrap">
  <div style="flex:1;min-width:200px;background:#f8f9fa;border-radius:8px;padding:12px">
    <div style="font-size:9px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">Por ativo vandalizado</div>
    ${[
        ['🛴 Patinetes', ocorrs.filter((o) => o.tipo === 'Vandalismo' && /patinete/i.test(o.ativo_tipo || '')).length, '#f59e0b'],
        ['🚲 Bicicletas', ocorrs.filter((o) => o.tipo === 'Vandalismo' && /bicicleta|bike/i.test(o.ativo_tipo || '')).length, '#3b82f6'],
        ['🔋 Baterias', ocorrs.filter((o) => o.tipo === 'Vandalismo' && /bateria/i.test(o.ativo_tipo || '')).length, '#a78bfa'],
    ].filter(([, n]) => n > 0).map(([l, n, c]) => {
        const bw = vand > 0 ? Math.max(4, Math.round(n / vand * 200)) : 0;
        return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px"><span>${l}</span><b style="color:${c}">${n}</b></div><div style="height:6px;background:rgba(0,0,0,.07);border-radius:3px"><div style="height:6px;width:${bw}px;background:${c};border-radius:3px"></div></div></div>`;
    }).join('')}
  </div>
  ${danoValorTotal > 0 ? `
  <div style="flex:1;min-width:200px;background:#fffbf0;border:1px solid #f0ad4e;border-radius:8px;padding:12px">
    <div style="font-size:9px;font-weight:700;color:#b7950b;text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">🔧 Danos avaliação oficina</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
      <div><div style="font-size:20px;font-weight:900;color:#ef4444">R$${danoValorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div><div style="font-size:9px;color:#999">Valor total</div></div>
      <div><div style="font-size:20px;font-weight:900;color:#f59e0b">${danoPctMedio}%</div><div style="font-size:9px;color:#999">% médio dano</div></div>
      <div><div style="font-size:20px;font-weight:900;color:#a78bfa">${vandComDano}</div><div style="font-size:9px;color:#999">Com avaliação</div></div>
      <div><div style="font-size:20px;font-weight:900;color:#6b7280">${vand - vandComDano}</div><div style="font-size:9px;color:#999">Sem avaliação</div></div>
    </div>
    ${vand - vandComDano > 0 ? `<div style="margin-top:8px;font-size:9px;color:#e67e22;text-align:center">⚠️ ${vand - vandComDano} caso(s) pendente(s) de avaliação</div>` : ''}
  </div>` : ''}
</div>

<!-- Gráfico SVG vandalismo semanal por cidade -->
${(() => {
        const vandCidades = {};
        ocs7d.filter((o) => o.tipo === 'Vandalismo').forEach((o) => {
            const c = (o.cidade_inicial || 'Desconhecida').split(' ')[0].slice(0, 12);
            vandCidades[c] = (vandCidades[c] || 0) + 1;
        });
        const entries = Object.entries(vandCidades).sort((a, b) => b[1] - a[1]).slice(0, 12);
        const totalV7d = entries.reduce((s, [, v]) => s + v, 0);
        if (!entries.length)
            return '<div class="section" style="color:#999;font-size:11px;padding:8px 32px">Sem dados de vandalismo nos últimos 7 dias</div>';
        const maxV = entries[0][1] || 1;
        const W = 820;
        const PL = 110;
        const PR = 20;
        const PT = 36;
        const PB = 28;
        const barH = 18;
        const gap = 5;
        const H = PT + entries.length * (barH + gap) + PB;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:Arial,sans-serif;display:block">`;
        svg += `<rect width="${W}" height="${H}" fill="#fffbf0" rx="8"/>`;
        svg += `<text x="${W / 2}" y="22" text-anchor="middle" fill="#b7950b" font-size="12" font-weight="bold">⚡ Vandalismo últimos 7d por cidade (Total: ${totalV7d})</text>`;
        entries.forEach(([cidade, n], i) => {
            const y = PT + i * (barH + gap);
            const bw = Math.max(4, Math.round((n / maxV) * (W - PL - PR)));
            const cor = n >= 5 ? '#c0392b' : n >= 3 ? '#e67e22' : '#f59e0b';
            svg += `<text x="${PL - 6}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#333" font-size="9" font-weight="600">${cidade}</text>`;
            svg += `<rect x="${PL}" y="${y}" width="${bw}" height="${barH}" fill="${cor}" rx="3" opacity="0.85"/>`;
            svg += `<text x="${PL + bw + 4}" y="${y + barH / 2 + 4}" fill="${cor}" font-size="9" font-weight="bold">${n}</text>`;
        });
        svg += '</svg>';
        return `<div class="section"><div class="sec-title">⚡ Vandalismo semanal por cidade</div><div style="margin-bottom:12px">${svg}</div></div>`;
    })()}

<!-- Tabela vandalismo por cidade -->
${cidadesOrd.filter(([, v]) => v.vand > 0).length ? `
<div class="section">
  <div class="sec-title">🏙 <span data-lk="pdf_vand_by_city">${tr(lang, 'pdf_vand_by_city')}</span></div>
  <table>
    <thead><tr>
      <th data-lk="pdf_city">${tr(lang, 'pdf_city')}</th>
      <th class="n" data-lk="vandalism">${tr(lang, 'vandalism')}</th>
      <th class="n" data-lk="pdf_open_col">${tr(lang, 'pdf_open_col')}</th><th class="n" data-lk="pdf_critical_col">${tr(lang, 'pdf_critical_col')}</th>
    </tr></thead>
    <tbody>${cidadesOrd.filter(([, v]) => v.vand > 0).map(([c, v]) => `<tr><td><b>${c}</b></td>
      <td class="n" style="color:#b7950b;font-weight:700">${v.vand || 0}</td>
      <td class="n" style="color:#c0392b">${v.abertos || 0}</td>
      <td class="n" style="color:#e74c3c">${v.crit || 0}</td></tr>`).join('')}</tbody>
  </table>
</div>` : ''}

<!-- Tabela detalhada vandalismo 24h -->
${vandRows24h ? `
<div class="section">
  <div class="sec-title">📋 <span data-lk="pdf_24h_vand">${tr(lang, 'pdf_24h_vand')}</span></div>
  <div style="background:#fffbf0;border:1px solid #f0ad4e;border-left:4px solid #b7950b;border-radius:8px;padding:14px 16px;margin:0 0 16px">
    <table>
      <thead><tr><th data-lk="pdf_datetime">${tr(lang, 'pdf_datetime')}</th><th data-lk="pdf_type">${tr(lang, 'pdf_type')}</th><th data-lk="pdf_asset">${tr(lang, 'pdf_asset')}</th><th data-lk="pdf_city">${tr(lang, 'pdf_city')}</th><th data-lk="pdf_guard_col">${tr(lang, 'pdf_guard_col')}</th><th data-lk="pdf_bo">${tr(lang, 'pdf_bo')}</th><th data-lk="pdf_damage">${tr(lang, 'pdf_damage')}</th></tr></thead>
      <tbody>${vandRows24h}</tbody>
    </table>
  </div>
</div>` : `<div class="section"><div style="color:#999;font-size:11px;padding:8px 32px" data-lk="pdf_no_24h_vand">${tr(lang, 'pdf_no_24h_vand')}</div></div>`}

<div class="footer">JET OS Guard System • <span data-lk="vandalism">${tr(lang, 'vandalism')}</span> • 2/3 • ${geradoEm}</div>

<!-- ════════════════════════════════════════════════════
     PÁGINA 3 — PERDAS, KPIs GERAIS & APÊNDICE
     ════════════════════════════════════════════════════ -->
<div style="page-break-before:always"></div>
<div class="pg-header" style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)">
  <div class="hlogo">JET OS • <span data-lk="pdf_kpis" style="text-transform:uppercase">${tr(lang, 'pdf_kpis')}</span></div>
  <div class="htitle">📊 <span data-lk="pdf_kpis">${tr(lang, 'pdf_kpis')}</span> · <span data-lk="pdf_losses">${tr(lang, 'pdf_losses')}</span> · <span data-lk="pdf_appendix">${tr(lang, 'pdf_appendix')}</span> — ${dataFmt}</div>
  <div class="hsub">${r.semana} &nbsp;•&nbsp; 3/3</div>
</div>

<!-- KPIs gerais completos -->
<div class="pg-kpis">
  <div class="pk k-total"><div class="pv">${total}</div><div class="pl" data-lk="total">${tr(lang, 'total')}</div></div>
  <div class="pk k-aberto"><div class="pv">${abertos}</div><div class="pl" data-lk="open">${tr(lang, 'open')}</div></div>
  <div class="pk k-apuracao"><div class="pv">${apurac}</div><div class="pl">Em apuração</div></div>
  <div class="pk k-recup"><div class="pv">${recup}</div><div class="pl" data-lk="recovered">${tr(lang, 'recovered')}</div></div>
  <div class="pk k-encerr"><div class="pv">${encerr}</div><div class="pl">Encerrado</div></div>
  <div class="pk k-crit"><div class="pv">${crit}</div><div class="pl" data-lk="critical">${tr(lang, 'critical')}</div></div>
  <div class="pk k-taxa"><div class="pv">${taxa}%</div><div class="pl">Taxa resolução</div></div>
  ${procurand > 0 ? `<div class="pk k-proc"><div class="pv" style="color:#9b59b6">${procurand}</div><div class="pl" data-lk="wanted">${tr(lang, 'wanted')}</div></div>` : ''}
</div>

${alertas.length ? `
<div class="alertas">
  <div class="alertas-t">⚠️ Alertas</div>
  <ul>${alertas.map((a) => `<li>• ${a}</li>`).join('')}</ul>
</div>` : ''}

<div class="charts">
  ${svgTipos}
  ${svgStatus}
</div>
${svgCidades ? `<div class="chart-full">${svgCidades}</div>` : ''}

<!-- PERDAS BRPD -->
<div class="section">
  <div class="sec-title">📉 <span data-lk="pdf_losses">${tr(lang, 'pdf_losses')}</span> — BRPD <span data-lk="pdf_accum">${tr(lang, 'pdf_accum')}</span> (${acumLabel})</div>
  <div class="perdas-box">
    <div class="perdas-total">
      <div class="ptotal"><div class="ptv">${PERDAS_ACUM.totalBRPD}</div><div class="ptl" data-lk="pdf_total_col">${tr(lang, 'pdf_total_col')} BRPD</div></div>
      <div class="ptotal"><div class="ptv" style="color:#e67e22">${PERDAS_ACUM.totalPatins}</div><div class="ptl">🛴 <span data-lk="pdf_scooters">${tr(lang, 'pdf_scooters')}</span></div></div>
      <div class="ptotal"><div class="ptv" style="color:#f39c12">${PERDAS_ACUM.totalBikes}</div><div class="ptl">🚲 <span data-lk="pdf_bikes">${tr(lang, 'pdf_bikes')}</span></div></div>
      <div class="ptotal" style="border-color:#f0ad4e">
        <div class="ptv" style="color:#e67e22;font-size:13px">${PERDAS_ACUM.atualizadoEm}</div>
        <div class="ptl">Ref. planilha</div>
      </div>
    </div>
    <div style="overflow-x:auto">
    <table style="min-width:900px">
      <thead>
        <tr>
          <th class="n" rowspan="2">#</th>
          <th rowspan="2" data-lk="pdf_region">${tr(lang, 'pdf_region')}</th>
          <th rowspan="2"><span data-lk="pdf_branch">${tr(lang, 'pdf_branch')}</span> / <span data-lk="pdf_resp">${tr(lang, 'pdf_resp')}</span></th>
          <th class="n" rowspan="2">🛴 <span data-lk="pdf_scooters">${tr(lang, 'pdf_scooters')}</span></th>
          <th class="n" rowspan="2">🚲 <span data-lk="pdf_bikes">${tr(lang, 'pdf_bikes')}</span></th>
          <th class="n" rowspan="2">BRPD</th>
          <th class="n" rowspan="2">% Brasil</th>
          <th class="n" colspan="3" style="background:#e67e22;text-align:center">⚡ <span data-lk="pdf_vandalism_ttl">${tr(lang, 'pdf_vandalism_ttl')}</span> 24h</th>
          <th class="n" colspan="3" style="background:#9b59b6;text-align:center">🔍 <span data-lk="pdf_not_found">${tr(lang, 'pdf_not_found')}</span> 24h</th>
          <th class="n" colspan="2" style="background:#2980b9;text-align:center">📋</th>
        </tr>
        <tr>
          <th class="n" style="background:#e67e2240;font-size:8px">🛴 Pat.</th>
          <th class="n" style="background:#e67e2240;font-size:8px">🚲 Bike</th>
          <th class="n" style="background:#e67e2240;font-size:8px;border-right:2px solid #e67e22" data-lk="pdf_total_col">${tr(lang, 'pdf_total_col')}</th>
          <th class="n" style="background:#9b59b640;font-size:8px">🛴 Pat.</th>
          <th class="n" style="background:#9b59b640;font-size:8px">🚲 Bike</th>
          <th class="n" style="background:#9b59b640;font-size:8px">🔋 Bat.</th>
          <th style="background:#2980b940;font-size:8px;border-left:2px solid #2980b9" data-lk="pdf_status_24h">${tr(lang, 'pdf_status_24h')}</th>
          <th style="background:#2980b940;font-size:8px" data-lk="pdf_status_7d">${tr(lang, 'pdf_status_7d')}</th>
        </tr>
      </thead>
      <tbody>${perdasRows}</tbody>
    </table>
    </div>
  </div>
</div>

<!-- Apêndice -->
<div class="section">
  <div class="sec-title">📋 <span data-lk="pdf_appendix">${tr(lang, 'pdf_appendix')}</span></div>
  <div style="font-size:10px;color:#6c757d;margin-bottom:16px">
    Todas as ocorrências do período ordenadas por cidade e status.
    Críticos em vermelho · Procurados em roxo · Fotos clicáveis.
  </div>
</div>
${apendice}

<div class="footer">JET OS Guard System • <span data-lk="pdf_caption">${tr(lang, 'pdf_caption')}</span> • 3/3 • ${geradoEm}</div>

<!-- Lightbox -->
<div id="lightbox" onclick="if(event.target===this)fecharFoto()">
  <button id="lightbox-close" onclick="fecharFoto()">✕</button>
  <img id="lightbox-img" src="" alt="foto"/>
  <div id="lightbox-caption"></div>
</div>

<script>
function abrirFoto(url) {
  var lb = document.getElementById('lightbox');
  var img = document.getElementById('lightbox-img');
  var cap = document.getElementById('lightbox-caption');
  img.src = url;
  cap.textContent = url.split('/').pop().split('?')[0] || 'Foto da ocorrência';
  lb.classList.add('ativo');
  document.body.style.overflow = 'hidden';
}
function fecharFoto() {
  document.getElementById('lightbox').classList.remove('ativo');
  document.getElementById('lightbox-img').src = '';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') fecharFoto();
});
</script>

</div>
<div class="lang-bar" style="margin-top:8px">
  <span style="font-size:14px;margin-right:6px">🌐</span>
  <span style="font-size:12px;color:#fff;font-weight:700;margin-right:8px">Idioma / Language:</span>
  <button class="lang-btn" data-lang="pt" onclick="applyLang('pt')" style="padding:6px 20px;border-radius:16px;border:2px solid #fff;background:#fff;color:#7c3aed;font-size:13px;font-weight:800;cursor:pointer">PT</button>
  <button class="lang-btn" data-lang="en" onclick="applyLang('en')" style="padding:6px 20px;border-radius:16px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:13px;font-weight:700;cursor:pointer">EN</button>
  <button class="lang-btn" data-lang="es" onclick="applyLang('es')" style="padding:6px 20px;border-radius:16px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:13px;font-weight:700;cursor:pointer">ES</button>
  <button class="lang-btn" data-lang="ru" onclick="applyLang('ru')" style="padding:6px 20px;border-radius:16px;border:2px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:13px;font-weight:700;cursor:pointer">RU</button>
</div>
</div>
</body></html>`;
}
// ── ENVIAR TELEGRAM ────────────────────────────────────────────────────────
async function getTelegramConfigFromFirestore() {
    try {
        const db = admin.firestore();
        const snap1 = await db.collection('config').doc('telegram').get();
        if (snap1.exists) {
            const d = snap1.data();
            const token = String(d.bot_token || d.botToken || '').trim();
            const chatId = String(d.chat_id || d.chatId || d.relatoriosChatId || '').trim();
            console.log('[telegram-cfg] config/telegram → token:', token ? 'OK' : 'VAZIO', 'chatId:', chatId || 'VAZIO');
            if (token && chatId)
                return { token, chatId };
        }
        const snap2 = await db.collection('telegram_config').doc('global').get();
        if (snap2.exists) {
            const d = snap2.data();
            const token = String(d.botToken || d.bot_token || '').trim();
            const chatId = String(d.relatoriosChatId || d.chat_id || d.chatId || '').trim();
            if (token && chatId)
                return { token, chatId };
        }
        const envToken = process.env.TELEGRAM_BOT_TOKEN || '';
        const envChatId = process.env.TELEGRAM_CHAT_ID || '';
        if (envToken && envChatId)
            return { token: envToken, chatId: envChatId };
        console.warn('[telegram-cfg] Nenhuma config encontrada');
        return { token: '', chatId: '' };
    }
    catch (e) {
        console.error('[telegram-cfg] Erro:', e);
        return { token: '', chatId: '' };
    }
}
async function enviarRelatorioTelegram(r, lang = 'pt') {
    const { token, chatId } = await getTelegramConfigFromFirestore();
    if (!token || !chatId) {
        console.warn('[telegram] Token ou ChatID não configurados.');
        return;
    }
    // Busca 24h, 7d, mês e acumulado (ano) para a mensagem e o PDF
    const db = admin.firestore();
    const agora = new Date();
    const ini24 = new Date(agora.getTime() - 24 * 3600000);
    const ini7d = new Date(agora.getTime() - 7 * 24 * 3600000);
    const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const iniAno = new Date(agora.getFullYear(), 0, 1);
    const [snap24, snap7d, snapMes, snapAcum] = await Promise.all([
        db.collection('ocorrencias')
            .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(ini24))
            .orderBy('criadoEm', 'desc').get(),
        db.collection('ocorrencias')
            .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(ini7d))
            .orderBy('criadoEm', 'desc').get(),
        db.collection('ocorrencias')
            .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(iniMes))
            .orderBy('criadoEm', 'desc').get(),
        db.collection('ocorrencias')
            .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(iniAno))
            .orderBy('criadoEm', 'desc').get(),
    ]);
    const ocs24h = snap24.docs.map(d => ({ id: d.id, ...d.data() }));
    const ocs7d = snap7d.docs.map(d => ({ id: d.id, ...d.data() }));
    const ocsMes = snapMes.docs.map(d => ({ id: d.id, ...d.data() }));
    const ocsAcum = snapAcum.docs.map(d => ({ id: d.id, ...d.data() }));
    const mensagem = formatarMensagem(lang, r, ocs24h, ocs7d);
    const html = await gerarPdfHtml(r, ocs24h, ocs7d, ocsMes, ocsAcum, lang);
    const filename = `jet_guard_${r.data}.html`;
    // Envia texto
    const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
    try {
        const resp = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: mensagem, parse_mode: 'Markdown', disable_web_page_preview: true }, { timeout: 15000 });
        console.log('[telegram] Mensagem enviada, status=', resp.status);
    }
    catch (e) {
        const body = e?.response?.data ? JSON.stringify(e.response.data) : e?.message;
        console.error('[telegram] Erro ao enviar mensagem:', body);
        throw new Error('Telegram sendMessage error: ' + body);
    }
    // Envia PDF (HTML como documento)
    try {
        const FormData = (await Promise.resolve().then(() => __importStar(require('form-data')))).default;
        const https = (await Promise.resolve().then(() => __importStar(require('https')))).default;
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', `📎 JET Guard • ${tr(lang, 'pdf_caption')} • ${r.data}`);
        form.append('document', Buffer.from(html, 'utf-8'), {
            filename,
            contentType: 'text/html',
        });
        await new Promise((resolve, reject) => {
            const req = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendDocument`, method: 'POST', headers: form.getHeaders() }, res => { res.resume(); res.statusCode === 200 ? resolve() : reject(new Error(`TG doc ${res.statusCode}`)); });
            req.on('error', reject);
            form.pipe(req);
        });
        console.log('[telegram] PDF enviado:', filename);
    }
    catch (e) {
        console.error('[telegram] Erro ao enviar PDF:', e?.message);
        // Não falha se PDF der erro — mensagem já foi enviada
    }
}
//# sourceMappingURL=relatorio.js.map