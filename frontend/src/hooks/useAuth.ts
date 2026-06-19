// src/hooks/useAuth.ts
import { useState, useEffect, createContext, useContext } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  signOut, User
} from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { estabelecerSessaoSupabase, encerrarSessaoSupabase } from '../lib/supabase-auth';

export interface Usuario {
  uid: string; email: string; nome: string;
  role: 'campo' | 'gestor' | 'admin' | 'guard' | 'viewer';
  paises: string[];
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

let _started = false;
function _start() {
  if (_started) return;
  _started = true;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const docRef = doc(db, 'usuarios', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          const usuario: Usuario = {
            uid: user.uid,
            email: user.email || '',
            nome: data.nome || '',
            role: data.role || 'viewer',
            paises: data.paises || []
          };
          _set({ user, usuario, loading: false, erro: null });
          console.log('[auth] usuário carregado:', usuario);
        } else {
          _set({ user: null, usuario: null, loading: false, erro: 'Perfil não encontrado.' });
        }
      } catch(e) {
        console.error('[auth] erro ao carregar perfil:', e);
        _set({ user: null, usuario: null, loading: false, erro: 'Erro ao carregar perfil.' });
      }
    } else {
      _set({ user: null, usuario: null, loading: false, erro: null });
    }
  });
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

// Migração (strangler): dual-auth via helper compartilhado (ver lib/supabase-auth.ts).
async function login(email: string, senha: string) {
  _set({ erro: null });
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch {
    _set({ loading: false, erro: 'E-mail ou senha incorretos.' });
    throw new Error('Login falhou');
  }
  await estabelecerSessaoSupabase(email, senha); // não-fatal
}

async function logout() {
  await encerrarSessaoSupabase(); // para GPS nativo + signOut Supabase (não-fatal)
  await signOut(auth);
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
