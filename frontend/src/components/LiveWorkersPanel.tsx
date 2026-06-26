// frontend/src/components/LiveWorkersPanel.tsx
// Painel de operadores em campo — GPS em tempo real
//
// Features:
//   - onSnapshot em gps_logistica (últimos 10 min)
//   - Lista de operadores com badge de status (online/lento/parado)
//   - Clique voa para a posição no mapa Leaflet
//   - Mostra tarefa ativa do operador se houver

import React, { useEffect, useState, useRef } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  Timestamp, getDocs, limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';

// ─────────────────────────── Textos (pt / en / es / ru) ───────────────────────────
const T = {
  semGps: {
    pt: 'sem GPS',
    en: 'no GPS',
    es: 'sin GPS',
    ru: 'нет GPS',
  },
  online: {
    pt: 'online',
    en: 'online',
    es: 'en línea',
    ru: 'в сети',
  },
  lento: {
    pt: 'lento',
    en: 'slow',
    es: 'lento',
    ru: 'медленно',
  },
  parado: {
    pt: 'parado',
    en: 'stopped',
    es: 'detenido',
    ru: 'остановлен',
  },
  ultimaAtt: {
    pt: 'Última att',
    en: 'Last update',
    es: 'Última act.',
    ru: 'Посл. обновл.',
  },
  ultimaAttMin: {
    pt: 'última att',
    en: 'last update',
    es: 'última act.',
    ru: 'посл. обновл.',
  },
  gpsFalso: {
    pt: '⚠️ GPS FALSO DETECTADO',
    en: '⚠️ FAKE GPS DETECTED',
    es: '⚠️ GPS FALSO DETECTADO',
    ru: '⚠️ ОБНАРУЖЕН ПОДДЕЛЬНЫЙ GPS',
  },
  campoAoVivo: {
    pt: 'CAMPO AO VIVO',
    en: 'LIVE FIELD',
    es: 'CAMPO EN VIVO',
    ru: 'ПОЛЕ В РЕАЛЬНОМ ВРЕМЕНИ',
  },
  semOperadores: {
    pt: 'Sem operadores com GPS recente',
    en: 'No operators with recent GPS',
    es: 'Sin operadores con GPS reciente',
    ru: 'Нет операторов с недавним GPS',
  },
};
type Lang = 'pt' | 'en' | 'es' | 'ru';
type L4 = { pt: string; en: string; es: string; ru: string };

// Traduz o label canônico (fonte PT) de statusCor para o idioma atual
function statusLabel(canon: string, pick: (o: L4) => string): string {
  if (canon === 'online') return pick(T.online);
  if (canon === 'lento')  return pick(T.lento);
  if (canon === 'parado') return pick(T.parado);
  return pick(T.semGps);
}

interface GPS {
  uid: string;
  nome?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  criadoEm: any;
  slotId?: string;
  cidade?: string;
  role?: string;
  isMock?: boolean;
}

interface Props {
  mapa: L.Map | null;
  visivel: boolean;
  cidade?: string;
  usuario: { uid: string; role: string };
}

const JANELA_MIN = 10; // operadores com GPS nos últimos 10 min

function fmtIdade(ts: any): string {
  if (!ts) return '?';
  const ms = Date.now() - (ts?.toDate?.() ?? new Date(ts)).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}min`;
  return `${Math.floor(s/3600)}h`;
}

function statusCor(ts: any): { dot: string; label: string } {
  if (!ts) return { dot: '#6b7280', label: 'sem GPS' };
  const s = (Date.now() - (ts?.toDate?.() ?? new Date(ts)).getTime()) / 1000;
  if (s < 90)  return { dot: '#22c55e', label: 'online' };
  if (s < 300) return { dot: '#f59e0b', label: 'lento' };
  return { dot: '#ef4444', label: 'parado' };
}

function workerIcon(uid: string, cor: string, isMock?: boolean): L.DivIcon {
  const border = isMock ? '2.5px solid #f97316' : `2.5px solid ${cor}`;
  const bg     = isMock ? '#f9731622' : `${cor}22`;
  const badge  = isMock ? `<div style="position:absolute;top:-4px;right:-4px;background:#f97316;border-radius:50%;width:12px;height:12px;font-size:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">!</div>` : '';
  return L.divIcon({
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div style="position:relative;width:28px;height:28px">
      <div style="width:28px;height:28px;border-radius:50%;background:${bg};border:${border};display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.5);">👤</div>
      ${badge}
    </div>`,
  });
}

