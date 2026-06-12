// src/components/FotoMedidas.tsx
// Konva para canvas sem CORS/taint — instalar: npm install konva react-konva

import { useState, useRef, useEffect, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Stage, Layer, Image as KImage, Line, Circle, Text, Rect, Group } from 'react-konva';

interface Props {
  fotoUrl: string;
  fotoFile?: File | null;
  onSalvar: (base64: string) => void;
  onCancelar: () => void;
}
interface Pt { x: number; y: number; }

const CORES   = ['#60A5FA', '#34D399', '#FBBF24', '#F87171'];
const HANDLE  = 14;

export function FotoMedidas({ fotoUrl, fotoFile, onSalvar, onCancelar }: Props) {
  const { t } = useTranslation();
  const stageRef     = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [imgEl,       setImgEl]       = useState<HTMLImageElement | null>(null);
  const [imgLoaded,   setImgLoaded]   = useState(false);
  const [size,        setSize]        = useState({ w: 300, h: 500 });
  const [imgPos,      setImgPos]      = useState({ x: 0, y: 0, w: 300, h: 500 });
  const [largura,     setLargura]     = useState(1.50);
  const [comprimento, setComprimento] = useState(5.00);
  const [rot,         setRot]         = useState(0);
  const [pts, setPts] = useState<[Pt,Pt,Pt,Pt]>([
    { x: 50,  y: 160 },
    { x: 250, y: 140 },
    { x: 260, y: 230 },
    { x: 40,  y: 245 },
  ]);

  // ── Medir container ──────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Carregar imagem como base64 puro ────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadImg = (src: string) => {
      const img = new window.Image();
      img.onload = () => { if (!cancelled) setImgEl(img); };
      img.src = src;
    };

    if (fotoFile) {
      const rd = new FileReader();
      rd.onload  = () => { if (!cancelled) loadImg(rd.result as string); };
      rd.onerror = () => loadImg(fotoUrl);
      rd.readAsDataURL(fotoFile);
    } else if (fotoUrl.startsWith('data:') || fotoUrl.startsWith('blob:')) {
      loadImg(fotoUrl);
    } else {
      fetch(fotoUrl)
        .then(r => r.blob())
        .then(b => new Promise<string>((res, rej) => {
          const rd = new FileReader();
          rd.onload  = () => res(rd.result as string);
          rd.onerror = rej;
          rd.readAsDataURL(b);
        }))
        .then(loadImg)
        .catch(() => loadImg(fotoUrl));
    }
    return () => { cancelled = true; };
  }, [fotoUrl, fotoFile]);

  // ── Calcular área da imagem + posição inicial do polígono ────────
  useEffect(() => {
    if (!imgEl || !size.w) return;
    setImgLoaded(true);
    const sc = Math.min(size.w / imgEl.naturalWidth, size.h / imgEl.naturalHeight);
    const rw = imgEl.naturalWidth  * sc;
    const rh = imgEl.naturalHeight * sc;
    const rx = (size.w - rw) / 2;
    const ry = (size.h - rh) / 2;
    setImgPos({ x: rx, y: ry, w: rw, h: rh });
    const cx = rx + rw * 0.5;
    const cy = ry + rh * 0.5;
    const pw = rw * 0.55; const ph = rh * 0.20; const p = rw * 0.03;
    setPts([
      { x: cx - pw/2 + p, y: cy - ph/2 },
      { x: cx + pw/2 - p, y: cy - ph/2 },
      { x: cx + pw/2,     y: cy + ph/2 },
      { x: cx - pw/2,     y: cy + ph/2 },
    ]);
  }, [imgEl, size]);

  // ── Drag handle ──────────────────────────────────────────────────
  const onDrag = (i: number) => (e: any) => {
    setPts(prev => {
      const n = [...prev] as [Pt,Pt,Pt,Pt];
      n[i] = { x: e.target.x(), y: e.target.y() };
      return n;
    });
  };

  // ── Rotação ──────────────────────────────────────────────────────
  const aplicarRot = (deg: number) => {
    setRot(deg);
    const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
    const cy = pts.reduce((a, p) => a + p.y, 0) / 4;
    const rad = (deg * Math.PI) / 180;
    setPts(prev => prev.map(p => {
      const dx = p.x - cx; const dy = p.y - cy;
      return { x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) };
    }) as [Pt,Pt,Pt,Pt]);
  };

  // ── Export via Konva — sem canvas taint ─────────────────────────
  const exportar = () => {
    const stage = stageRef.current;
    if (!stage) return;
    // Esconder handles
    stage.find('.handle').forEach((n: any) => n.hide());
    stage.batchDraw();
    const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.92 });
    stage.find('.handle').forEach((n: any) => n.show());
    stage.batchDraw();
    onSalvar(url);
  };

  // ── Labels perpendiculares aos lados ────────────────────────────
  const midPerp = (a: Pt, b: Pt, offset: number) => {
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l = Math.sqrt(dx*dx + dy*dy) || 1;
    return { x: mx - (dy/l)*offset, y: my + (dx/l)*offset };
  };

  const lc = midPerp(pts[0], pts[1], -30);
  const ll = midPerp(pts[1], pts[2],  36);
  const poly = pts.flatMap(p => [p.x, p.y]);

  const lbl: CSSProperties = {
    fontSize: 9, color: '#4a5a7a', textTransform: 'uppercase' as const,
    letterSpacing: .5, fontWeight: 700, marginBottom: 4,
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'#000',
      display:'flex', flexDirection:'column', fontFamily:'Inter,sans-serif' }}>

      {/* Header */}
      <div style={{ padding:'10px 16px', background:'rgba(10,15,25,.97)',
        borderBottom:'1px solid rgba(255,255,255,.08)', flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>📐 Área da Estação</div>
          <div style={{ fontSize:9, color:'#4a5a7a', marginTop:1 }}>
            Arraste os 4 cantos coloridos · Slider para rotacionar
          </div>
        </div>
        <button onClick={onCancelar}
          style={{ background:'none', border:'none', color:'#4a5a7a', fontSize:20, cursor:'pointer' }}>✕</button>
      </div>

      {/* Konva Stage */}
      <div ref={containerRef} style={{ flex:1, overflow:'hidden', background:'#111', position:'relative' }}>
        {!imgLoaded && (
          <div style={{ position:'absolute', inset:0, display:'flex',
            alignItems:'center', justifyContent:'center' }}>
            <div style={{ color:'#60a5fa', fontSize:13 }}>⏳ Carregando...</div>
          </div>
        )}
        {imgLoaded && (
          <Stage ref={stageRef} width={size.w} height={size.h}>
            <Layer>
              {/* Foto */}
              <KImage image={imgEl!} x={imgPos.x} y={imgPos.y} width={imgPos.w} height={imgPos.h} />

              {/* Polígono */}
              <Line points={poly} closed fill="rgba(255,255,255,0.08)" stroke="white" strokeWidth={2} lineJoin="round" />

              {/* Label comprimento */}
              <Group x={lc.x} y={lc.y}>
                <Rect x={-44} y={-13} width={88} height={26} cornerRadius={8} fill="rgba(255,255,255,0.93)" />
                <Text x={-44} y={-13} width={88} height={26} text={comprimento.toFixed(2) + ' m'}
                  fontSize={12} fontStyle="bold" fill="#111" align="center" verticalAlign="middle" listening={false} />
              </Group>

              {/* Label largura */}
              <Group x={ll.x} y={ll.y}>
                <Rect x={-34} y={-13} width={68} height={26} cornerRadius={8} fill="rgba(255,255,255,0.93)" />
                <Text x={-34} y={-13} width={68} height={26} text={largura.toFixed(2) + ' m'}
                  fontSize={12} fontStyle="bold" fill="#111" align="center" verticalAlign="middle" listening={false} />
              </Group>

              {/* Handles */}
              {pts.map((p, i) => (
                <Group key={i}>
                  <Circle name="handle" x={p.x} y={p.y} radius={HANDLE+4} fill={CORES[i]} opacity={0.25} listening={false} />
                  <Circle name="handle" x={p.x} y={p.y} radius={HANDLE} fill={CORES[i]} stroke="white" strokeWidth={2}
                    draggable onDragMove={onDrag(i)} />
                  <Text name="handle" x={p.x-HANDLE} y={p.y-HANDLE} width={HANDLE*2} height={HANDLE*2}
                    text={['TL','TR','BR','BL'][i]} fontSize={8} fontStyle="bold" fill="white"
                    align="center" verticalAlign="middle" listening={false} />
                </Group>
              ))}
            </Layer>
          </Stage>
        )}
      </div>

      {/* Controles */}
      <div style={{ background:'rgba(10,15,25,.97)', borderTop:'1px solid rgba(255,255,255,.08)',
        padding:'12px 16px', flexShrink:0 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          {([{label:t('photo.length'),val:comprimento,set:setComprimento},{label:t('photo.width'),val:largura,set:setLargura}]).map(({label,val,set})=>(
            <div key={label}>
              <div style={lbl}>{label}</div>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <button onClick={()=>set((v:number)=>Math.max(.1,+(v-.1).toFixed(2)))}
                  style={{ width:30,height:30,borderRadius:7,border:'none',background:'rgba(255,255,255,.1)',color:'#fff',fontSize:18,cursor:'pointer' }}>−</button>
                <input type="number" value={val} step={0.01} min={0.1} onChange={e=>set(+e.target.value)}
                  style={{ flex:1,padding:'5px',borderRadius:7,textAlign:'center',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.06)',color:'#fff',fontSize:14,fontWeight:700 }}/>
                <button onClick={()=>set((v:number)=>+(v+.1).toFixed(2))}
                  style={{ width:30,height:30,borderRadius:7,border:'none',background:'rgba(255,255,255,.1)',color:'#fff',fontSize:18,cursor:'pointer' }}>+</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <div style={lbl}>Rotação: {Math.round(rot)}°</div>
            <button onClick={()=>aplicarRot(0)} style={{ background:'none',border:'none',color:'#4a5a7a',fontSize:10,cursor:'pointer' }}>Resetar</button>
          </div>
          <input type="range" min={-180} max={180} value={rot} onChange={e=>aplicarRot(+e.target.value)}
            style={{ width:'100%', accentColor:'#a78bfa' }}/>
        </div>

        <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' as const }}>
          {['TL topo-esq','TR topo-dir','BR base-dir','BL base-esq'].map((l,i)=>(
            <div key={i} style={{ display:'flex',alignItems:'center',gap:4,fontSize:9,color:'rgba(255,255,255,.35)' }}>
              <div style={{ width:8,height:8,borderRadius:'50%',background:CORES[i] }}/>{l}
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancelar}
            style={{ flex:1,padding:'11px',borderRadius:10,cursor:'pointer',background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',color:'rgba(255,255,255,.5)',fontSize:13,fontWeight:600 }}>
            Cancelar
          </button>
          <button onClick={exportar} disabled={!imgLoaded}
            style={{ flex:2,padding:'11px',borderRadius:10,cursor:'pointer',border:'none',
              background:imgLoaded?'linear-gradient(135deg,#3b82f6,#1d4ed8)':'rgba(59,130,246,.3)',
              color:'#fff',fontSize:14,fontWeight:700 }}>
            💾 Salvar com medidas
          </button>
        </div>
      </div>
    </div>
  );
}
