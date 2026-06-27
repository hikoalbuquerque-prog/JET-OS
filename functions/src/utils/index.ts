// src/utils/index.ts
import * as admin from 'firebase-admin';

// ── FIRESTORE ────────────────────────────────────────────────────
export const db  = () => admin.firestore();
export const storage = () => admin.storage();

// ── VALIDAÇÕES ───────────────────────────────────────────────────
export function validarLatLng(lat: unknown, lng: unknown): boolean {
  const la = Number(lat), lo = Number(lng);
  return isFinite(la) && isFinite(lo)
    && la >= -90 && la <= 90
    && lo >= -180 && lo <= 180;
}

export function limparNulos<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const limpo: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    const v = obj[k];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const sub = limparNulos(v as Record<string, unknown>);
      if (Object.keys(sub).length > 0) limpo[k] = sub as T[keyof T];
    } else {
      limpo[k] = v;
    }
  }
  return limpo;
}

// ── NORMALIZAÇÃO ─────────────────────────────────────────────────
export function normalizarLargura(valor: unknown): number | null {
  if (!valor) return null;
  const str   = String(valor).replace(',', '.');
  const match = str.match(/(\d+(\.\d+)?)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return num > 0 ? num : null;
}

export function gerarCodigo(cidade: string, tipo: string): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const cid  = cidade.substring(0, 3).toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tip  = tipo === 'PUBLICA' ? 'PUB' : tipo === 'PRIVADA' ? 'PRI' : 'CON';
  return `${cid}-${tip}-${ts}`;
}

// ── ERRO PADRÃO ──────────────────────────────────────────────────
export function erroResponse(msg: string, code = 'ERRO') {
  return { ok: false, error: msg, code };
}

export function okResponse<T>(data: T) {
  return { ok: true, ...data };
}

// ── LOG DE EVENTO ────────────────────────────────────────────────
export async function logEvento(params: {
  tipo: string;
  estacaoId?: string;
  uid: string;
  email: string;
  descricao: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const { supabaseInsert } = await import('../lib/supabase-rest');
    await supabaseInsert('eventos', {
      tipo: 'audit',
      titulo: params.descricao,
      dados: { uid: params.uid, email: params.email, estacaoId: params.estacaoId, meta: params.meta },
      criado_em: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[logEvento] erro:', e);
  }
}
