// frontend/src/lib/usuarios-supabase.ts
// Fase 2 / Onda C — escrita de usuarios via Edge Function `usuarios-write` (dual-write,
// atrás de flag). A RLS só deixa o próprio se-atualizar; a Edge Function (service_role)
// valida o chamador (self ou gestor/admin) e aplica o update — permite admin/gestor
// escrever OUTROS usuários (aprovar prestador, editar permissões) sem Firebase Auth.
// Pré-req do flip de Auth (C.8/C.9). Default OFF → só Firestore.

import { supabase } from './supabase';

export const usuariosWriteSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_usuarios_write');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_USUARIOS_WRITE as string) === 'supabase';
};

// Atualiza um usuário (por firebase uid) via Edge Function. `patch` em camelCase; a função
// só aplica colunas permitidas pelo papel do chamador (self: perfil; gestor: + role/cidades/ativo).
// Best-effort durante a transição: lança em erro p/ o chamador logar (não quebra o Firestore).
export async function escreverUsuarioSupabase(alvoFirebaseUid: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('usuarios-write', {
    body: { alvoFirebaseUid, patch },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
}
