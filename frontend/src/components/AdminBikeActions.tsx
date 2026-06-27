// AdminBikeActions.tsx — Ações admin de patinetes no mapa GoJet
// Portado do V2: AdminBringToParkingModal + AdminMoveBikeModal + AdminOrganizeParkingModal
// Cria tarefas no Supabase (tabela "tarefas")

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { usuariosReadSupabase, fetchUsuarios } from '../lib/usuarios-supabase';
import { colorForParking, PARKING_COLOR_HEX } from '../lib/parking-colors';
import { classifyBike } from '../lib/bike-classify';

// ─── i18n ─────────────────────────────────────────────────────────────────────

const T = {
  titulo_trazer:   { pt:'🚚 Trazer patinete ao ponto',   en:'🚚 Bring scooter to point',       es:'🚚 Llevar patinete al punto',      ru:'🚚 Доставить самокат к точке' },
  titulo_mover:    { pt:'📍 Levar patinete a um ponto',   en:'📍 Take scooter to a point',      es:'📍 Llevar patinete a un punto',    ru:'📍 Отвезти самокат к точке' },
  titulo_organizar:{ pt:'📦 Organizar ponto',            en:'📦 Organize point',               es:'📦 Organizar punto',               ru:'📦 Организовать точку' },
  selecione_patinete: { pt:'Selecione um patinete',       en:'Select a scooter',                es:'Selecciona un patinete',           ru:'Выберите самокат' },
  selecione_destino:  { pt:'Selecione um ponto destino',  en:'Select a destination point',      es:'Selecciona un punto destino',      ru:'Выберите точку назначения' },
  tarefa_criada:   { pt:'✓ Tarefa criada',                en:'✓ Task created',                  es:'✓ Tarea creada',                   ru:'✓ Задача создана' },
  erro:            { pt:'Erro: ',                          en:'Error: ',                         es:'Error: ',                          ru:'Ошибка: ' },
  patinete:        { pt:'Patinete',                        en:'Scooter',                         es:'Patinete',                         ru:'Самокат' },
  buscar_id:       { pt:'Buscar por identificador…',       en:'Search by identifier…',           es:'Buscar por identificador…',        ru:'Поиск по идентификатору…' },
  ponto_organizar: { pt:'Ponto a organizar',              en:'Point to organize',               es:'Punto a organizar',                ru:'Точка для организации' },
  ponto_destino:   { pt:'Ponto destino',                  en:'Destination point',               es:'Punto destino',                    ru:'Точка назначения' },
  buscar_ponto:    { pt:'Buscar ponto…',                  en:'Search point…',                   es:'Buscar punto…',                    ru:'Поиск точки…' },
  bikes:           { pt:'bikes',                           en:'bikes',                           es:'bikes',                            ru:'самокаты' },
  atribuir_worker: { pt:'Atribuir a worker (opcional)',   en:'Assign to worker (optional)',     es:'Asignar a operario (opcional)',    ru:'Назначить исполнителю (необязательно)' },
  nao_atribuir:    { pt:'— Não atribuir agora —',         en:'— Do not assign now —',           es:'— No asignar ahora —',             ru:'— Не назначать сейчас —' },
  criando:         { pt:'⏳ Criando…',                     en:'⏳ Creating…',                     es:'⏳ Creando…',                       ru:'⏳ Создание…' },
  criar_tarefa:    { pt:'✓ Criar tarefa',                 en:'✓ Create task',                   es:'✓ Crear tarea',                    ru:'✓ Создать задачу' },
};

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
  const { i18n } = useTranslation();
  const lang = (((i18n.language||'pt').slice(0,2)) as 'pt'|'en'|'es'|'ru');
  const pick = (o:{pt:string;en:string;es:string;ru:string}) => o[lang] ?? o.pt;

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
    fetchUsuarios({ cidade, role_in: ['campo', 'logistica', 'motorista'] })
      .then(users => { setWorkers(users.map(u => ({ uid: u.uid, nome: u.nome ?? u.email ?? u.uid }))); })
      .catch(() => {});
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
    if (!bikeSel && modo !== 'organizar') { setMsg(pick(T.selecione_patinete)); return; }
    if (!parkingSel && modo !== 'mover_bike') { setMsg(pick(T.selecione_destino)); return; }
    setCriando(true); setMsg('');
    try {
      const agora = new Date().toISOString();
      const newId = crypto.randomUUID();
      if (modo === 'trazer_bike' || modo === 'mover_bike') {
        const { error } = await supabase.from('tarefas').upsert({
          id: newId,
          cidade, criado_por: gestorUid, criado_em: agora, atualizado_em: agora,
          status: 'pendente',
          assignee_uid: workerSel || null,
          assignee_nome: workers.find(w => w.uid === workerSel)?.nome ?? null,
          prioridade: 3, gerado_por_gojet: true,
          kind: 'PATINETE',
          titulo: `Levar ${bikeSel!.identifier ?? bikeSel!.id.slice(-6)} → ${parkingSel!.name}`,
          descricao: `Trazer patinete até o ponto ${parkingSel!.name}`,
          bike_identifier: bikeSel!.identifier ?? bikeSel!.id,
          bike_lat: bikeSel!.location_lat, bike_lng: bikeSel!.location_lng,
          parking_id: parkingSel!.id, parking_nome: parkingSel!.name,
          parking_lat: parkingSel!.latitude, parking_lng: parkingSel!.longitude,
          target_count: (parkingSel!.target_bikes_count ?? 0) - (parkingSel!.availableCount ?? 0),
        }, { onConflict: 'id' });
        if (error) throw new Error(error.message);
      } else {
        // ORGANIZACAO — cria tarefa para o ponto inteiro
        const { error } = await supabase.from('tarefas').upsert({
          id: newId,
          cidade, criado_por: gestorUid, criado_em: agora, atualizado_em: agora,
          status: 'pendente',
          assignee_uid: workerSel || null,
          assignee_nome: workers.find(w => w.uid === workerSel)?.nome ?? null,
          prioridade: 3, gerado_por_gojet: true,
          kind: 'ORGANIZACAO',
          titulo: `Organizar ${parkingSel!.name}`,
          descricao: `Preencher pontos zerados/baixos na área de ${parkingSel!.name}`,
          parking_id: parkingSel!.id, parking_nome: parkingSel!.name,
          parking_lat: parkingSel!.latitude, parking_lng: parkingSel!.longitude,
          target_count: (parkingSel!.target_bikes_count ?? 0) - (parkingSel!.availableCount ?? 0),
        }, { onConflict: 'id' });
        if (error) throw new Error(error.message);
      }
      setMsg(pick(T.tarefa_criada));
      onCriado?.(newId);
      setTimeout(() => onFechar(), 1200);
    } catch (e: any) {
      setMsg(pick(T.erro) + e.message);
    } finally { setCriando(false); }
  }, [bikeSel, parkingSel, workerSel, modo, cidade, gestorUid, workers, onCriado, onFechar, pick]);

  const TITULO: Record<Modo, string> = {
    trazer_bike: pick(T.titulo_trazer),
    mover_bike:  pick(T.titulo_mover),
    organizar:   pick(T.titulo_organizar),
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
            <label style={S.label}>{pick(T.patinete)}</label>
            <input style={S.inp} placeholder={pick(T.buscar_id)} value={buscaBike} onChange={e=>setBuscaBike(e.target.value)} />
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
            <label style={S.label}>{modo==='organizar'?pick(T.ponto_organizar):pick(T.ponto_destino)}</label>
            {!parkingAlvo && (
              <input style={S.inp} placeholder={pick(T.buscar_ponto)} value={buscaParking} onChange={e=>setBuscaParking(e.target.value)} />
            )}
            {parkingAlvo ? (
              <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', borderRadius:8, padding:'8px 12px', marginBottom:12 }}>
                <div style={{ fontSize:12, color:'#ef4444', fontWeight:700 }}>📍 {parkingAlvo.name}</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,.4)' }}>{parkingAlvo.availableCount ?? 0} / {parkingAlvo.target_bikes_count ?? '—'} {pick(T.bikes)}</div>
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
                        {p.availableCount ?? 0} / {p.target_bikes_count ?? '—'} {pick(T.bikes)}
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
            <label style={S.label}>{pick(T.atribuir_worker)}</label>
            <select value={workerSel} onChange={e=>setWorkerSel(e.target.value)}
              style={{ ...S.inp, appearance:'none' }}>
              <option value="">{pick(T.nao_atribuir)}</option>
              {workers.map(w => <option key={w.uid} value={w.uid}>{w.nome}</option>)}
            </select>
          </>
        )}

        {msg && <div style={{ fontSize:12, color: msg.startsWith('✓')?'#22c55e':'#ef4444', marginBottom:10, textAlign:'center' }}>{msg}</div>}

        <button style={S.btn('#a78bfa')} disabled={criando} onClick={criar}>
          {criando ? pick(T.criando) : pick(T.criar_tarefa)}
        </button>
      </div>
    </div>
  );
}
