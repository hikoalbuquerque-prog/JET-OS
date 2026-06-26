// App.tsx — root component (slim shell after split)
import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { estabelecerSessaoSupabase, encerrarSessaoSupabase } from './lib/supabase-auth';
import TelaGuard from './TelaGuard';
import AndroidPermissionGate from './components/AndroidPermissionGate';
import LgpdConsentGate, { precisaConsentirLocalizacao } from './components/LgpdConsentGate';
import TermosUsoGate from './components/TermosUsoGate';
import BugReportButton from './components/BugReportButton';
import { instalarCapturaErros } from './lib/bugReport';
import TelaMapa from './views/TelaMapa';
import {
  TelaLogin,
  SplashScreen,
  OnboardingWizard,
  TelaTrocarSenha,
  TelaPrestadorPendente,
} from './components/AppShell';
import type { Usuario } from './lib/app-utils';
import 'leaflet/dist/leaflet.css';
import './i18n';
import i18n from './i18n/index';

// Carrega idioma salvo
const savedLang = localStorage.getItem('appLang');
if (savedLang) i18n.changeLanguage(savedLang);

type Tela = 'loading' | 'login' | 'mapa' | 'guard' | 'trocar-senha' | 'prestador-pendente';

export default function App() {
  const [tela,       setTela]       = useState<Tela>('loading');
  const [usuario,    setUsuario]    = useState<Usuario | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [permGateOk, setPermGateOk] = useState(false);
  const [lgpdOk,     setLgpdOk]     = useState(false);
  const [termosOk,   setTermosOk]   = useState(false);

  // Captura automática de erros não-tratados → bug_reports (uma vez, lê o usuário via ref).
  const usuarioRef = useRef<Usuario | null>(null);
  usuarioRef.current = usuario;
  useEffect(() => {
    instalarCapturaErros(() => {
      const u = usuarioRef.current;
      return u ? { uid: u.uid, nome: u.nome, email: u.email, role: u.role, tipoCadastro: u.tipoCadastro } : undefined;
    });
  }, []);

  useEffect(() => {
    // Listener para navegação para Guard via FAB
    const onNavGuard = () => setTela('guard');
    window.addEventListener('jetNavGuard', onNavGuard);

    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        try {
          // Garante sessão Supabase ativa (RLS). Se o token persistido expirou,
          // autoRefreshToken renova. Se nunca existiu, força re-login silencioso.
          try {
            const { supabase: sb } = await import('./lib/supabase');
            const { data: sess } = await sb.auth.getSession();
            if (!sess?.session) {
              console.warn('[auth] Supabase sem sessão — forçando re-login');
              await signOut(auth);
              return;
            }
          } catch { /* não-fatal */ }

          const docRef = doc(db, 'usuarios', user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const u: Usuario = {
              uid: user.uid,
              email: user.email || '',
              nome: data.nome || '',
              role: data.role || 'viewer',
              paises: data.paises || [],
              cidadesPermitidas: data.cidadesPermitidas,
              cidadesGerenciaLog: data.cidadesGerenciaLog,
              cargoPrestador: data.cargoPrestador,
              tipoCadastro: data.tipoCadastro,
              statusPrestador: data.statusPrestador,
              cidade: data.cidade,
            };
            // Se usuario foi criado com senha temporária, forçar troca
            if (data.senhaTemporaria) {
              setUsuario(u);
              setTela('trocar-senha');
            } else {
              setUsuario(u);
              // Log de acesso
              if (u.uid && u.email) {
                import('firebase/firestore').then(({ addDoc, collection: col }) => {
                  import('./lib/firebase').then(({ db: dbI }) => {
                    addDoc(col(dbI, 'logs_acesso'), {
                      uid:        u.uid || 'unknown',
                      email:      u.email || 'unknown',
                      nome:       u.nome || 'unknown',
                      role:       u.role || 'viewer',
                      ts:         Date.now(),
                      userAgent:  navigator.userAgent.slice(0, 200),
                      plataforma: navigator.platform,
                      idioma:     navigator.language,
                      online:     navigator.onLine,
                    }).catch((err: any) => console.error('Log erro:', err));
                  });
                });
              }
              // Verificar se é primeiro acesso
              const jaViu = localStorage.getItem('jet_onboarding_' + u.uid);
              if (!jaViu) setOnboarding(true);
              // Prestador aguardando aprovação → tela de espera
              if (u.role === 'prestador_pendente' || (u.tipoCadastro === 'prestador' && u.statusPrestador === 'pendente')) {
                setTela('prestador-pendente');
              } else if (u.role === 'guard') {
                setTela('guard');
              } else {
                console.log('[auth] role:', u.role, '→ tela: mapa');
                setTela('mapa');
              }
            }
          } else {
            console.error('Usuário não encontrado no Firestore');
            setUsuario(null);
            setTela('login');
          }
        } catch (e: any) {
          console.error('[auth] erro:', e);
          setUsuario(null);
          setTela('login');
        }
      } else {
        setUsuario(null);
        setTela('login');
      }
    });
    return () => {
      unsub();
      window.removeEventListener('jetNavGuard', onNavGuard as EventListener);
    };
  }, []);

  const handleLogin = async (email: string, senha: string): Promise<string | null> => {
    try { await signInWithEmailAndPassword(auth, email, senha); }
    catch { return 'E-mail ou senha incorretos.'; }
    // dual-auth (migração): estabelece a sessão Supabase com o mesmo e-mail/senha.
    // Não-fatal — se falhar, o login Firebase segue valendo.
    await estabelecerSessaoSupabase(email, senha);
    return null;
  };

  // Logout único: para o GPS nativo + encerra a sessão Supabase ANTES do signOut Firebase.
  const handleLogout = async () => {
    await encerrarSessaoSupabase();
    await signOut(auth);
  };

  if (tela === 'loading') return <SplashScreen />;

  if (tela === 'login') return <TelaLogin onLogin={handleLogin} />;

  if (tela === 'prestador-pendente' && usuario) return <TelaPrestadorPendente usuario={usuario} onLogout={() => handleLogout()} />;

  // Termos de Uso + Política de Privacidade — TODOS os perfis, no 1º acesso,
  // antes de qualquer outro gate (web e APK).
  if (
    usuario && (tela === 'mapa' || tela === 'guard') && !termosOk
  ) return (
    <TermosUsoGate
      uid={usuario.uid}
      email={usuario.email}
      nome={usuario.nome}
      role={usuario.role}
      tipoCadastro={usuario.tipoCadastro}
      onAceito={() => setTermosOk(true)}
      onRecusado={() => { handleLogout(); setTela('login'); }}
    />
  );

  // Consentimento LGPD de localização — perfis rastreados E prestadores (rastreados
  // em slots), antes do permission gate (web e APK)
  if (
    usuario && (tela === 'mapa' || tela === 'guard') &&
    precisaConsentirLocalizacao(usuario) && !lgpdOk
  ) return (
    <LgpdConsentGate
      uid={usuario.uid}
      email={usuario.email}
      nome={usuario.nome}
      role={usuario.role}
      onAceito={() => setLgpdOk(true)}
      onRecusado={() => { handleLogout(); setTela('login'); }}
    />
  );

  // Permission gate — Android APK, antes de mostrar qualquer tela de app
  if (usuario && (tela === 'mapa' || tela === 'guard') && !permGateOk) return (
    <AndroidPermissionGate role={usuario.role} onReady={() => setPermGateOk(true)} />
  );

  // Onboarding — sobreposto ao mapa
  if (onboarding && usuario && tela === 'mapa') return (
    <>
      <TelaMapa usuario={usuario!} onLogout={() => handleLogout()} />
      <OnboardingWizard
        usuario={usuario}
        onConcluir={() => {
          localStorage.setItem('jet_onboarding_' + usuario.uid, '1');
          setOnboarding(false);
        }}
      />
      <BugReportButton usuario={usuario!} />
    </>
  );
  // Segurança: só role==='guard' fica na TelaGuard
  if (tela === 'guard' && usuario && usuario.role !== 'guard') {
    console.warn('[auth] role', usuario.role, 'tentou acessar TelaGuard — redirecionando para mapa');
    setTimeout(() => setTela('mapa'), 0);
    return null;
  }
  if (tela === 'guard') return (
    <>
      <TelaGuard usuario={usuario!} onLogout={() => handleLogout()} onVoltarMapa={() => setTela('mapa')} />
      <BugReportButton usuario={usuario!} />
    </>
  );
  if (tela === 'trocar-senha') return (
    <TelaTrocarSenha
      onConcluido={() => setTela(usuario?.role === 'guard' ? 'guard' : 'mapa')}
      onLogout={() => { handleLogout(); setTela('login'); }}
    />
  );
  return (
    <>
      <TelaMapa usuario={usuario!} onLogout={() => handleLogout()} />
      <BugReportButton usuario={usuario!} />
    </>
  );
}
