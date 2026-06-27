// src/hooks/useAuth.ts
// Auth flip (C.8→C.9): Supabase é o auth PRIMÁRIO. Login via Edge Function auth-login
// (migração preguiçosa de senha Firebase→Supabase). State via onAuthStateChange do Supabase.
// Firebase login mantido como fallback NÃO-FATAL (para Firestore reads residuais).
import { useState, useEffect, createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import { supabase } from '../lib/supabase';
import { SUPA_REFRESH_KEY, carregarPerfilSupabase, encerrarSessaoSupabase } from '../lib/supabase-auth';

export interface Usuario {
  uid: string; email: string; nome: string;
  role: 'campo' | 'gestor' | 'admin' | 'guard' | 'viewer' | string;
  paises: string[];
  cidadesPermitidas?: string[];
  cidadesGerenciaLog?: string[];
  cargoPrestador?: string;
  tipoCadastro?: string;
  statusPrestador?: string;
  cidade?: string;
  senhaTemporaria?: boolean;
}

interface AuthState {
  user: User | null;
  usuario: Usuario | null;
  loading: boolean;
  erro: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
  isGestor: boolean;
  isAdmin: boolean;
  isGuard: boolean;
}

let _state: AuthState = { user: null, usuario: null, loading: true, erro: null };
const _subs = new Set<() => void>();
const _notify = () => _subs.forEach(fn => fn());
const _set = (s: Partial<AuthState>) => { _state = { ..._state, ...s }; _notify(); };

async function _loadProfile(supaUid: string): Promise<Usuario | null> {
  const cols = 'email, nome, role, paises, ativo, firebase_uid, cidades_permitidas, cidades_gerencia_log, cargo, tipo_cadastro, status_prestador, cidade, senha_temporaria';
  const { data, error } = await supabase
    .from('usuarios')
    .select(cols)
    .eq('id', supaUid)
    .maybeSingle();

  if (error || !data || data.ativo === false) {
    const fb = await carregarPerfilSupabase(supaUid);
    return fb ? { ...fb, role: fb.role as Usuario['role'] } : null;
  }
  return {
    uid: data.firebase_uid || supaUid,
    email: data.email || '',
    nome: data.nome || '',
    role: (data.role || 'viewer') as Usuario['role'],
    paises: Array.isArray(data.paises) && data.paises.length ? data.paises : [],
    cidadesPermitidas: data.cidades_permitidas ?? undefined,
    cidadesGerenciaLog: data.cidades_gerencia_log ?? undefined,
    cargoPrestador: data.cargo ?? undefined,
    tipoCadastro: data.tipo_cadastro ?? undefined,
    statusPrestador: data.status_prestador ?? undefined,
    cidade: data.cidade ?? undefined,
    senhaTemporaria: data.senha_temporaria ?? false,
  };
}

let _started = false;
function _start() {
  if (_started) return;
  _started = true;

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      try {
        const u = session.user;
        const usuario = await _loadProfile(u.id);
        if (usuario) {
          // Shim: componentes que ainda leem user.uid (Firebase User) — criamos um objeto compatível
          const userShim = { uid: usuario.uid, email: u.email } as unknown as User;
          _set({ user: userShim, usuario, loading: false, erro: null });
          console.log('[auth] sessão Supabase ativa, perfil:', usuario.nome, usuario.role);
        } else {
          console.warn('[auth] perfil não encontrado para', u.id);
          _set({ user: null, usuario: null, loading: false, erro: 'Perfil não encontrado.' });
        }
      } catch (e) {
        console.error('[auth] erro ao carregar perfil:', e);
        _set({ user: null, usuario: null, loading: false, erro: 'Erro ao carregar perfil.' });
      }
    } else {
      _set({ user: null, usuario: null, loading: false, erro: null });
    }
  });

  // Recuperação de sessão ao retornar ao app (tab oculta, tela bloqueada, app minimizado).
  // autoRefreshToken cuida do refresh periódico, mas o timer pode parar quando a tab fica
  // inativa. Ao voltar, forçamos getSession() que dispara refresh se o access_token expirou.
  // Se o refresh_token também estiver inválido, onAuthStateChange recebe session=null e
  // o usuário é redirecionado ao login automaticamente.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && _state.user) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data?.session) {
            console.warn('[auth] sessão perdida ao retornar — forçando re-login');
            // onAuthStateChange já vai disparar com session=null
          }
        }).catch(() => { /* rede indisponível — tenta no próximo resume */ });
      }
    });
  }
}

