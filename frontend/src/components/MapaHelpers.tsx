// MapaHelpers.tsx — Helper components for TelaMapa extracted from App.tsx
import React, { useState, useEffect, useRef, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import L from 'leaflet';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem } from '../lib/imageUtils';
import { fnGeocodeForward } from '../lib/edge-functions';
import i18n from '../i18n/index';
import type { Estacao } from '../lib/app-utils';
import { showToastGlobal } from './ui/ToastQueue';
import { POIPanel } from './POIPanel';
import type { POI } from './POIPanel';


export function PadAssinatura({ onSalvar, onCancelar }: {
  onSalvar: (dataUrl: string) => void;
  onCancelar: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing   = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });

  const getPos = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const start = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current!;
    lastPos.current = getPos(e, canvas);
  };

  const move = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#307FE2';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const end = () => { drawing.current = false; };

  const limpar = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1a1f2e', borderRadius: 14, padding: 20, width: '100%', maxWidth: 340 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
          Assinatura do autorizante
        </div>
        <canvas ref={canvasRef} width={300} height={150}
          style={{ background: '#fff', borderRadius: 8, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={limpar} style={{ flex: 1, padding: 10,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.6)', fontSize: 12, cursor: 'pointer' }}>
            Limpar
          </button>
          <button onClick={onCancelar} style={{ flex: 1, padding: 10,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 8, color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer' }}>
            Pular
          </button>
          <button onClick={() => onSalvar(canvasRef.current!.toDataURL())} style={{ flex: 1, padding: 10,
            background: 'linear-gradient(135deg,#1a6fd4,#307FE2)', border: 'none',
            borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DRAWER ADD/EDIT ──────────────────────────────────────────────
export const CONCORRENTES = ['Tembici','Whoosh','Outro'];

// Botão de foto inline no DrawerAdd — câmera ou galeria
export function FotoBotaoDrawer({ lat, lng, onFotoSalva }: {
  lat: number; lng: number;
  onFotoSalva: (url: string, file?: File) => void;
}) {
  const { t } = useTranslation();
  const [loading,  setLoading]  = useState(false);
  const [preview,  setPreview]  = useState<{base64:string; file:File} | null>(null);
  const [showUrl,  setShowUrl]  = useState(false);
  const [urlVal,   setUrlVal]   = useState('');
  const inputRef   = useRef<HTMLInputElement>(null);
  const inputGalRef = useRef<HTMLInputElement>(null);

  // Upload de base64 (após edição de medidas ou direto)
  const uploadBase64 = async (base64: string, file?: File) => {
    setLoading(true);
    setPreview(null);
    try {
      const ext  = file?.name.split('.').pop() || 'jpg';
      const path = 'estacoes/fotos/' + Date.now() + '_' + Math.random().toString(36).slice(-4) + '.' + ext;
      const fetchRes = await fetch(base64);
      const blob     = await fetchRes.blob();
      const url = await uploadComRetry(blob, path);
      onFotoSalva(url, file);
    } catch (err) {
      console.error('[FotoBotao] upload error:', err);
      showToastGlobal('Erro ao enviar foto. Tente novamente.', 'erro');
    } finally {
      setLoading(false);
    }
  };

  // Comprime (HEIC-safe) e converte para base64 — antes de qualquer upload.
  // Converte HEIC→JPEG antes de comprimir, evitando o bug de foto "quebrada"
  // (HEIC enviado como .jpg que o WebView não renderiza). Ver lib/imageUtils.
  const processarArquivo = async (file: File) => {
    try {
      const compressed = await comprimirImagem(file);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        setPreview({ base64, file: compressed });
      };
      reader.onerror = () => showToastGlobal('Erro ao ler foto. Tente novamente.', 'erro');
      reader.readAsDataURL(compressed);
    } catch (err) {
      console.error('[FotoBotao] compressão falhou:', err);
      showToastGlobal('Erro ao processar foto. Tente novamente.', 'erro');
    }
  };

  const btn: React.CSSProperties = {
    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12,
    background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
    color: 'rgba(255,255,255,.5)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  };

  // Preview local com opções: Salvar direto | Medir área | Refazer
  if (preview) {
    return (
      <div>
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.15)', marginBottom: 8 }}>
          <img src={preview.base64} alt="preview"
            style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setPreview(null)}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: 'rgba(255,255,255,.4)' }}>
            🔄 Refazer
          </button>
          <button type="button" onClick={() => {
            // Abrir editor de medidas com base64 local — sem Firebase, sem CORS
            window.dispatchEvent(new CustomEvent('jetAbrirMedidas', {
              detail: { base64: preview.base64, file: preview.file,
                onSalvar: (b64: string) => uploadBase64(b64, preview.file) }
            }));
          }}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.3)',
              color: '#60a5fa', fontWeight: 600 }}>
            📐 Medir área
          </button>
          <button type="button" onClick={() => uploadBase64(preview.base64, preview.file)}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)',
              color: '#4ade80', fontWeight: 600 }}>
            ✓ Salvar
          </button>
        </div>
      </div>
    );
  }

  const confirmarUrl = () => {
    const u = urlVal.trim();
    if (!u.startsWith('http')) return;
    onFotoSalva(u);
    setShowUrl(false);
    setUrlVal('');
  };

  if (showUrl) return (
    <div>
      <input autoFocus value={urlVal}
        onChange={e => setUrlVal(e.target.value)}
        onPaste={e => setTimeout(() => { if ((e.target as HTMLInputElement).value.startsWith('http')) confirmarUrl(); }, 80)}
        onKeyDown={e => { if (e.key === 'Enter') confirmarUrl(); }}
        placeholder="Cole a URL da imagem (http://...)"
        style={{ width: '100%', padding: '9px 10px', borderRadius: 8, boxSizing: 'border-box' as const,
          background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)',
          color: '#dce8ff', fontSize: 12, outline: 'none', marginBottom: 6 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => { setShowUrl(false); setUrlVal(''); }}
          style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.4)' }}>
          Cancelar
        </button>
        <button type="button" onClick={confirmarUrl}
          style={{ flex: 2, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.3)',
            color: '#4ade80', fontWeight: 600 }}>
          ✓ Usar URL
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={e => { const f=e.target.files?.[0]; if(f) processarArquivo(f); e.target.value=''; }} />
      <input ref={inputGalRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={e => { const f=e.target.files?.[0]; if(f) processarArquivo(f); e.target.value=''; }} />
      {loading ? (
        <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: '#60a5fa',
          background: 'rgba(96,165,250,.08)', borderRadius: 8, border: '1px solid rgba(96,165,250,.2)' }}>
          ⏳ Enviando foto...
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => inputRef.current?.click()}    style={btn} type="button">{`📷 ${t('drawer.camera')}`}</button>
          <button onClick={() => inputGalRef.current?.click()} style={btn} type="button">{`🖼 ${t('drawer.gallery')}`}</button>
          <button onClick={() => setShowUrl(true)}             style={btn} type="button">🔗 URL</button>
        </div>
      )}
    </div>
  );
}