export default function LiveWorkersPanel({ mapa, visivel, cidade, usuario }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L4) => o[lang] ?? o.pt;
  const [workers, setWorkers] = useState<GPS[]>([]);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0); // força rerender a cada 15s para atualizar cores/tempos
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Tick a cada 15s para atualizar status de cor e tempo em tempo real
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Busca nomes de usuários para todos os uids visíveis (batches de 30)
  useEffect(() => {
    if (workers.length === 0) return;
    const uidsComNome = workers.filter(w => !w.nome && !nomes.has(w.uid)).map(w => w.uid);
    if (uidsComNome.length === 0) return;
    const batches: string[][] = [];
    for (let i = 0; i < uidsComNome.length; i += 30) batches.push(uidsComNome.slice(i, i + 30));
    Promise.all(batches.map(batch =>
      getDocs(query(collection(db, 'usuarios'), where('__name__', 'in', batch)))
    )).then(snaps => {
      setNomes(prev => {
        const next = new Map(prev);
        snaps.flatMap(s => s.docs).forEach(d => {
          const data = d.data();
          const nome = [data.nome, data.sobrenome].filter(Boolean).join(' ') || d.id.slice(0, 8);
          next.set(d.id, nome);
        });
        return next;
      });
    }).catch(() => {});
  }, [workers]);

  // Realtime GPS
  useEffect(() => {
    if (!visivel) return;
    const desde = new Date(Date.now() - JANELA_MIN * 60_000);

    const constraints = [
      where('criadoEm', '>=', Timestamp.fromDate(desde)),
      orderBy('criadoEm', 'desc'),
      limit(200),
    ];
    // Se não é admin, só vê a própria cidade
    const q = query(collection(db, 'gps_logistica'), ...constraints);

    const unsub = onSnapshot(q, snap => {
      // Agrupa por uid — pega o mais recente de cada
      const byUid = new Map<string, GPS>();
      for (const d of snap.docs) {
        const x = d.data() as GPS;
        if (!byUid.has(x.uid) || (x.criadoEm?.seconds ?? 0) > (byUid.get(x.uid)!.criadoEm?.seconds ?? 0)) {
          byUid.set(x.uid, { ...x });
        }
      }
      // Filtra por cidade se fornecida
      let lista = [...byUid.values()];
      if (cidade) lista = lista.filter(w => !w.cidade || w.cidade === cidade);
      setWorkers(lista);
    }, err => console.warn('[LiveWorkers]', err));

    return unsub;
  }, [visivel, cidade]);

  // Cria/destrói o LayerGroup apenas quando o mapa muda — evita recriar markers a cada tick
  useEffect(() => {
    if (!mapa) return;
    const layer = L.layerGroup();
    layerRef.current = layer;
    return () => {
      if (mapa.hasLayer(layer)) mapa.removeLayer(layer);
      layerRef.current = null;
      markersRef.current.clear();
    };
  }, [mapa]);

  // Mostra/esconde layer quando visível muda
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !mapa) return;
    if (visivel) { if (!mapa.hasLayer(layer)) layer.addTo(mapa); }
    else         { if (mapa.hasLayer(layer))  mapa.removeLayer(layer); }
  }, [mapa, visivel]);

  // Atualiza markers sem recriar o layer (roda a cada tick/workers/nomes)
  useEffect(() => {
    const layer   = layerRef.current;
    const markers = markersRef.current;
    if (!layer || !mapa || !visivel) return;

    const activeUids = new Set(workers.map(w => w.uid));
    for (const [uid, m] of markers) {
      if (!activeUids.has(uid)) { layer.removeLayer(m); markers.delete(uid); }
    }

    for (const w of workers) {
      if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) continue;
      const s     = statusCor(w.criadoEm);
      const idade = fmtIdade(w.criadoEm);
      const nome  = w.nome || nomes.get(w.uid) || w.uid.slice(0, 8);
      const mockBanner = w.isMock
        ? `<div style="margin-top:4px;padding:3px 6px;background:#f9731620;border:1px solid #f97316;border-radius:4px;font-size:10px;color:#f97316;font-weight:600">${pick(T.gpsFalso)}</div>`
        : '';
      const popup = `
        <div style="font-family:Inter,sans-serif;font-size:12px;min-width:160px">
          <div style="font-weight:700;font-size:13px;color:#0d0d1a;margin-bottom:4px">👤 ${nome}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <div style="width:8px;height:8px;border-radius:50%;background:${s.dot}"></div>
            <span style="color:#374151">${statusLabel(s.label, pick)}</span>
          </div>
          <div style="font-size:10px;color:#6b7280">${pick(T.ultimaAtt)}: ${idade}</div>
          ${w.accuracy ? `<div style="font-size:10px;color:#9ca3af">±${Math.round(w.accuracy)}m</div>` : ''}
          ${mockBanner}
        </div>`;

      if (markers.has(w.uid)) {
        const mk = markers.get(w.uid)!;
        mk.setLatLng([w.lat, w.lng]);
        mk.setIcon(workerIcon(w.uid, s.dot, w.isMock));
        mk.getPopup()?.setContent(popup);
      } else {
        const mk = L.marker([w.lat, w.lng], { icon: workerIcon(w.uid, s.dot, w.isMock), zIndexOffset: 500 });
        mk.bindPopup(popup, { maxWidth: 200 });
        layer.addLayer(mk);
        markers.set(w.uid, mk);
      }
    }
  }, [mapa, visivel, workers, nomes, tick, lang]);

  if (!visivel) return null;

  const online = workers.filter(w => {
    const s = statusCor(w.criadoEm);
    return s.label === 'online';
  }).length;

  return (
    <div style={{
      position: 'fixed', left: 52, bottom: 100, zIndex: 800,
      background: 'rgba(13,18,30,.95)', border: '1px solid rgba(255,255,255,.1)',
      borderRadius: 10, padding: '10px 12px', backdropFilter: 'blur(8px)',
      minWidth: 180, maxHeight: 300, overflowY: 'auto', scrollbarWidth: 'thin',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.35)',
        letterSpacing: 1, marginBottom: 8 }}>
        {pick(T.campoAoVivo)} — {online}/{workers.length} {pick(T.online)}
      </div>

      {workers.length === 0 ? (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)' }}>
          {pick(T.semOperadores)}
        </div>
      ) : (
        workers
          .sort((a, b) => (b.criadoEm?.seconds ?? 0) - (a.criadoEm?.seconds ?? 0))
          .map(w => {
            const s    = statusCor(w.criadoEm);
            const nome = w.nome || nomes.get(w.uid) || w.uid.slice(0, 8);
            return (
              <button
                key={w.uid}
                onClick={() => mapa?.flyTo([w.lat, w.lng], 16)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0', background: 'none', border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,.05)',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%',
                  background: s.dot, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {nome}
                    </div>
                    {w.isMock && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: '#f97316',
                        background: '#f9731618', border: '1px solid #f97316',
                        borderRadius: 3, padding: '0 4px', flexShrink: 0,
                      }}>MOCK</span>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>
                    {statusLabel(s.label, pick)} · {pick(T.ultimaAttMin)} {fmtIdade(w.criadoEm)}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.25)' }}>›</span>
              </button>
            );
          })
      )}
    </div>
  );
}
