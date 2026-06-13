// frontend/src/components/AndroidPermissionGate.tsx
// Tela de permissões para APK Android (Capacitor).
// Só exibida quando rodando como app nativo e alguma permissão está pendente.
// Roles de campo (logistica/campo/charger/scalt) precisam de localização.
// Todos precisam de notificações.

import { useState, useEffect, useCallback } from 'react';

type PermStatus = 'checking' | 'granted' | 'denied' | 'prompt' | 'limited';

interface PermState {
  locForeground: PermStatus;
  locBackground: PermStatus;
  notifications: PermStatus;
}

interface Props {
  role: string;
  onReady: () => void; // chamado quando todas as permissões necessárias estão ok
}

function isNativeAndroid(): boolean {
  const cap = (window as any)?.Capacitor;
  return cap?.isNativePlatform?.() === true && cap?.getPlatform?.() === 'android';
}

const FIELD_ROLES = ['logistica', 'campo', 'charger', 'scalt', 'promotor'];

async function checkPermissions(needsLocation: boolean): Promise<PermState> {
  const state: PermState = {
    locForeground: 'prompt',
    locBackground: 'prompt',
    notifications: 'prompt',
  };

  try {
    if (needsLocation) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const geo = await Geolocation.checkPermissions();
      // `location` = ACCESS_FINE_LOCATION; `coarseLocation` = ACCESS_COARSE_LOCATION
      // Se qualquer um for granted, o foreground está ok
      const fine   = geo.location    as PermStatus;
      const coarse = geo.coarseLocation as PermStatus;
      state.locForeground = fine === 'granted' || coarse === 'granted' ? 'granted'
        : fine === 'denied'   || coarse === 'denied'   ? 'denied'
        : 'prompt';
      // Background considera o mesmo — plugin não expõe ACCESS_BACKGROUND_LOCATION
      // diretamente; se foreground ok, o foreground service já pode rodar
      state.locBackground = state.locForeground;
    } else {
      state.locForeground = 'granted';
      state.locBackground = 'granted';
    }
  } catch { /* plugin não disponível em web */ }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const notif = await LocalNotifications.checkPermissions();
    state.notifications = (notif.display as PermStatus) ?? 'prompt';
  } catch { /* plugin não disponível em web */ }

  return state;
}

async function requestLocation(): Promise<PermStatus> {
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const res = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    return (res.location as PermStatus) ?? 'denied';
  } catch { return 'denied'; }
}

async function requestNotifications(): Promise<PermStatus> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const res = await LocalNotifications.requestPermissions();
    return (res.display as PermStatus) ?? 'denied';
  } catch { return 'denied'; }
}

const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 9000,
    background: '#080e1a',
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    padding: '32px 24px',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 380,
    background: '#0f1929',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 20, padding: '28px 24px',
    display: 'flex', flexDirection: 'column' as const, gap: 20,
  },
  permRow: (granted: boolean, denied: boolean) => ({
    background: granted ? 'rgba(16,185,129,.08)' : denied ? 'rgba(239,68,68,.08)' : 'rgba(255,255,255,.04)',
    border: `1px solid ${granted ? 'rgba(16,185,129,.25)' : denied ? 'rgba(239,68,68,.25)' : 'rgba(255,255,255,.1)'}`,
    borderRadius: 12, padding: '14px 16px',
    display: 'flex', alignItems: 'center', gap: 14,
  } as React.CSSProperties),
  btn: (active: boolean) => ({
    padding: '11px 20px', borderRadius: 10, border: 'none', cursor: active ? 'pointer' : 'default',
    fontWeight: 700, fontSize: 13,
    background: active ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'rgba(255,255,255,.08)',
    color: active ? '#fff' : 'rgba(255,255,255,.3)',
    transition: 'opacity .15s', flexShrink: 0,
  } as React.CSSProperties),
  skipBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,.25)',
    fontSize: 12, cursor: 'pointer', marginTop: 8, textDecoration: 'underline',
  } as React.CSSProperties,
};

function PermRow({
  icon, title, desc, status, onRequest, loading,
}: {
  icon: string; title: string; desc: string;
  status: PermStatus; onRequest: () => void; loading: boolean;
}) {
  const granted = status === 'granted';
  const denied  = status === 'denied';

  return (
    <div style={S.permRow(granted, denied)}>
      <div style={{ fontSize: 28, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff', marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', lineHeight: 1.4 }}>{desc}</div>
        {denied && (
          <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>
            Negado. Ative em Configurações → Aplicativos → Jet OS
          </div>
        )}
      </div>
      {!granted && !denied && (
        <button onClick={onRequest} disabled={loading} style={S.btn(!loading)}>
          {loading ? '...' : 'Permitir'}
        </button>
      )}
      {granted && <span style={{ fontSize: 20, flexShrink: 0 }}>✅</span>}
      {denied  && <span style={{ fontSize: 20, flexShrink: 0 }}>🚫</span>}
    </div>
  );
}

