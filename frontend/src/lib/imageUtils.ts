// frontend/src/lib/imageUtils.ts
// Preparação/compressão de imagem para upload — robusta a HEIC/HEIF.
//
// PROBLEMA que isto resolve: câmeras de iPhone (e alguns Androids com HEIF ligado)
// geram arquivos HEIC. O `createImageBitmap`/`<img>` do Chrome/WebView Android NÃO
// decodificam HEIC, então a compressão via canvas falhava e o arquivo HEIC original
// acabava sendo enviado com nome `.jpg` → imagem QUEBRADA na tela.
//
// Aqui: se a imagem for HEIC/HEIF, convertemos para JPEG (heic2any, carregado sob
// demanda) ANTES de comprimir no canvas. Resultado: sempre um JPEG renderizável.

function ehHeic(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  if (t === 'image/heic' || t === 'image/heif') return true;
  // iOS às vezes manda type vazio; checa a extensão como fallback.
  return /\.(heic|heif)$/i.test(file.name || '');
}

// Converte HEIC/HEIF → JPEG (Blob). heic2any é pesado (libheif wasm), por isso é
// importado dinamicamente só quando realmente há um HEIC.
async function heicParaJpeg(file: File, quality: number): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality });
  return Array.isArray(out) ? out[0] : out;
}

// Captura uma foto pela CÂMERA NATIVA do Capacitor (Android/iOS). Crucial: o WebView
// NÃO decodifica HEIC (de Samsung/iPhone com HEIF ligado) — nem via heic2any (WASM falha
// no WebView) nem via createImageBitmap. Já a câmera nativa decodifica no nível do SO e
// devolve SEMPRE JPEG. Por isso, no app nativo, capturamos por aqui em vez de <input file>.
// Retorna null se o usuário cancelar. Lança se o plugin não estiver disponível.
export async function capturarFotoNativa(quality = 85): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const photo = await Camera.getPhoto({
    quality,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    saveToGallery: false,
    correctOrientation: true,
  });
  if (!photo?.webPath) return null;
  const blob = await (await fetch(photo.webPath)).blob(); // JPEG (plugin transcodifica HEIF→JPEG)
  return new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' });
}

/**
 * Comprime uma imagem para JPEG (máx. `maxW` de largura), convertendo HEIC se preciso.
 * @returns um File JPEG pronto para upload.
 * @throws  se a imagem não puder ser decodificada (ex.: arquivo corrompido).
 */
export async function comprimirImagem(file: File, maxW = 1280, q = 0.82): Promise<File> {
  // 1) HEIC/HEIF → JPEG antes de qualquer coisa.
  let fonte: Blob = file;
  if (ehHeic(file)) {
    fonte = await heicParaJpeg(file, q);
  }

  // 2) Compressão via canvas.
  const bm = await createImageBitmap(fonte);
  const r  = Math.min(1, maxW / bm.width);
  const c  = document.createElement('canvas');
  c.width  = Math.round(bm.width * r);
  c.height = Math.round(bm.height * r);
  c.getContext('2d')?.drawImage(bm, 0, 0, c.width, c.height);
  bm.close?.();

  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', q));
  if (!blob) throw new Error('Falha ao gerar JPEG a partir da imagem.');

  const nome = (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], nome, { type: 'image/jpeg' });
}
