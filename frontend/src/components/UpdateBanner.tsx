// UpdateBanner.tsx — Banner de atualização OTA para Capacitor
// Portado do V2 UpdateBanner.tsx + updates.ts
// Aparece quando uma nova versão do app está disponível via Capacitor Live Updates

import React, { useState, useEffect } from 'react';

// Tipa o plugin do Capacitor Live Updates sem importar o pacote diretamente
// (evita erro se o pacote não estiver instalado na versão web)
function getUpdater(): any {
  return (window as any)?.Capacitor?.Plugins?.LiveUpdates ?? null;
}

function isNative(): boolean {
  return !!(window as any)?.Capacitor?.isNativePlatform?.();
}

interface Props {
  /** Callback chamado após aplicar a atualização (antes de reload) */
  onApply?: () => void;
}

export default function UpdateBanner({ onApply }: Props) {
  const [disponivel, setDisponivel] = useState(false);
  const [aplicando,  setAplicando]  = useState(false);
  const [progresso,  setProgresso]  = useState(0);

  useEffect(() => {
    if (!isNative()) return;
    const updater = getUpdater();
    if (!updater) return;

    let cancelado = false;

    const checar = async () => {
      try {
        const result = await updater.sync?.();
        if (!cancelado && result?.activeApplicationPathChanged) {
          setDisponivel(true);
        }
      } catch {
        // silencioso — app continua funcionando normalmente
      }
    };

    checar();
    const interval = setInterval(checar, 5 * 60 * 1000); // recheca a cada 5min
    return () => { cancelado = true; clearInterval(interval); };
  }, []);

  const aplicar = async () => {
    const updater = getUpdater();
    if (!updater) return;
    setAplicando(true);
    try {
      // Simula progresso visual
      const steps = [20, 50, 80, 100];
      for (const step of steps) {
        await new Promise(r => setTimeout(r, 300));
        setProgresso(step);
      }
      onApply?.();
      await updater.reload?.();
    } catch {
      setAplicando(false);
      setProgresso(0);
    }
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
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>⬇ Aplicando atualização…</div>
            <div style={{ marginTop: 6, background: 'rgba(255,255,255,.1)', borderRadius: 4, height: 4 }}>
              <div style={{ width: `${progresso}%`, height: 4, background: '#3b82f6', borderRadius: 4, transition: 'width .3s' }} />
            </div>
          </>
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
