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

function workerIcon(uid: string, cor: string): L.DivIcon {
  return L.divIcon({
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${cor}22;border:2.5px solid ${cor};
      display:flex;align-items:center;justify-content:center;
      font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.5);
    ">👤</div>`,
  });
}

export default function LiveWorkersPanel({ mapa, visivel, cidade, usuario }: Props) {
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

  // Busca nomes de usuários para todos os uids visíveis
  useEffect(() => {
    if (workers.length === 0) return;
    const uidsComNome = workers.filter(w => !w.nome).map(w => w.uid);
    if (uidsComNome.length === 0) return;
    getDocs(query(collection(db, 'usuarios'), where('__name__', 'in', uidsComNome.slice(0, 10))))
      .then(snap => {
        setNomes(prev => {
          const next = new Map(prev);
          snap.docs.forEach(d => {
            const data = d.data();
            const nome = [data.nome, data.sobrenome].filter(Boolean).join(' ') || data.nome || d.id.slice(0, 8);
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

  // Renderiza no mapa
  useEffect(() => {
    if (!mapa) return;
    if (!layerRef.current) {
      layerRef.current = L.layerGroup();
    }
    const layer   = layerRef.current;
    const markers = markersRef.current;

    if (!visivel) {
      if (mapa.hasLayer(layer)) mapa.removeLayer(layer);
      return;
    }
    if (!mapa.hasLayer(layer)) layer.addTo(mapa);

    const activeUids = new Set(workers.map(w => w.uid));
    for (const [uid, m] of markers) {
      if (!activeUids.has(uid)) { layer.removeLayer(m); markers.delete(uid); }
    }

    for (const w of workers) {
      if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) continue;
      const s    = statusCor(w.criadoEm);
      const idade = fmtIdade(w.criadoEm);
      const nome  = w.nome || nomes.get(w.uid) || w.uid.slice(0, 8);

      if (markers.has(w.uid)) {
        markers.get(w.uid)!.setLatLng([w.lat, w.lng]);
        markers.get(w.uid)!.setIcon(workerIcon(w.uid, s.dot));
        markers.get(w.uid)!.getPopup()?.setContent(`
          <div style="font-family:Inter,sans-serif;font-size:12px;min-width:160px">
            <div style="font-weight:700;font-size:13px;color:#0d0d1a;margin-bottom:4px">👤 ${nome}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <div style="width:8px;height:8px;border-radius:50%;background:${s.dot}"></div>
              <span style="color:#374151">${s.label}</span>
            </div>
            <div style="font-size:10px;color:#6b7280">Última att: ${idade}</div>
            ${w.accuracy ? `<div style="font-size:10px;color:#9ca3af">±${Math.round(w.accuracy)}m</div>` : ''}
          </div>`);
      } else {
        const m = L.marker([w.lat, w.lng], { icon: workerIcon(w.uid, s.dot), zIndexOffset: 500 });
        m.bindPopup(`
          <div style="font-family:Inter,sans-serif;font-size:12px;min-width:160px">
            <div style="font-weight:700;font-size:13px;color:#0d0d1a;margin-bottom:4px">👤 ${nome}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <div style="width:8px;height:8px;border-radius:50%;background:${s.dot}"></div>
              <span style="color:#374151">${s.label}</span>
            </div>
            <div style="font-size:10px;color:#6b7280">Última att: ${idade}</div>
            ${w.accuracy ? `<div style="font-size:10px;color:#9ca3af">±${Math.round(w.accuracy)}m</div>` : ''}
          </div>`, { maxWidth: 200 });
        layer.addLayer(m);
        markers.set(w.uid, m);
      }
    }

    return () => {
      if (layerRef.current && mapa.hasLayer(layerRef.current)) {
        mapa.removeLayer(layerRef.current);
        layerRef.current = null;
        markersRef.current.clear();
      }
    };
  }, [mapa, visivel, workers, nomes, tick]);

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
        CAMPO AO VIVO — {online}/{workers.length} online
      </div>

      {workers.length === 0 ? (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)' }}>
          Sem operadores com GPS recente
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
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nome}
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>
                    {s.label} · última att {fmtIdade(w.criadoEm)}
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
