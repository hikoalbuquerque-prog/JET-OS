// App.tsx — root component (auth flip C.9: Supabase primário)
import { useState, useEffect, useRef } from 'react';
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
import { useAuthProvider, AuthCtx } from './hooks/useAuth';
import type { Usuario } from './hooks/useAuth';
import 'leaflet/dist/leaflet.css';
import './i18n';
import i18n from './i18n/index';

const savedLang = localStorage.getItem('appLang');
if (savedLang) i18n.changeLanguage(savedLang);

type Tela = 'loading' | 'login' | 'mapa' | 'guard' | 'trocar-senha' | 'prestador-pendente';

export default function App() {
  const auth = useAuthProvider();
  const { user, usuario, loading, login, logout } = auth;

  const [tela,       setTela]       = useState<Tela>('loading');
  const [onboarding, setOnboarding] = useState(false);
  const [permGateOk, setPermGateOk] = useState(false);
  const [lgpdOk,     setLgpdOk]     = useState(false);
  const [termosOk,   setTermosOk]   = useState(false);

  const usuarioRef = useRef<Usuario | null>(null);
  usuarioRef.current = usuario;
  useEffect(() => {
    instalarCapturaErros(() => {
      const u = usuarioRef.current;
      return u ? { uid: u.uid, nome: u.nome, email: u.email, role: u.role, tipoCadastro: u.tipoCadastro } : undefined;
    });
  }, []);

  // Routing baseado no estado de auth
  useEffect(() => {
    if (loading) { setTela('loading'); return; }
    if (!user || !usuario) { setTela('login'); return; }

    if (usuario.senhaTemporaria) { setTela('trocar-senha'); return; }

    // Log de acesso (fire-and-forget via Firestore residual)
    if (usuario.uid && usuario.email) {
      import('firebase/firestore').then(({ addDoc, collection: col }) => {
        import('./lib/firebase').then(({ db }) => {
          addDoc(col(db, 'logs_acesso'), {
            uid:        usuario.uid || 'unknown',
            email:      usuario.email || 'unknown',
            nome:       usuario.nome || 'unknown',
            role:       usuario.role || 'viewer',
            ts:         Date.now(),
            userAgent:  navigator.userAgent.slice(0, 200),
            plataforma: navigator.platform,
            idioma:     navigator.language,
            online:     navigator.onLine,
          }).catch((err: any) => console.error('Log erro:', err));
        });
      });
    }

    const jaViu = localStorage.getItem('jet_onboarding_' + usuario.uid);
    if (!jaViu) setOnboarding(true);

    if (usuario.role === 'prestador_pendente' || (usuario.tipoCadastro === 'prestador' && usuario.statusPrestador === 'pendente')) {
      setTela('prestador-pendente');
    } else if (usuario.role === 'guard') {
      setTela('guard');
    } else {
      console.log('[auth] role:', usuario.role, '→ tela: mapa');
      setTela('mapa');
    }
  }, [loading, user, usuario]);

  // Navegação para Guard via FAB
  useEffect(() => {
    const onNavGuard = () => setTela('guard');
    window.addEventListener('jetNavGuard', onNavGuard);
    return () => window.removeEventListener('jetNavGuard', onNavGuard as EventListener);
  }, []);

  const handleLogin = async (email: string, senha: string): Promise<string | null> => {
    try {
      await login(email, senha);
      return null;
    } catch {
      return 'E-mail ou senha incorretos.';
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  if (tela === 'loading') return <SplashScreen />;

  if (tela === 'login') return <TelaLogin onLogin={handleLogin} />;

  if (tela === 'prestador-pendente' && usuario) return <TelaPrestadorPendente usuario={usuario as any} onLogout={() => handleLogout()} />;

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

  if (
    usuario && (tela === 'mapa' || tela === 'guard') &&
    precisaConsentirLocalizacao(usuario as any) && !lgpdOk
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

  if (usuario && (tela === 'mapa' || tela === 'guard') && !permGateOk) return (
    <AndroidPermissionGate role={usuario.role} onReady={() => setPermGateOk(true)} />
  );

  if (onboarding && usuario && tela === 'mapa') return (
    <>
      <TelaMapa usuario={usuario as any} onLogout={() => handleLogout()} />
      <OnboardingWizard
        usuario={usuario as any}
        onConcluir={() => {
          localStorage.setItem('jet_onboarding_' + usuario.uid, '1');
          setOnboarding(false);
        }}
      />
      <BugReportButton usuario={usuario as any} />
    </>
  );

  if (tela === 'guard' && usuario && usuario.role !== 'guard') {
    console.warn('[auth] role', usuario.role, 'tentou acessar TelaGuard — redirecionando para mapa');
    setTimeout(() => setTela('mapa'), 0);
    return null;
  }
  if (tela === 'guard') return (
    <AuthCtx.Provider value={auth}>
      <TelaGuard usuario={usuario as any} onLogout={() => handleLogout()} onVoltarMapa={() => setTela('mapa')} />
      <BugReportButton usuario={usuario as any} />
    </AuthCtx.Provider>
  );
  if (tela === 'trocar-senha') return (
    <TelaTrocarSenha
      onConcluido={() => setTela(usuario?.role === 'guard' ? 'guard' : 'mapa')}
      onLogout={() => { handleLogout(); setTela('login'); }}
    />
  );
  return (
    <AuthCtx.Provider value={auth}>
      <TelaMapa usuario={usuario as any} onLogout={() => handleLogout()} />
      <BugReportButton usuario={usuario as any} />
    </AuthCtx.Provider>
  );
}
