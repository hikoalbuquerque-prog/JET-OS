// frontend/src/lib/uploadUtils.ts
// Upload para Storage com retry + backoff exponencial.
// Flag jet_storage_provider: 'supabase' → Supabase Storage, default → Firebase Storage.
// Paths "ocorrencias/*" → bucket "ocorrencias" (0061); demais → bucket "uploads" (0034).
// A assinatura não muda — 12 call sites inalterados.

import { supabase } from './supabase';

const TENTATIVAS = 4;
const BASE_DELAY = 800; // ms

// Paths que começam com "ocorrencias/" usam o bucket dedicado "ocorrencias"
// (migration 0061). O prefixo é removido para que o object key fique limpo.
function resolveBucket(path: string): { bucket: string; key: string } {
  if (path.startsWith('ocorrencias/')) {
    return { bucket: 'ocorrencias', key: path.slice('ocorrencias/'.length) };
  }
  return { bucket: 'uploads', key: path };
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export const storageProviderSupabase = (): boolean => true;

async function uploadSupabase(file: File | Blob, path: string): Promise<string> {
  const { bucket, key } = resolveBucket(path);
  const { error } = await supabase.storage.from(bucket).upload(key, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return data.publicUrl;
}

export async function getBytesStorage(path: string): Promise<Uint8Array> {
  const { bucket, key } = resolveBucket(path);
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error || !data) throw error || new Error('download falhou');
  return new Uint8Array(await data.arrayBuffer());
}

export async function deleteStorage(path: string): Promise<void> {
  const { bucket, key } = resolveBucket(path);
  const { error } = await supabase.storage.from(bucket).remove([key]);
  if (error) throw error;
}

export async function uploadComRetry(file: File | Blob, path: string): Promise<string> {
  let ultimoErro: unknown;
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      return await uploadSupabase(file, path);
    } catch (err) {
      ultimoErro = err;
      const wait = BASE_DELAY * Math.pow(2, i);
      console.warn(`[upload] tentativa ${i + 1}/${TENTATIVAS} falhou, aguardando ${wait}ms`, err);
      if (i < TENTATIVAS - 1) await delay(wait);
    }
  }
  throw ultimoErro;
}
