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

import * as admin from 'firebase-admin';
import { onRequest }  from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const db = admin.firestore();

const CITY_ID = '669f89ebd06775867c31b984';
const GOJET_BASE = 'https://logistic.gojet.app/api/v0/urent';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface SlotConfigZona {
  zona: string;
  turno: 'T0' | 'T1' | 'T2';
  vagasBase: number;
  cargo: string;
  ativo: boolean;
  cidade?: string;
}

interface SlotConfigGlobal {
  multiplicadores: {
    ociosidadeAlta: number; limiarOciosidade: number;
    deficitAlto: number;    limiarDeficit: number;
    bateriasBaixa: number;  limiarBateria: number;
  };
  zonas: SlotConfigZona[];
  cidade: string;
  pais: string;
  cityIdGoJet: string;
  webhookSecret?: string;
}

interface GoJetParking {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bikes_count?: number;
  count?: number;
  target?: number;
  status?: string;
}

interface ZoneStats {
  zona: string;
  totalPontos: number;
  disponiveis: number;
  target: number;
  deficit: number;
  ociosidade: number; // %
}

// ─── Mapa de emojis → zonas ───────────────────────────────────────────────────

const ZONA_MAP: Record<string, string> = {
  '🟥': 'Z1 - Vermelha',
  '⬛': 'Z2 - Preta',
  '🟧': 'Z3 - Laranja',
  '🟦': 'Z4 - Azul',
  '🟩': 'Z5 - Verde',
  '🟨': 'Z6 - Amarela',
  '🏁': 'Zona Interlagos',
};

// ─── Helpers GoJet ────────────────────────────────────────────────────────────

async function fetchGoJet(): Promise<{
  parkings: GoJetParking[];
  bikes: any[];
} | null> {
  try {
    const [pRes, bRes] = await Promise.all([
      fetch(`${GOJET_BASE}/parkings?city_id=${CITY_ID}&page=1&limit=1000`),
      fetch(`${GOJET_BASE}/bikes?city_id=${CITY_ID}&page=1&limit=1000`),
    ]);
    if (!pRes.ok || !bRes.ok) return null;

    const pJson = await pRes.json();
    const bJson = await bRes.json();

    const parkings: GoJetParking[] = pJson.data ?? pJson ?? [];
    const bikes: any[]             = bJson.data ?? bJson ?? [];

    // Enriquecer parkings com contagem de bikes
    const bikesPorParking: Record<string, number> = {};
    for (const b of bikes) {
      if (b.parking_id) {
        bikesPorParking[b.parking_id] = (bikesPorParking[b.parking_id] || 0) + 1;
      }
    }
    for (const p of parkings) {
      p.bikes_count = bikesPorParking[p.id] ?? p.bikes_count ?? p.count ?? 0;
    }

    return { parkings, bikes };
  } catch (e) {
    console.error('[GoJet] fetch erro:', e);
    return null;
  }
}

function calcularStatsZonas(parkings: GoJetParking[]): Record<string, ZoneStats> {
  const stats: Record<string, ZoneStats> = {};

  for (const p of parkings) {
    // Detecta zona pelo emoji no início do nome
    const emoji = p.name?.match(/^([🟥⬛🟧🟦🟩🟨🏁])/u)?.[1];
    const zona  = emoji ? ZONA_MAP[emoji] : null;
    if (!zona) continue;

    if (!stats[zona]) {
      stats[zona] = { zona, totalPontos: 0, disponiveis: 0, target: 0, deficit: 0, ociosidade: 0 };
    }

    stats[zona].totalPontos++;
    stats[zona].disponiveis += p.bikes_count ?? 0;
    stats[zona].target      += p.target ?? 0;
    stats[zona].deficit     += Math.max(0, (p.target ?? 0) - (p.bikes_count ?? 0));
  }

  // Calcular ociosidade por zona
  for (const z of Object.values(stats)) {
    z.ociosidade = z.target > 0
      ? Math.round(((z.target - z.disponiveis) / z.target) * 100)
      : 0;
  }

  return stats;
}

function turnoAtual(): 'T0' | 'T1' | 'T2' {
  const hora = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  ).getHours();
  if (hora >= 23 || hora < 7)  return 'T0';
  if (hora >= 10 && hora < 15) return 'T1';
  return 'T2';
}

// ─── Core: gerar tarefas monitor ─────────────────────────────────────────────

