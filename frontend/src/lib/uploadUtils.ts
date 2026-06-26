// frontend/src/lib/uploadUtils.ts
// Upload para Storage com retry + backoff exponencial.
// Flag jet_storage_provider: 'supabase' → Supabase Storage (bucket "uploads"),
// default → Firebase Storage. A assinatura não muda — 12 call sites inalterados.

import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';
import { supabase } from './supabase';

const TENTATIVAS = 4;
const BASE_DELAY = 800; // ms

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export const storageProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_storage_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_STORAGE_PROVIDER as string) !== 'firebase';
};

async function uploadSupabase(file: File | Blob, path: string): Promise<string> {
  const { error } = await supabase.storage.from('uploads').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('uploads').getPublicUrl(path);
  return data.publicUrl;
}

export async function getBytesStorage(path: string): Promise<Uint8Array> {
  if (storageProviderSupabase()) {
    const { data, error } = await supabase.storage.from('uploads').download(path);
    if (error || !data) throw error || new Error('download falhou');
    return new Uint8Array(await data.arrayBuffer());
  }
  const { ref: sRef, getBytes } = await import('firebase/storage');
  const { storage: fbStorage } = await import('./firebase');
  return new Uint8Array(await getBytes(sRef(fbStorage, path)));
}

export async function deleteStorage(path: string): Promise<void> {
  if (storageProviderSupabase()) {
    const { error } = await supabase.storage.from('uploads').remove([path]);
    if (error) throw error;
    return;
  }
  const { ref: sRef, deleteObject } = await import('firebase/storage');
  const { storage: fbStorage } = await import('./firebase');
  await deleteObject(sRef(fbStorage, path));
}

export async function uploadComRetry(file: File | Blob, path: string): Promise<string> {
  const useSupa = storageProviderSupabase();
  let ultimoErro: unknown;
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      if (useSupa) return await uploadSupabase(file, path);
      const r = storageRef(storage, path);
      await uploadBytes(r, file);
      return await getDownloadURL(r);
    } catch (err) {
      ultimoErro = err;
      const wait = BASE_DELAY * Math.pow(2, i);
      console.warn(`[upload] tentativa ${i + 1}/${TENTATIVAS} falhou, aguardando ${wait}ms`, err);
      if (i < TENTATIVAS - 1) await delay(wait);
    }
  }
  throw ultimoErro;
}