// ── Helper reverseGeocode via Nominatim ──────────────────────────────
async function reverseGeocode(lat: number, lng: number): Promise<Record<string,string> | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt-BR`
    );
    const d = await r.json();
    if (d.address) {
      const a = d.address;
      return {
        endereco: d.display_name || '',
        bairro:   a.suburb || a.neighbourhood || a.city_district || '',
        cidade:   a.city || a.town || a.county || '',
        estado:   a.state || '',
        pais:     a.country_code?.toUpperCase() || 'BR',
      };
    }
  } catch {}
  return null;
}


// ── GeoInputField — 1 campo para coordenada completa ─────────────────
// Aceita: "-8.063116, -34.872091" ou "-8.063116,-34.872091" ou "POINT(-34.87 -8.06)"
export function GeoInputField({ onCoordChange, mapaLocRef, markerLocRef }: {
  onCoordChange: (lat:number, lng:number, geo?:Record<string,string>) => void;
  mapaLocRef: React.MutableRefObject<any>;
  markerLocRef: React.MutableRefObject<any>;
}) {
  const [val, setVal] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);

  const parseGeo = (s: string): {lat:number;lng:number} | null => {
    // Tentar vários formatos
    const nums = s.replace(/[^0-9.,-]/g,' ').trim().split(/[\s,;]+/).filter(Boolean);
    if (nums.length >= 2) {
      const a = parseFloat(nums[0]), b = parseFloat(nums[1]);
      if (!isNaN(a) && !isNaN(b)) {
        // Detectar lat/lng pela magnitude (lat Brasil: -35 a -3, lng: -75 a -30)
        if (a >= -35 && a <= -3 && b >= -75 && b <= -30) return {lat:a, lng:b};
        if (b >= -35 && b <= -3 && a >= -75 && a <= -30) return {lat:b, lng:a};
        // Fora do Brasil mas válidos
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return {lat:a, lng:b};
      }
    }
    return null;
  };

  const aplicar = async () => {
    const coords = parseGeo(val);
    if (!coords) { setErro('Formato inválido. Ex: -8.063116, -34.872091'); setOk(false); return; }
    setErro('');
    try {
      const res = await reverseGeocode(coords.lat, coords.lng) as any;
      const d = res.data as any;
      onCoordChange(coords.lat, coords.lng, d.ok ? d.geo : undefined);
    } catch {
      onCoordChange(coords.lat, coords.lng, undefined);
    }
    if (mapaLocRef.current && markerLocRef.current) {
      mapaLocRef.current.setView([coords.lat, coords.lng], 17);
      markerLocRef.current.setLatLng([coords.lat, coords.lng]);
    }
    setOk(true);
  };

  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ fontSize:9, color:'#7a8ba8', marginBottom:4 }}>
        Cole as coordenadas completas (ex: <code style={{color:'#60a5fa'}}>-8.063116, -34.872091</code>)
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <input
          value={val}
          onChange={e => { setVal(e.target.value); setOk(false); setErro(''); }}
          onKeyDown={e => e.key==='Enter' && aplicar()}
          placeholder="-8.063116, -34.872091"
          style={{ flex:1, padding:'8px 10px', borderRadius:8,
            border:`1px solid ${erro?'rgba(239,68,68,.4)':ok?'rgba(74,222,128,.4)':'rgba(255,255,255,.1)'}`,
            background:'rgba(255,255,255,.06)', color:'#fff', fontSize:12, outline:'none' }}
        />
        <button type="button" onClick={aplicar}
          style={{ padding:'8px 12px', borderRadius:8, cursor:'pointer', border:'none',
            background:'rgba(96,165,250,.2)', color:'#60a5fa', fontSize:12, fontWeight:700 }}>
          ✓
        </button>
      </div>
      {erro && <div style={{ fontSize:9, color:'#f87171', marginTop:3 }}>{erro}</div>}
      {ok   && <div style={{ fontSize:9, color:'#4ade80', marginTop:3 }}>✓ Localização aplicada</div>}
    </div>
  );
}


// ── DrawerLocSelector — GPS / Mapa / Busca para DrawerAdd ────────────
export function DrawerLocSelector({
  latLng, geo, geoLoading, modoLoc, setModoLoc, showMapaLoc, setShowMapaLoc,
  buscaLocEnd, setBuscaLocEnd, buscandoLocEnd, setBuscandoLocEnd,
  mapContainerRef, mapaLocRef, markerLocRef, onCoordChange,
}: {
  latLng: {lat:number;lng:number};
  geo: Record<string,string>;
  geoLoading: boolean;
  modoLoc: string; setModoLoc: (v:any)=>void;
  showMapaLoc: boolean; setShowMapaLoc: (v:boolean)=>void;
  buscaLocEnd: string; setBuscaLocEnd: (v:string)=>void;
  buscandoLocEnd: boolean; setBuscandoLocEnd: (v:boolean)=>void;
  mapContainerRef: React.RefObject<HTMLDivElement>;
  mapaLocRef: React.MutableRefObject<any>;
  markerLocRef: React.MutableRefObject<any>;
  onCoordChange: (lat:number, lng:number, geo?:Record<string,string>) => void;
}) {
  const { t } = useTranslation();
  // Inicializar mapa quando aberto
  useEffect(() => {
    if (!showMapaLoc || !mapContainerRef.current || mapaLocRef.current) return;
    setTimeout(() => {
      if (!mapContainerRef.current) return;
      const map = L.map(mapContainerRef.current, { center:[latLng.lat,latLng.lng], zoom:16, zoomControl:true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { attribution:'©CartoDB', maxZoom:19 }).addTo(map);
      const marker = L.marker([latLng.lat,latLng.lng],{draggable:true}).addTo(map);
      markerLocRef.current = marker;
      marker.on('dragend', async () => {
        const ll = marker.getLatLng();
        try {
          const res = await reverseGeocode(ll.lat, ll.lng) as any;
          const d = res.data as any;
          onCoordChange(ll.lat, ll.lng, d.ok ? d.geo : undefined);
        } catch { onCoordChange(ll.lat, ll.lng, undefined); }
      });
      map.on('click', async (e:L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        try {
          const res = await reverseGeocode(e.latlng.lat, e.latlng.lng) as any;
          const d = res.data as any;
          onCoordChange(e.latlng.lat, e.latlng.lng, d.ok ? d.geo : undefined);
        } catch { onCoordChange(e.latlng.lat, e.latlng.lng, undefined); }
      });
      mapaLocRef.current = map;
    }, 100);
  }, [showMapaLoc]);

  const buscarEndereco = async () => {
    if (!buscaLocEnd.trim()) return;
    setBuscandoLocEnd(true);
    try {
      const res = await fnGeocodeForward()({ address: buscaLocEnd }) as any;
      const d = res.data as any;
      if (d.ok) {
        onCoordChange(d.lat, d.lng, d.geo);
        if (mapaLocRef.current && markerLocRef.current) {
          mapaLocRef.current.setView([d.lat, d.lng], 17);
          markerLocRef.current.setLatLng([d.lat, d.lng]);
        }
      } else {
        showToastGlobal('Endereço não encontrado. Tente ser mais específico.', 'warn');
      }
    } catch (e: any) {
      showToastGlobal('Erro ao buscar endereço: ' + e.message, 'erro');
    }
    setBuscandoLocEnd(false);
  };

  const capturarGPS = () => {
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      try {
        const res = await reverseGeocode(lat, lng) as any;
        const d = res.data as any;
        onCoordChange(lat, lng, d.ok ? d.geo : undefined);
      } catch {
        onCoordChange(lat, lng, undefined);
      }
      if (mapaLocRef.current && markerLocRef.current) {
        mapaLocRef.current.setView([lat,lng],17);
        markerLocRef.current.setLatLng([lat,lng]);
      }
    }, () => showToastGlobal('GPS indisponível', 'warn'));
  };

  const inp: React.CSSProperties = {
    flex:1, padding:'8px 10px', borderRadius:8,
    border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.06)',
    color:'#fff', fontSize:12, outline:'none',
  };

  return (
    <div>
      {/* Botões modo */}
      <div style={{ display:'flex', gap:5, marginBottom:8 }}>
        {[
          { key:'gps',   icon:'📡', label:t('drawer.gps') },
          { key:'mapa',  icon:'🗺',  label:t('drawer.map') },
          { key:'busca', icon:'🔍', label:t('drawer.address') },
          { key:'geo',   icon:'🌐', label:t('drawer.geo') },
        ].map(m => (
          <button key={m.key} type="button" onClick={() => {
            setModoLoc(m.key);
            if (m.key==='mapa') setShowMapaLoc(true); else setShowMapaLoc(false);
            if (m.key==='gps') capturarGPS();
            if (m.key==='geo') setBuscaLocEnd('');
          }} style={{
            flex:1, padding:'7px 4px', borderRadius:8, cursor:'pointer', fontSize:11,
            background: modoLoc===m.key ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.05)',
            border: `1px solid ${modoLoc===m.key ? 'rgba(96,165,250,.4)' : 'rgba(255,255,255,.08)'}`,
            color: modoLoc===m.key ? '#60a5fa' : 'rgba(255,255,255,.45)',
            fontWeight: modoLoc===m.key ? 700 : 400,
          }}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Busca de endereço */}
      {modoLoc === 'busca' && (
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>
          <input value={buscaLocEnd} onChange={e=>setBuscaLocEnd(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&buscarEndereco()}
            placeholder={t('drawer.addressSearch')} style={inp} />
          <button type="button" onClick={buscarEndereco} disabled={buscandoLocEnd}
            style={{ padding:'8px 12px', borderRadius:8, cursor:'pointer', border:'none',
              background:'rgba(96,165,250,.2)', color:'#60a5fa', fontSize:12, fontWeight:700 }}>
            {buscandoLocEnd?'⏳':'🔍'}
          </button>
        </div>
      )}

      {/* Geo — 1 campo para coordenada completa "-8.063116, -34.872091" */}
      {modoLoc === 'geo' && (
        <GeoInputField
          onCoordChange={onCoordChange}
          mapaLocRef={mapaLocRef}
          markerLocRef={markerLocRef}
        />
      )}

      {/* Mapa inline */}
      {showMapaLoc && (
        <div style={{ borderRadius:10, overflow:'hidden', marginBottom:8,
          border:'1px solid rgba(96,165,250,.2)' }}>
          <div style={{ padding:'5px 10px', background:'rgba(96,165,250,.1)',
            fontSize:10, color:'#60a5fa' }}>
            Toque no mapa ou arraste o pin para ajustar
          </div>
          <div ref={mapContainerRef} style={{ width:'100%', height:220 }} />
        </div>
      )}

      {/* Coords atuais */}
      <div style={{ fontSize:9, color:'rgba(255,255,255,.25)', marginBottom:4 }}>
        📍 {latLng.lat.toFixed(6)}, {latLng.lng.toFixed(6)}
        {geoLoading && <span style={{marginLeft:6,color:'#7a8ba8'}}>· geocodificando...</span>}
      </div>
    </div>
  );
}


export function DrawerAdd({ latLng, cidadeAtual, pais, fotoInicial, onSalvar, onFechar, estacaoEdit, onMedirFoto, topOffset = 52 }: {
  latLng: {lat:number;lng:number};
  cidadeAtual: string;
  pais: string;
  fotoInicial?: string;
  onSalvar: (d: Record<string, unknown>) => Promise<void>;
  onFechar: () => void;
  estacaoEdit?: Estacao | null;
  onMedirFoto?: (fotoUrl: string, fotoFile?: File) => void;
  topOffset?: number;
}) {
  const { t } = useTranslation();
  const [tipo,        setTipo]        = useState(estacaoEdit?.tipo      || 'PUBLICA');
  const [status,      setStatus]      = useState(estacaoEdit?.status    || 'SOLICITADO');
  const [largura,     setLargura]     = useState(String(estacaoEdit?.larguraFaixa || ''));
  const [obs,         setObs]         = useState('');
  const [consultor,   setConsultor]   = useState((estacaoEdit as any)?.consultor || '');
  const [fotoUrl,     setFotoUrl]     = useState(fotoInicial || '');
  const [fotoFileRef, setFotoFileRef] = useState<File | undefined>(undefined);

  // Escutar resultado do FotoMedidas (evento global)
  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail as string;
      setFotoUrl(url);
    };
    window.addEventListener('jetFotoMedida', handler);
    return () => window.removeEventListener('jetFotoMedida', handler);
  }, []);
  const [geo,         setGeo]         = useState<Record<string,string>>({ cidade: cidadeAtual, pais });
  const [geoLoading,  setGeoLoading]  = useState(true);
  // LocSelector — modo de localização
  const [modoLoc,     setModoLoc]     = useState<'gps'|'mapa'|'busca'>('gps');
  const [showMapaLoc, setShowMapaLoc] = useState(false);
  const [buscaLocEnd, setBuscaLocEnd] = useState('');
  const [buscandoLocEnd, setBuscandoLocEnd] = useState(false);
  const [coordAtual,  setCoordAtual]  = useState({ lat: latLng.lat, lng: latLng.lng });
  const mapaLocRef2   = useRef<any>(null);
  const markerLocRef2 = useRef<any>(null);
  const mapContainerRef2 = useRef<HTMLDivElement>(null);
  const [busy,        setBusy]        = useState(false);

  // Privado
  const [nomeLocal,   setNomeLocal]   = useState(estacaoEdit?.privado?.nomeLocal        || '');
  const [nomeAuth,    setNomeAuth]    = useState(estacaoEdit?.privado?.nomeAutorizante  || '');
  const [cargoAuth,   setCargoAuth]   = useState(estacaoEdit?.privado?.cargoAutorizante || '');
  const [telAuth,     setTelAuth]     = useState(estacaoEdit?.privado?.telefone         || '');
  const [emailAuth,   setEmailAuth]   = useState(estacaoEdit?.privado?.email            || '');
  const [assinatura,  setAssinatura]  = useState(estacaoEdit?.privado?.assinatura       || '');
  const [showPad,     setShowPad]     = useState(false);

  // Concorrente
  const [nomeConcorrente, setNomeConcorrente] = useState('');
  const [outroConc,       setOutroConc]       = useState('');

  const modoEdicao = !!estacaoEdit;
  const [drawerTab, setDrawerTab] = useState<'form'|'pois'>('form');

  // Geocode reverso — tenta Cloud Function, fallback Nominatim (OSM)
  useEffect(() => {
    setGeoLoading(true);

    const buscarNominatim = () =>
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latLng.lat}&lon=${latLng.lng}&format=json&accept-language=pt-BR`)
        .then(r => r.json())
        .then(d => {
          if (d.address) {
            const a = d.address;
            setGeo({
              endereco:  d.display_name || '',
              bairro:    a.suburb || a.neighbourhood || a.city_district || '',
              cidade:    a.city || a.town || a.municipality || cidadeAtual,
              estado:    a.state || '',
              pais:      a.country_code?.toUpperCase() === 'MX' ? 'MX' : 'BR',
              alcaldia:  a.country_code?.toUpperCase() === 'MX' ? (a.city_district || '') : ''
            });
          }
        });

    reverseGeocode(latLng.lat, latLng.lng)
      .then(r => {
        const d = (r?.data || r) as unknown as { ok: boolean; geo?: Record<string,string> };
        if (d.ok && d.geo && d.geo.endereco) {
          setGeo(d.geo);
        } else {
          return buscarNominatim();
        }
      })
      .catch(() => buscarNominatim())
      .finally(() => setGeoLoading(false));
  }, [latLng.lat, latLng.lng]);

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6
  };

     const handleSalvar = async () => {                                                                 
       setBusy(true);                                                                                   
                                                                                                        
       const privado = tipo === 'PRIVADA' ? {                                                           
         nomeLocal, nomeAutorizante: nomeAuth, cargoAutorizante: cargoAuth,                             
         telefone: telAuth, email: emailAuth,                                                           
         assinatura: assinatura || null                                                                 
       } : null;                                                                                        
                                                                                                        
      const conc = tipo === 'CONCORRENTE'                                                              
        ? (nomeConcorrente === 'Outro' ? outroConc : nomeConcorrente)                                  
        : null;                                                                                        
                                                                                                       
      // Criamos o objeto base                                                                         
      const payload: Record<string, any> = {                                                           
        lat: coordAtual.lat,                                                                           
        lng: coordAtual.lng,                                                                           
        cidade: geo.cidade || cidadeAtual || '',                                                       
        bairro: geo.bairro || '',                                                                      
        endereco: geo.endereco || '',                                                                  
        tipo,                                                                                          
        status,                                                                                        
        larguraFaixa: largura ? parseFloat(largura) : null,                                            
        observacoes:  obs     || null,                                                                 
        nomeConcorrente: conc,                                                                         
        privado,                                                                                       
        geo,                                                                                           
        pais: geo.pais || pais,
      consultor: consultor.trim() || null,                                                           
      fotoUrl:   fotoUrl || null,                                                                    
      };                                                                                               
                                                                                                       
      // ✅ SÓ ADICIONA O ID SE FOR EDIÇÃO                                                              
      if (estacaoEdit?.id) {                                                                           
        payload.id = estacaoEdit.id;                                                                   
      }                                                                                                
                                                                                                       
      if (modoEdicao) {                                                                                
        payload.codigo = estacaoEdit!.codigo;                                                          
      }                                                                                                
                                                                                                       
      await onSalvar(payload);                                                                         
      setBusy(false);                                                                                  
    };                                                                                                                          

  return (
    <>
      <div style={{ position: 'fixed', top: topOffset, right: 0,
        width: typeof window !== 'undefined' && window.innerWidth <= 480 ? '100%' : 400,
        height: 'calc(100% - ' + topOffset + 'px)',
        background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(255,255,255,.08)',
        zIndex: typeof window !== 'undefined' && window.innerWidth <= 480 ? 1050 : 450,
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif',
        overflowY: 'auto', scrollbarWidth: 'thin' as const }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
              {modoEdicao ? t('drawer.editStation') : t('drawer.addStation')}
            </div>
            {modoEdicao && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>
                {estacaoEdit!.codigo}
              </div>
            )}
          </div>
          {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <button onClick={() => setDrawerTab('form')} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: drawerTab === 'form' ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.06)', color: drawerTab === 'form' ? '#60a5fa' : 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          📋 Formulário
        </button>
        <button onClick={() => setDrawerTab('pois')} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: drawerTab === 'pois' ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.06)', color: drawerTab === 'pois' ? '#10b981' : 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          📍 POIs próximos
        </button>
      </div>
      <button onClick={onFechar} style={{ background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
            color: 'rgba(255,255,255,.5)', width: 30, height: 30, cursor: 'pointer', fontSize: 16 }}>x</button>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20,
          flexDirection: 'column', gap: 16, display: drawerTab === 'form' ? 'flex' : 'none' }}>

          {/* LocSelector — GPS / Mapa / Busca */}
          <DrawerLocSelector
            latLng={coordAtual}
            geo={geo}
            geoLoading={geoLoading}
            modoLoc={modoLoc}
            setModoLoc={setModoLoc}
            showMapaLoc={showMapaLoc}
            setShowMapaLoc={setShowMapaLoc}
            buscaLocEnd={buscaLocEnd}
            setBuscaLocEnd={setBuscaLocEnd}
            buscandoLocEnd={buscandoLocEnd}
            setBuscandoLocEnd={setBuscandoLocEnd}
            mapContainerRef={mapContainerRef2}
            mapaLocRef={mapaLocRef2}
            markerLocRef={markerLocRef2}
            onCoordChange={(lat, lng, geoData) => {
              setCoordAtual({ lat, lng });
              if (geoData) setGeo(geoData);
            }}
          />
          {/* Endereço geocodificado (leitura) */}
          {!geoLoading && !showMapaLoc && (
          <div style={{ padding: '8px 12px', borderRadius: 8,
            background: 'rgba(48,127,226,.06)', border: '1px solid rgba(48,127,226,.15)',
            fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            {geo.cidade}{geo.bairro ? ` · ${geo.bairro}` : ''}
            {geo.endereco ? <div style={{ marginTop:2, fontSize:10, color:'rgba(255,255,255,.35)' }}>{geo.endereco}</div> : null}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                    {coordAtual.lat.toFixed(6)}, {coordAtual.lng.toFixed(6)}
                  </span>
                  {modoEdicao && (
                    <button
                      onClick={() => {
                        // Emite evento para o mapa entrar em modo de reposicionamento do pin
                        window.dispatchEvent(new CustomEvent('jetReposicionarPin', {
                          detail: { lat: coordAtual.lat, lng: coordAtual.lng, codigo: estacaoEdit!.codigo }
                        }));
                      }}
                      style={{
                        background: 'rgba(96,165,250,.15)', border: '1px solid rgba(96,165,250,.3)',
                        borderRadius: 6, color: '#60a5fa', fontSize: 10, cursor: 'pointer',
                        padding: '3px 8px', fontWeight: 600,
                      }}
                    >📍 Ajustar pin</button>
                  )}
                </div>
            </div>
          )}

          {/* Foto do local */}
          <div>
            <label style={lbl}>{t('drawer.photo')}</label>
            {fotoUrl ? (
              <div>
                <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(16,185,129,.3)', position: 'relative' }}>
                  <img src={fotoUrl} alt="foto" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(16,185,129,.9)', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#fff', fontWeight: 600 }}>📷 Foto salva</div>
                  <button onClick={() => { setFotoUrl(''); setFotoFileRef(undefined); }}
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}>✕</button>
                </div>
                {/* Botão medir — aparece abaixo da foto */}
                {onMedirFoto && (
                  <button onClick={async () => {
                    // fotoUrl já é base64 se veio da câmera via novo fluxo
                    if (fotoUrl.startsWith('data:') || fotoUrl.startsWith('blob:')) {
                      onMedirFoto(fotoUrl, undefined); return;
                    }
                    // URL remota (foto já salva): converter para base64 via fetch
                    try {
                      const r = await fetch(fotoUrl);
                      const b = await r.blob();
                      const base64 = await new Promise<string>((res, rej) => {
                        const rd = new FileReader(); rd.onload=()=>res(rd.result as string); rd.onerror=rej; rd.readAsDataURL(b);
                      });
                      onMedirFoto(base64, undefined);
                    } catch { onMedirFoto(fotoUrl, undefined); }
                  }}
                    style={{ width: '100%', marginTop: 6, padding: '8px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.25)',
                      color: '#60a5fa', fontSize: 11, fontWeight: 600, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    📐 Marcar área com medidas
                  </button>
                )}
              </div>
            ) : (
              <FotoBotaoDrawer
                lat={latLng.lat} lng={latLng.lng}
                onFotoSalva={(url: string, file?: File) => { setFotoUrl(url); setFotoFileRef(file); }}
              />
            )}
          </div>

          {/* Tipo */}
          <div>
            <label style={lbl}>{t('drawer.stationType')}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { k: 'PUBLICA',      label: t('drawer.public'),      cor: '#3b82f6' },
                { k: 'PRIVADA',      label: t('drawer.private'),      cor: '#f59e0b' },
                { k: 'CONCORRENTE',  label: t('drawer.competitor'),  cor: '#ef4444' }
              ].map(t => (
                <button key={t.k} onClick={() => setTipo(t.k)} style={{
                  flex: 1, padding: '9px 4px', borderRadius: 8, fontSize: 10,
                  fontWeight: 600, cursor: 'pointer',
                  background: tipo === t.k ? `${t.cor}22` : 'rgba(255,255,255,.04)',
                  border: `1px solid ${tipo === t.k ? t.cor + '66' : 'rgba(255,255,255,.08)'}`,
                  color: tipo === t.k ? t.cor : 'rgba(255,255,255,.4)'
                }}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label style={lbl}>{t('drawer.status')}</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              style={{ ...inp, appearance: 'none',
                background: 'rgba(255,255,255,.06)',
                color: status === 'INSTALADO'  ? '#93c5fd' :
                       status === 'APROVADO'   ? '#60a5fa' :
                       status === 'NEGOCIACAO' ? '#fbbf24' :
                       status === 'SOLICITADO' ? '#bfdbfe' :
                       status === 'REPROVADO'  ? '#fca5a5' :
                       status === 'CANCELADO'  ? '#94a3b8' : '#fff',
              }}>
              {[
                { v: 'SOLICITADO', l: t('filters.requested') },
                { v: 'NEGOCIACAO', l: t('filters.negotiation') },
                { v: 'APROVADO',   l: t('filters.approved')   },
                { v: 'INSTALADO',  l: t('filters.installed')  },
                { v: 'REPROVADO',  l: t('filters.rejected')  },
                { v: 'CANCELADO',  l: t('filters.cancelled')  },
              ].map(s => <option key={s.v} value={s.v} style={{ background: '#0d1220', color: '#fff' }}>{s.l}</option>)}
            </select>
          </div>

          {/* Consultor de campo */}
          <div>
            <label style={lbl}>{t('drawer.consultant')}</label>
            <input value={consultor} onChange={e => setConsultor(e.target.value)}
              placeholder={t('drawer.consultantPlaceholder')} style={inp} />
          </div>

          {/* Largura faixa */}
          <div>
            <label style={lbl}>{t('drawer.laneWidth')}</label>
            <input type="number" step="0.1" min="0" value={largura}
              onChange={e => setLargura(e.target.value)}
              placeholder={t('drawer.laneWidthPlaceholder')} style={inp} />
          </div>

          {/* === CONCORRENTE === */}
          {tipo === 'CONCORRENTE' && (
            <div style={{ padding: 14, borderRadius: 10,
              background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)',
              display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>
                Dados do concorrente
              </div>
              <div>
                <label style={lbl}>Empresa</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CONCORRENTES.map(c => (
                    <button key={c} onClick={() => setNomeConcorrente(c)} style={{
                      padding: '6px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                      background: nomeConcorrente === c ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.04)',
                      border: `1px solid ${nomeConcorrente === c ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.08)'}`,
                      color: nomeConcorrente === c ? '#f87171' : 'rgba(255,255,255,.4)'
                    }}>{c}</button>
                  ))}
                </div>
              </div>
              {nomeConcorrente === 'Outro' && (
                <div>
                  <label style={lbl}>Nome do concorrente</label>
                  <input value={outroConc} onChange={e => setOutroConc(e.target.value)}
                    placeholder="Nome da empresa" style={inp} />
                </div>
              )}
            </div>
          )}

          {/* === PRIVADO === */}
          {tipo === 'PRIVADA' && (
            <div style={{ padding: 14, borderRadius: 10,
              background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)',
              display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>
                Dados do local privado
              </div>
              <div>
                <label style={lbl}>Nome do local</label>
                <input value={nomeLocal} onChange={e => setNomeLocal(e.target.value)}
                  placeholder="ex: Shopping Iguatemi" style={inp} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>
                Autorizante
              </div>
              <div>
                <label style={lbl}>Nome completo</label>
                <input value={nomeAuth} onChange={e => setNomeAuth(e.target.value)}
                  placeholder="Nome do responsavel" style={inp} />
              </div>
              <div>
                <label style={lbl}>Cargo</label>
                <input value={cargoAuth} onChange={e => setCargoAuth(e.target.value)}
                  placeholder="ex: Gerente de operacoes" style={inp} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Telefone</label>
                  <input value={telAuth} onChange={e => setTelAuth(e.target.value)}
                    placeholder="(41) 99999-9999" style={inp} type="tel" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>E-mail</label>
                  <input value={emailAuth} onChange={e => setEmailAuth(e.target.value)}
                    placeholder="email@local.com" style={inp} type="email" />
                </div>
              </div>

              {/* Assinatura */}
              <div>
                <label style={lbl}>Assinatura (opcional)</label>
                {assinatura ? (
                  <div style={{ position: 'relative' }}>
                    <img src={assinatura} style={{ width: '100%', background: '#fff',
                      borderRadius: 8, border: '1px solid rgba(255,255,255,.1)' }} />
                    <button onClick={() => setAssinatura('')} style={{
                      position: 'absolute', top: 6, right: 6,
                      background: 'rgba(239,68,68,.8)', border: 'none', borderRadius: 6,
                      color: '#fff', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
                      Limpar
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setShowPad(true)} style={{
                    width: '100%', padding: 12,
                    background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
                    borderRadius: 8, color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer'
                  }}>
                    Assinar aqui
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Observações */}
          <div>
            <label style={lbl}>{t('drawer.observations')}</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)}
              rows={3} placeholder={t('drawer.obsPlaceholder')}
              style={{ ...inp, resize: 'vertical', minHeight: 72 }} />
          </div>
        </div>

        {/* Footer — sempre visível */}
        <div style={{ padding: '16px 20px',
          paddingBottom: typeof window !== 'undefined' && window.innerWidth <= 480 ? 24 : 16,
          borderTop: '1px solid rgba(255,255,255,.06)',
          display: 'flex', gap: 8, flexShrink: 0,
          background: 'rgba(13,18,30,.97)' }}>
          <button onClick={onFechar} style={{ flex: 1, padding: 12,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button disabled={busy} onClick={handleSalvar} style={{ flex: 2, padding: 12,
            background: busy ? 'rgba(48,127,226,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? t('drawer.saving') : modoEdicao ? t('drawer.saveChanges') : t('drawer.addStation')}
          </button>
        </div>

      {/* POI Tab */}
      {drawerTab === 'pois' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <POIPanel
            lat={latLng.lat}
            lng={latLng.lng}
            raio={400}
            onSugerirEndereco={(endereco: string) => {
              setGeo(g => ({ ...g, endereco }));
              setDrawerTab('form');
            }}
          />
        </div>
      )}

      {showPad && (
        <PadAssinatura
          onSalvar={(dataUrl) => { setAssinatura(dataUrl); setShowPad(false); }}
          onCancelar={() => setShowPad(false)}
        />
      )}
      </div>
    </>
  );
}


// ── MODAL EDITAR ZONA EXISTENTE ─────────────────────────────────
export function ZonaEditModal({ zona, onSalvar, onExcluir, onFechar }: {
  zona: Record<string,unknown>;
  onSalvar: (id: string, dados: Record<string,unknown>) => Promise<void>;
  onExcluir: (id: string) => Promise<void>;
  onFechar: () => void;
}) {
  const { t } = useTranslation();
  const [nome,       setNome]       = useState(String(zona.nome       || ''));
  const [grupo,      setGrupo]      = useState(String(zona.grupo      || 'Geral'));
  const [fase,       setFase]       = useState(String(zona.fase       || 'Fase 1'));
  const [cor,        setCor]        = useState(String(zona.cor        || '#2563eb'));
  const [prioridade, setPrioridade] = useState(String(zona.prioridade || '1'));
  const [ativo,      setAtivo]      = useState(zona.ativo !== false);
  const [busy,       setBusy]       = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const CORES = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d'];
  const FASES = ['Fase 1','Fase 2','Fase 3','Expansão','Piloto','Concluída'];

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#1a1f2e', borderRadius: 14, padding: 24,
        width: '100%', maxWidth: 340, border: '1px solid rgba(255,255,255,.08)',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc' }}>Editar Zona</div>
          <button onClick={onFechar} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.5)', width: 28, height: 28,
            cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Nome da área</label>
            <input value={nome} onChange={e => setNome(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Grupo</label>
            <input value={grupo} onChange={e => setGrupo(e.target.value)} style={inp} />
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
                  border: cor === c ? '3px solid white' : '2px solid transparent',
                  cursor: 'pointer'
                }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Prioridade</label>
              <input type="number" min="1" max="10" value={prioridade}
                onChange={e => setPrioridade(e.target.value)} style={{ ...inp, width: 80 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Ativo</label>
              <button onClick={() => setAtivo(v => !v)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                background: ativo ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${ativo ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.1)'}`,
                color: ativo ? '#6ee7b7' : 'rgba(255,255,255,.4)'
              }}>{ativo ? 'Sim' : 'Não'}</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)} style={{
              padding: '11px 14px',
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              borderRadius: 10, color: '#f87171', fontSize: 12, cursor: 'pointer'
            }}>🗑</button>
          ) : (
            <button onClick={async () => {
              setBusy(true);
              await onExcluir(zona.id as string);
              setBusy(false);
            }} style={{
              padding: '11px 14px',
              background: 'rgba(239,68,68,.2)', border: '1px solid rgba(239,68,68,.4)',
              borderRadius: 10, color: '#f87171', fontSize: 11, fontWeight: 700, cursor: 'pointer'
            }}>Confirmar exclusão</button>
          )}
          <button onClick={onFechar} style={{
            flex: 1, padding: 11,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer'
          }}>{t('drawer.cancel')}</button>
          <button disabled={busy} onClick={async () => {
            setBusy(true);
            await onSalvar(zona.id as string, { nome, grupo, fase, cor, prioridade: parseInt(prioridade)||1, ativo });
            setBusy(false);
          }} style={{
            flex: 2, padding: 11,
            background: busy ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
          }}>{busy ? t('drawer.saving') : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CRIAR/EDITAR ZONA ─────────────────────────────────────
export function ZonaFormModal({ coords, cidade, pais, onSalvar, onCancelar }: {
  coords: [number,number][];
  cidade: string;
  pais: string;
  onSalvar: (zona: Record<string,unknown>) => Promise<void>;
  onCancelar: () => void;
}) {
  const { t } = useTranslation();
  const [nome,       setNome]       = useState('');
  const [grupo,      setGrupo]      = useState('Geral');
  const [fase,       setFase]       = useState('Fase 1');
  const [cor,        setCor]        = useState('#2563eb');
  const [prioridade, setPrioridade] = useState('1');
  const [busy,       setBusy]       = useState(false);

  const CORES = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d'];
  const FASES = ['Fase 1','Fase 2','Fase 3','Expansão','Piloto','Concluída'];

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#1a1f2e', borderRadius: 14, padding: 24,
        width: '100%', maxWidth: 340, border: '1px solid rgba(255,255,255,.08)'
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc', marginBottom: 16 }}>
          Nova Zona — {cidade}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 16 }}>
          {coords.length} pontos desenhados
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Nome da área</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="ex: Centro Expandido" style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Grupo</label>
            <input value={grupo} onChange={e => setGrupo(e.target.value)}
              placeholder="ex: Geral, Prioritário" style={inp} />
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
            <div style={{ display: 'flex', gap: 8 }}>
              {CORES.map(c => (
                <button key={c} onClick={() => setCor(c)} style={{
                  width: 28, height: 28, borderRadius: '50%', background: c,
                  border: cor === c ? '3px solid white' : '2px solid transparent',
                  cursor: 'pointer'
                }} />
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Prioridade (1=alta)</label>
            <input type="number" min="1" max="10" value={prioridade}
              onChange={e => setPrioridade(e.target.value)} style={{ ...inp, width: 80 }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onCancelar} style={{
            flex: 1, padding: 11,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer'
          }}>{t('drawer.cancel')}</button>
          <button disabled={busy || !nome} onClick={async () => {
            setBusy(true);
            await onSalvar({
              cidade, pais, nome, grupo, fase, cor,
              prioridade: parseInt(prioridade) || 1,
              ativo: true,
              poligono: coords.map(([lat, lng]) => ({ lat, lng }))
            });
            setBusy(false);
          }} style={{
            flex: 2, padding: 11,
            background: busy || !nome ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy || !nome ? 'not-allowed' : 'pointer'
          }}>
            {busy ? t('drawer.saving') : 'Salvar zona'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SELETOR DE IDIOMAS ───────────────────────────────────────────
export const LANGS = [
  { code: 'pt', label: 'PT', flag: '🇧🇷' },
  { code: 'es', label: 'ES', flag: '🇲🇽' },
  { code: 'en', label: 'EN', flag: '🇺🇸' },
  { code: 'ru', label: 'RU', flag: '🇷🇺' },
];

export function LangSelector() {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState(i18n.language?.slice(0,2) || 'pt');

  const trocar = (code: string) => {
    setLang(code);
    i18n.changeLanguage(code);
    localStorage.setItem('appLang', code);
    setOpen(false);
  };

  const atual = LANGS.find(l => l.code === lang) || LANGS[0];

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
        borderRadius: 8, color: 'rgba(255,255,255,.7)', padding: '4px 8px',
        fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
      }}>
        {atual.flag} {atual.label}
      </button>
      {open && (
        <div style={{
          position: 'fixed', top: 'auto', right: 12, marginTop: 4,
          background: '#1a1f2e', border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 8, overflow: 'hidden', zIndex: 2000, minWidth: 90,
          boxShadow: '0 4px 20px rgba(0,0,0,.6)'
        }}>
          {LANGS.map(l => (
            <button key={l.code} onClick={() => trocar(l.code)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '8px 12px', border: 'none',
              background: l.code === lang ? 'rgba(96,165,250,.15)' : 'transparent',
              color: l.code === lang ? '#60a5fa' : 'rgba(255,255,255,.7)',
              fontSize: 12, cursor: 'pointer', textAlign: 'left'
            }}>
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── APP PRINCIPAL ────────────────────────────────────────────────
type Tela = 'loading' | 'login' | 'mapa' | 'guard' | 'trocar-senha' | 'prestador-pendente';

// ── EXPORT ZONAS ─────────────────────────────────────────────────
export async function exportarZonas(cidade: string, pais: string, formato: 'geojson' | 'csv' | 'wkt') {
  const { data, error } = await supabase
    .from('zonas_geo')
    .select('*')
    .eq('cidade', cidade);
  if (error) throw error;
  const zonas = (data ?? []).map((r: any) => {
    // Converte GeoJSON string → array [{lat,lng}]
    let poligono: any[] = [];
    try {
      const geo = typeof r.geojson === 'string' ? JSON.parse(r.geojson) : r.geojson;
      if (geo?.coordinates?.[0]) {
        poligono = geo.coordinates[0].map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      }
    } catch {}
    return {
      id: r.firebase_id ?? r.id,
      nome: r.nome, grupo: r.grupo, fase: r.fase, cor: r.cor,
      ativo: r.ativo, criadoEm: r.criado_em, importadoEm: null,
      poligono,
    };
  });

  let conteudo = '', nomeArquivo = '', tipo = '';

  if (formato === 'geojson') {
    const features = zonas.map(z => ({
      type: 'Feature',
      properties: { id: z.id, nome: z.nome, grupo: z.grupo, fase: z.fase, cor: z.cor, ativo: z.ativo,
        criadoEm: z.criadoEm?.toDate ? z.criadoEm.toDate().toISOString() : z.criadoEm,
        importadoEm: z.importadoEm },
      geometry: {
        type: 'Polygon',
        coordinates: [z.poligono?.map((p: any) => [p.lng, p.lat]) || []]
      }
    }));
    conteudo = JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
    nomeArquivo = `zonas_${cidade}_${new Date().toISOString().split('T')[0]}.geojson`;
    tipo = 'application/geo+json';

  } else if (formato === 'wkt') {
    const rows = ['WKT,nome,grupo,fase,cor,ativo,criadoEm'];
    for (const z of zonas) {
      const pts = (z.poligono || []).map((p: any) => `${p.lng} ${p.lat}`).join(', ');
      const wkt = `"POLYGON ((${pts}))"`;
      const dt = z.criadoEm?.toDate ? z.criadoEm.toDate().toISOString() : (z.importadoEm || '');
      rows.push(`${wkt},"${z.nome||''}","${z.grupo||''}","${z.fase||''}","${z.cor||''}",${z.ativo!==false},"${dt}"`);
    }
    conteudo = rows.join('\n');
    nomeArquivo = `zonas_${cidade}_${new Date().toISOString().split('T')[0]}.wkt.csv`;
    tipo = 'text/csv';

  } else { // csv simples lat,lng por zona
    const rows = ['nome,grupo,fase,lat,lng,ativo'];
    for (const z of zonas) {
      for (const p of (z.poligono || [])) {
        rows.push(`"${z.nome||''}","${z.grupo||''}","${z.fase||''}",${p.lat},${p.lng},${z.ativo!==false}`);
      }
    }
    conteudo = rows.join('\n');
    nomeArquivo = `zonas_${cidade}_pontos_${new Date().toISOString().split('T')[0]}.csv`;
    tipo = 'text/csv';
  }

  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo; a.click();
  URL.revokeObjectURL(url);
}

// ── OVERPASS HELPERS (inline no App) ────────────────────────────
export function buildOverpassQuery(lat: number, lng: number, raio: number): string {
  const c = lat + ',' + lng;
  const r = String(raio);
  // Cobertura ampla: transporte, gastronomia, saúde, educação, lazer, comércio, pedestres
  return '[out:json][timeout:30];('
    // Transporte
    + 'node["railway"~"subway_entrance|station|tram_stop"](around:' + r + ',' + c + ');'
    + 'node["highway"~"bus_stop|crossing|traffic_signals"](around:' + r + ',' + c + ');'
    + 'node["amenity"~"bus_station|ferry_terminal|taxi"](around:' + r + ',' + c + ');'
    // Gastronomia e vida noturna
    + 'node["amenity"~"restaurant|cafe|fast_food|bar|pub|nightclub|food_court|ice_cream|bakery"](around:' + r + ',' + c + ');'
    // Saúde
    + 'node["amenity"~"pharmacy|hospital|clinic|dentist|veterinary|doctors"](around:' + r + ',' + c + ');'
    // Educação
    + 'node["amenity"~"school|university|college|kindergarten|library"](around:' + r + ',' + c + ');'
    // Financeiro
    + 'node["amenity"~"bank|atm|money_transfer"](around:' + r + ',' + c + ');'
    // Serviços públicos
    + 'node["amenity"~"police|fire_station|post_office|townhall|courthouse|embassy"](around:' + r + ',' + c + ');'
    // Lazer e esporte
    + 'node["leisure"~"park|fitness_centre|sports_centre|stadium|swimming_pool|playground|dance"](around:' + r + ',' + c + ');'
    + 'node["amenity"~"cinema|theatre|arts_centre|casino|gambling|stripclub"](around:' + r + ',' + c + ');'
    // Comércio
    + 'node["shop"~"mall|supermarket|convenience|bakery|clothes|electronics|hairdresser|beauty|hardware"](around:' + r + ',' + c + ');'
    // Turismo e hospedagem
    + 'node["tourism"~"hotel|hostel|motel|museum|attraction|viewpoint|information"](around:' + r + ',' + c + ');'
    // Infraestrutura
    + 'node["amenity"~"parking|fuel|charging_station|bicycle_parking|car_wash"](around:' + r + ',' + c + ');'
    + 'node["amenity"~"recycling|waste_basket|drinking_water|shower|toilets"](around:' + r + ',' + c + ');'
    // Religioso
    + 'node["amenity"~"place_of_worship"](around:' + r + ',' + c + ');'
    // Ways (áreas grandes)
    + 'way["amenity"~"hospital|university|school|park|cinema|stadium"](around:' + r + ',' + c + ');'
    + ');out center qt 600;';
}

export function parseOverpassElements(elements: any[], refLat: number, refLng: number): any[] {
  const R = 6371000;
  function dist(la: number, lo: number) {
    const dLat = (la-refLat)*Math.PI/180, dLon = (lo-refLng)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(refLat*Math.PI/180)*Math.cos(la*Math.PI/180)*Math.sin(dLon/2)**2;
    return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
  }
  const tipoMap: Record<string,string> = {
    // Transporte
    subway_entrance:'subway_entrance',station:'station',tram_stop:'station',
    bus_stop:'bus_stop',bus_station:'bus_station',ferry_terminal:'station',taxi:'taxi',
    crossing:'faixa_pedestre',traffic_signals:'semaforo',
    // Gastronomia
    restaurant:'restaurant',cafe:'cafe',fast_food:'fast_food',bar:'bar',pub:'bar',
    nightclub:'balada',food_court:'restaurant',ice_cream:'cafe',bakery:'bakery',
    // Saúde
    pharmacy:'pharmacy',hospital:'hospital',clinic:'clinic',dentist:'clinic',
    veterinary:'veterinary',doctors:'clinic',
    // Educação
    school:'school',university:'university',college:'university',
    kindergarten:'school',library:'library',
    // Financeiro
    bank:'bank',atm:'bank',money_transfer:'bank',
    // Serviços públicos
    police:'police',fire_station:'police',post_office:'post_office',
    townhall:'governo',courthouse:'governo',embassy:'governo',
    // Lazer
    park:'park',fitness_centre:'fitness_centre',sports_centre:'fitness_centre',
    stadium:'stadium',swimming_pool:'fitness_centre',playground:'park',
    dance:'balada',cinema:'cinema',theatre:'theatre',arts_centre:'theatre',
    casino:'entretenimento',gambling:'entretenimento',stripclub:'balada',
    // Comércio
    mall:'mall',supermarket:'supermarket',convenience:'convenience',
    clothes:'shopping',electronics:'shopping',hairdresser:'servicos',
    beauty:'servicos',hardware:'shopping',
    // Turismo
    hotel:'hotel',hostel:'hotel',motel:'hotel',museum:'museum',
    attraction:'attraction',viewpoint:'viewpoint',information:'attraction',
    // Infraestrutura
    parking:'parking',fuel:'fuel',charging_station:'charging_station',
    bicycle_parking:'parking',car_wash:'servicos',
    // Religioso
    place_of_worship:'religioso',
  };
  const seen = new Set<string>();
  const result: any[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;
    const tags = el.tags || {};
    const nome = tags.name || tags['name:pt'] || '';
    if (!nome) continue;
    const allVals = Object.values(tags) as string[];
    let tipo = 'outros';
    for (const [k, v] of Object.entries(tipoMap)) {
      if (allVals.includes(k)) { tipo = v; break; }
      if (tags.amenity === k || tags.railway === k || tags.highway === k ||
          tags.shop === k || tags.leisure === k || tags.tourism === k) { tipo = v; break; }
    }
    if (tipo === 'outros') continue;
    const uid = el.type + '-' + el.id;
    if (seen.has(uid)) continue;
    seen.add(uid);
    result.push({ id: uid, nome, tipo, lat, lng, distancia: dist(lat, lng), tags, endereco: tags['addr:street'] || '' });
  }
  return result.sort((a: any, b: any) => a.distancia - b.distancia);
}

// ── Modal de detalhe de POI Google (igual ao padrão estações) ───────────
export function POIGoogleDetalheModal({ poi, onFechar }: { poi: any; onFechar: () => void }) {
  const [svFull, setSvFull] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const copiarCoords = () => {
    navigator.clipboard.writeText(poi.lat + ', ' + poi.lng).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 2000);
    });
  };

  const overlay: CSSProperties = {
    position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:9999,
    display:'flex',alignItems:'center',justifyContent:'center',padding:16,
  };
  const card: CSSProperties = {
    background:'#0d1521',border:'1px solid rgba(255,255,255,.1)',borderRadius:16,
    width:'100%',maxWidth:420,maxHeight:'90vh',overflowY:'auto',
    scrollbarWidth:'thin',scrollbarColor:'#1c2535 transparent',
  };
  const row: CSSProperties = { display:'flex',gap:8,padding:'8px 16px' };
  const lbl: CSSProperties = { fontSize:9,color:'#7a8ba8',textTransform:'uppercase',letterSpacing:.5,fontWeight:700 };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={card}>

        {/* Header */}
        <div style={{ padding:'14px 16px 10px',borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:14,fontWeight:700,color:'#dce8ff',marginBottom:2 }}>{poi.nome}</div>
              <div style={{ fontSize:10,color:'#fbbf24',fontWeight:600 }}>{poi.tipo}</div>
            </div>
            <button onClick={onFechar} style={{ background:'none',border:'none',color:'#7a8ba8',fontSize:18,cursor:'pointer',padding:0 }}>✕</button>
          </div>
          {poi.endereco && <div style={{ fontSize:10,color:'#7a8ba8',marginTop:4 }}>{poi.endereco}</div>}
          {poi.rating && (
            <div style={{ fontSize:10,color:'#fbbf24',marginTop:4 }}>
              {'★'.repeat(Math.round(poi.rating))}{'☆'.repeat(5-Math.round(poi.rating))}
              {' '}{poi.rating.toFixed(1)} ({poi.total_ratings} avaliações)
            </div>
          )}
        </div>

        {/* Street View */}
        {poi.street_view_url && (
          <div style={{ position:'relative',cursor:'pointer' }} onClick={() => setSvFull(true)}>
            <img src={poi.street_view_url} alt="Street View"
              style={{ width:'100%',height:160,objectFit:'cover',display:'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
            <div style={{
              position:'absolute',bottom:6,right:8,background:'rgba(0,0,0,.6)',
              borderRadius:6,padding:'2px 7px',fontSize:9,color:'#fff',
            }}>🌐 Street View — clique para ampliar</div>
          </div>
        )}

        {/* Foto do lugar */}
        {poi.foto_url && (
          <img src={poi.foto_url} alt={poi.nome}
            style={{ width:'100%',height:120,objectFit:'cover',display:'block' }}
            onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
        )}

        {/* Ações */}
        <div style={{ ...row, paddingTop:12, flexWrap:'wrap' as const, gap:6 }}>
          {[
            { label:'🗺 Ver no Maps',    cor:'#3b82f6', action: () => window.open(poi.maps_url,'_blank') },
            { label: copiado ? '✓ Copiado!' : '📋 Copiar coords', cor:'#10b981', action: copiarCoords },
            { label:'🌐 Street View',    cor:'#a78bfa', action: () => setSvFull(true) },
          ].map(({ label, cor, action }) => (
            <button key={label} onClick={action} style={{
              background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.1)',
              borderRadius:8,color:cor,fontSize:11,fontWeight:600,
              padding:'6px 12px',cursor:'pointer',
            }}>{label}</button>
          ))}
        </div>

        {/* Coordenadas */}
        <div style={{ padding:'8px 16px 14px' }}>
          <div style={lbl}>Coordenadas</div>
          <div style={{ fontSize:11,color:'#9fb3c8',fontFamily:'monospace',marginTop:3 }}>
            {poi.lat.toFixed(6)}, {poi.lng.toFixed(6)}
          </div>
          {poi.salvoEm?.toDate && (
            <div style={{ fontSize:9,color:'#7a8ba8',marginTop:6 }}>
              Salvo em: {poi.salvoEm.toDate().toLocaleDateString('pt-BR')}
              {poi.fonte === 'google' ? ' · Google Places' : ' · OSM'}
            </div>
          )}
        </div>
      </div>

      {/* Street View fullscreen */}
      {svFull && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.95)',zIndex:10000,
          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}
          onClick={() => setSvFull(false)}>
          <img src={poi.street_view_url} alt="Street View"
            style={{ maxWidth:'95vw',maxHeight:'85vh',borderRadius:12,objectFit:'contain' }}/>
          <div style={{ color:'rgba(255,255,255,.4)',fontSize:11,marginTop:10 }}>
            Clique para fechar · {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Filtros dos POIs Google ───────────────────────────────────────────
export const POI_GOOGLE_LABEL: Record<string,string> = {
  restaurant:'🍽 Restaurante', cafe:'☕ Café', bar:'🍺 Bar', nightclub:'🎵 Balada',
  fast_food:'🍔 Fast Food', bakery:'🥐 Padaria', ice_cream:'🍦 Sorveteria',
  transit_station:'🚇 Metrô/Trem', bus_station:'🚌 Ônibus', taxi:'🚕 Táxi',
  lodging:'🏨 Hotel', hostel:'🛏 Hostel', hotel:'🏨 Hotel',
  shopping_mall:'🛍 Shopping', supermarket:'🛒 Mercado', convenience:'🏪 Conveniência',
  pharmacy:'💊 Farmácia', hospital:'🏥 Hospital', clinic:'🏥 Clínica',
  dentist:'🦷 Dentista', veterinary:'🐾 Veterinário',
  bank:'🏦 Banco', atm:'💳 ATM',
  university:'🎓 Universidade', school:'📚 Escola', library:'📖 Biblioteca',
  park:'🌳 Parque', gym:'💪 Academia', stadium:'🏟 Estádio', swimming_pool:'🏊 Piscina',
  museum:'🏛 Museu', cinema:'🎬 Cinema', theatre:'🎭 Teatro', attraction:'⭐ Atração',
  police:'👮 Polícia', post_office:'📮 Correios', townhall:'🏛 Prefeitura',
  parking:'🅿 Estacionamento', fuel:'⛽ Posto', charging_station:'🔌 Recarga',
  place_of_worship:'⛪ Igreja', beauty:'💅 Beleza', hairdresser:'💈 Barbearia',
  clothes:'👔 Roupa', electronics:'📱 Eletrônico', outros:'📍 Outros',
};

export function POIGoogleFiltros({ dados, tiposAtivos, onChange, bottom }: {
  dados: any[]; tiposAtivos: Set<string>;
  onChange: (s: Set<string>) => void; bottom: number;
}) {
  const tipos = Array.from(new Set(dados.map((p: any) => p.tipo))).sort() as string[];
  const visiveis = tiposAtivos.size > 0 ? dados.filter((p: any) => tiposAtivos.has(p.tipo)).length : dados.length;

  return (
    <div style={{ position:'fixed', bottom, left:'50%', transform:'translateX(-50%)',
      zIndex:1000, width:'min(96vw, 720px)' }}>
      <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:'8px 12px',
        background:'rgba(8,13,24,.97)', borderRadius:12,
        border:'1px solid rgba(251,191,36,.35)',
        boxShadow:'0 4px 24px rgba(0,0,0,.85)', backdropFilter:'blur(12px)',
        maxHeight:170, overflowY:'auto', scrollbarWidth:'thin',
        scrollbarColor:'#1c2535 transparent' }}>
        <div style={{ width:'100%', display:'flex', alignItems:'center',
          justifyContent:'space-between', marginBottom:4 }}>
          <span style={{ fontSize:10, color:'#fbbf24', fontWeight:700 }}>
            🗺 POIs Google — {visiveis} visíveis
          </span>
          <button onClick={() => onChange(new Set())}
            style={{ padding:'2px 10px', borderRadius:8, fontSize:9, cursor:'pointer',
              background:'rgba(251,191,36,.15)', border:'1px solid rgba(251,191,36,.4)',
              color:'#fbbf24', fontWeight:600 }}>
            Todos ({dados.length})
          </button>
        </div>
        {tipos.map(t => {
          const count = dados.filter((p: any) => p.tipo === t).length;
          const ativo = tiposAtivos.has(t);
          const label = POI_GOOGLE_LABEL[t] || ('📍 ' + t);
          return (
            <button key={t} onClick={() => onChange((() => {
              const s = new Set(tiposAtivos); s.has(t) ? s.delete(t) : s.add(t); return s;
            })())} style={{ padding:'3px 10px', borderRadius:10, fontSize:10, cursor:'pointer',
              background: ativo ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${ativo ? '#fbbf24' : 'rgba(255,255,255,.1)'}`,
              color: ativo ? '#fff' : 'rgba(255,255,255,.5)',
              fontWeight: ativo ? 700 : 400, whiteSpace:'nowrap' }}>
              {label} <span style={{ opacity:.65, fontSize:9 }}>({count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ── Tela Trocar Senha — aparece no primeiro acesso ──────────────────