function useGlobalAuth(): AuthState {
  const [, tick] = useState(0);
  useEffect(() => {
    const sub = () => tick(n => n + 1);
    _subs.add(sub);
    tick(n => n + 1);
    return () => { _subs.delete(sub); };
  }, []);
  return _state;
}

async function login(email: string, senha: string) {
  _set({ erro: null, loading: true });
  try {
    // 1. Sessão B (GPS nativo) — refresh token separado, sobrevive a reload
    try {
      const { data: dataB } = await supabase.functions.invoke('auth-login', { body: { email, password: senha } });
      const sessB = (dataB as any)?.session;
      if (sessB?.refresh_token) {
        try { localStorage.setItem(SUPA_REFRESH_KEY, sessB.refresh_token); } catch { /* */ }
      }
    } catch (e: any) { console.warn('[auth] sessão GPS (B) falhou:', e?.message); }

    // 2. Sessão A (JS) — auth-login faz migração preguiçosa Firebase→Supabase
    const { data, error } = await supabase.functions.invoke('auth-login', { body: { email, password: senha } });
    if (error) throw new Error(error.message || 'auth-login falhou');
    const errCode = (data as any)?.error;
    if (errCode === 'user_not_provisioned') {
      throw new Error('Usuário não provisionado no Supabase. Contate o administrador.');
    }
    if (errCode === 'invalid_credentials') {
      throw new Error('E-mail ou senha incorretos.');
    }
    if (errCode) {
      throw new Error(`Erro no login: ${errCode} — ${(data as any)?.detail || ''}`);
    }
    const session = (data as any)?.session;
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('Sessão não retornada pelo auth-login');
    }
    const { error: setErr } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (setErr) {
      console.error('[auth] setSession falhou:', setErr.message);
      throw new Error('Falha ao estabelecer sessão. Tente novamente.');
    }
    console.log('[auth] login Supabase OK', (data as any)?.migrated ? '(senha migrada)' : '');

    // 3. Firebase login (NÃO-FATAL) — mantém sessão p/ Firestore reads residuais
    try {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const { auth: fbAuth } = await import('../lib/firebase');
      await signInWithEmailAndPassword(fbAuth, email, senha);
    } catch { console.warn('[auth] Firebase login fallback falhou (não-fatal)'); }
  } catch (e: any) {
    console.error('[auth] login falhou:', e);
    const msg = e?.message || 'E-mail ou senha incorretos.';
    _set({ loading: false, erro: msg });
    throw new Error(msg);
  }
}

async function logout() {
  await encerrarSessaoSupabase();
  try {
    const { signOut } = await import('firebase/auth');
    const { auth: fbAuth } = await import('../lib/firebase');
    await signOut(fbAuth);
  } catch { /* Firebase já deslogado ou não carregou */ }
}

export const AuthCtx = createContext<AuthContextType>({} as AuthContextType);
export function useAuth() { return useContext(AuthCtx); }

export function useAuthProvider(): AuthContextType {
  _start();
  const state = useGlobalAuth();
  return {
    ...state, login, logout,
    isGestor: ['gestor', 'admin'].includes(state.usuario?.role || ''),
    isAdmin:  state.usuario?.role === 'admin',
    isGuard:  ['guard', 'campo'].includes(state.usuario?.role || ''),
  };
}
