// frontend/src/components/LiveTrackingMap.tsx — JET OS V2
// Mapa ao vivo de prestadores de campo — dots coloridos, tooltip, histórico de rota

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, where, onSnapshot, orderBy, limit,
  Timestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { gpsProviderSupabase, fetchGpsAtual } from '../lib/gps-supabase';
import L from 'leaflet';
import GpsRotaPanel from './GpsRotaPanel';

// i18n — objeto de traduções (pt fonte fiel)
const TR = {
  campoAoVivo:   { pt: 'Campo ao vivo', en: 'Live field', es: 'Campo en vivo', ru: 'Поле в реальном времени' },
  online:        { pt: 'Online', en: 'Online', es: 'En línea', ru: 'В сети' },
  idle:          { pt: 'Idle', en: 'Idle', es: 'Inactivo', ru: 'Простой' },
  semGpsCurto:   { pt: 'S/ GPS', en: 'No GPS', es: 'Sin GPS', ru: 'Без GPS' },
  todos:         { pt: 'Todos', en: 'All', es: 'Todos', ru: 'Все' },
  semOperadores: { pt: 'Sem operadores', en: 'No operators', es: 'Sin operadores', ru: 'Нет операторов' },
  verRota:       { pt: 'Ver rota', en: 'View route', es: 'Ver ruta', ru: 'Показать маршрут' },
  // STATUS_LABEL
  emExecucao:    { pt: 'em execução', en: 'in progress', es: 'en ejecución', ru: 'в работе' },
  statusIdle:    { pt: 'idle', en: 'idle', es: 'inactivo', ru: 'простой' },
  semGps10min:   { pt: 'sem GPS >10min', en: 'no GPS >10min', es: 'sin GPS >10min', ru: 'без GPS >10 мин' },
  // popup
  atualizadoHa:  { pt: 'atualizado há', en: 'updated', es: 'actualizado hace', ru: 'обновлено' },
  atualizadoHaSuf: { pt: '', en: 'ago', es: '', ru: 'назад' },
  verRotaDoDia:  { pt: 'Ver rota do dia', en: 'View today\'s route', es: 'Ver ruta del día', ru: 'Маршрут за день' },
};

interface Props {
  cidade: string;
  usuario: { uid: string; role: string };
}

interface Worker {
  uid: string;
  nome?: string;
  lat: number;
  lng: number;
  velocidade?: number;
  criadoEm: any;
  cidade?: string;
  role?: string;
  tarefaAtiva?: string;
}

const T = {
  bg: 'rgba(13,18,30,1)', card: 'rgba(22,28,40,.95)',
  bdr: 'rgba(255,255,255,.08)',
  blue: '#1a6fd4', bluel: '#307FE2',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  txt: '#e2e8f0', dim: '#64748b', dim2: '#94a3b8',
};

// Status por tempo do último GPS
function calcStatus(criadoEm: any): 'online' | 'idle' | 'sem_gps' {
  if (!criadoEm) return 'sem_gps';
  const ms = Date.now() - (criadoEm?.toDate?.() ?? new Date(criadoEm)).getTime();
  if (ms < 90_000) return 'online';
  if (ms < 600_000) return 'idle';   // <10min
  return 'sem_gps';
}

const STATUS_COR: Record<string, string> = {
  online: '#22c55e',
  idle: '#f59e0b',
  sem_gps: '#ef4444',
};

const STATUS_TR_KEY: Record<string, keyof typeof TR> = {
  online: 'emExecucao',
  idle: 'statusIdle',
  sem_gps: 'semGps10min',
};

