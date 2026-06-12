// ZonasManager.tsx — Módulo completo de gerenciamento de zonas
import { useState, useEffect, useRef, useCallback } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from './lib/firebase';
import L from 'leaflet';
import JSZip from 'jszip';

interface Zona {
  id: string;
  cidade: string;
  nome: string;
  grupo: string;
  fase: string;
  cor: string;
  prioridade: number;
  ativo: boolean;
  poligono: { lat: number; lng: number }[];
  criadoEm?: any;
  importadoEm?: string;
  atualizadoEm?: any;
}

interface Props {
  cidade: string;
  pais: string;
  onFechar: () => void;
  mapInstance: L.Map | null;
  onMapRefresh?: () => void;
}

const CORES  = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d','#0f766e','#b45309'];
const FASES  = ['Fase 1','Fase 2','Fase 3','Expansão','Piloto','Concluída'];
const GRUPOS = ['Geral','Prioritário','Secundário','Expansão','Piloto'];

// ── EDITOR DE VÉRTICES ───────────────────────────────────────────
function EditorVertices({ zona, onSalvar, onCancelar, mapInstance }: {
  zona: Zona;
  onSalvar: (pontos: { lat: number; lng: number }[]) => Promise<void>;
  onCancelar: () => void;
  mapInstance: L.Map | null;
}) {
  const layerRef   = useRef<L.LayerGroup | null>(null);
  const polyRef    = useRef<L.Polygon | null>(null);
  const ptsRef     = useRef<[number,number][]>(zona.poligono.map(p => [p.lat, p.lng] as [number,number]));
  const markersRef = useRef<L.Marker[]>([]);
  const ignoreClickRef = useRef(false);
  const [count, setCount] = useState(zona.poligono.length);
  const [busy, setBusy]   = useState(false);

  // Cria ícone de vértice numerado
  const makeIcon = (n: number, cor: string) => L.divIcon({
    className: '',
    html: `<div style="
      width:24px;height:24px;border-radius:50%;
      background:${cor};border:2.5px solid white;
      display:flex;align-items:center;justify-content:center;
      font-size:9px;font-weight:800;color:white;
      box-shadow:0 2px 6px rgba(0,0,0,.5);
      cursor:grab;user-select:none">${n}</div>`,
    iconSize: [24,24],
    iconAnchor: [12,12]
  });

  const updatePoly = useCallback(() => {
    if (!layerRef.current) return;
    if (polyRef.current) polyRef.current.remove();
    if (ptsRef.current.length >= 2) {
      polyRef.current = L.polygon(ptsRef.current, {
        color: zona.cor, fillColor: zona.cor,
        fillOpacity: 0.15, weight: 2.5, interactive: false
      }).addTo(layerRef.current);
      polyRef.current.bringToBack();
    }
  }, [zona.cor]);

  const buildMarkers = useCallback(() => {
    // Remove markers antigos
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    const layer = layerRef.current;
    if (!layer) return;

    ptsRef.current.forEach((pt, idx) => {
      const marker = L.marker(pt, {
        icon: makeIcon(idx + 1, zona.cor),
        draggable: true,
        autoPan: false,
        bubblingMouseEvents: false,
        zIndexOffset: 1000
      });

      // DRAG — atualiza ponto e redesenha poly
      marker.on('drag', () => {
        const ll = marker.getLatLng();
        ptsRef.current[idx] = [ll.lat, ll.lng];
        updatePoly();
      });

      marker.on('dragstart', () => {
        if (mapInstance) mapInstance.dragging.disable();
      });

      marker.on('dragend', () => {
        if (mapInstance) mapInstance.dragging.enable();
        setCount(ptsRef.current.length);
      });

      // CONTEXTMENU (right-click) OU duplo clique rápido — remove vértice
      let lastClick = 0;
      const removeVertex = (e?: any) => {
        if (e?.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
        L.DomEvent.stopPropagation(e || {} as any);
        if (ptsRef.current.length <= 3) { alert('Zona precisa de pelo menos 3 vértices'); return; }
        ptsRef.current.splice(idx, 1);
        buildMarkers();
        updatePoly();
      };
      marker.on('contextmenu', removeVertex);
      marker.on('click', (e: any) => {
        L.DomEvent.stopPropagation(e);
        const now = Date.now();
        if (now - lastClick < 350) { removeVertex(e); } // duplo clique manual
        lastClick = now;
      });

      marker.addTo(layer);
      markersRef.current.push(marker);
    });

    setCount(ptsRef.current.length);
  }, [zona.cor, mapInstance, updatePoly]);

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;

    // Centraliza no polígono
    if (zona.poligono.length >= 2) {
      try {
        map.fitBounds(
          L.latLngBounds(zona.poligono.map(p => [p.lat, p.lng] as [number,number])),
          { padding: [80, 80] }
        );
      } catch { /* ignore */ }
    }

    updatePoly();
    buildMarkers();

    // CLICK no mapa — adiciona vértice no final
    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (ignoreClickRef.current) return;
      ptsRef.current = [...ptsRef.current, [e.latlng.lat, e.latlng.lng]];
      buildMarkers();
      updatePoly();
    };

    map.on('click', onMapClick);

    return () => {
      layer.remove();
      map.off('click', onMapClick);
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    };
  }, []);

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1500,
      background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
      borderTop: '1px solid rgba(192,132,252,.3)',
      padding: '12px 20px', fontFamily: 'Inter,sans-serif'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#c084fc', fontWeight: 700 }}>✏️ {zona.nome}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', flex: 1 }}>
          <b style={{ color: '#fff' }}>{count}</b> vértices ·
          <span style={{ color: '#60a5fa' }}> Arraste</span> para mover ·
          <span style={{ color: '#f87171' }}> 2× clique</span> para remover ·
          <span style={{ color: '#6ee7b7' }}> Clique mapa</span> para adicionar
        </div>
        <button onClick={onCancelar} style={{
          padding: '7px 14px', background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
          color: 'rgba(255,255,255,.5)', fontSize: 12, cursor: 'pointer'
        }}>Cancelar</button>
        <button disabled={busy || count < 3} onClick={async () => {
          setBusy(true);
          await onSalvar(ptsRef.current.map(([lat,lng]) => ({ lat, lng })));
          setBusy(false);
        }} style={{
          padding: '7px 18px',
          background: busy || count < 3 ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
          border: 'none', borderRadius: 8, color: '#fff',
          fontSize: 12, fontWeight: 600, cursor: busy || count < 3 ? 'not-allowed' : 'pointer'
        }}>{busy ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </div>
  );
}

