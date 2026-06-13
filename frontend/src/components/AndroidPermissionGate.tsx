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
    // requestPermissions retorna 'granted' imediatamente se já concedido (sem mostrar diálogo)
    // Isso resolve o caso onde checkPermissions() retorna 'denied' stale após concessão manual
    const res = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    const fine   = res.location      as PermStatus;
    const coarse = res.coarseLocation as PermStatus;
    return fine === 'granted' || coarse === 'granted' ? 'granted'
      : fine === 'denied' || coarse === 'denied' ? 'denied'
      : 'prompt';
  } catch { return 'denied'; }
}

async function abrirConfiguracoes() {
  try {
    // Tenta abrir as configurações de permissão do app diretamente
    const { App } = await import('@capacitor/app');
    await (App as any).openUrl({ url: 'app-settings:' });
  } catch {
    try {
      // Fallback Android via intent
      window.open('android.settings.APPLICATION_DETAILS_SETTINGS', '_system');
    } catch { /* nada */ }
  }
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
            Negado. Vá em Configurações → Apps → JET OS → Permissões → Localização → "Permitir o tempo todo"
          </div>
        )}
      </div>
      {/* Mostra "Permitir" quando prompt, e "Tentar novamente" quando denied */}
      {!granted && (
        <button onClick={onRequest} disabled={loading} style={S.btn(!loading)}>
          {loading ? '...' : denied ? '🔄' : 'Permitir'}
        </button>
      )}
      {granted && <span style={{ fontSize: 20, flexShrink: 0 }}>✅</span>}
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

        {/* Aviso se localização negada */}
        {perms.locForeground === 'denied' && (
          <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)',
            borderRadius: 10, padding: '12px 14px', fontSize: 11, color: 'rgba(255,255,255,.5)',
            lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              ⚠️ Toque em 🔄 acima após conceder.<br />
              Ou abra as configurações diretamente:
            </div>
            <button
              onClick={abrirConfiguracoes}
              style={{ background: 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.4)',
                color: '#a5b4fc', borderRadius: 8, padding: '8px 12px',
                fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              ⚙️ Abrir configurações do app
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
