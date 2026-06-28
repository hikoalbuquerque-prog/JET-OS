import React, { useState, useEffect, useCallback, useRef } from 'react';

interface ToastItem {
  id: number;
  msg: string;
  tipo: string;
  acao?: { label: string; fn: () => void };
  timeout: number;
}

const META: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: 'rgba(16,185,129,.18)', border: 'rgba(16,185,129,.4)', text: '#6ee7b7', icon: '✓' },
  error:   { bg: 'rgba(239,68,68,.18)',  border: 'rgba(239,68,68,.4)',  text: '#f87171', icon: '✕' },
  erro:    { bg: 'rgba(239,68,68,.18)',  border: 'rgba(239,68,68,.4)',  text: '#f87171', icon: '✕' },
  warn:    { bg: 'rgba(245,158,11,.18)', border: 'rgba(245,158,11,.4)', text: '#fbbf24', icon: '⚠' },
  info:    { bg: 'rgba(48,127,226,.18)', border: 'rgba(48,127,226,.4)', text: '#60a5fa', icon: 'ℹ' },
};

let _nextId = 0;
let _pushToast: ((item: Omit<ToastItem, 'id'>) => void) | null = null;

export function showToastGlobal(msg: string, tipo = 'info', acao?: { label: string; fn: () => void }) {
  const timeout = tipo === 'error' || tipo === 'erro' ? 6000 : 4000;
  _pushToast?.({ msg, tipo, acao, timeout });
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  _pushToast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = ++_nextId;
    setToasts(prev => [...prev.slice(-4), { ...item, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), item.timeout);
  }, []);

  return (
    <>
      {children}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9000, display: 'flex', flexDirection: 'column-reverse', gap: 8, pointerEvents: 'none' }}
        role="status" aria-live="polite">
        {toasts.map(t => {
          const c = META[t.tipo] || META.info;
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 16px', background: c.bg,
              border: `1px solid ${c.border}`, borderRadius: 12,
              backdropFilter: 'blur(16px)',
              maxWidth: 'min(92vw,420px)', boxShadow: '0 4px 24px rgba(0,0,0,.5)',
              animation: 'toast-in .2s ease', pointerEvents: 'auto',
            }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>{c.icon}</span>
              <span style={{ color: c.text, fontSize: 13, fontWeight: 500, flex: 1 }}>{t.msg}</span>
              {t.acao && (
                <button onClick={t.acao.fn} style={{
                  background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 7,
                  color: c.text, fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>{t.acao.label}</button>
              )}
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                style={{ background: 'none', border: 'none', color: c.text, cursor: 'pointer', fontSize: 14, opacity: .6, padding: 0 }}
                aria-label="Fechar">✕</button>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </>
  );
}