// ── FORMULÁRIO DE ZONA ───────────────────────────────────────────
function ZonaForm({ zona, onSalvar, onFechar }: {
  zona?: Partial<Zona>;
  onSalvar: (dados: Partial<Zona>) => Promise<void>;
  onFechar: () => void;
}) {
  const [nome,       setNome]       = useState(zona?.nome       || '');
  const [grupo,      setGrupo]      = useState(zona?.grupo      || 'Geral');
  const [fase,       setFase]       = useState(zona?.fase       || 'Fase 1');
  const [cor,        setCor]        = useState(zona?.cor        || '#2563eb');
  const [prioridade, setPrioridade] = useState(String(zona?.prioridade || 1));
  const [ativo,      setAtivo]      = useState(zona?.ativo !== false);
  const [busy,       setBusy]       = useState(false);

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Nome da área *</label>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Centro Expandido" style={inp} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Grupo</label>
          <select value={grupo} onChange={e => setGrupo(e.target.value)} style={{ ...inp, appearance: 'none' }}>
            {GRUPOS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Prioridade</label>
          <input type="number" min="1" max="10" value={prioridade}
            onChange={e => setPrioridade(e.target.value)} style={inp} />
        </div>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Fase</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FASES.map(f => (
            <button key={f} onClick={() => setFase(f)} style={{
              padding: '5px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
              background: fase === f ? 'rgba(192,132,252,.2)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${fase === f ? 'rgba(192,132,252,.4)' : 'rgba(255,255,255,.08)'}`,
              color: fase === f ? '#c084fc' : 'rgba(255,255,255,.4)'
            }}>{f}</button>
          ))}
        </div>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Cor</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CORES.map(c => (
            <button key={c} onClick={() => setCor(c)} style={{
              width: 28, height: 28, borderRadius: '50%', background: c,
              border: cor === c ? '3px solid white' : '2px solid rgba(255,255,255,.2)',
              cursor: 'pointer'
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>Zona ativa</label>
        <button onClick={() => setAtivo(v => !v)} style={{
          padding: '5px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
          background: ativo ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.04)',
          border: `1px solid ${ativo ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.1)'}`,
          color: ativo ? '#6ee7b7' : 'rgba(255,255,255,.4)'
        }}>{ativo ? 'Ativa' : 'Inativa'}</button>
      </div>
      <button disabled={busy || !nome} onClick={async () => {
        setBusy(true);
        await onSalvar({ nome, grupo, fase, cor, prioridade: parseInt(prioridade)||1, ativo });
        setBusy(false);
      }} style={{
        padding: 12,
        background: busy || !nome ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
        border: 'none', borderRadius: 10, color: '#fff',
        fontSize: 13, fontWeight: 600, cursor: busy || !nome ? 'not-allowed' : 'pointer'
      }}>{busy ? 'Salvando...' : zona?.id ? 'Salvar alterações' : 'Criar zona'}</button>

      <button onClick={onFechar} style={{
        padding: 10, background: 'none', border: 'none',
        color: 'rgba(255,255,255,.3)', fontSize: 12, cursor: 'pointer'
      }}>Cancelar</button>
    </div>
  );
}

// ── MÓDULO PRINCIPAL ─────────────────────────────────────────────
type Vista = 'lista' | 'form' | 'nova_form';

export default function ZonasManager({ cidade, pais, onFechar, mapInstance, onMapRefresh }: Props) {
  const [zonas,        setZonas]        = useState<Zona[]>([]);
  const [vista,        setVista]        = useState<Vista>('lista');
  const [zonaAtiva,    setZonaAtiva]    = useState<Zona | null>(null);
  const [editVertices, setEditVertices] = useState<Zona | null>(null);
  const [filtroAtivo,  setFiltroAtivo]  = useState<'todos'|'ativos'|'inativos'>('todos');
  const [busca,        setBusca]        = useState('');
  const [desenhando,   setDesenhando]   = useState(false);
  const [novosPontos,  setNovosPontos]  = useState<{lat:number;lng:number}[]>([]);
  const drawLayerRef   = useRef<L.LayerGroup | null>(null);
  const drawPolyRef    = useRef<L.Polygon | null>(null);
  const [importando,   setImportando]   = useState(false);
  const [importLog,    setImportLog]    = useState<string[]>([]);
  const kmzInputRef = useRef<HTMLInputElement>(null);

  // Firestore listener
  useEffect(() => {
    if (!cidade) return;
    const q = query(collection(db, 'poligonos'), where('cidade', '==', cidade));
    return onSnapshot(q, snap => {
      setZonas(snap.docs.map(d => ({ id: d.id, ...d.data() } as Zona)));
    });
  }, [cidade]);

  // ── Importar KMZ/KML ─────────────────────────────────────────────────────
  const importarKMZ = async (file: File) => {
    setImportando(true);
    setImportLog(['📂 Lendo arquivo...']);
    const log = (msg: string) => setImportLog(prev => [...prev, msg]);

    try {
      let kmlText = '';

      if (file.name.toLowerCase().endsWith('.kmz')) {
        // KMZ = ZIP com doc.kml dentro
        const zip = await JSZip.loadAsync(file);
        const kmlFile = Object.keys(zip.files).find(n => n.endsWith('.kml'));
        if (!kmlFile) throw new Error('Nenhum .kml encontrado no KMZ');
        kmlText = await zip.files[kmlFile].async('text');
        log(`✅ KMZ extraído: ${kmlFile}`);
      } else {
        kmlText = await file.text();
        log('✅ KML lido');
      }

      const parser = new DOMParser();
      const doc    = parser.parseFromString(kmlText, 'text/xml');

      // Extrai só Placemarks com Polygon (ignora Points = estações)
      const placemarks = Array.from(doc.querySelectorAll('Placemark'));
      const zonasPMs   = placemarks.filter(pm => pm.querySelector('Polygon'));
      log(`📍 ${zonasPMs.length} zonas encontradas (${placemarks.length - zonasPMs.length} estações ignoradas)`);

      // Mapeia cores dos estilos
      const styles: Record<string, string> = {};
      doc.querySelectorAll('Style').forEach(s => {
        const id  = s.getAttribute('id') ?? '';
        const cor = s.querySelector('PolyStyle > color')?.textContent ?? '';
        if (id && cor && cor.length === 8) {
          // KML: aabbggrr → #rrggbb
          const r = cor.slice(6, 8), g = cor.slice(4, 6), b = cor.slice(2, 4);
          styles[id] = `#${r}${g}${b}`;
        }
      });

      let criadas = 0;
      for (const pm of zonasPMs) {
        const nome = pm.querySelector('name')?.textContent?.trim() ?? 'Zona importada';
        const styleUrl = pm.querySelector('styleUrl')?.textContent?.trim().replace('#','') ?? '';
        const cor = styles[styleUrl + '-normal'] ?? styles[styleUrl] ?? '#7c3aed';

        const coordsEl = pm.querySelector('Polygon coordinates, outerBoundaryIs coordinates');
        if (!coordsEl?.textContent) continue;

        const pontos = coordsEl.textContent.trim().split(/\s+/).map(c => {
          const [lng, lat] = c.split(',').map(Number);
          return { lat, lng };
        }).filter(p => isFinite(p.lat) && isFinite(p.lng));

        if (pontos.length < 3) continue;

        const { addDoc, collection: col } = await import('firebase/firestore');
        const { serverTimestamp } = await import('firebase/firestore');
        await addDoc(col(db, 'poligonos'), {
          nome,
          cidade,
          pais,
          cor,
          grupo: 'importado',
          fase: 'operacao',
          prioridade: 1,
          ativo: true,
          poligono: pontos,
          criadoEm: serverTimestamp(),
          importadoDe: file.name,
        });
        criadas++;
        log(`  ✅ ${nome} (${pontos.length} pontos)`);
      }

      log(`
🎉 ${criadas} zonas importadas com sucesso!`);
      if (onMapRefresh) onMapRefresh();
    } catch (e: any) {
      setImportLog(prev => [...prev, `❌ Erro: ${e.message}`]);
    } finally {
      setImportando(false);
    }
  };

  // Modo desenho nova zona
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    if (!desenhando) {
      if (drawLayerRef.current) { drawLayerRef.current.clearLayers(); drawLayerRef.current.remove(); drawLayerRef.current = null; }
      map.getContainer().style.cursor = '';
      return;
    }

    map.getContainer().style.cursor = 'crosshair';
    const layer = L.layerGroup().addTo(map);
    drawLayerRef.current = layer;
    let pts: {lat:number;lng:number}[] = [];

    const onClick = (e: L.LeafletMouseEvent) => {
      pts = [...pts, { lat: e.latlng.lat, lng: e.latlng.lng }];
      setNovosPontos([...pts]);
      if (drawPolyRef.current) drawPolyRef.current.remove();
      if (pts.length >= 2) {
        drawPolyRef.current = L.polygon(pts.map(p => [p.lat,p.lng] as [number,number]), {
          color: '#c084fc', fillColor: '#c084fc', fillOpacity: 0.15, weight: 2, dashArray: '6,4'
        }).addTo(layer);
      }
      L.circleMarker([e.latlng.lat, e.latlng.lng], {
        radius: 5, color: '#c084fc', fillColor: '#c084fc', fillOpacity: 1, weight: 2
      }).addTo(layer);
    };

    const onDblClick = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      if (pts.length < 3) { alert('Desenhe pelo menos 3 pontos.'); return; }
      setDesenhando(false);
      setVista('nova_form');
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    return () => { map.off('click', onClick); map.off('dblclick', onDblClick); map.getContainer().style.cursor = ''; };
  }, [desenhando, mapInstance]);

  const zonasFiltradas = zonas.filter(z => {
    if (filtroAtivo === 'ativos'   && !z.ativo) return false;
    if (filtroAtivo === 'inativos' &&  z.ativo) return false;
    if (busca && !z.nome?.toLowerCase().includes(busca.toLowerCase()) &&
                 !z.grupo?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const salvarZona = async (dados: Partial<Zona>) => {
    if (zonaAtiva?.id) {
      await updateDoc(doc(db, 'poligonos', zonaAtiva.id), { ...dados, atualizadoEm: new Date() });
    } else {
      const id = 'ZONA-' + Date.now();
      await setDoc(doc(db, 'poligonos', id), {
        id, cidade, pais, ...dados,
        poligono: novosPontos,
        criadoEm: new Date(), atualizadoEm: new Date()
      });
      if (drawLayerRef.current) drawLayerRef.current.clearLayers();
      setNovosPontos([]);
    }
    setVista('lista');
    setZonaAtiva(null);
  };

  const excluirZona = async (id: string) => {
    if (!confirm('Excluir esta zona permanentemente?')) return;
    await deleteDoc(doc(db, 'poligonos', id));
    setVista('lista');
    setZonaAtiva(null);
  };

  const salvarVertices = async (pontos: {lat:number;lng:number}[]) => {
    if (!editVertices?.id) return;
    await updateDoc(doc(db, 'poligonos', editVertices.id), {
      poligono: pontos, atualizadoEm: new Date()
    });
    setEditVertices(null);
  };

  const toggleAtivo = async (zona: Zona) => {
    await updateDoc(doc(db, 'poligonos', zona.id), { ativo: !zona.ativo, atualizadoEm: new Date() });
    onMapRefresh?.();
  };

  // Editor de vértices sobrepõe tudo
  if (editVertices) {
    return (
      <EditorVertices
        zona={editVertices}
        mapInstance={mapInstance}
        onSalvar={salvarVertices}
        onCancelar={() => setEditVertices(null)}
      />
    );
  }

  return (
    <>
      {/* Painel lateral */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: 360, height: '100%',
        background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
        borderRight: '1px solid rgba(255,255,255,.08)', zIndex: 1200,
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif'
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0
        }}>
          {vista !== 'lista' ? (
            <button onClick={() => { setVista('lista'); setZonaAtiva(null); setDesenhando(false); }} style={{
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 8, color: 'rgba(255,255,255,.6)', padding: '5px 10px',
              fontSize: 12, cursor: 'pointer'
            }}>← Voltar</button>
          ) : null}
          <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc' }}>
            {vista === 'lista' ? `Zonas — ${cidade}` : vista === 'form' ? 'Editar zona' : 'Nova zona'}
          </div>
          <button onClick={onFechar} style={{
            marginLeft: 'auto', background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
            color: 'rgba(255,255,255,.5)', width: 28, height: 28, cursor: 'pointer', fontSize: 14
          }}>×</button>
        </div>

        {/* LISTA */}
        {vista === 'lista' && (
          <>
            {/* Controles */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar zona..." style={{
                  width: '100%', padding: '8px 12px', marginBottom: 8,
                  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                  borderRadius: 8, color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box'
                }} />
              <div style={{ display: 'flex', gap: 6 }}>
                {(['todos','ativos','inativos'] as const).map(f => (
                  <button key={f} onClick={() => setFiltroAtivo(f)} style={{
                    flex: 1, padding: '5px', borderRadius: 8, fontSize: 10, cursor: 'pointer',
                    background: filtroAtivo === f ? 'rgba(192,132,252,.2)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${filtroAtivo === f ? 'rgba(192,132,252,.4)' : 'rgba(255,255,255,.08)'}`,
                    color: filtroAtivo === f ? '#c084fc' : 'rgba(255,255,255,.4)'
                  }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                ))}
              </div>
            </div>

            {/* Lista de zonas */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
              {zonasFiltradas.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,.3)', fontSize: 13 }}>
                  Nenhuma zona encontrada
                </div>
              )}
              {zonasFiltradas.map(z => (
                <div key={z.id} style={{
                  padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                  background: 'rgba(255,255,255,.03)',
                  border: `1px solid ${z.ativo ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.03)'}`,
                  opacity: z.ativo ? 1 : 0.5
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: z.cor, flexShrink: 0 }} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', flex: 1 }}>
                      {z.nome || '(sem nome)'}
                    </div>
                    {!z.ativo && (
                      <span style={{ fontSize: 9, color: '#f87171', background: 'rgba(239,68,68,.1)',
                        border: '1px solid rgba(239,68,68,.2)', borderRadius: 4, padding: '1px 5px' }}>
                        INATIVA
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>
                    {z.grupo} · {z.fase} · {z.poligono?.length || 0} vértices · P{z.prioridade}
                  </div>
                  {(z.criadoEm || z.importadoEm) && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.25)', marginBottom: 8 }}>
                      📅 {z.importadoEm ? 'Importado' : 'Criado'}: {(() => { try { const dt = z.importadoEm || (z.criadoEm?.toDate ? z.criadoEm.toDate() : new Date(z.criadoEm)); return new Date(dt).toLocaleDateString('pt-BR'); } catch { return '—'; } })()}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => {
                      setZonaAtiva(z);
                      setVista('form');
                      // Centraliza no mapa
                      if (mapInstance && z.poligono?.length > 0) {
                        const bounds = L.latLngBounds(z.poligono.map(p => [p.lat, p.lng] as [number,number]));
                        mapInstance.fitBounds(bounds, { padding: [80, 80] });
                      }
                    }} style={{
                      flex: 1, padding: '6px', fontSize: 10, cursor: 'pointer',
                      background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)',
                      borderRadius: 6, color: 'rgba(255,255,255,.6)'
                    }}>✏️ Editar</button>
                    <button onClick={() => setEditVertices(z)} style={{
                      flex: 1, padding: '6px', fontSize: 10, cursor: 'pointer',
                      background: 'rgba(168,85,247,.1)', border: '1px solid rgba(168,85,247,.2)',
                      borderRadius: 6, color: '#c084fc'
                    }}>⬡ Vértices</button>
                    <button onClick={() => toggleAtivo(z)} style={{
                      flex: 1, padding: '6px', fontSize: 10, cursor: 'pointer',
                      background: z.ativo ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)',
                      border: `1px solid ${z.ativo ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.2)'}`,
                      borderRadius: 6, color: z.ativo ? '#f87171' : '#6ee7b7'
                    }}>{z.ativo ? 'Desativar' : 'Reativar'}</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Botão nova zona */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
              {desenhando ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#c084fc', marginBottom: 8 }}>
                    {novosPontos.length} pontos · Duplo clique para fechar
                  </div>
                  <button onClick={() => { setDesenhando(false); setNovosPontos([]); }} style={{
                    width: '100%', padding: 10,
                    background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)',
                    borderRadius: 10, color: '#f87171', fontSize: 12, cursor: 'pointer'
                  }}>Cancelar desenho</button>
                </div>
              ) : (
                <>
                  <input ref={kmzInputRef} type="file" accept=".kmz,.kml"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) importarKMZ(f); e.target.value = ''; }} />
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <button onClick={() => setDesenhando(true)} style={{
                      flex: 2, padding: 12,
                      background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
                      border: 'none', borderRadius: 10, color: '#fff',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer'
                    }}>+ Desenhar nova zona</button>
                    <button onClick={() => kmzInputRef.current?.click()} style={{
                      flex: 1, padding: 12,
                      background: 'rgba(168,85,247,.1)',
                      border: '1px solid rgba(168,85,247,.3)',
                      borderRadius: 10, color: '#c084fc',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer'
                    }}>📂 KMZ</button>
                  </div>
                </>
              )}

              {/* Log de importação */}
              {importLog.length > 0 && (
                <div style={{
                  marginTop: 8, padding: 10, background: 'rgba(0,0,0,.3)',
                  border: '1px solid rgba(168,85,247,.2)', borderRadius: 8,
                  maxHeight: 180, overflowY: 'auto', fontSize: 11,
                  fontFamily: 'monospace', color: '#c084fc',
                }}>
                  {importLog.map((l, i) => (
                    <div key={i} style={{ marginBottom: 2 }}>{l}</div>
                  ))}
                  {!importando && (
                    <button onClick={() => setImportLog([])} style={{
                      marginTop: 6, width: '100%', padding: '5px',
                      background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)',
                      borderRadius: 6, color: 'rgba(255,255,255,.4)', fontSize: 10, cursor: 'pointer'
                    }}>Fechar log</button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* FORMULÁRIO EDIÇÃO */}
        {(vista === 'form' || vista === 'nova_form') && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            {vista === 'nova_form' && (
              <div style={{
                padding: '8px 12px', borderRadius: 8, marginBottom: 16,
                background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)',
                fontSize: 11, color: '#6ee7b7'
              }}>
                {novosPontos.length} pontos desenhados
              </div>
            )}
            <ZonaForm
              zona={vista === 'form' ? zonaAtiva || {} : {}}
              onSalvar={salvarZona}
              onFechar={() => { setVista('lista'); setZonaAtiva(null); }}
            />
            {vista === 'form' && zonaAtiva?.id && (
              <button onClick={() => excluirZona(zonaAtiva.id)} style={{
                width: '100%', marginTop: 12, padding: 10,
                background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                borderRadius: 10, color: '#f87171', fontSize: 12, cursor: 'pointer'
              }}>🗑 Excluir zona permanentemente</button>
            )}
          </div>
        )}
      </div>

      <style>{`
        .vtx-label { background: transparent; border: none; color: white; font-size: 9px; font-weight: 700; box-shadow: none; }
        .vtx-label::before { display: none; }
      `}</style>
    </>
  );
}
