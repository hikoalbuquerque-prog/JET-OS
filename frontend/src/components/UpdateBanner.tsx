// UpdateBanner.tsx — Banner de atualização para PWA + Capacitor
// PWA: detecta novo service worker via vite-plugin-pwa (registerType: 'prompt')
// Capacitor: detecta via Live Updates plugin

import React, { useState, useEffect } from 'react';

function isNative(): boolean {
  return !!(window as any)?.Capacitor?.isNativePlatform?.();
}

export default function UpdateBanner() {
  const [disponivel, setDisponivel] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [swReg, setSwReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (isNative()) {
      const updater = (window as any)?.Capacitor?.Plugins?.LiveUpdates ?? null;
      if (!updater) return;
      let cancelado = false;
      const checar = async () => {
        try {
          const result = await updater.sync?.();
          if (!cancelado && result?.activeApplicationPathChanged) setDisponivel(true);
        } catch {}
      };
      checar();
      const interval = setInterval(checar, 5 * 60 * 1000);
      return () => { cancelado = true; clearInterval(interval); };
    }

    // PWA: listen for vite-plugin-pwa prompt event
    const onNeedRefresh = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.registration) setSwReg(detail.registration);
      setDisponivel(true);
    };
    window.addEventListener('vite-pwa:need-refresh', onNeedRefresh);

    // Also check if SW is already waiting
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg?.waiting) { setSwReg(reg); setDisponivel(true); }
        if (reg) {
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (newSW) {
              newSW.addEventListener('statechange', () => {
                if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                  setSwReg(reg);
                  setDisponivel(true);
                }
              });
            }
          });
        }
      });
    }

    return () => window.removeEventListener('vite-pwa:need-refresh', onNeedRefresh);
  }, []);

  const aplicar = async () => {
    setAplicando(true);
    if (isNative()) {
      const updater = (window as any)?.Capacitor?.Plugins?.LiveUpdates;
      try { await updater?.reload?.(); } catch { setAplicando(false); }
      return;
    }
    // PWA: tell waiting SW to skipWaiting, then reload
    if (swReg?.waiting) {
      swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    // Reload after short delay to let SW activate
    setTimeout(() => window.location.reload(), 500);
  };

  if (!disponivel) return null;

  return (
    <div style={{
      position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, background: '#1e3a5f', border: '1px solid #3b82f6',
      borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center',
      gap: 12, maxWidth: 340, width: 'calc(100% - 32px)', boxShadow: '0 4px 24px rgba(0,0,0,.4)',
    }}>
      <div style={{ flex: 1 }}>
        {aplicando ? (
          <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>⬇ Atualizando…</div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>🆕 Nova versão disponível</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>Atualização pronta para instalar</div>
          </>
        )}
      </div>
      {!aplicando && (
        <button onClick={aplicar} style={{
          padding: '6px 14px', borderRadius: 8, border: 'none',
          background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
        }}>
          Instalar
        </button>
      )}
    </div>
  );
}
