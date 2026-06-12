// App.tsx — root component (slim shell after split)
import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import TelaGuard from './TelaGuard';
import AndroidPermissionGate from './components/AndroidPermissionGate';
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

  useEffect(() => {
    // Listener para navegação para Guard via FAB
    const onNavGuard = () => setTela('guard');
    window.addEventListener('jetNavGuard', onNavGuard);

    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        try {
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
    try { await signInWithEmailAndPassword(auth, email, senha); return null; }
    catch { return 'E-mail ou senha incorretos.'; }
  };

  if (tela === 'loading') return <SplashScreen />;

  if (tela === 'login') return <TelaLogin onLogin={handleLogin} />;

  if (tela === 'prestador-pendente' && usuario) return <TelaPrestadorPendente usuario={usuario} onLogout={() => signOut(auth)} />;

  // Permission gate — Android APK, antes de mostrar qualquer tela de app
  if (usuario && (tela === 'mapa' || tela === 'guard') && !permGateOk) return (
    <AndroidPermissionGate role={usuario.role} onReady={() => setPermGateOk(true)} />
  );

  // Onboarding — sobreposto ao mapa
  if (onboarding && usuario && tela === 'mapa') return (
    <>
      <TelaMapa usuario={usuario!} onLogout={() => signOut(auth)} />
      <OnboardingWizard
        usuario={usuario}
        onConcluir={() => {
          localStorage.setItem('jet_onboarding_' + usuario.uid, '1');
          setOnboarding(false);
        }}
      />
    </>
  );
  // Segurança: só role==='guard' fica na TelaGuard
  if (tela === 'guard' && usuario && usuario.role !== 'guard') {
    console.warn('[auth] role', usuario.role, 'tentou acessar TelaGuard — redirecionando para mapa');
    setTimeout(() => setTela('mapa'), 0);
    return null;
  }
  if (tela === 'guard') return <TelaGuard usuario={usuario!} onLogout={() => signOut(auth)} onVoltarMapa={() => setTela('mapa')} />;
  if (tela === 'trocar-senha') return (
    <TelaTrocarSenha
      onConcluido={() => setTela(usuario?.role === 'guard' ? 'guard' : 'mapa')}
      onLogout={() => { signOut(auth); setTela('login'); }}
    />
  );
  return <TelaMapa usuario={usuario!} onLogout={() => signOut(auth)} />;
}
