// frontend/src/components/SlotsDashboard.tsx
// JET OS — Dashboard visual de slots (resumo estilo Telegram, UI rica)
// Auto-refresh 30s | Exporta texto para Telegram

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { supabase } from '../lib/supabase';
import { slotsProviderSupabase } from '../lib/slots-supabase';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Props {
  cidade: string;
  pais: string;
  usuario: { uid: string; nome: string; role: string };
  onEnviarTelegram?: (resumoTexto: string) => void;
}

interface SlotDoc {
  id: string;
  dataSlot: string;           // 'YYYY-MM-DD'
  horaIni: string;            // 'HH:MM'
  horaFim: string;
  cargo: string;              // 'scout'|'scalt'|'charger'
  turno: string;              // nome livre ou 'T1'|'T2'|'T0'
  status: string;
  motivoCancelamento?: string;
  cidade: string;
  vagas?: number;
}

type TipoCategoria = 'scout' | 'charger';

interface StatusCounts {
  iniciou: number;   // ✅
  pendente: number;  // ⏳
  faltou: number;    // ❌
  desistiu: number;  // ⛔
}

interface TurnoResumo {
  label: string;
  emoji: string;
  slots: number;
  vagas: number;
  iniciou: number;
  scout: StatusCounts & { slots: number; vagas: number };
  charger: StatusCounts & { slots: number; vagas: number };
}

