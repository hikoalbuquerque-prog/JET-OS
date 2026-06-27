// frontend/src/components/EventoGoJetPanel.tsx
// Painel para planejar pontos GoJet temporários vinculados a eventos.
// Cada evento ativo pode ter um ponto M3 temporário que aparece no mapa GoJet
// com badge "EV" e pulse, tratado como monitor M3 dentro da lógica de tarefas.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import L from 'leaflet';
import { db } from '../lib/firebase';
import { supabase } from '../lib/supabase';

// Flag dual-run: localStorage.setItem('jet_estacoes_provider','supabase')
const estacoesProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_estacoes_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch {}
  return (import.meta.env.VITE_ESTACOES_PROVIDER as string) === 'supabase';
};

const T = {
  statusPlanejado: { pt: 'Planejado', en: 'Planned', es: 'Planeado', ru: 'Запланировано' },
  statusAtivo:     { pt: 'Ao Vivo', en: 'Live', es: 'En Vivo', ru: 'В эфире' },
  statusEncerrado: { pt: 'Encerrado', en: 'Ended', es: 'Finalizado', ru: 'Завершено' },
  encerrado:       { pt: 'Encerrado', en: 'Ended', es: 'Finalizado', ru: 'Завершено' },
  eventoSemNome:   { pt: 'Evento sem nome', en: 'Unnamed event', es: 'Evento sin nombre', ru: 'Событие без названия' },
  erroCarregar:    { pt: 'Erro ao carregar eventos', en: 'Error loading events', es: 'Error al cargar eventos', ru: 'Ошибка загрузки событий' },
  coordsInvalidas: { pt: 'Coordenadas inválidas', en: 'Invalid coordinates', es: 'Coordenadas inválidas', ru: 'Неверные координаты' },
  erroSalvar:      { pt: 'Erro ao salvar ponto', en: 'Error saving point', es: 'Error al guardar punto', ru: 'Ошибка сохранения точки' },
  erroRemover:     { pt: 'Erro ao remover ponto', en: 'Error removing point', es: 'Error al eliminar punto', ru: 'Ошибка удаления точки' },
  titulo:          { pt: '📅 Eventos GoJet', en: '📅 GoJet Events', es: '📅 Eventos GoJet', ru: '📅 События GoJet' },
  subtitulo:       { pt: 'pontos M3 temporários', en: 'temporary M3 points', es: 'puntos M3 temporales', ru: 'временные точки M3' },
  bannerPick:      { pt: '👆 Clique no mapa para definir a localização do ponto', en: '👆 Click on the map to set the point location', es: '👆 Haz clic en el mapa para definir la ubicación del punto', ru: '👆 Нажмите на карту, чтобы задать расположение точки' },
  carregando:      { pt: 'Carregando eventos...', en: 'Loading events...', es: 'Cargando eventos...', ru: 'Загрузка событий...' },
  nenhumEvento:    { pt: 'Nenhum evento próximo ou ativo em', en: 'No upcoming or active event in', es: 'Ningún evento próximo o activo en', ru: 'Нет предстоящих или активных событий в' },
  crieEventosA:    { pt: 'Crie eventos na coleção', en: 'Create events in the collection', es: 'Crea eventos en la colección', ru: 'Создайте события в коллекции' },
  crieEventosB:    { pt: 'com campo', en: 'with field', es: 'con campo', ru: 'с полем' },
  restantes:       { pt: 'restantes', en: 'remaining', es: 'restantes', ru: 'осталось' },
  comecaEm:        { pt: 'começa em', en: 'starts in', es: 'comienza en', ru: 'начинается через' },
  pontoConfigA:    { pt: 'EV ✓ Ponto configurado ·', en: 'EV ✓ Point configured ·', es: 'EV ✓ Punto configurado ·', ru: 'EV ✓ Точка настроена ·' },
  bikes:           { pt: 'bikes', en: 'bikes', es: 'bicis', ru: 'велосипедов' },
  semPonto:        { pt: 'Sem ponto GoJet configurado', en: 'No GoJet point configured', es: 'Sin punto GoJet configurado', ru: 'Точка GoJet не настроена' },
  editar:          { pt: 'Editar', en: 'Edit', es: 'Editar', ru: 'Изменить' },
  remover:         { pt: 'Remover', en: 'Remove', es: 'Eliminar', ru: 'Удалить' },
  editarPonto:     { pt: '✏️ Editar ponto GoJet', en: '✏️ Edit GoJet point', es: '✏️ Editar punto GoJet', ru: '✏️ Изменить точку GoJet' },
  adicionarPonto:  { pt: '+ Adicionar ponto GoJet (M3 temp)', en: '+ Add GoJet point (temp M3)', es: '+ Agregar punto GoJet (M3 temp)', ru: '+ Добавить точку GoJet (врем. M3)' },
  localizacao:     { pt: '📍 Localização do ponto GoJet', en: '📍 GoJet point location', es: '📍 Ubicación del punto GoJet', ru: '📍 Расположение точки GoJet' },
  cliquePara:      { pt: '👆 Clique no mapa para selecionar', en: '👆 Click on the map to select', es: '👆 Haz clic en el mapa para seleccionar', ru: '👆 Нажмите на карту, чтобы выбрать' },
  parkingProximo:  { pt: '💡 Parking GoJet mais próximo:', en: '💡 Nearest GoJet parking:', es: '💡 Parking GoJet más cercano:', ru: '💡 Ближайший паркинг GoJet:' },
  aDist:           { pt: 'a', en: 'at', es: 'a', ru: 'на расстоянии' },
  usar:            { pt: 'Usar', en: 'Use', es: 'Usar', ru: 'Использовать' },
  latitude:        { pt: 'Latitude', en: 'Latitude', es: 'Latitud', ru: 'Широта' },
  longitude:       { pt: 'Longitude', en: 'Longitude', es: 'Longitud', ru: 'Долгота' },
  targetBikes:     { pt: 'Target de bikes', en: 'Bike target', es: 'Meta de bicis', ru: 'Целевое число велосипедов' },
  raio:            { pt: 'Raio (m)', en: 'Radius (m)', es: 'Radio (m)', ru: 'Радиус (м)' },
  cancelar:        { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  salvando:        { pt: '⏳ Salvando...', en: '⏳ Saving...', es: '⏳ Guardando...', ru: '⏳ Сохранение...' },
  salvarPonto:     { pt: '✓ Salvar ponto GoJet', en: '✓ Save GoJet point', es: '✓ Guardar punto GoJet', ru: '✓ Сохранить точку GoJet' },
  rodape:          { pt: 'Pontos EV são M3 temporários · expiram automaticamente ao fim do evento', en: 'EV points are temporary M3 · they expire automatically when the event ends', es: 'Los puntos EV son M3 temporales · expiran automáticamente al finalizar el evento', ru: 'Точки EV — это временные M3 · истекают автоматически по окончании события' },
};

interface Evento {
  id: string;
  nome: string;
  cidade: string;
  estado?: string;
  pais?: string;
  inicio: Date;
  fim: Date;
  status: 'planejado' | 'ativo' | 'encerrado';
  // GoJet integration
  pontoGoJetEstacaoId?: string;
  pontoGoJetLat?: number;
  pontoGoJetLng?: number;
  pontoGoJetTarget?: number;
  pontoGoJetRaio?: number;
}

interface GoJetParking {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface Props {
  cidade: string;
  parkings: GoJetParking[];
  mapa: L.Map | null;
  onFechar: () => void;
  onEstacaoCriada: () => void;
}

const STATUS_COR: Record<string, string> = {
  planejado: '#3b82f6',
  ativo:     '#22c55e',
  encerrado: '#6b7280',
};

function fmtData(d: Date): string {
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function tempoRestante(fim: Date, encerradoLabel: string): string {
  const diff = fim.getTime() - Date.now();
  if (diff <= 0) return encerradoLabel;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

// Encontra o parking GoJet mais próximo de um ponto (para sugestão)
function parkingMaisProximo(lat: number, lng: number, parkings: GoJetParking[]): GoJetParking | null {
  let best: GoJetParking | null = null;
  let bestDist = Infinity;
  for (const p of parkings) {
    const dLat = (p.latitude - lat) * 111320;
    const dLng = (p.longitude - lng) * 111320 * Math.cos(lat * Math.PI / 180);
    const d = Math.sqrt(dLat * dLat + dLng * dLng);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

export function EventoGoJetPanel({ cidade, parkings, mapa, onFechar, onEstacaoCriada }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

  const STATUS_LABEL: Record<string, string> = {
    planejado: pick(T.statusPlanejado),
    ativo:     pick(T.statusAtivo),
    encerrado: pick(T.statusEncerrado),
  };

  const [eventos, setEventos]     = useState<Evento[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando]   = useState(false);
  const [erro, setErro]           = useState<string | null>(null);

  // Form de ponto GoJet
  const [formLat,    setFormLat]    = useState('');
  const [formLng,    setFormLng]    = useState('');
  const [formTarget, setFormTarget] = useState('10');
  const [formRaio,   setFormRaio]   = useState('150');
  const [pickingMap, setPickingMap] = useState(false);

  // Carrega eventos próximos/ativos para a cidade
  useEffect(() => {
    setLoading(true);

    const processarLista = (raw: any[], idKey: string) => {
      const now = new Date();
      const lista: Evento[] = raw
        .map((x: any) => {
          const inicio = x.inicio instanceof Date ? x.inicio
            : (x.inicio as Timestamp)?.toDate?.() ?? new Date(x.inicio ?? 0);
          const fim = x.fim instanceof Date ? x.fim
            : (x.fim as Timestamp)?.toDate?.() ?? new Date(x.fim ?? 0);
          const status: Evento['status'] = fim < now ? 'encerrado' : inicio <= now ? 'ativo' : 'planejado';
          return {
            id: x[idKey] ?? x.id,
            nome: x.nome ?? x.name ?? pick(T.eventoSemNome),
            cidade: x.cidade, estado: x.estado, pais: x.pais ?? 'BR',
            inicio, fim, status,
            pontoGoJetEstacaoId: x.pontoGoJetEstacaoId ?? x.ponto_gojet_estacao_id,
            pontoGoJetLat:       x.pontoGoJetLat       ?? x.ponto_gojet_lat,
            pontoGoJetLng:       x.pontoGoJetLng       ?? x.ponto_gojet_lng,
            pontoGoJetTarget:    x.pontoGoJetTarget    ?? x.ponto_gojet_target,
            pontoGoJetRaio:      x.pontoGoJetRaio      ?? x.ponto_gojet_raio,
          };
        })
        .filter(e => e.status !== 'encerrado' || Date.now() - e.fim.getTime() < 2 * 3600000)
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      setEventos(lista);
    };

    if (estacoesProviderSupabase()) {
      // ── Supabase ──
      (async () => {
        try {
          const { data, error } = await supabase
            .from('eventos')
            .select('*')
            .eq('cidade', cidade);
          if (error) throw error;
          processarLista(
            (data ?? []).map((r: any) => ({
              ...r,
              inicio: r.inicio ? new Date(r.inicio) : new Date(0),
              fim: r.fim ? new Date(r.fim) : new Date(0),
            })),
            'firebase_id',
          );
        } catch {
          setErro(pick(T.erroCarregar));
        } finally {
          setLoading(false);
        }
      })();
    } else {
      // ── Firestore (fallback) ──
      getDocs(query(
        collection(db, 'eventos'),
        where('cidade', '==', cidade),
      )).then(snap => {
        processarLista(
          snap.docs.map(d => ({ ...d.data(), _docId: d.id })),
          '_docId',
        );
      }).catch(() => setErro(pick(T.erroCarregar)))
        .finally(() => setLoading(false));
    }
  }, [cidade]);

  // Pick-from-map: click no mapa para definir coordenadas
  useEffect(() => {
    if (!pickingMap || !mapa) return;
    const handler = (e: L.LeafletMouseEvent) => {
      setFormLat(e.latlng.lat.toFixed(6));
      setFormLng(e.latlng.lng.toFixed(6));
      setPickingMap(false);
    };
    mapa.once('click', handler);
    return () => { mapa.off('click', handler); };
  }, [pickingMap, mapa]);

  function abrirForm(ev: Evento) {
    setEditandoId(ev.id);
    setFormLat(ev.pontoGoJetLat?.toFixed(6) ?? '');
    setFormLng(ev.pontoGoJetLng?.toFixed(6) ?? '');
    setFormTarget(String(ev.pontoGoJetTarget ?? 10));
    setFormRaio(String(ev.pontoGoJetRaio ?? 150));
    setErro(null);
  }

  async function salvarPonto(ev: Evento) {
    const lat = parseFloat(formLat);
    const lng = parseFloat(formLng);
    const target = parseInt(formTarget, 10);
    const raio   = parseInt(formRaio, 10);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setErro(pick(T.coordsInvalidas)); return;
    }

    setSalvando(true); setErro(null);
    try {
      // Se já existia estação temporária, deleta a anterior
      if (ev.pontoGoJetEstacaoId) {
        await deleteDoc(doc(db, 'estacoes', ev.pontoGoJetEstacaoId)).catch(() => {});
      }

      // Cria nova estação temporária
      const estacaoRef = await addDoc(collection(db, 'estacoes'), {
        tipoMonitor: 'M3',
        temporario: true,
        eventoId:   ev.id,
        eventoNome: ev.nome,
        eventoFim:  Timestamp.fromDate(ev.fim),
        lat, lng,
        targetBikes: target,
        raio,
        cidade,
        nome: ev.nome,
        ativo: true,
        criadoEm: serverTimestamp(),
      });

      // Atualiza o documento do evento com referência ao ponto
      await updateDoc(doc(db, 'eventos', ev.id), {
        pontoGoJetEstacaoId: estacaoRef.id,
        pontoGoJetLat: lat,
        pontoGoJetLng: lng,
        pontoGoJetTarget: target,
        pontoGoJetRaio: raio,
        atualizadoEm: serverTimestamp(),
      });

      // Atualiza estado local
      setEventos(prev => prev.map(e => e.id === ev.id
        ? { ...e, pontoGoJetEstacaoId: estacaoRef.id, pontoGoJetLat: lat, pontoGoJetLng: lng, pontoGoJetTarget: target, pontoGoJetRaio: raio }
        : e
      ));
      setEditandoId(null);
      onEstacaoCriada();

      // Centraliza mapa no ponto criado
      if (mapa) mapa.flyTo([lat, lng], Math.max(mapa.getZoom(), 16));

    } catch (e: any) {
      setErro(e.message ?? pick(T.erroSalvar));
    } finally {
      setSalvando(false);
    }
  }

  async function removerPonto(ev: Evento) {
    if (!ev.pontoGoJetEstacaoId) return;
    setSalvando(true);
    try {
      await deleteDoc(doc(db, 'estacoes', ev.pontoGoJetEstacaoId));
      await updateDoc(doc(db, 'eventos', ev.id), {
        pontoGoJetEstacaoId: null,
        pontoGoJetLat: null, pontoGoJetLng: null,
        pontoGoJetTarget: null, pontoGoJetRaio: null,
      });
      setEventos(prev => prev.map(e => e.id === ev.id
        ? { ...e, pontoGoJetEstacaoId: undefined, pontoGoJetLat: undefined, pontoGoJetLng: undefined }
        : e
      ));
      onEstacaoCriada();
    } catch (e: any) {
      setErro(e.message ?? pick(T.erroRemover));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', right: 12, top: 80, bottom: 80, zIndex: 1200,
      width: 320, background: '#0d1218',
      border: '1px solid rgba(217,119,6,.4)',
      borderRadius: 14, display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 32px rgba(0,0,0,.7)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.08)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(217,119,6,.08)',
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#fbbf24' }}>{pick(T.titulo)}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 1 }}>{cidade} — {pick(T.subtitulo)}</div>
        </div>
        <button onClick={onFechar}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 16, cursor: 'pointer' }}>✕</button>
      </div>

      {/* Pick-from-map banner */}
      {pickingMap && (
        <div style={{
          padding: '8px 16px', background: 'rgba(251,191,36,.15)',
          border: '1px solid rgba(251,191,36,.3)', margin: 8, borderRadius: 8,
          fontSize: 11, color: '#fbbf24', fontWeight: 700, textAlign: 'center',
        }}>
          {pick(T.bannerPick)}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div style={{ margin: '8px 12px 0', padding: '6px 10px', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, fontSize: 10, color: '#ef4444' }}>
          ⚠️ {erro}
        </div>
      )}

      {/* Lista de eventos */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,.3)', fontSize: 12 }}>
            {pick(T.carregando)}
          </div>
        )}

        {!loading && eventos.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,.3)', fontSize: 12 }}>
            {pick(T.nenhumEvento)} {cidade}.
            <br /><br />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.2)' }}>
              {pick(T.crieEventosA)} <code style={{ color: '#a78bfa' }}>eventos</code> {pick(T.crieEventosB)} <code style={{ color: '#a78bfa' }}>cidade</code>.
            </span>
          </div>
        )}

        {eventos.map(ev => {
          const temPonto  = !!ev.pontoGoJetEstacaoId;
          const isEditando = editandoId === ev.id;
          const corStatus  = STATUS_COR[ev.status];
          const encerrado  = ev.status === 'encerrado';

          return (
            <div key={ev.id} style={{
              background: 'rgba(255,255,255,.04)', borderRadius: 10,
              border: `1px solid ${temPonto ? 'rgba(217,119,6,.4)' : 'rgba(255,255,255,.08)'}`,
              overflow: 'hidden',
            }}>
              {/* Header do evento */}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#f0f4ff', flex: 1, marginRight: 8 }}>{ev.nome}</div>
                  <span style={{
                    background: `${corStatus}22`, color: corStatus,
                    borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700, flexShrink: 0,
                  }}>{STATUS_LABEL[ev.status]}</span>
                </div>

                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>
                  {fmtData(ev.inicio)} → {fmtData(ev.fim)}
                </div>

                {ev.status === 'ativo' && (
                  <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>
                    ⏱ {tempoRestante(ev.fim, pick(T.encerrado))} {pick(T.restantes)}
                  </div>
                )}

                {ev.status === 'planejado' && (
                  <div style={{ fontSize: 10, color: '#60a5fa' }}>
                    🕐 {pick(T.comecaEm)} {tempoRestante(ev.inicio, pick(T.encerrado))}
                  </div>
                )}

                {/* Status do ponto GoJet */}
                <div style={{
                  marginTop: 8, padding: '5px 8px', borderRadius: 6,
                  background: temPonto ? 'rgba(217,119,6,.1)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${temPonto ? 'rgba(217,119,6,.25)' : 'rgba(255,255,255,.06)'}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ fontSize: 10 }}>
                    {temPonto
                      ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>{pick(T.pontoConfigA)} {ev.pontoGoJetTarget} {pick(T.bikes)}</span>
                      : <span style={{ color: 'rgba(255,255,255,.3)' }}>{pick(T.semPonto)}</span>}
                  </div>
                  {temPonto && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!encerrado && (
                        <button
                          onClick={() => abrirForm(ev)}
                          style={{ fontSize: 8, padding: '2px 5px', borderRadius: 3, border: 'none', background: 'rgba(217,119,6,.3)', color: '#fbbf24', cursor: 'pointer', fontWeight: 700 }}>
                          {pick(T.editar)}
                        </button>
                      )}
                      <button
                        onClick={() => removerPonto(ev)}
                        disabled={salvando}
                        style={{ fontSize: 8, padding: '2px 5px', borderRadius: 3, border: 'none', background: 'rgba(239,68,68,.2)', color: '#f87171', cursor: 'pointer', fontWeight: 700 }}>
                        {pick(T.remover)}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Botão configurar / form inline */}
              {!encerrado && (
                <>
                  {!isEditando && (
                    <button
                      onClick={() => abrirForm(ev)}
                      style={{
                        width: '100%', padding: '8px', border: 'none', borderTop: '1px solid rgba(255,255,255,.06)',
                        background: temPonto ? 'rgba(217,119,6,.08)' : 'rgba(16,185,129,.08)',
                        color: temPonto ? '#f59e0b' : '#10b981',
                        fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}>
                      {temPonto ? pick(T.editarPonto) : pick(T.adicionarPonto)}
                    </button>
                  )}

                  {isEditando && (
                    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.06)', background: 'rgba(0,0,0,.2)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>
                        {pick(T.localizacao)}
                      </div>

                      {/* Pick from map button */}
                      <button
                        onClick={() => { setPickingMap(true); }}
                        style={{
                          width: '100%', padding: '7px', borderRadius: 6, border: '1px dashed rgba(251,191,36,.4)',
                          background: 'rgba(251,191,36,.08)', color: '#fbbf24',
                          fontSize: 10, fontWeight: 700, cursor: 'pointer', marginBottom: 8,
                        }}>
                        {pick(T.cliquePara)}
                      </button>

                      {/* Sugestão: parking mais próximo */}
                      {formLat && formLng && (() => {
                        const lat = parseFloat(formLat);
                        const lng = parseFloat(formLng);
                        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                        const prox = parkingMaisProximo(lat, lng, parkings);
                        if (!prox) return null;
                        const dLat = (prox.latitude - lat) * 111320;
                        const dLng = (prox.longitude - lng) * 111320 * Math.cos(lat * Math.PI / 180);
                        const dist = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
                        return (
                          <div style={{
                            padding: '5px 8px', borderRadius: 5, background: 'rgba(59,130,246,.1)',
                            border: '1px solid rgba(59,130,246,.2)', marginBottom: 8, fontSize: 9, color: '#93c5fd',
                          }}>
                            {pick(T.parkingProximo)} <strong>{prox.name}</strong> {pick(T.aDist)} {dist}m
                            <button
                              onClick={() => { setFormLat(prox.latitude.toFixed(6)); setFormLng(prox.longitude.toFixed(6)); }}
                              style={{ marginLeft: 6, fontSize: 8, padding: '1px 5px', borderRadius: 3, border: 'none', background: 'rgba(59,130,246,.3)', color: '#93c5fd', cursor: 'pointer' }}>
                              {pick(T.usar)}
                            </button>
                          </div>
                        );
                      })()}

                      {/* Lat/Lng inputs */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                        <label style={{ fontSize: 9, color: 'rgba(255,255,255,.45)' }}>
                          {pick(T.latitude)}
                          <input type="number" step="any" value={formLat} onChange={e => setFormLat(e.target.value)}
                            style={{ display: 'block', width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#f0f4ff', fontSize: 11, marginTop: 2 }}
                            placeholder="-23.5613" />
                        </label>
                        <label style={{ fontSize: 9, color: 'rgba(255,255,255,.45)' }}>
                          {pick(T.longitude)}
                          <input type="number" step="any" value={formLng} onChange={e => setFormLng(e.target.value)}
                            style={{ display: 'block', width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#f0f4ff', fontSize: 11, marginTop: 2 }}
                            placeholder="-46.6543" />
                        </label>
                        <label style={{ fontSize: 9, color: 'rgba(255,255,255,.45)' }}>
                          {pick(T.targetBikes)}
                          <input type="number" min={1} max={200} value={formTarget} onChange={e => setFormTarget(e.target.value)}
                            style={{ display: 'block', width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#f0f4ff', fontSize: 11, marginTop: 2 }} />
                        </label>
                        <label style={{ fontSize: 9, color: 'rgba(255,255,255,.45)' }}>
                          {pick(T.raio)}
                          <input type="number" min={50} max={500} value={formRaio} onChange={e => setFormRaio(e.target.value)}
                            style={{ display: 'block', width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#f0f4ff', fontSize: 11, marginTop: 2 }} />
                        </label>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setEditandoId(null)}
                          style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: 'rgba(255,255,255,.4)', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}>
                          {pick(T.cancelar)}
                        </button>
                        <button
                          onClick={() => salvarPonto(ev)}
                          disabled={salvando}
                          style={{ flex: 2, padding: '7px', borderRadius: 6, border: 'none', background: 'rgba(217,119,6,.9)', color: '#0d0d1a', fontSize: 10, fontWeight: 800, cursor: salvando ? 'wait' : 'pointer' }}>
                          {salvando ? pick(T.salvando) : pick(T.salvarPonto)}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 9, color: 'rgba(255,255,255,.2)', textAlign: 'center' }}>
        {pick(T.rodape)}
      </div>
    </div>
  );
}
