// src/components/FotoCaptura.tsx
// Fluxo completo: câmera → preview → upload Storage → vincula à estação

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem } from '../lib/imageUtils';

// i18n: padrão do TermosUsoGate — texto em objetos { pt, en, es, ru }, sem chaves json.
const T = {
  prepararUpload:   { pt: 'Preparando upload...', en: 'Preparing upload...', es: 'Preparando subida...', ru: 'Подготовка загрузки...' },
  enviandoFoto:     { pt: 'Enviando foto...', en: 'Uploading photo...', es: 'Subiendo foto...', ru: 'Отправка фото...' },
  erro:             { pt: 'Erro: ', en: 'Error: ', es: 'Error: ', ru: 'Ошибка: ' },
  falhaUpload:      { pt: 'falha no upload', en: 'upload failed', es: 'fallo en la subida', ru: 'сбой загрузки' },
  solteAqui:        { pt: 'Solte aqui 📥', en: 'Drop here 📥', es: 'Suelta aquí 📥', ru: 'Отпустите здесь 📥' },
  tituloAddFoto:    { pt: '🖼 Adicionar foto', en: '🖼 Add photo', es: '🖼 Añadir foto', ru: '🖼 Добавить фото' },
  tituloFotografar: { pt: '📷 Fotografar local', en: '📷 Photograph site', es: '📷 Fotografiar lugar', ru: '📷 Сфотографировать место' },
  tituloConfirmar:  { pt: '🖼 Confirmar foto', en: '🖼 Confirm photo', es: '🖼 Confirmar foto', ru: '🖼 Подтвердить фото' },
  tituloEnviando:   { pt: '⬆ Enviando...', en: '⬆ Uploading...', es: '⬆ Subiendo...', ru: '⬆ Отправка...' },
  tituloSalva:      { pt: '✅ Foto salva!', en: '✅ Photo saved!', es: '✅ ¡Foto guardada!', ru: '✅ Фото сохранено!' },
  novaEstacao:      { pt: 'Nova estação', en: 'New station', es: 'Nueva estación', ru: 'Новая станция' },
  estacao:          { pt: 'Estação ', en: 'Station ', es: 'Estación ', ru: 'Станция ' },
  comoAddSV:        { pt: 'Como adicionar a foto do Street View:', en: 'How to add the Street View photo:', es: 'Cómo añadir la foto de Street View:', ru: 'Как добавить фото из Street View:' },
  passo1a:          { pt: '1. Pressione ', en: '1. Press ', es: '1. Pulsa ', ru: '1. Нажмите ' },
  passo1b:          { pt: ' (ou ', en: ' (or ', es: ' (o ', ru: ' (или ' },
  passo1c:          { pt: ' no Mac)', en: ' on Mac)', es: ' en Mac)', ru: ' на Mac)' },
  passo2:           { pt: '2. Selecione a área do Street View', en: '2. Select the Street View area', es: '2. Selecciona el área de Street View', ru: '2. Выделите область Street View' },
  passo3a:          { pt: '3. Salve e clique em ', en: '3. Save and click ', es: '3. Guarda y haz clic en ', ru: '3. Сохраните и нажмите ' },
  passo3b:          { pt: ' abaixo', en: ' below', es: ' abajo', ru: ' ниже' },
  selecionarArq:    { pt: 'Selecionar arquivo', en: 'Select file', es: 'Seleccionar archivo', ru: 'Выбрать файл' },
  instrucaoFoto:    { pt: 'Tire uma foto do local para registrar a condição real da calçada', en: 'Take a photo of the site to record the real condition of the sidewalk', es: 'Toma una foto del lugar para registrar la condición real de la acera', ru: 'Сделайте фото места, чтобы зафиксировать реальное состояние тротуара' },
  btnSelecionarArq: { pt: '📁 Selecionar arquivo', en: '📁 Select file', es: '📁 Seleccionar archivo', ru: '📁 Выбрать файл' },
  btnAbrirCamera:   { pt: '📷 Abrir câmera', en: '📷 Open camera', es: '📷 Abrir cámara', ru: '📷 Открыть камеру' },
  colarImagem:      { pt: 'Ctrl+V — colar imagem', en: 'Ctrl+V — paste image', es: 'Ctrl+V — pegar imagen', ru: 'Ctrl+V — вставить изображение' },
  colarDesc:        { pt: 'Cole um print ou screenshot copiado', en: 'Paste a copied print or screenshot', es: 'Pega una captura o screenshot copiado', ru: 'Вставьте скопированный снимок экрана' },
  arrasteAqui:      { pt: 'Arraste a imagem aqui', en: 'Drag the image here', es: 'Arrastra la imagen aquí', ru: 'Перетащите изображение сюда' },
  arrasteDesc:      { pt: 'Solte direto neste modal', en: 'Drop it directly in this modal', es: 'Suéltala directamente en este modal', ru: 'Отпустите прямо в этом окне' },
  cancelar:         { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  refazer:          { pt: '🔄 Refazer', en: '🔄 Retake', es: '🔄 Rehacer', ru: '🔄 Переснять' },
  confirmar:        { pt: '✓ Confirmar', en: '✓ Confirm', es: '✓ Confirmar', ru: '✓ Подтвердить' },
  fotoSalva:        { pt: 'Foto salva com sucesso!', en: 'Photo saved successfully!', es: '¡Foto guardada con éxito!', ru: 'Фото успешно сохранено!' },
  vinculadaNovo:    { pt: 'O drawer de cadastro já está com a foto vinculada.', en: 'The registration drawer already has the photo linked.', es: 'El panel de registro ya tiene la foto vinculada.', ru: 'Фото уже привязано к панели регистрации.' },
  vinculadaExist:   { pt: 'Foto associada à estação.', en: 'Photo linked to the station.', es: 'Foto asociada a la estación.', ru: 'Фото привязано к станции.' },
};

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
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

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
    const file = Array.from(e.dataTransfer.files).find(f =>
      f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
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
    setProgress(pick(T.prepararUpload));

    try {
      // Path no Storage
      const ts = Date.now();
      const path = context === 'existente' && estacaoId
        ? `estacoes/${estacaoId}/foto/${ts}_campo.jpg`
        : `estacoes/temp/${ts}_novo.jpg`;

      // Compressão HEIC-safe (ver lib/imageUtils). Converte HEIC→JPEG antes de comprimir,
      // evitando o bug de foto "quebrada" (HEIC enviado como .jpg que o WebView não renderiza).
      const compressed = await comprimirImagem(fotoFile);
      setProgress(pick(T.enviandoFoto));
      const url = await uploadComRetry(compressed, path);

      setFase('done');
      setTimeout(() => {
        onFotoSalva(url, context);
        onClose();
      }, 800);
    } catch (e: any) {
      setProgress(pick(T.erro) + (e.message || pick(T.falhaUpload)));
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
            <div style={{ fontSize: 32, color: '#3d9bff', fontWeight: 700 }}>{pick(T.solteAqui)}</div>
          </div>
        )}

        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1c2535', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff' }}>
              {fase === 'camera' && (origem === 'streetview' ? pick(T.tituloAddFoto) : pick(T.tituloFotografar))}
              {fase === 'preview' && pick(T.tituloConfirmar)}
              {fase === 'uploading' && pick(T.tituloEnviando)}
              {fase === 'done' && pick(T.tituloSalva)}
            </div>
            <div style={{ fontSize: 10, color: '#7a8ba8', marginTop: 2 }}>
              {context === 'novo' ? pick(T.novaEstacao) : `${pick(T.estacao)}${estacaoCodigo || estacaoId}`}
              {lat && lng ? ` · ${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''}
            </div>
          </div>
          {fase !== 'uploading' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7a8ba8', cursor: 'pointer', fontSize: 18 }}>✕</button>
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
                <div style={{ color: '#f5c842', fontWeight: 600, marginBottom: 8 }}>{pick(T.comoAddSV)}</div>
                <div>{pick(T.passo1a)}<b style={{color:'#dce8ff'}}>Windows + Shift + S</b>{pick(T.passo1b)}<b style={{color:'#dce8ff'}}>Cmd+Shift+4</b>{pick(T.passo1c)}</div>
                <div>{pick(T.passo2)}</div>
                <div>{pick(T.passo3a)}<b style={{color:'#3d9bff'}}>{pick(T.selecionarArq)}</b>{pick(T.passo3b)}</div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', textAlign: 'center' }}>
                {pick(T.instrucaoFoto)}
              </div>
            )}
            <button onClick={abrirCamera} style={{ ...btnPrimary, width: '100%', padding: '14px' }}>
              {origem === 'streetview' ? pick(T.btnSelecionarArq) : pick(T.btnAbrirCamera)}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(61,155,255,.06)', borderRadius: 8, border: '1px solid rgba(61,155,255,.15)' }}>
                <span style={{ fontSize: 16 }}>📋</span>
                <div>
                  <div style={{ fontSize: 11, color: '#3d9bff', fontWeight: 600 }}>{pick(T.colarImagem)}</div>
                  <div style={{ fontSize: 10, color: '#7a8ba8' }}>{pick(T.colarDesc)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(61,155,255,.04)', borderRadius: 8, border: '1px dashed rgba(61,155,255,.2)' }}>
                <span style={{ fontSize: 16 }}>🖱</span>
                <div>
                  <div style={{ fontSize: 11, color: '#7a8ba8', fontWeight: 600 }}>{pick(T.arrasteAqui)}</div>
                  <div style={{ fontSize: 10, color: '#2a3a5a' }}>{pick(T.arrasteDesc)}</div>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{ ...btnSecondary, width: '100%' }}>
              {pick(T.cancelar)}
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
                {pick(T.refazer)}
              </button>
              <button onClick={confirmar} style={btnPrimary}>
                {pick(T.confirmar)}
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
            <div style={{ fontSize: 13, color: '#2ecc71', fontWeight: 600 }}>{pick(T.fotoSalva)}</div>
            <div style={{ fontSize: 11, color: '#7a8ba8', textAlign: 'center' }}>
              {context === 'novo' ? pick(T.vinculadaNovo) : pick(T.vinculadaExist)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