async function _gerarTarefasMonitor(parkings: GoJetParking[], turno: 'T0' | 'T1' | 'T2') {
  const hoje = new Date().toISOString().slice(0, 10);

  const estacoesSnap = await db.collection('estacoes')
    .where('tipoMonitor', 'in', ['M1', 'M2', 'M3'])
    .get();

  if (estacoesSnap.empty) return;

  let criadas = 0;

  for (const estDoc of estacoesSnap.docs) {
    const est = { id: estDoc.id, ...estDoc.data() } as any;
    const monConfig = est.monitorConfig ?? {};

    // Encontra parking GoJet correspondente (por gojetParkingId ou proximidade)
    const parking = parkings.find((p) =>
      p.id === est.gojetParkingId ||
      (est.lat && est.lng &&
        Math.abs(p.lat - est.lat) < 0.0005 &&
        Math.abs((p.lng ?? 0) - est.lng) < 0.0005)
    );

    if (!parking) continue;

    const patinetes = parking.bikes_count ?? 0;
    let precisaTarefa = false;
    let prioridade: 1 | 2 | 3 | 4 | 5 = 3;
    let descricao = '';
    let cargo = 'scalt';

    if (est.tipoMonitor === 'M1') {
      if (patinetes === 0) {
        precisaTarefa = true;
        prioridade    = 5;
        descricao     = `🚨 URGENTE: ${est.nome ?? est.codigo} zerou — reposição imediata`;
        cargo         = 'scalt';
      }
    } else if (est.tipoMonitor === 'M2') {
      const m2 = monConfig.M2 ?? {};
      const isFds = [0, 6].includes(new Date().getDay());
      const turnoKey = isFds ? 'Fds' : (turno === 'T0' || turno === 'T2') ? 'Noite' : 'Dia';
      const min = m2[`min${turnoKey}`] ?? 0;
      const max = m2[`max${turnoKey}`] ?? 99;

      if (patinetes < min) {
        precisaTarefa = true;
        prioridade    = patinetes === 0 ? 5 : 4;
        descricao     = `📉 ${est.nome}: ${patinetes} pat. abaixo do mínimo ${min} (${turnoKey})`;
        cargo         = 'scalt';
      } else if (patinetes > max) {
        precisaTarefa = true;
        prioridade    = 2;
        descricao     = `📈 ${est.nome}: ${patinetes} pat. acima do máximo ${max} — coletar excesso`;
        cargo         = 'scalt';
      }
    } else if (est.tipoMonitor === 'M3') {
      const m3 = monConfig.M3 ?? {};
      if (m3.promotorAtivo) {
        const slotPromo = await db.collection('slots')
          .where('cargo', '==', 'promotor')
          .where('cidade', '==', est.cidade)
          .where('status', 'in', ['aceito', 'em_andamento'])
          .limit(1).get();

        if (slotPromo.empty) {
          precisaTarefa = true;
          prioridade    = 3;
          descricao     = `👤 ${est.nome}: ponto M3 sem promotor ativo`;
          cargo         = 'promotor';
        }
      }
    }

    if (!precisaTarefa) continue;

    // Evita duplicata: verifica se já tem tarefa aberta para este ponto hoje
    const existente = await db.collection('tarefas')
      .where('estacao.id', '==', est.id)
      .where('status', 'in', ['pendente', 'aceita', 'em_andamento'])
      .where('criadaHoje', '==', hoje)
      .limit(1).get();

    if (!existente.empty) continue;

    await db.collection('tarefas').add({
      tipo:             est.tipoMonitor === 'M3' ? 'promo_abordagem' : 'rebalanceamento',
      titulo:           descricao,
      status:           'pendente',
      prioridade,
      cargo,
      cidade:           est.cidade ?? '',
      pais:             est.pais   ?? 'BR',
      slotId:           null,
      assigneeUid:      null,
      assigneeNome:     null,
      estacao: {
        id:       est.id,
        nome:     est.nome ?? est.codigo,
        endereco: est.endereco ?? '',
        lat:      est.lat,
        lng:      est.lng,
      },
      gojetParkingId:    parking.id,
      patinetesAtual:    patinetes,
      geradoAutomatico:  true,
      tipoMonitorOrigem: est.tipoMonitor,
      criadaHoje:        hoje,
      criadoEm:          admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm:      admin.firestore.FieldValue.serverTimestamp(),
    });

    criadas++;
  }

  if (criadas > 0) console.log(`[tarefasMonitor] ${criadas} tarefas criadas`);
}

export const gerarSlotsAgendado = onSchedule(
  { schedule: '0 21 * * *', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 120, region: 'southamerica-east1' },
  async () => {
    const cfgSnap = await db.collection('slot_config').doc('global').get();
    if (!cfgSnap.exists) { console.warn('[gerarSlots] sem config'); return; }
    const cfg = cfgSnap.data() as SlotConfigGlobal;
    const dados = await fetchGoJet();
    const statsZonas = dados ? calcularStatsZonas(dados.parkings) : {};
    await _gerarSlots(cfg, statsZonas);
  }
);

// ─── Core: gerar slots ────────────────────────────────────────────────────────

