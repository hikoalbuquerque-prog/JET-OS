// frontend/src/lib/supabase.ts
// Cliente Supabase (migração — a partir da Fase 1). URL e chave pública (publishable/anon)
// vêm do env Vite (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Convive com o Firebase durante a migração — não substitui nada ainda.
//
// Requer: npm i @supabase/supabase-js  (na pasta frontend/)

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// SESSÕES DESACOPLADAS (Fase 2 — cutover de leitura):
//   • Este cliente JS tem sua PRÓPRIA sessão gerenciada (persist + autoRefresh) — usada
//     para LER dados do Supabase sob RLS (estações, slots, escala, etc.) de forma estável
//     (sobrevive a reload e renova sozinha).
//   • O serviço GPS nativo usa uma sessão SEPARADA (segundo auth-login no login do app,
//     guardada em localStorage['jet_supa_refresh'] — ver supabase-auth.ts). Como são
//     famílias de refresh token DISTINTAS, a renovação do JS NÃO invalida o token do GPS.
//   Antes (até a Fase 1) o JS era session-less p/ não rotacionar o token do GPS; o
//   desacoplamento por duas sessões resolveu isso. Ver DEBRIEF 17.x / CUTOVER_PLAN.
export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'jet-os-supabase-auth',
  },
});

(window as any).__supabase = supabase;
