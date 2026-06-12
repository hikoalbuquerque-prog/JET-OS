// AdminBikeActions.tsx — Ações admin de patinetes no mapa GoJet
// Portado do V2: AdminBringToParkingModal + AdminMoveBikeModal + AdminOrganizeParkingModal
// Cria tarefas diretamente no Firestore (coleção "tarefas")

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, addDoc, query, where, getDocs, serverTimestamp, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { colorForParking, PARKING_COLOR_HEX } from '../lib/parking-colors';
import { classifyBike } from '../lib/bike-classify';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ParkingRef {
  id: string; name: string; latitude: number; longitude: number;
  monitor?: boolean; availableCount?: number; target_bikes_count?: number;
}

export interface BikeRef {
  id: string; identifier?: string;
  business_status?: string; business_sub_status?: string;
  disabled?: boolean; ordered?: boolean; booked?: boolean; service_mode?: boolean;
  battery_percent?: number;
  location_lat: number; location_lng: number;
  parking_id?: string | null;
}

type Modo = 'trazer_bike' | 'organizar' | 'mover_bike';

interface Props {
  modo: Modo;
  cidade: string;
  gestorUid: string;
  gestorNome: string;
  // Para "trazer_bike": parking alvo (zerado/baixo)
  parkingAlvo?: ParkingRef;
  // Para "mover_bike": bike selecionada
  bikeAlvo?: BikeRef;
  // Lista completa para seleção
  parkings: ParkingRef[];
  bikes: BikeRef[];
  onFechar: () => void;
  onCriado?: (tarefaId: string) => void;
}

// ─── Helpers geo ─────────────────────────────────────────────────────────────

