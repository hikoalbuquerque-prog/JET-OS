// frontend/src/components/GpsRotaPanel.tsx — JET OS V2
// Histórico de rota de um prestador num dia selecionado

import React, { useState, useEffect, useRef } from 'react';
import {
  collection, query, where, orderBy, getDocs, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import L from 'leaflet';

interface Props {
  uid: string;
  nome: string;
  onFechar: () => void;
}

interface Ponto {
  lat: number;
  lng: number;
  criadoEm: any;
  velocidade?: number;
}

const T = {
  bg: 'rgba(13,18,30,1)', card: 'rgba(22,28,40,.95)',
  bdr: 'rgba(255,255,255,.08)', bdr2: 'rgba(255,255,255,.04)',
  blue: '#1a6fd4', bluel: '#307FE2',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  txt: '#e2e8f0', dim: '#64748b', dim2: '#94a3b8',
};

function isoHoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function distKm(la1: number, ln1: number, la2: number, ln2: number): number {
  const R = 6371;
  const dL = (la2 - la1) * Math.PI / 180;
  const dN = (ln2 - ln1) * Math.PI / 180;
  const a = Math.sin(dL / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDur(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function GpsRotaPanel({ uid, nome, onFechar }: Props) {
  const [data, setData] = useState(isoHoje());
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [carregando, setCarregando] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const rotaLayerRef = useRef<L.LayerGroup | null>(null);

  // Busca pontos
  useEffect(() => {
    setCarregando(true);
    const ini = new Date(data + 'T00:00:00');
    const fim = new Date(data + 'T23:59:59');
    const q = query(
      collection(db, 'gps_logistica_hist', uid, 'pontos'),
      where('criadoEm', '>=', Timestamp.fromDate(ini)),
      where('criadoEm', '<=', Timestamp.fromDate(fim)),
      orderBy('criadoEm', 'asc'),
      limit(500),
    );
    getDocs(q).then(snap => {
      setPontos(snap.docs.map(d => d.data() as Ponto));
    }).catch(err => {
      console.warn('[GpsRotaPanel]', err);
      setPontos([]);
    }).finally(() => setCarregando(false));
  }, [uid, data]);

  // Inicializa mapa
  useEffect(() => {
    if (!mapRef.current) return;
    if (mapaRef.current) return;
    const m = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(m);
    mapaRef.current = m;
    return () => { m.remove(); mapaRef.current = null; };
  }, []);

  // Renderiza rota no mapa
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    // Limpa camada anterior
    if (rotaLayerRef.current) {
      rotaLayerRef.current.clearLayers();
    } else {
      rotaLayerRef.current = L.layerGroup().addTo(mapa);
    }
    const layer = rotaLayerRef.current;

    if (pontos.length === 0) return;

    const coords: [number, number][] = pontos.map(p => [p.lat, p.lng]);

    // Linha de rota
    L.polyline(coords, { color: T.bluel, weight: 3, opacity: 0.85 }).addTo(layer);

    // Marcador de início
    const inicio = pontos[0];
    L.circleMarker([inicio.lat, inicio.lng], {
      radius: 8, color: T.green, fillColor: T.green, fillOpacity: 1, weight: 2,
    }).bindPopup(`<b>Início</b><br>${fmtTs(inicio.criadoEm)}`).addTo(layer);

    // Marcador de fim
    const fim = pontos[pontos.length - 1];
    L.circleMarker([fim.lat, fim.lng], {
      radius: 8, color: T.red, fillColor: T.red, fillOpacity: 1, weight: 2,
    }).bindPopup(`<b>Fim</b><br>${fmtTs(fim.criadoEm)}`).addTo(layer);

    // Ajusta visão
    mapa.fitBounds(L.latLngBounds(coords).pad(0.1));
  }, [pontos]);

  // Estatísticas
  const stats = React.useMemo(() => {
    if (pontos.length < 2) return null;
    let distTotal = 0;
    let somaVel = 0;
    let cntVel = 0;
    for (let i = 1; i < pontos.length; i++) {
      distTotal += distKm(pontos[i - 1].lat, pontos[i - 1].lng, pontos[i].lat, pontos[i].lng);
    }
    for (const p of pontos) {
      if (p.velocidade != null) { somaVel += p.velocidade; cntVel++; }
    }
    const tsIni = pontos[0].criadoEm?.toDate?.() ?? new Date(pontos[0].criadoEm);
    const tsFim = pontos[pontos.length - 1].criadoEm?.toDate?.() ?? new Date(pontos[pontos.length - 1].criadoEm);
    const durMs = tsFim.getTime() - tsIni.getTime();
    return {
      total: pontos.length,
      distKm: distTotal.toFixed(2),
      velMedia: cntVel > 0 ? (somaVel / cntVel).toFixed(1) : null,
      duracao: fmtDur(durMs),
    };
  }, [pontos]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 6000,
      background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      fontFamily: "'Inter',-apple-system,sans-serif",
    }}>
      <div style={{
        background: T.bg, border: `1px solid ${T.bdr}`, borderRadius: 14,
        width: '100%', maxWidth: 900, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: `1px solid ${T.bdr}`,
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.txt }}>
              📍 Rota — {nome}
            </div>
            <div style={{ fontSize: 11, color: T.dim }}>Histórico de deslocamento</div>
          </div>
          <input
            type="date"
            value={data}
            max={isoHoje()}
            onChange={e => setData(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 12,
              background: 'rgba(255,255,255,.06)', border: `1px solid ${T.bdr}`,
              color: T.txt, outline: 'none',
            }}
          />
          <button
            onClick={onFechar}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`, color: T.dim2,
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
            }}
          >✕ Fechar</button>
        </div>

        {/* Body: mapa + stats */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Mapa */}
          <div ref={mapRef} style={{ flex: 1, minWidth: 0 }} />

          {/* Painel lateral */}
          <div style={{
            width: 200, flexShrink: 0, borderLeft: `1px solid ${T.bdr}`,
            background: T.card, padding: 14, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: 1 }}>
              Estatísticas
            </div>

            {carregando && (
              <div style={{ fontSize: 12, color: T.dim }}>Carregando...</div>
            )}
            {!carregando && pontos.length === 0 && (
              <div style={{ fontSize: 12, color: T.dim }}>Sem dados para este dia.</div>
            )}
            {!carregando && stats && (
              <>
                <StatBox label="Pontos GPS" value={String(stats.total)} color={T.bluel} />
                <StatBox label="Distância" value={`${stats.distKm} km`} color={T.green} />
                {stats.velMedia && (
                  <StatBox label="Vel. média" value={`${stats.velMedia} km/h`} color={T.yellow} />
                )}
                <StatBox label="Duração" value={stats.duracao} color={T.dim2} />
              </>
            )}

            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${T.bdr}` }}>
              <div style={{ fontSize: 10, color: T.dim, marginBottom: 6 }}>Legenda</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: T.green }} />
                <span style={{ fontSize: 11, color: T.dim2 }}>Início</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: T.red }} />
                <span style={{ fontSize: 11, color: T.dim2 }}>Fim</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)', border: `1px solid ${color}22`,
      borderTop: `2px solid ${color}`, borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
    </div>
  );
}

function fmtTs(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