export default function AndroidPermissionGate({ role, onReady }: Props) {
  const needsLocation = FIELD_ROLES.includes(role);
  const [perms, setPerms]       = useState<PermState | null>(null);
  const [loadingLoc, setLoadingLoc]   = useState(false);
  const [loadingPush, setLoadingPush] = useState(false);
  const [skipped, setSkipped]   = useState(false);

  // Se não for APK Android, passa direto
  useEffect(() => {
    if (!isNativeAndroid()) { onReady(); return; }
    checkPermissions(needsLocation).then(setPerms);

    // Re-verifica quando o usuário volta ao app após ir em Configurações
    let handle: { remove: () => void } | null = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) checkPermissions(needsLocation).then(setPerms);
      }).then(h => { handle = h; });
    }).catch(() => {});

    return () => { handle?.remove(); };
  }, [needsLocation]);

  // Quando todas as permissões necessárias estão ok, passa direto
  useEffect(() => {
    if (!perms) return;
    const locOk = !needsLocation || perms.locForeground === 'granted';
    const pushOk = perms.notifications === 'granted';
    if (locOk && pushOk) onReady();
  }, [perms, needsLocation]);

  const handleLocation = useCallback(async () => {
    setLoadingLoc(true);
    const result = await requestLocation();
    setPerms(prev => prev ? { ...prev, locForeground: result, locBackground: result } : prev);
    setLoadingLoc(false);
  }, []);

  const handleNotifications = useCallback(async () => {
    setLoadingPush(true);
    const result = await requestNotifications();
    setPerms(prev => prev ? { ...prev, notifications: result } : prev);
    setLoadingPush(false);
  }, []);

  if (skipped || !perms) return null;

  const locOk  = !needsLocation || perms.locForeground === 'granted';
  const pushOk = perms.notifications === 'granted';
  if (locOk && pushOk) return null;

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        {/* Logo / título */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛴</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#dce8ff' }}>Jet OS</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', marginTop: 4, lineHeight: 1.5 }}>
            Para funcionar corretamente, o app precisa das permissões abaixo.
          </div>
        </div>

        {/* Permissão de localização */}
        {needsLocation && (
          <PermRow
            icon="📍"
            title="Localização"
            desc="Necessária para registro de turno, GPS em campo e atribuição de tarefas por proximidade."
            status={perms.locForeground}
            onRequest={handleLocation}
            loading={loadingLoc}
          />
        )}

        {/* Permissão de notificações */}
        <PermRow
          icon="🔔"
          title="Notificações"
          desc="Receba alertas de novas tarefas, atualizações de slot e mensagens da equipe em tempo real."
          status={perms.notifications}
          onRequest={handleNotifications}
          loading={loadingPush}
        />

        {/* Aviso se alguma foi negada */}
        {(perms.locForeground === 'denied' || perms.notifications === 'denied') && (
          <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)',
            borderRadius: 10, padding: '12px 14px', fontSize: 11, color: 'rgba(255,255,255,.5)',
            lineHeight: 1.5 }}>
            ⚠️ Permissões negadas precisam ser reativadas manualmente:<br />
            <b style={{ color: '#fbbf24' }}>Configurações → Apps → Jet OS → Permissões</b>
            <br /><br />
            <button
              onClick={() => checkPermissions(needsLocation).then(setPerms)}
              style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.3)',
                color: '#fbbf24', borderRadius: 8, padding: '6px 12px',
                fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              Já concedi → verificar novamente
            </button>
          </div>
        )}

        {/* Botão continuar (habilitado quando tudo ok ou quando há denied — não pode fazer mais nada) */}
        {(locOk && pushOk) || (perms.locForeground === 'denied' || perms.notifications === 'denied') ? (
          <button onClick={onReady} style={{ ...S.btn(true), width: '100%', padding: 14 }}>
            {locOk && pushOk ? '✓ Continuar' : 'Continuar mesmo assim'}
          </button>
        ) : null}

        <button onClick={() => setSkipped(true)} style={S.skipBtn}>
          Pular por agora
        </button>
      </div>
    </div>
  );
}