function fmtIdade(criadoEm: any): string {
  if (!criadoEm) return '?';
  const s = Math.floor((Date.now() - (criadoEm?.toDate?.() ?? new Date(criadoEm)).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}

function workerCircleHtml(cor: string, letra: string): string {
  return `<div style="
    width:32px;height:32px;border-radius:50%;
    background:${cor}22;border:2.5px solid ${cor};
    display:flex;align-items:center;justify-content:center;
    font-size:13px;font-weight:700;color:${cor};
    box-shadow:0 2px 10px ${cor}55;
    font-family:Inter,sans-serif;
  ">${letra}</div>`;
}

export default function LiveTrackingMap({ cidade, usuario }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [rotaWorker, setRotaWorker] = useState<{ uid: string; nome: string } | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'online' | 'idle' | 'sem_gps'>('todos');

  const mapRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());

  // Inicializa mapa
  useEffect(() => {
    if (!mapRef.current) return;
    if (mapaRef.current) return;

    const coordsCidade: Record<string, [number, number]> = {
      'São Paulo': [-23.55, -46.63],
      'Rio de Janeiro': [-22.91, -43.17],
      'Belo Horizonte': [-19.92, -43.94],
      'Fortaleza': [-3.73, -38.52],
      'Salvador': [-12.97, -38.50],
      'default': [-15.78, -47.93],
    };
    const center = coordsCidade[cidade] ?? coordsCidade['default'];

    const m = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(m);
    m.setView(center, 13);
    layerRef.current = L.layerGroup().addTo(m);
    mapaRef.current = m;

    return () => { m.remove(); mapaRef.current = null; };
  }, []);

  // GPS data — Supabase polling (Onda D) ou Firestore onSnapshot (fallback)
  useEffect(() => {
    if (!cidade) return;

    if (gpsProviderSupabase()) {
      // Supabase: polling a cada 10s
      let alive = true;
      const poll = () => {
        fetchGpsAtual(60).then(pts => {
          if (!alive) return;
          const filtered = pts.filter(p => !p.cidade || p.cidade === cidade || p.cidade === '');
          const byUid = new Map<string, Worker>();
          for (const p of filtered) {
            if (!byUid.has(p.uid) || (p.criadoEm?.seconds ?? 0) > (byUid.get(p.uid)!.criadoEm?.seconds ?? 0)) {
              byUid.set(p.uid, { uid: p.uid, lat: p.lat, lng: p.lng, criadoEm: p.criadoEm, velocidade: p.velocidade ?? undefined, nome: p.nome, cidade: p.cidade });
            }
          }
          setWorkers([...byUid.values()]);
        });
      };
      poll();
      const id = setInterval(poll, 10_000);
      return () => { alive = false; clearInterval(id); };
    }

    // Firestore fallback
    const desde = new Date(Date.now() - 60 * 60_000); // última hora
    const q = query(
      collection(db, 'gps_logistica'),
      where('cidade', '==', cidade),
      where('criadoEm', '>=', Timestamp.fromDate(desde)),
      orderBy('criadoEm', 'desc'),
      limit(300),
    );

    const unsub = onSnapshot(q, snap => {
      const byUid = new Map<string, Worker>();
      for (const d of snap.docs) {
        const x = d.data() as Worker;
        if (!byUid.has(x.uid) || (x.criadoEm?.seconds ?? 0) > (byUid.get(x.uid)!.criadoEm?.seconds ?? 0)) {
          byUid.set(x.uid, { ...x });
        }
      }
      setWorkers([...byUid.values()]);
    }, err => console.warn('[LiveTrackingMap]', err));

    return unsub;
  }, [cidade]);

  // Atualiza marcadores no mapa
  useEffect(() => {
    const mapa = mapaRef.current;
    const layer = layerRef.current;
    if (!mapa || !layer) return;

    const markers = markersRef.current;
    const activeUids = new Set(workers.map(w => w.uid));

    // Remove saídos
    for (const [uid, m] of markers) {
      if (!activeUids.has(uid)) { layer.removeLayer(m); markers.delete(uid); }
    }

    for (const w of workers) {
      if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) continue;
      const status = calcStatus(w.criadoEm);
      const cor = STATUS_COR[status];
      const nome = w.nome ?? w.uid.slice(0, 8);
      const nomeDisplay = nome.split(' ')[0];
      const idade = fmtIdade(w.criadoEm);
      const velTxt = w.velocidade != null ? `${w.velocidade.toFixed(1)} km/h` : '—';
      const statusLabel = pick(TR[STATUS_TR_KEY[status]] as { pt: string; en: string; es: string; ru: string });
      const idadeSuf = pick(TR.atualizadoHaSuf);

      const popupHtml = `
        <div style="font-family:Inter,sans-serif;font-size:12px;min-width:170px;">
          <div style="font-weight:700;font-size:13px;color:#0d0d1a;margin-bottom:5px;">
            👤 ${nome}
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${cor};flex-shrink:0;"></div>
            <span style="color:#374151;">${statusLabel}</span>
          </div>
          <div style="color:#6b7280;font-size:11px;margin-bottom:2px;">⏱ ${pick(TR.atualizadoHa)} ${idade}${idadeSuf ? ' ' + idadeSuf : ''}</div>
          <div style="color:#6b7280;font-size:11px;margin-bottom:6px;">🚀 ${velTxt}</div>
          <button
            onclick="window._jetOpenRota && window._jetOpenRota('${w.uid}','${nome}')"
            style="background:#1a6fd4;border:none;color:#fff;padding:4px 10px;
              border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;"
          >${pick(TR.verRotaDoDia)}</button>
        </div>
      `;

      if (markers.has(w.uid)) {
        const m = markers.get(w.uid)!;
        m.setLatLng([w.lat, w.lng]);
        m.setStyle({ color: cor, fillColor: cor });
        m.getPopup()?.setContent(popupHtml);
      } else {
        const m = L.circleMarker([w.lat, w.lng], {
          radius: 9, color: cor, fillColor: cor, fillOpacity: 0.85, weight: 2,
        });
        m.bindTooltip(nomeDisplay, {
          permanent: false, direction: 'top', offset: [0, -10],
          className: 'jet-tooltip',
        });
        m.bindPopup(popupHtml, { maxWidth: 220 });
        layer.addLayer(m);
        markers.set(w.uid, m);
      }
    }
  }, [workers, lang]);

  // Expõe callback global para o popup
  useEffect(() => {
    (window as any)._jetOpenRota = (uid: string, nome: string) => {
      setRotaWorker({ uid, nome });
    };
    return () => { delete (window as any)._jetOpenRota; };
  }, []);

  const workersFiltrados = workers.filter(w => {
    if (filtroStatus === 'todos') return true;
    return calcStatus(w.criadoEm) === filtroStatus;
  });

  const cntOnline = workers.filter(w => calcStatus(w.criadoEm) === 'online').length;
  const cntIdle   = workers.filter(w => calcStatus(w.criadoEm) === 'idle').length;
  const cntSemGps = workers.filter(w => calcStatus(w.criadoEm) === 'sem_gps').length;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 500, gap: 0, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      {/* Sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${T.bdr}`,
        background: T.card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* KPIs */}
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.bdr}` }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {pick(TR.campoAoVivo)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <KpiBadge cor={T.green} n={cntOnline} label={pick(TR.online)} />
            <KpiBadge cor={T.yellow} n={cntIdle} label={pick(TR.idle)} />
            <KpiBadge cor={T.red} n={cntSemGps} label={pick(TR.semGpsCurto)} />
          </div>
        </div>

        {/* Filtro */}
        <div style={{ padding: '8px 14px', borderBottom: `1px solid ${T.bdr}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['todos', 'online', 'idle', 'sem_gps'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltroStatus(f)}
              style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                background: filtroStatus === f ? T.bluel : 'rgba(255,255,255,.06)',
                color: filtroStatus === f ? '#fff' : T.dim2,
              }}
            >
              {f === 'todos' ? pick(TR.todos) : f === 'sem_gps' ? pick(TR.semGpsCurto) : f === 'online' ? pick(TR.online) : pick(TR.idle)}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin' }}>
          {workersFiltrados.length === 0 ? (
            <div style={{ padding: 14, fontSize: 11, color: T.dim }}>{pick(TR.semOperadores)}</div>
          ) : (
            workersFiltrados
              .sort((a, b) => (b.criadoEm?.seconds ?? 0) - (a.criadoEm?.seconds ?? 0))
              .map(w => {
                const status = calcStatus(w.criadoEm);
                const cor = STATUS_COR[status];
                const nome = (w.nome ?? w.uid.slice(0, 8)).split(' ')[0];
                return (
                  <div
                    key={w.uid}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 14px', borderBottom: `1px solid ${T.bdr}`,
                      cursor: 'pointer',
                    }}
                    onClick={() => mapaRef.current?.flyTo([w.lat, w.lng], 16)}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nome}
                      </div>
                      <div style={{ fontSize: 9, color: T.dim }}>
                        {pick(TR[STATUS_TR_KEY[status]] as { pt: string; en: string; es: string; ru: string })} · {fmtIdade(w.criadoEm)}
                        {w.velocidade != null && ` · ${w.velocidade.toFixed(0)} km/h`}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setRotaWorker({ uid: w.uid, nome: w.nome ?? w.uid }); }}
                      title={pick(TR.verRota)}
                      style={{
                        background: 'none', border: 'none', color: T.bluel,
                        fontSize: 12, cursor: 'pointer', padding: '2px 4px',
                      }}
                    >📍</button>
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* Mapa */}
      <div ref={mapRef} style={{ flex: 1, minWidth: 0 }} />

      {/* Modal de rota */}
      {rotaWorker && (
        <GpsRotaPanel
          uid={rotaWorker.uid}
          nome={rotaWorker.nome}
          onFechar={() => setRotaWorker(null)}
        />
      )}
    </div>
  );
}

function KpiBadge({ cor, n, label }: { cor: string; n: number; label: string }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center', background: `${cor}18`,
      border: `1px solid ${cor}33`, borderRadius: 8, padding: '6px 4px',
    }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: cor, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 9, color: cor, marginTop: 2, fontWeight: 600 }}>{label}</div>
    </div>
  );
}
