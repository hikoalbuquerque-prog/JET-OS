import React, { useState, useEffect, useRef, useCallback } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

interface PromptDialogProps {
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

const T = {
  bg: 'rgba(0,0,0,.75)',
  card: '#0d1521',
  bdr: 'rgba(255,255,255,.08)',
  txt: '#e2e8f0',
  dim: '#64748b',
  blue: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
  red: '#ef4444',
  orange: '#f59e0b',
};

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9500,
  background: T.bg, backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16, animation: 'cd-in .15s ease',
};

const card: React.CSSProperties = {
  background: T.card, border: `1px solid ${T.bdr}`,
  borderRadius: 14, width: '100%', maxWidth: 400,
  padding: '20px 24px',
  fontFamily: "'Inter',-apple-system,sans-serif",
};

const btnBase: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 8, fontWeight: 600,
  fontSize: 13, cursor: 'pointer', border: 'none',
  transition: 'all .15s', minWidth: 80,
};

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  boxSizing: 'border-box', background: 'rgba(255,255,255,.06)',
  border: `1px solid ${T.bdr}`, color: T.txt, fontSize: 13,
  outline: 'none', marginTop: 12,
};

const anim = `@keyframes cd-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`;

function variantColor(v?: string) {
  if (v === 'danger') return T.red;
  if (v === 'warning') return T.orange;
  return '';
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', variant, onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) btnRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onCancel]);

  if (!open) return null;
  const color = variantColor(variant);

  const handle = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <style>{anim}</style>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.txt, marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.5 }}>{message}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onCancel} style={{ ...btnBase, background: 'rgba(255,255,255,.06)', color: T.dim }}>{cancelLabel}</button>
          <button ref={btnRef} onClick={handle} disabled={busy} style={{ ...btnBase, background: color || T.blue, color: '#fff', opacity: busy ? .6 : 1 }}>{busy ? '...' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function PromptDialog({ open, title, message, placeholder, defaultValue = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setValue(defaultValue); setTimeout(() => inputRef.current?.focus(), 50); } }, [open, defaultValue]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onCancel]);

  if (!open) return null;

  const handle = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try { await onConfirm(value.trim()); } finally { setBusy(false); }
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <style>{anim}</style>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.txt, marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.5 }}>{message}</div>}
        <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder}
          onKeyDown={e => { if (e.key === 'Enter') handle(); }}
          style={inp} aria-label={title} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCancel} style={{ ...btnBase, background: 'rgba(255,255,255,.06)', color: T.dim }}>{cancelLabel}</button>
          <button onClick={handle} disabled={busy || !value.trim()} style={{ ...btnBase, background: T.blue, color: '#fff', opacity: (busy || !value.trim()) ? .6 : 1 }}>{busy ? '...' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

type DialogState =
  | null
  | { type: 'confirm'; title: string; message?: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; resolve: (ok: boolean) => void }
  | { type: 'prompt'; title: string; message?: string; placeholder?: string; defaultValue?: string; confirmLabel?: string; resolve: (val: string | null) => void };

let _setDialog: React.Dispatch<React.SetStateAction<DialogState>> | null = null;

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  _setDialog = setDialog;

  return (
    <>
      {children}
      {dialog?.type === 'confirm' && (
        <ConfirmDialog open title={dialog.title} message={dialog.message} variant={dialog.variant}
          confirmLabel={dialog.confirmLabel} onConfirm={() => { dialog.resolve(true); setDialog(null); }}
          onCancel={() => { dialog.resolve(false); setDialog(null); }} />
      )}
      {dialog?.type === 'prompt' && (
        <PromptDialog open title={dialog.title} message={dialog.message} placeholder={dialog.placeholder}
          defaultValue={dialog.defaultValue} confirmLabel={dialog.confirmLabel}
          onConfirm={val => { dialog.resolve(val); setDialog(null); }}
          onCancel={() => { dialog.resolve(null); setDialog(null); }} />
      )}
    </>
  );
}

export function confirmDialog(title: string, message?: string, opts?: { variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string }): Promise<boolean> {
  return new Promise(resolve => {
    _setDialog?.({ type: 'confirm', title, message, variant: opts?.variant, confirmLabel: opts?.confirmLabel, resolve });
  });
}

export function promptDialog(title: string, opts?: { message?: string; placeholder?: string; defaultValue?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise(resolve => {
    _setDialog?.({ type: 'prompt', title, message: opts?.message, placeholder: opts?.placeholder, defaultValue: opts?.defaultValue, confirmLabel: opts?.confirmLabel, resolve });
  });
}
