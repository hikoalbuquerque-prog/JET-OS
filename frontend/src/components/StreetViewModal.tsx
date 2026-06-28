// src/components/StreetViewModal.tsx
// Painel inline de Street View usando Google Maps Embed API (gratuita)
// Não usa Street View Static API — sem custo

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const T = {
  captureHint:  { pt: 'Abre em nova janela...', en: 'Opens in new window...', es: 'Abre en nueva ventana...', ru: 'Открыть в новом окне...' },
  useImageHint: { pt: 'Cole ou arraste a imagem', en: 'Paste or drag the image', es: 'Pega o arrastra la imagen', ru: 'Вставьте или перетащите изображение' },
  openMaps:     { pt: 'Abrir no Google Maps', en: 'Open in Google Maps', es: 'Abrir en Google Maps', ru: 'Открыть в Google Maps' },
};

interface Props {
  lat: number;
  lng: number;
  nome?: string;
  onClose: () => void;
  onCapturarFoto?: () => void; // opcional — abre câmera após ver o SV
}

const GMAPS_KEY = (import.meta as any).env?.VITE_GMAPS_KEY || '';

export function StreetViewModal({ lat, lng, nome, onClose, onCapturarFoto }: Props) {
  const { t, i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [modo, setModo] = useState<'sv'|'mapa'>('sv');
  const [carregado, setCarregado] = useState(false);
  const [showCapHint, setShowCapHint] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Street View Embed URL — gratuito, sem cobrança por visualização
  const svUrl = GMAPS_KEY
    ? `https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&location=${lat},${lng}&heading=0&pitch=0&fov=90`
    : `https://www.google.com/maps/embed?pb=!4v1&center=${lat},${lng}&zoom=1`;

  // Mapa satélite embed — também gratuito
  const mapUrl = GMAPS_KEY
    ? `https://www.google.com/maps/embed/v1/view?key=${GMAPS_KEY}&center=${lat},${lng}&zoom=19&maptype=satellite`
    : `https://www.google.com/maps/embed?pb=!1m0!3m2!1s0!2z!4m0!3m2!1d${lat}!2d${lng}!5e1!3m2!1spt-BR!2sbr!4v1`;

  const activeUrl = modo === 'sv' ? svUrl : mapUrl;

  useEffect(() => {
    setCarregado(false);
  }, [modo]);

  // Fecha com ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div style={{
        width: '90vw', maxWidth: 860, height: '75vh', maxHeight: 620,
        background: '#0c1018', borderRadius: 12,
        border: '1px solid #1c2535',
        boxShadow: '0 24px 80px rgba(0,0,0,.9)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderBottom: '1px solid #1c2535',
          flexShrink: 0,
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setModo('sv')} style={{
              padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: modo === 'sv' ? 'rgba(61,155,255,.2)' : 'rgba(255,255,255,.06)',
              color: modo === 'sv' ? '#3d9bff' : 'rgba(255,255,255,.4)',
              fontSize: 12, fontWeight: 600,
            }}>
              🌐 {t('streetviewModal.streetView')}
            </button>
            <button onClick={() => setModo('mapa')} style={{
              padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: modo === 'mapa' ? 'rgba(34,197,94,.2)' : 'rgba(255,255,255,.06)',
              color: modo === 'mapa' ? '#22c55e' : 'rgba(255,255,255,.4)',
              fontSize: 12, fontWeight: 600,
            }}>
              🛰 {t('streetviewModal.satellite')}
            </button>
          </div>

          {/* Info */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {nome && <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nome}</div>}
            <div style={{ fontSize: 10, color: '#7a8ba8', fontFamily: "'IBM Plex Mono',monospace" }}>
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          </div>

          {/* Ações */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {onCapturarFoto && (
              <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
                <button onClick={() => {
                  // Abre SV em nova aba no ângulo exato para print fácil
                  const svDirectUrl = modo === 'sv'
                    ? `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m1!1e1`
                    : `https://www.google.com/maps/@${lat},${lng},200m/data=!3m1!1e3`;
                  window.open(svDirectUrl, '_blank', 'width=1000,height=700,noopener');
                  setShowCapHint(true);
                  setTimeout(() => setShowCapHint(false), 8000);
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 6, border: 'none',
                  background: 'rgba(245,200,66,.15)', color: '#f5c842',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }} title={pick(T.captureHint)}>
                  📸 {t('streetviewModal.captureFrame')}
                </button>
                <button onClick={onCapturarFoto} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 6, border: 'none',
                  background: 'rgba(16,185,129,.15)', color: '#10b981',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }} title={pick(T.useImageHint)}>
                  📁 {t('streetviewModal.useImage')}
                </button>
                {showCapHint && (
                  <div style={{
                    position: 'absolute', top: 38, right: 0, zIndex: 100,
                    background: '#0c1018', border: '1px solid #f5c842',
                    borderRadius: 8, padding: '10px 14px', width: 240,
                    boxShadow: '0 8px 24px rgba(0,0,0,.8)',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f5c842', marginBottom: 6 }}>📸 Janela aberta!</div>
                    <div style={{ fontSize: 11, color: '#dce8ff', lineHeight: 1.6 }}>
                      1. Navegue até o ângulo certo<br/>
                      2. <b style={{color:'#f5c842'}}>Win+Shift+S</b> (Mac: Cmd+Shift+4)<br/>
                      3. Selecione a área<br/>
                      4. Volte aqui e clique <b style={{color:'#10b981'}}>📁 Usar imagem</b><br/>
                      5. Cole com <b style={{color:'#3d9bff'}}>Ctrl+V</b> ou arraste
                    </div>
                    <button onClick={() => setShowCapHint(false)} style={{ marginTop: 8, width: '100%', padding: '4px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: '#7a8ba8', cursor: 'pointer', fontSize: 10 }}>
                      Entendi
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => window.open(`https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m1!1e1`, '_blank')}
              style={{
                padding: '6px 10px', borderRadius: 6, border: '1px solid #1c2535',
                background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.5)',
                cursor: 'pointer', fontSize: 11,
              }} title={pick(T.openMaps)}>
              ↗
            </button>
            <button onClick={onClose} style={{
              padding: '6px 10px', borderRadius: 6, border: 'none',
              background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.5)',
              cursor: 'pointer', fontSize: 14,
            }}>✕</button>
          </div>
        </div>

        {/* Iframe */}
        <div style={{ flex: 1, position: 'relative', background: '#050709' }}>
          {!carregado && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, border: '3px solid #1c2535',
                borderTopColor: '#3d9bff', borderRadius: '50%',
                animation: 'spin .7s linear infinite',
              }}/>
              <div style={{ fontSize: 12, color: '#7a8ba8' }}>
                {modo === 'sv' ? t('streetviewModal.loadingSV') : t('streetviewModal.loadingSat')}
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={activeUrl}
            width="100%"
            height="100%"
            style={{
              border: 'none', display: 'block',
              opacity: carregado ? 1 : 0,
              transition: 'opacity .3s',
            }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setCarregado(true)}
          />
        </div>

        {/* Footer info */}
        <div style={{
          padding: '6px 16px', borderTop: '1px solid #1c2535',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: '#7a8ba8' }}>
            {modo === 'sv' ? t('streetviewModal.footerSV') : t('streetviewModal.footerSat')}
          </div>
          <div style={{ fontSize: 9, color: '#1c2535' }}>Google Maps Embed · gratuito</div>
        </div>
      </div>
    </div>
  );
}
