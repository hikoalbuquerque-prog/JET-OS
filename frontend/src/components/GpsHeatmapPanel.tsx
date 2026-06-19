// frontend/src/components/GpsHeatmapPanel.tsx — JET OS V2
// Heatmap de posições GPS dos prestadores por período

import React, { useState, useEffect, useRef } from 'react';
import {
  collection, query, where, getDocs, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { analyticsProviderSupabase, fetchGpsHeatmap } from '../lib/analytics-supabase';
import L from 'leaflet';

// Importa o plugin leaflet.heat (adiciona L.heatLayer)
import 'leaflet.heat';

declare module 'leaflet' {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: {
      minOpacity?: number; maxZoom?: number; max?: number;
      radius?: number; blur?: number; gradient?: Record<string, string>;
    }
  ): L.Layer;
}

interface Props {
  cidade: string;
}

type Periodo = 'hoje' | 'semana' | 'mes';

const T = {
  bg: 'rgba(13,18,30,1)', card: 'rgba(22,28,40,.95)', sur: 'rgba(13,18,30,.97)',
  bdr: 'rgba(255,255,255,.08)', bdr2: 'rgba(255,255,255,.04)',
  blueg: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
  blue: '#1a6fd4', bluel: '#307FE2',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  txt: '#e2e8f0', dim: '#64748b', dim2: '#94a3b8',
};

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'semana', label: '7 dias' },
  { id: 'mes', label: '30 dias' },
];

function iniciosPeriodo(p: Periodo): Date {
  const agora = new Date();
  if (p === 'hoje') return new Date(agora.toISOString().slice(0, 10) + 'T00:00:00');
  if (p === 'semana') return new Date(Date.now() - 7 * 86400_000);
  return new Date(Date.now() - 30 * 86400_000);
}

export default function GpsHeatmapPanel({ cidade }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const [pontos, setPontos] = useState<[number, number, number][]>([]);
  const [carregando, setCarregando] = useState(false);
  const [total, setTotal] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const heatRef = useRef<L.Layer | null>(null);

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
    m.setView(center, 12);
    mapaRef.current = m;

    return () => { m.remove(); mapaRef.current = null; };
  }, []);

  // Busca dados
  useEffect(() => {
    if (!cidade) return;
    setCarregando(true);
    const desde = iniciosPeriodo(periodo);

    // Migração #3: lê do Postgres (RPC) quando VITE_ANALYTICS_PROVIDER=supabase.
    // A RPC retorna pontos binados (peso = contagem). cidade = cidade do operador.
    if (analyticsProviderSupabase()) {
      fetchGpsHeatmap({ desde: desde.toISOString(), cidade, limit: 5000 })
        .then(pts => { setTotal(pts.reduce((s, p) => s + (p[2] || 1), 0)); setPontos(pts); })
        .catch(err => { console.warn('[GpsHeatmap] RPC Supabase falhou:', err); setPontos([]); setTotal(0); })
        .finally(() => setCarregando(false));
      return;
    }

    const q = query(
      collection(db, 'gps_logistica'),
      where('cidade', '==', cidade),
      where('criadoEm', '>=', Timestamp.fromDate(desde)),
      orderBy('criadoEm', 'desc'),
      limit(2000),
    );

    getDocs(q).then(snap => {
      const pts: [number, number, number][] = [];
      for (const d of snap.docs) {
        const x = d.data();
        if (Number.isFinite(x.lat) && Number.isFinite(x.lng)) {
          pts.push([x.lat, x.lng, 1]);
        }
      }
      setTotal(pts.length);
      setPontos(pts);
    }).catch(err => {
      console.warn('[GpsHeatmap]', err);
      setPontos([]);
    }).finally(() => setCarregando(false));
  }, [cidade, periodo]);

  // Atualiza heatmap no mapa
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    if (heatRef.current) {
      mapa.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    if (pontos.length === 0) return;

    try {
      const heat = (L as any).heatLayer(pontos, {
        radius: 20, blur: 15, maxZoom: 17,
        gradient: { 0.2: '#1a6fd4', 0.5: '#f59e0b', 0.8: '#ef4444', 1.0: '#fff' },
      });
      heat.addTo(mapa);
      heatRef.current = heat;
    } catch (e) {
      // fallback: círculos semi-transparentes
      const layer = L.layerGroup().addTo(mapa);
      heatRef.current = layer as unknown as L.Layer;
      for (const [lat, lng] of pontos.slice(0, 300)) {
        L.circleMarker([lat, lng], {
          radius: 6, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.15, weight: 0,
        }).addTo(layer);
      }
    }
  }, [pontos]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: "'Inter',-apple-system,sans-serif",
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: T.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
          🔥 Heatmap GPS — {cidade}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODOS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: periodo === p.id ? T.bluel : 'rgba(255,255,255,.06)',
                color: periodo === p.id ? '#fff' : T.dim2,
                transition: 'all .15s',
              }}
            >{p.label}</button>
          ))}
        </div>
        {carregando && (
          <span style={{ fontSize: 11, color: T.dim }}>Carregando...</span>
        )}
        {!carregando && total > 0 && (
          <span style={{ fontSize: 11, color: T.dim2 }}>{total.toLocaleString('pt-BR')} pontos</span>
        )}
        {!carregando && total === 0 && (
          <span style={{ fontSize: 11, color: T.red }}>Sem dados no período</span>
        )}
      </div>

      {/* Mapa */}
      <div
        ref={mapRef}
        style={{
          flex: 1, minHeight: 400, borderRadius: 12,
          border: `1px solid ${T.bdr}`, overflow: 'hidden',
        }}
      />
    </div>
  );
}