async function _gerarSlots(cfg: SlotConfigGlobal, statsZonas: Record<string, ZoneStats>) {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const dataStr = amanha.toISOString().slice(0, 10);

  const overridesSnap = await db.collection('slot_config').doc('overrides').get();
  const overrides: Record<string, any> = overridesSnap.exists ? overridesSnap.data()! : {};

  const turnoMap: Record<string, { inicio: string; fim: string }> = {
    T0: { inicio: '23:00', fim: '07:00' },
    T1: { inicio: '10:00', fim: '15:00' },
    T2: { inicio: '15:00', fim: '23:00' },
  };

  let totalGerados = 0;
  const erros: string[] = [];

  for (const zonaCfg of cfg.zonas) {
    if (!zonaCfg.ativo) continue;

    const chave = `${zonaCfg.zona}_${zonaCfg.turno}`;
    if (overrides[chave]?.ativo === false) continue;

    let vagas = overrides[chave]?.vagasBase ?? zonaCfg.vagasBase;

    // Multiplicadores baseados em dados GoJet ao vivo
    const snap = statsZonas[zonaCfg.zona];
    if (snap && cfg.multiplicadores) {
      const m = cfg.multiplicadores;
      if (snap.ociosidade > m.limiarOciosidade) vagas += m.ociosidadeAlta;
      if (snap.deficit    > m.limiarDeficit)    vagas += m.deficitAlto;
      if (zonaCfg.cargo === 'charger')           vagas += m.bateriasBaixa;
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
        await db.collection('slots').add({
          titulo:           `${zonaCfg.cargo === 'charger' ? 'Charger' : 'Scalt'} — ${zonaCfg.zona} ${zonaCfg.turno}`,
          cargo:            zonaCfg.cargo,
          cidade:           zonaCfg.cidade || cfg.cidade,
          pais:             cfg.pais,
          turnoInicio:      inicio,
          turnoFim:         fim,
          dataSlot:         `${dd}/${mm}/${yyyy}`,
          turno:            zonaCfg.turno,
          tipo:             zonaCfg.cargo === 'charger' ? 'Charger' : 'Scalt',
          status:           'aberto',
          qtdPessoas:       1,
          criadoPor:        'scheduler',
          aceitoPor:        null,
          tarefasIds:       [],
          geradoAutomatico: true,
          zonaOrigem:       zonaCfg.zona,
          criadoEm:         admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm:     admin.firestore.FieldValue.serverTimestamp(),
        });
        totalGerados++;
      }
    } catch (e: any) {
      erros.push(`${chave}: ${e.message}`);
    }
  }

  await db.collection('logs_automacao').add({
    tipo:         'geracao_slots',
    data:         dataStr,
    totalGerados,
    erros,
    criadoEm:     admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[gerarSlots] ${totalGerados} slots gerados para ${dataStr}`);
}

// ─── FUNCTION: limpezaSnapshots (todo dia 3h) ─────────────────────────────────

export const limpezaSnapshots = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'America/Sao_Paulo',
    region:   'southamerica-east1',
  },
  async () => {
    const limite = new Date();
    limite.setDate(limite.getDate() - 7);

    const snap = await db.collection('gojet_snapshots')
      .where('criadoEm', '<', limite)
      .limit(500)
      .get();

    const batch = db.batch();
    snap.docs.forEach(d => {
      if (d.id !== 'latest') batch.delete(d.ref);
    });
    await batch.commit();
    console.log(`[limpeza] ${snap.size} snapshots antigos removidos`);
  }
);

// ─── FUNCTION: gerarSlotsAutomatico (webhook manual/seguro) ──────────────────

export const gerarSlotsAutomatico = onRequest(async (req, res) => {
  const secret = req.headers['x-n8n-secret'];
  const cfgSnap = await db.collection('slot_config').doc('global').get();
  if (!cfgSnap.exists) { res.status(400).json({ erro: 'sem config' }); return; }
  const cfg = cfgSnap.data() as SlotConfigGlobal;
  if (secret !== cfg.webhookSecret) { res.status(401).json({ erro: 'não autorizado' }); return; }

  const dados = await fetchGoJet();
  const statsZonas = dados ? calcularStatsZonas(dados.parkings) : {};
  await _gerarSlots(cfg, statsZonas);
  res.json({ sucesso: true });
});

// ─── FUNCTION: gerarTarefasMonitor (webhook manual/teste) ────────────────────

export const gerarTarefasMonitor = onRequest(async (req, res) => {
  const secret = req.headers['x-n8n-secret'];
  const cfgSnap = await db.collection('slot_config').doc('global').get();
  if (!cfgSnap.exists) { res.status(400).json({ erro: 'sem config' }); return; }
  const cfg = cfgSnap.data() as any;
  if (secret !== cfg.webhookSecret) { res.status(401).json({ erro: 'não autorizado' }); return; }

  const dados = await fetchGoJet();
  if (!dados) { res.status(500).json({ erro: 'GoJet indisponível' }); return; }

  const turno = turnoAtual();
  await _gerarTarefasMonitor(dados.parkings, turno);
  res.json({ sucesso: true, turno });
});
