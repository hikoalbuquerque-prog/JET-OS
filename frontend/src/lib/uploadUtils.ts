// frontend/src/lib/uploadUtils.ts
// Upload para Firebase Storage com retry + backoff exponencial.

import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

const TENTATIVAS = 4;
const BASE_DELAY = 800; // ms

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Faz upload de um arquivo para Storage com até 4 tentativas.
 * Backoff: 800ms, 1.6s, 3.2s, 6.4s
 *
 * @param file  Arquivo ou Blob a enviar
 * @param path  Caminho no Storage (ex: `tarefas_logistica/{id}/foto.jpg`)
 * @returns     URL pública de download
 * @throws      Erro após esgotar tentativas
 */
export async function uploadComRetry(file: File | Blob, path: string): Promise<string> {
  let ultimoErro: unknown;
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
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