interface DiaResumo {
  label: string;
  data: string;
  slots: number;
  vagas: number;
  counts: StatusCounts;
  scoutCounts: StatusCounts & { slots: number; vagas: number };
  chargerCounts: StatusCounts & { slots: number; vagas: number };
  turnos: TurnoResumo[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function classifyTurno(horaIni: string): { label: string; emoji: string; key: string } {
  const h = parseInt(horaIni.split(':')[0] ?? '0', 10);
  if (h >= 10 && h < 15) return { label: 'T1', emoji: '☀️', key: 'T1' };
  if (h >= 15 && h < 23) return { label: 'T2', emoji: '🌆', key: 'T2' };
  if (h >= 23 || h < 7)  return { label: 'T0', emoji: '🌙', key: 'T0' };
  return { label: 'Custom', emoji: '⏰', key: 'Custom' };
}

function isScout(cargo: string): boolean {
  return cargo === 'scout' || cargo === 'scalt';
}

function getStatusCounts(slots: SlotDoc[]): StatusCounts {
  let iniciou = 0, pendente = 0, faltou = 0, desistiu = 0;
  for (const s of slots) {
    if (s.status === 'em_andamento' || s.status === 'concluido') {
      iniciou++;
    } else if (s.status === 'aberto' || s.status === 'aceito' || s.status === 'a_caminho') {
      pendente++;
    } else if (s.status === 'cancelado') {
      const m = (s.motivoCancelamento ?? '').toLowerCase();
      if (m.includes('falt') || m.includes('no_show')) faltou++;
      else desistiu++;
    }
  }
  return { iniciou, pendente, faltou, desistiu };
}

function buildDiaResumo(label: string, data: string, slots: SlotDoc[]): DiaResumo {
  const vagas = slots.reduce((acc, s) => acc + (s.vagas ?? 1), 0);
  const counts = getStatusCounts(slots);

  const scoutSlots = slots.filter(s => isScout(s.cargo));
  const chargerSlots = slots.filter(s => !isScout(s.cargo));

  const scoutCounts = {
    ...getStatusCounts(scoutSlots),
    slots: scoutSlots.length,
    vagas: scoutSlots.reduce((a, s) => a + (s.vagas ?? 1), 0),
  };
  const chargerCounts = {
    ...getStatusCounts(chargerSlots),
    slots: chargerSlots.length,
    vagas: chargerSlots.reduce((a, s) => a + (s.vagas ?? 1), 0),
  };

  // Agrupar por turno
  const turnoMap = new Map<string, { info: ReturnType<typeof classifyTurno>; list: SlotDoc[] }>();
  for (const s of slots) {
    const info = classifyTurno(s.horaIni);
    const key = s.turno || info.key;
    if (!turnoMap.has(key)) turnoMap.set(key, { info, list: [] });
    turnoMap.get(key)!.list.push(s);
  }

  const turnoOrder = ['T1', 'T2', 'T0'];
  const turnosSorted = [...turnoMap.entries()].sort(([a], [b]) => {
    const ia = turnoOrder.indexOf(a);
    const ib = turnoOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const turnos: TurnoResumo[] = turnosSorted.map(([key, { info, list }]) => {
    const tv = list.reduce((a, s) => a + (s.vagas ?? 1), 0);
    const tScout = list.filter(s => isScout(s.cargo));
    const tCharger = list.filter(s => !isScout(s.cargo));
    return {
      label: key,
      emoji: info.emoji,
      slots: list.length,
      vagas: tv,
      iniciou: getStatusCounts(list).iniciou,
      scout: { ...getStatusCounts(tScout), slots: tScout.length, vagas: tScout.reduce((a, s) => a + (s.vagas ?? 1), 0) },
      charger: { ...getStatusCounts(tCharger), slots: tCharger.length, vagas: tCharger.reduce((a, s) => a + (s.vagas ?? 1), 0) },
    };
  });

  return { label, data, slots: slots.length, vagas, counts, scoutCounts, chargerCounts, turnos };
}

// ─── Geração de texto Telegram ────────────────────────────────────────────────

function formatStatusLine(c: StatusCounts, showAll = false): string {
  const parts: string[] = [];
  if (c.iniciou > 0 || showAll) parts.push(`✅${c.iniciou}`);
  if (c.pendente > 0) parts.push(`⏳${c.pendente}`);
  if (c.faltou > 0) parts.push(`❌${c.faltou}`);
  if (c.desistiu > 0) parts.push(`⛔${c.desistiu}`);
  return parts.join(' · ');
}

function gerarTextoTelegram(cidade: string, hoje: DiaResumo, amanha: DiaResumo): string {
  const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const lines: string[] = [];

  lines.push(`📋 RESUMO DE SLOTS — ${cidade} · ${agora}`);

  function formatDia(d: DiaResumo) {
    lines.push(`📅 ${d.label.toUpperCase()} — ${d.data.split('-').reverse().join('/')} · ${d.slots} slots · ${d.vagas} vagas · ${d.counts.iniciou}/${d.slots}`);
    const statusLine = formatStatusLine(d.counts);
    if (statusLine) lines.push(`   ${statusLine}`);

    if (d.scoutCounts.slots > 0) {
      const sc = d.scoutCounts;
      lines.push(`   🛴 ${sc.slots} s · ${sc.vagas} v · ${sc.iniciou}/${sc.slots} · ${formatStatusLine(sc)}`);
    }
    if (d.chargerCounts.slots > 0) {
      const ch = d.chargerCounts;
      lines.push(`   🔋 ${ch.slots} s · ${ch.vagas} v · ${ch.iniciou}/${ch.slots} · ${formatStatusLine(ch)}`);
    }

    for (const t of d.turnos) {
      lines.push(`   ${t.emoji} ${t.label}: ${t.slots} slots · ${t.vagas} v · ✅${t.iniciou}`);
      if (t.scout.slots > 0 && t.charger.slots > 0) {
        lines.push(`      🛴 ${t.scout.slots}s  🔋 ${t.charger.slots}s`);
      }
    }
  }

  formatDia(hoje);
  lines.push('');
  formatDia(amanha);

  return lines.join('\n');
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = {
  container: {
    background: '#0a0f1a',
    color: '#e2e8f0',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    minHeight: '100%',
    padding: '16px',
    fontSize: '13px',
  } as React.CSSProperties,
  header: {
    background: 'linear-gradient(135deg, #1a2035 0%, #0d1526 100%)',
    borderRadius: '12px',
    padding: '14px 18px',
    marginBottom: '12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: '1px solid #1e2d45',
  } as React.CSSProperties,
  card: {
    background: 'linear-gradient(135deg, #111827 0%, #0d1526 100%)',
    borderRadius: '10px',
    padding: '14px',
    marginBottom: '10px',
    border: '1px solid #1e2d45',
  } as React.CSSProperties,
  diaLabel: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#60a5fa',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
  },
  totalRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    marginBottom: '8px',
    alignItems: 'center',
  },
  badge: (color: string) => ({
    background: color,
    borderRadius: '6px',
    padding: '2px 8px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#fff',
    whiteSpace: 'nowrap' as const,
  }),
  pill: {
    background: '#1e2d45',
    borderRadius: '6px',
    padding: '2px 8px',
    fontSize: '12px',
    color: '#94a3b8',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  typeRow: {
    background: '#0d1a2d',
    borderRadius: '8px',
    padding: '8px 10px',
    marginBottom: '6px',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
    alignItems: 'center',
    fontSize: '12px',
  } as React.CSSProperties,
  turnoBlock: {
    background: '#0a1528',
    borderRadius: '8px',
    padding: '8px 10px',
    marginBottom: '5px',
    border: '1px solid #1a2840',
  } as React.CSSProperties,
  turnoHeader: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    marginBottom: '4px',
  } as React.CSSProperties,
  legend: {
    marginTop: '12px',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap' as const,
    fontSize: '11px',
    color: '#64748b',
  } as React.CSSProperties,
  btn: {
    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    border: 'none',
    color: '#fff',
    borderRadius: '8px',
    padding: '7px 14px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
  } as React.CSSProperties,
  spinner: {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    border: '2px solid #334155',
    borderTopColor: '#60a5fa',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  } as React.CSSProperties,
};

// ─── Sub-componente: linha de status ──────────────────────────────────────────

function StatusPills({ c }: { c: StatusCounts }) {
  return (
    <span style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}>
      {c.iniciou > 0 && <span style={S.badge('#16a34a')}>✅ {c.iniciou}</span>}
      {c.pendente > 0 && <span style={S.badge('#b45309')}>⏳ {c.pendente}</span>}
      {c.faltou > 0   && <span style={S.badge('#dc2626')}>❌ {c.faltou}</span>}
      {c.desistiu > 0 && <span style={S.badge('#7c3aed')}>⛔ {c.desistiu}</span>}
    </span>
  );
}

// ─── Sub-componente: bloco de dia ─────────────────────────────────────────────

function DiaCard({ resumo, isToday }: { resumo: DiaResumo; isToday: boolean }) {
  const pct = resumo.slots > 0 ? Math.round((resumo.counts.iniciou / resumo.slots) * 100) : 0;
  return (
    <div style={S.card}>
      <div style={S.diaLabel}>
        📅 {resumo.label} — {resumo.data.split('-').reverse().join('/')}
      </div>
      <div style={S.totalRow}>
        <span style={{ fontWeight: 700, fontSize: '14px', color: '#f1f5f9' }}>
          {resumo.counts.iniciou}/{resumo.slots}
        </span>
        <span style={S.pill}>{resumo.slots} slots</span>
        <span style={S.pill}>{resumo.vagas} vagas</span>
        <span style={S.badge(pct >= 80 ? '#15803d' : pct >= 50 ? '#b45309' : '#991b1b')}>{pct}%</span>
        <StatusPills c={resumo.counts} />
      </div>

      {resumo.scoutCounts.slots > 0 && (
        <div style={S.typeRow}>
          <span>🛴 Scout</span>
          <span style={S.pill}>{resumo.scoutCounts.slots} s · {resumo.scoutCounts.vagas} v</span>
          <span style={{ color: '#e2e8f0' }}>{resumo.scoutCounts.iniciou}/{resumo.scoutCounts.slots}</span>
          <StatusPills c={resumo.scoutCounts} />
        </div>
      )}
      {resumo.chargerCounts.slots > 0 && (
        <div style={S.typeRow}>
          <span>🔋 Charger</span>
          <span style={S.pill}>{resumo.chargerCounts.slots} s · {resumo.chargerCounts.vagas} v</span>
          <span style={{ color: '#e2e8f0' }}>{resumo.chargerCounts.iniciou}/{resumo.chargerCounts.slots}</span>
          <StatusPills c={resumo.chargerCounts} />
        </div>
      )}

      {resumo.turnos.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '11px', color: '#475569', marginBottom: '5px', fontWeight: 600 }}>
            POR TURNO
          </div>
          {resumo.turnos.map(t => (
            <div key={t.label} style={S.turnoBlock}>
              <div style={S.turnoHeader}>
                <span style={{ fontWeight: 700, color: '#93c5fd' }}>{t.emoji} {t.label}</span>
                <span style={S.pill}>{t.slots} slots</span>
                <span style={S.pill}>{t.vagas} v</span>
                <span style={{ color: '#e2e8f0' }}>✅ {t.iniciou}</span>
              </div>
              {(t.scout.slots > 0 || t.charger.slots > 0) && (
                <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#94a3b8' }}>
                  {t.scout.slots > 0 && <span>🛴 {t.scout.slots}s <StatusPills c={t.scout} /></span>}
                  {t.charger.slots > 0 && <span>🔋 {t.charger.slots}s <StatusPills c={t.charger} /></span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function SlotsDashboard({ cidade, pais, usuario, onEnviarTelegram }: Props) {
  const { t } = useTranslation();
  const [hoje, setHoje] = useState<DiaResumo | null>(null);
  const [amanha, setAmanha] = useState<DiaResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSlots = useCallback(async () => {
    try {
      setErro(null);
      const now = new Date();
      const d0 = toDateStr(now);
      const d1 = toDateStr(new Date(now.getTime() + 86400000));

      let docs: SlotDoc[];

      if (slotsProviderSupabase()) {
        // ── Supabase ──
        const { data, error } = await supabase
          .from('slots')
          .select('*')
          .eq('cidade', cidade);
        if (error) throw error;
        docs = (data ?? []).map((r: any) => {
          const c = r.config ?? {};
          const inicio = r.inicio ?? '';
          const dataSlot = typeof inicio === 'string' ? inicio.slice(0, 10) : '';
          const horaIni = typeof inicio === 'string' ? inicio.slice(11, 16) : '';
          const fim = r.fim ?? '';
          const horaFim = typeof fim === 'string' ? fim.slice(11, 16) : '';
          return {
            id: r.id, dataSlot, horaIni, horaFim,
            cargo: r.tipo ?? c.cargo ?? 'scalt',
            turno: c.turno ?? '',
            status: r.status ?? 'aberto',
            motivoCancelamento: c.motivo_cancelamento ?? undefined,
            cidade: r.cidade,
            vagas: r.vagas ?? 1,
          };
        });
      } else {
        // ── Firestore (fallback) ──
        const q = query(
          collection(db, 'slots'),
          where('cidade', '==', cidade),
        );
        const snap = await getDocs(q);
        docs = snap.docs.map(d => {
          const raw = d.data();
          const inicio = raw.turnoInicio ?? '';
          const dataSlot = inicio.slice(0, 10);
          const horaIni = inicio.slice(11, 16);
          const fim = raw.turnoFim ?? '';
          const horaFim = fim.slice(11, 16);
          return {
            id: d.id, dataSlot, horaIni, horaFim,
            cargo: raw.cargo ?? 'scalt', turno: raw.turno ?? '',
            status: raw.status ?? 'aberto',
            motivoCancelamento: raw.motivoCancelamento ?? undefined,
            cidade: raw.cidade, vagas: raw.vagas ?? 1,
          };
        });
      }

      const slotsHoje = docs.filter(s => s.dataSlot === d0);
      const slotsAmanha = docs.filter(s => s.dataSlot === d1);

      const diaHoje = new Date().toLocaleDateString('pt-BR', { weekday: 'short' });
      const diaAmanha = new Date(now.getTime() + 86400000).toLocaleDateString('pt-BR', { weekday: 'short' });

      setHoje(buildDiaResumo(`Hoje (${diaHoje})`, d0, slotsHoje));
      setAmanha(buildDiaResumo(`Amanhã (${diaAmanha})`, d1, slotsAmanha));
      setUltimaAtualizacao(new Date());
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao carregar slots');
    } finally {
      setLoading(false);
    }
  }, [cidade]);

  useEffect(() => {
    fetchSlots();
    intervalRef.current = setInterval(fetchSlots, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchSlots]);

  const handleEnviarTelegram = () => {
    if (!hoje || !amanha || !onEnviarTelegram) return;
    const texto = gerarTextoTelegram(cidade, hoje, amanha);
    onEnviarTelegram(texto);
  };

  const agora = ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={S.container}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={S.header}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#f1f5f9' }}>
            📋 Resumo de Slots
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {cidade} · {pais} · {agora}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {loading && <div style={S.spinner} />}
          <button style={S.btn} onClick={fetchSlots} title={t('form.refresh')}>⟳</button>
          {onEnviarTelegram && (
            <button style={S.btn} onClick={handleEnviarTelegram} disabled={!hoje || !amanha}>
              📤 Telegram
            </button>
          )}
        </div>
      </div>

      {erro && (
        <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', color: '#fca5a5', fontSize: '12px' }}>
          ⚠️ {erro}
        </div>
      )}

      {loading && !hoje ? (
        <div style={{ textAlign: 'center', color: '#475569', padding: '40px' }}>
          <div style={{ ...S.spinner, margin: '0 auto 8px', width: '24px', height: '24px', borderWidth: '3px' }} />
          Carregando slots...
        </div>
      ) : (
        <>
          {hoje && <DiaCard resumo={hoje} isToday />}
          {amanha && <DiaCard resumo={amanha} isToday={false} />}
        </>
      )}

      <div style={S.legend}>
        <span>✅ Iniciou</span>
        <span>⏳ Pendente</span>
        <span>❌ Faltou</span>
        <span>⛔ Desistiu</span>
        <span>🛴 Scout/Scalt</span>
        <span>🔋 Charger</span>
        <span>☀️ T1 10–15h</span>
        <span>🌆 T2 15–23h</span>
        <span>🌙 T0 23–07h</span>
      </div>
    </div>
  );
}
