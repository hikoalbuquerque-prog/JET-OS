// src/components/FotoCaptura.tsx
// Fluxo completo: câmera → preview → upload Storage → vincula à estação

import { useState, useEffect, useRef, useCallback } from 'react';
import { uploadComRetry } from '../lib/uploadUtils';

interface Props {
  context: 'novo' | 'existente';
  origem?: 'campo' | 'streetview'; // campo = câmera física, streetview = veio do modal SV
  lat?: number;
  lng?: number;
  estacaoId?: string;
  estacaoCodigo?: string;
  onFotoSalva: (url: string, context: 'novo' | 'existente') => void;
  onClose: () => void;
}

export function FotoCaptura({ context, origem = 'campo', lat, lng, estacaoId, estacaoCodigo, onFotoSalva, onClose }: Props) {
  const [fase, setFase] = useState<'camera'|'preview'|'uploading'|'done'>('camera');
  const [preview, setPreview] = useState<string | null>(null);
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Drag & drop
  const [draggingOver, setDraggingOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(false);
    if (fase !== 'camera') return;
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (!file) return;
    setFotoFile(file);
    setPreview(URL.createObjectURL(file));
    setFase('preview');
  }, [fase]);

  // Paste: Ctrl+V para colar imagem copiada
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (fase !== 'camera') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (!file) continue;
          setFotoFile(file);
          setPreview(URL.createObjectURL(file));
          setFase('preview');
          break;
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [fase]);

  // Abre câmera imediatamente ao montar
  const abrirCamera = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
    setFase('preview');
    e.target.value = '';
  };

  const confirmar = async () => {
    if (!fotoFile) return;
    setFase('uploading');
    setProgress('Preparando upload...');

    try {
      // Path no Storage
      const ts = Date.now();
      const path = context === 'existente' && estacaoId
        ? `estacoes/${estacaoId}/foto/${ts}_campo.jpg`
        : `estacoes/temp/${ts}_novo.jpg`;

      setProgress('Enviando foto...');
      const url = await uploadComRetry(fotoFile, path);

      setFase('done');
      setTimeout(() => {
        onFotoSalva(url, context);
        onClose();
      }, 800);
    } catch (e: any) {
      setProgress('Erro: ' + (e.message || 'falha no upload'));
      setTimeout(() => setFase('preview'), 2000);
    }
  };

  const refazer = () => {
    setPreview(null);
    setFotoFile(null);
    setFase('camera');
    setTimeout(() => inputRef.current?.click(), 100);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 4000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(8px)',
  };

  const card: React.CSSProperties = {
    background: '#0c1018', border: '1px solid #1c2535', borderRadius: 12,
    width: 340, maxWidth: '94vw', overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,.9)',
  };

  const btnPrimary: React.CSSProperties = {
    flex: 1, padding: '12px', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
    color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  };

  const btnSecondary: React.CSSProperties = {
    flex: 1, padding: '12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,.1)',
    background: 'rgba(255,255,255,.04)',
    color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer',
  };

  return (
    <div style={overlay} onClick={fase === 'camera' ? onClose : undefined}>
      <div style={{...card, outline: draggingOver ? '2px dashed #3d9bff' : 'none', background: draggingOver ? '#0d1520' : card.background}}
        onClick={e => e.stopPropagation()}
        onDragOver={e => { e.preventDefault(); if (fase === 'camera') setDraggingOver(true); }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={handleDrop}>
        {draggingOver && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(61,155,255,.08)', borderRadius: 12, zIndex: 10, pointerEvents: 'none' }}>
            <div style={{ fontSize: 32, color: '#3d9bff', fontWeight: 700 }}>Solte aqui 📥</div>
          </div>
        )}

        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1c2535', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff' }}>
              {fase === 'camera' && (origem === 'streetview' ? '🖼 Adicionar foto' : '📷 Fotografar local')}
              {fase === 'preview' && '🖼 Confirmar foto'}
              {fase === 'uploading' && '⬆ Enviando...'}
              {fase === 'done' && '✅ Foto salva!'}
            </div>
            <div style={{ fontSize: 10, color: '#4a5a7a', marginTop: 2 }}>
              {context === 'novo' ? 'Nova estação' : `Estação ${estacaoCodigo || estacaoId}`}
              {lat && lng ? ` · ${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''}
            </div>
          </div>
          {fase !== 'uploading' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a5a7a', cursor: 'pointer', fontSize: 18 }}>✕</button>
          )}
        </div>

        {/* Input câmera oculto */}
        {/* Câmera (campo) ou arquivo (screenshot SV) */}
        <input ref={inputRef} type="file" accept="image/*"
          {...(origem === 'campo' ? { capture: 'environment' as any } : {})}
          style={{ display: 'none' }} onChange={onFileChange} />

        {/* FASE: câmera */}
        {fase === 'camera' && (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 64 }}>{origem === 'streetview' ? '🖼' : '📷'}</div>
            {origem === 'streetview' ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', textAlign: 'center', lineHeight: 1.6 }}>
                <div style={{ color: '#f5c842', fontWeight: 600, marginBottom: 8 }}>Como adicionar a foto do Street View:</div>
                <div>1. Pressione <b style={{color:'#dce8ff'}}>Windows + Shift + S</b> (ou <b style={{color:'#dce8ff'}}>Cmd+Shift+4</b> no Mac)</div>
                <div>2. Selecione a área do Street View</div>
                <div>3. Salve e clique em <b style={{color:'#3d9bff'}}>Selecionar arquivo</b> abaixo</div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', textAlign: 'center' }}>
                Tire uma foto do local para registrar a condição real da calçada
              </div>
            )}
            <button onClick={abrirCamera} style={{ ...btnPrimary, width: '100%', padding: '14px' }}>
              {origem === 'streetview' ? '📁 Selecionar arquivo' : '📷 Abrir câmera'}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(61,155,255,.06)', borderRadius: 8, border: '1px solid rgba(61,155,255,.15)' }}>
                <span style={{ fontSize: 16 }}>📋</span>
                <div>
                  <div style={{ fontSize: 11, color: '#3d9bff', fontWeight: 600 }}>Ctrl+V — colar imagem</div>
                  <div style={{ fontSize: 10, color: '#4a5a7a' }}>Cole um print ou screenshot copiado</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(61,155,255,.04)', borderRadius: 8, border: '1px dashed rgba(61,155,255,.2)' }}>
                <span style={{ fontSize: 16 }}>🖱</span>
                <div>
                  <div style={{ fontSize: 11, color: '#4a5a7a', fontWeight: 600 }}>Arraste a imagem aqui</div>
                  <div style={{ fontSize: 10, color: '#2a3a5a' }}>Solte direto neste modal</div>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{ ...btnSecondary, width: '100%' }}>
              Cancelar
            </button>
          </div>
        )}

        {/* FASE: preview */}
        {fase === 'preview' && preview && (
          <div>
            <div style={{ position: 'relative' }}>
              <img src={preview} alt="preview"
                style={{ width: '100%', maxHeight: 280, objectFit: 'cover', display: 'block' }} />
              <div style={{
                position: 'absolute', bottom: 8, left: 8,
                background: 'rgba(0,0,0,.7)', borderRadius: 6,
                padding: '4px 8px', fontSize: 10, color: '#fff',
              }}>
                {fotoFile ? `${(fotoFile.size / 1024).toFixed(0)} KB` : ''}
              </div>
            </div>
            <div style={{ padding: 16, display: 'flex', gap: 8 }}>
              <button onClick={refazer} style={btnSecondary}>
                🔄 Refazer
              </button>
              <button onClick={confirmar} style={btnPrimary}>
                ✓ Confirmar
              </button>
            </div>
          </div>
        )}

        {/* FASE: uploading */}
        {fase === 'uploading' && (
          <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {preview && <img src={preview} alt="" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 8, opacity: .5 }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 20, height: 20, border: '2px solid #1c2535', borderTopColor: '#3d9bff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: '#3d9bff' }}>{progress}</div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* FASE: done */}
        {fase === 'done' && (
          <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {preview && <img src={preview} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }} />}
            <div style={{ fontSize: 28 }}>✅</div>
            <div style={{ fontSize: 13, color: '#2ecc71', fontWeight: 600 }}>Foto salva com sucesso!</div>
            <div style={{ fontSize: 11, color: '#4a5a7a', textAlign: 'center' }}>
              {context === 'novo' ? 'O drawer de cadastro já está com a foto vinculada.' : 'Foto associada à estação.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
