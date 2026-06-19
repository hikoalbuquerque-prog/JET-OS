// frontend/src/lib/supabase.ts
// Cliente Supabase (migração — a partir da Fase 1). URL e chave pública (publishable/anon)
// vêm do env Vite (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Convive com o Firebase durante a migração — não substitui nada ainda.
//
// Requer: npm i @supabase/supabase-js  (na pasta frontend/)

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// IMPORTANTE (migração GPS): o serviço nativo Android é o ÚNICO que pode renovar
// o refresh token da sessão usada no rastreamento. Se o cliente JS também renovasse
// (autoRefreshToken), a rotação do refresh token do Supabase invalidaria o token do
// serviço nativo e o GPS pararia de postar depois de um tempo. Por isso: JS NÃO renova
// nem persiste a sessão — cada início de turno faz login fresco e entrega o refresh
// token ao serviço nativo, que passa a renovar sozinho. Ver DEBRIEF Seção 14.5.1.
export const supabase = createClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'jet-os-supabase-auth',
  },
});