function dist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function AdminBikeActions({
  modo, cidade, gestorUid, gestorNome,
  parkingAlvo, bikeAlvo, parkings, bikes, onFechar, onCriado,
}: Props) {
  const [buscaBike,    setBuscaBike]    = useState('');
  const [buscaParking, setBuscaParking] = useState('');
  const [bikeSel,      setBikeSel]      = useState<BikeRef | null>(bikeAlvo ?? null);
  const [parkingSel,   setParkingSel]   = useState<ParkingRef | null>(parkingAlvo ?? null);
  const [workers,      setWorkers]      = useState<{uid:string;nome:string}[]>([]);
  const [workerSel,    setWorkerSel]    = useState('');
  const [criando,      setCriando]      = useState(false);
  const [msg,          setMsg]          = useState('');

  // Carrega workers disponíveis
  useEffect(() => {
    getDocs(query(
      collection(db, 'usuarios'),
      where('cidade', '==', cidade),
      where('role', 'in', ['campo', 'logistica', 'motorista']),
    )).then(snap => {
      setWorkers(snap.docs.map(d => ({ uid: d.id, nome: d.data().nome ?? d.data().email ?? d.id })));
    }).catch(() => {});
  }, [cidade]);

  // Bikes disponíveis próximas ao parking alvo, ordenadas por distância
  const bikesDisponiveis = useMemo(() => {
    const ref = parkingAlvo ?? parkingSel;
    return bikes
      .filter(b => classifyBike(b) === 'available' || classifyBike(b) === 'low_battery')
      .filter(b => {
        if (!buscaBike) return true;
        return (b.identifier ?? b.id).toLowerCase().includes(buscaBike.toLowerCase());
      })
      .map(b => ({
        ...b,
        distM: ref ? dist(b.location_lat, b.location_lng, ref.latitude, ref.longitude) : 0,
      }))
      .sort((a, b) => a.distM - b.distM)
      .slice(0, 30);
  }, [bikes, parkingAlvo, parkingSel, buscaBike]);

  // Parkings filtrados para destino (excluindo o alvo)
  const parkingsDestino = useMemo(() => {
    return parkings
      .filter(p => p.id !== bikeAlvo?.parking_id)
      .filter(p => {
        if (!buscaParking) return true;
        return p.name.toLowerCase().includes(buscaParking.toLowerCase());
      })
      .sort((a, b) => {
        // Prioriza monitores zerados/baixos
        const ca = colorForParking(a), cb = colorForParking(b);
        const order: Record<string,number> = { red:5,orange:4,yellow:3,blue:2,green:1,gray:0 };
        return (order[cb]??0) - (order[ca]??0);
      })
      .slice(0, 30);
  }, [parkings, bikeAlvo, buscaParking]);

  const criar = useCallback(async () => {
    if (!bikeSel && modo !== 'organizar') { setMsg('Selecione um patinete'); return; }
    if (!parkingSel && modo !== 'mover_bike') { setMsg('Selecione um ponto destino'); return; }
    setCriando(true); setMsg('');
    try {
      const base = {
        cidade, criadoPor: gestorUid, criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(), status: 'pendente',
        assigneeUid: workerSel || null, assigneeNome: workers.find(w => w.uid === workerSel)?.nome ?? null,
        prioridade: 3, geradoPorGoJet: true,
      };
      let docRef;
      if (modo === 'trazer_bike' || modo === 'mover_bike') {
        docRef = await addDoc(collection(db, 'tarefas'), {
          ...base,
          kind: 'PATINETE',
          titulo: `Levar ${bikeSel!.identifier ?? bikeSel!.id.slice(-6)} → ${parkingSel!.name}`,
          descricao: `Trazer patinete até o ponto ${parkingSel!.name}`,
          bikeIdentifier: bikeSel!.identifier ?? bikeSel!.id,
          bikeLat: bikeSel!.location_lat, bikeLng: bikeSel!.location_lng,
          parkingId: parkingSel!.id, parkingNome: parkingSel!.name,
          parkingLat: parkingSel!.latitude, parkingLng: parkingSel!.longitude,
          targetCount: (parkingSel!.target_bikes_count ?? 0) - (parkingSel!.availableCount ?? 0),
        });
      } else {
        // ORGANIZACAO — cria tarefa para o ponto inteiro
        docRef = await addDoc(collection(db, 'tarefas'), {
          ...base,
          kind: 'ORGANIZACAO',
          titulo: `Organizar ${parkingSel!.name}`,
          descricao: `Preencher pontos zerados/baixos na área de ${parkingSel!.name}`,
          parkingId: parkingSel!.id, parkingNome: parkingSel!.name,
          parkingLat: parkingSel!.latitude, parkingLng: parkingSel!.longitude,
          targetCount: (parkingSel!.target_bikes_count ?? 0) - (parkingSel!.availableCount ?? 0),
        });
      }
      setMsg('✓ Tarefa criada');
      onCriado?.(docRef.id);
      setTimeout(() => onFechar(), 1200);
    } catch (e: any) {
      setMsg('Erro: ' + e.message);
    } finally { setCriando(false); }
  }, [bikeSel, parkingSel, workerSel, modo, cidade, gestorUid, workers, onCriado, onFechar]);

  const TITULO: Record<Modo, string> = {
    trazer_bike: '🚚 Trazer patinete ao ponto',
    mover_bike:  '📍 Levar patinete a um ponto',
    organizar:   '📦 Organizar ponto',
  };

  const S = {
    overlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,.75)', zIndex:3500, display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
    box:     { background:'#1a1f2e', border:'1px solid rgba(255,255,255,.1)', borderRadius:14, padding:20, width:'100%', maxWidth:420, maxHeight:'88vh', overflowY:'auto' as const },
    h:       { fontSize:15, fontWeight:700, color:'#fff', marginBottom:12 },
    label:   { fontSize:11, color:'rgba(255,255,255,.4)', display:'block', marginBottom:5 },
    inp:     { width:'100%', padding:'7px 10px', borderRadius:7, border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.05)', color:'#fff', fontSize:12, marginBottom:10, boxSizing:'border-box' as const },
    item:    (sel:boolean) => ({ padding:'8px 10px', borderRadius:8, border:`1px solid ${sel?'#a78bfa':'rgba(255,255,255,.07)'}`, background: sel?'rgba(167,139,250,.15)':'rgba(255,255,255,.03)', cursor:'pointer', marginBottom:6 }),
    btn:     (c:string) => ({ width:'100%', padding:'10px', borderRadius:10, border:'none', background:c, color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer' }),
  };

  return (
    <div style={S.overlay} onClick={e => e.target===e.currentTarget && onFechar()}>
      <div style={S.box}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14 }}>
          <div style={S.h}>{TITULO[modo]}</div>
          <button onClick={onFechar} style={{ background:'none',border:'none',color:'rgba(255,255,255,.4)',fontSize:18,cursor:'pointer' }}>✕</button>
        </div>

        {/* Seleção de bike (para trazer_bike ou mover_bike) */}
        {(modo === 'trazer_bike' || modo === 'mover_bike') && !bikeAlvo && (
          <>
            <label style={S.label}>Patinete</label>
            <input style={S.inp} placeholder="Buscar por identificador…" value={buscaBike} onChange={e=>setBuscaBike(e.target.value)} />
            <div style={{ maxHeight:180, overflowY:'auto' }}>
              {bikesDisponiveis.map(b => (
                <div key={b.id} style={S.item(bikeSel?.id===b.id)} onClick={()=>setBikeSel(b)}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:12, color:'#fff', fontWeight:700 }}>🛴 {b.identifier ?? b.id.slice(-6)}</span>
                    <span style={{ fontSize:10, color:'rgba(255,255,255,.4)' }}>{b.distM ? `${Math.round(b.distM)}m` : ''}</span>
                  </div>
                  {b.battery_percent != null && (
                    <div style={{ fontSize:10, color: b.battery_percent<0.2?'#ef4444':'#22c55e' }}>
                      ⚡ {Math.round(b.battery_percent*100)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {bikeAlvo && (
          <div style={{ background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.2)', borderRadius:8, padding:'8px 12px', marginBottom:12 }}>
            <div style={{ fontSize:12, color:'#a78bfa', fontWeight:700 }}>🛴 {bikeAlvo.identifier ?? bikeAlvo.id.slice(-6)}</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.4)' }}>⚡ {bikeAlvo.battery_percent!=null ? Math.round(bikeAlvo.battery_percent*100)+'%' : '—'}</div>
          </div>
        )}

        {/* Seleção de parking destino */}
        {(modo !== 'mover_bike' || bikeSel) && (
          <>
            <label style={S.label}>{modo==='organizar'?'Ponto a organizar':'Ponto destino'}</label>
            {!parkingAlvo && (
              <input style={S.inp} placeholder="Buscar ponto…" value={buscaParking} onChange={e=>setBuscaParking(e.target.value)} />
            )}
            {parkingAlvo ? (
              <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', borderRadius:8, padding:'8px 12px', marginBottom:12 }}>
                <div style={{ fontSize:12, color:'#ef4444', fontWeight:700 }}>📍 {parkingAlvo.name}</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,.4)' }}>{parkingAlvo.availableCount ?? 0} / {parkingAlvo.target_bikes_count ?? '—'} bikes</div>
              </div>
            ) : (
              <div style={{ maxHeight:180, overflowY:'auto' }}>
                {parkingsDestino.map(p => {
                  const cor = colorForParking(p);
                  return (
                    <div key={p.id} style={S.item(parkingSel?.id===p.id)} onClick={()=>setParkingSel(p)}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ width:8, height:8, borderRadius:'50%', background:PARKING_COLOR_HEX[cor], flexShrink:0 }} />
                        <span style={{ fontSize:12, color:'#fff' }}>{p.name}</span>
                        {p.monitor && <span style={{ fontSize:9, background:'rgba(167,139,250,.15)', color:'#a78bfa', borderRadius:3, padding:'1px 4px' }}>MON</span>}
                      </div>
                      <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', marginTop:2, paddingLeft:14 }}>
                        {p.availableCount ?? 0} / {p.target_bikes_count ?? '—'} bikes
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Atribuir worker (opcional) */}
        {workers.length > 0 && (
          <>
            <label style={S.label}>Atribuir a worker (opcional)</label>
            <select value={workerSel} onChange={e=>setWorkerSel(e.target.value)}
              style={{ ...S.inp, appearance:'none' }}>
              <option value="">— Não atribuir agora —</option>
              {workers.map(w => <option key={w.uid} value={w.uid}>{w.nome}</option>)}
            </select>
          </>
        )}

        {msg && <div style={{ fontSize:12, color: msg.startsWith('✓')?'#22c55e':'#ef4444', marginBottom:10, textAlign:'center' }}>{msg}</div>}

        <button style={S.btn('#a78bfa')} disabled={criando} onClick={criar}>
          {criando ? '⏳ Criando…' : '✓ Criar tarefa'}
        </button>
      </div>
    </div>
  );
}
