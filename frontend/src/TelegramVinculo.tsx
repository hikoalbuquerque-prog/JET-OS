// TelegramVinculo.tsx
// Componente de vinculação do Telegram para usuários logados.
//
// Aparece de duas formas:
//   1. Banner fixo no topo (após primeiro login, se ainda não vinculou)
//   2. Botão/modal na área de perfil do usuário (sempre disponível)
//
// Fluxo:
//   Usuário abre bot no Telegram → /start → recebe um código de 6 dígitos
//   O bot (via webhook) salva (codigo → uid) em telegram_vinculos/
//   O usuário digita o código aqui → Cloud Function valida e salva telegramChatId
//
// Alternativa simples (sem webhook):
//   Usuário cola manualmente o Chat ID do próprio perfil do Telegram
//   (obtido enviando /start para @userinfobot)

import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Props {
  usuario: {
    uid: string;
    nome: string;
    role: string;
    cargoPrestador?: string;
    tipoCadastro?: string;
  };
  // modo 'banner': aparece fixo no topo após login
  // modo 'modal': abre como modal completo
  // modo 'inline': embed dentro de outro painel (ex: perfil)
  modo?: 'banner' | 'modal' | 'inline';
  onFechar?: () => void;
  onVinculado?: () => void;
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const COR_TG = '#2AABEE';

const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 2200,
    background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: '#0d1521', borderRadius: 16,
    width: '100%', maxWidth: 480,
    border: '1px solid rgba(42,171,238,.2)',
    boxShadow: '0 12px 40px rgba(0,0,0,.6)',
    overflow: 'hidden',
  },
  banner: {
    position: 'fixed' as const, top: 52, left: 0, right: 0, zIndex: 1900,
    background: '#0d1c2e',
    borderBottom: `2px solid ${COR_TG}40`,
    padding: '10px 16px',
    display: 'flex', alignItems: 'center', gap: 12,
  },
  header: {
    padding: '16px 20px',
    background: `${COR_TG}12`,
    borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  body: { padding: '20px' },
  inp: {
    width: '100%', padding: '11px 14px', borderRadius: 8,
    boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 14, outline: 'none',
    textAlign: 'center' as const, letterSpacing: 4, fontWeight: 700,
    fontFamily: 'monospace',
  },
  btn: (cor: string, ghost = false) => ghost ? {
    padding: '10px 18px', borderRadius: 8,
    background: 'rgba(255,255,255,.05)',
    border: `1px solid ${cor}40`,
    color: cor, fontWeight: 700 as const, fontSize: 13,
    cursor: 'pointer' as const, flex: 1,
  } : {
    padding: '10px 18px', borderRadius: 8, border: 'none',
    background: cor, color: '#fff',
    fontWeight: 700 as const, fontSize: 13,
    cursor: 'pointer' as const, flex: 1,
  },
  step: (ativo: boolean) => ({
    display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8,
    background: ativo ? `${COR_TG}12` : 'rgba(255,255,255,.02)',
    border: `1px solid ${ativo ? COR_TG + '35' : 'rgba(255,255,255,.06)'}`,
    marginBottom: 8,
    transition: 'all .2s',
  }),
  numCircle: (ativo: boolean) => ({
    width: 22, height: 22, borderRadius: 11, flexShrink: 0,
    background: ativo ? COR_TG : 'rgba(255,255,255,.1)',
    color: ativo ? '#fff' : 'rgba(255,255,255,.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 800 as const,
  }),
};

// ─── Hook: verifica se usuário já tem telegramChatId ─────────────────────────

export function useTelegramVinculado(uid: string) {
  const [vinculado, setVinculado] = useState<boolean | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, 'usuarios', uid)).then(snap => {
      const id = snap.data()?.telegramChatId ?? null;
      setChatId(id);
      setVinculado(!!id);
    });
  }, [uid]);

  return { vinculado, chatId };
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function TelegramVinculo({ usuario, modo = 'modal', onFechar, onVinculado }: Props) {
  const [etapa, setEtapa] = useState<'instrucoes' | 'codigo' | 'manual' | 'ok'>('instrucoes');
  const [codigo, setCodigo] = useState('');
  const [chatIdManual, setChatIdManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [chatIdAtual, setChatIdAtual] = useState<string | null>(null);

  const isPrestador = usuario.tipoCadastro === 'prestador';
  const nomeBot = '@jet_os_bot'; // Substituir pelo @ real do bot

  // Carrega chatId atual se já vinculado
  useEffect(() => {
    getDoc(doc(db, 'usuarios', usuario.uid)).then(snap => {
      const id = snap.data()?.telegramChatId;
      if (id) { setChatIdAtual(id); setEtapa('ok'); }
    });
  }, [usuario.uid]);

  // ── Validar código (Cloud Function) ──
  const validarCodigo = async () => {
    if (codigo.length !== 6) { setErro('Código deve ter 6 dígitos'); return; }
    setBusy(true);
    setErro('');
    try {
      const fns = getFunctions(undefined, 'southamerica-east1');
      const fn = httpsCallable(fns, 'validarVinculoTelegram');
      const result = await fn({ codigo: codigo.trim() }) as any;
      if (result.data?.sucesso) {
        setChatIdAtual(result.data.chatId);
        setEtapa('ok');
        onVinculado?.();
      } else {
        setErro(result.data?.erro ?? 'Código inválido ou expirado');
      }
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao validar');
    } finally {
      setBusy(false);
    }
  };

  // ── Salvar Chat ID manual ──
  const salvarManual = async () => {
    const id = chatIdManual.trim();
    if (!id) { setErro('Informe o Chat ID'); return; }
    if (!/^-?\d{5,15}$/.test(id)) { setErro('Chat ID inválido (apenas números, ex: 123456789)'); return; }
    setBusy(true);
    setErro('');
    try {
      await updateDoc(doc(db, 'usuarios', usuario.uid), {
        telegramChatId: id,
        telegramVinculadoEm: serverTimestamp(),
        telegramModo: 'manual',
      });
      setChatIdAtual(id);
      setEtapa('ok');
      onVinculado?.();
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao salvar');
    } finally {
      setBusy(false);
    }
  };

  // ── Desvincular ──
  const desvincular = async () => {
    if (!window.confirm('Desvincular o Telegram? Você não receberá mais notificações.')) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'usuarios', usuario.uid), {
        telegramChatId: null,
        telegramVinculadoEm: null,
      });
      setChatIdAtual(null);
      setCodigo('');
      setChatIdManual('');
      setEtapa('instrucoes');
    } catch (e: any) {
      setErro(e.message ?? 'Erro');
    } finally {
      setBusy(false);
    }
  };

  // ─── Conteúdo interno ────────────────────────────────────────────────────

  const renderConteudo = () => {
    if (etapa === 'ok') {
      return (
        <div style={{ textAlign: 'center', padding: modo === 'inline' ? 0 : 8 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#dce8ff', marginBottom: 6 }}>
            Telegram vinculado
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 16 }}>
            Chat ID: <code style={{ color: COR_TG }}>{chatIdAtual}</code>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 20, lineHeight: 1.6 }}>
            Você receberá notificações de slots, tarefas e alertas diretamente no Telegram.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn('#6b7280', true)} onClick={desvincular} disabled={busy}>
              Desvincular
            </button>
            {onFechar && (
              <button style={S.btn(COR_TG)} onClick={onFechar}>
                Fechar
              </button>
            )}
          </div>
        </div>
      );
    }

    if (etapa === 'codigo') {
      return (
        <div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 16, lineHeight: 1.6 }}>
            Envie <code style={{ color: COR_TG, background: `${COR_TG}15`, padding: '2px 6px', borderRadius: 4 }}>/start</code> para {nomeBot} no Telegram.
            O bot vai responder com um código de 6 dígitos. Digite ele abaixo:
          </div>

          <div style={{ marginBottom: 16 }}>
            <input
              style={S.inp}
              value={codigo}
              onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              autoFocus
            />
          </div>

          {erro && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button style={S.btn('#6b7280', true)} onClick={() => { setEtapa('instrucoes'); setErro(''); }}>
              Voltar
            </button>
            <button style={S.btn(COR_TG)} onClick={validarCodigo} disabled={busy || codigo.length !== 6}>
              {busy ? '⏳ Verificando...' : 'Confirmar'}
            </button>
          </div>

          <button
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 12, cursor: 'pointer', padding: 0 }}
            onClick={() => { setEtapa('manual'); setErro(''); }}
          >
            Prefiro inserir o Chat ID manualmente →
          </button>
        </div>
      );
    }

    if (etapa === 'manual') {
      return (
        <div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 8, lineHeight: 1.6 }}>
            Envie uma mensagem para <code style={{ color: COR_TG }}>@userinfobot</code> no Telegram.
            Ele vai responder com seu Chat ID. Cole abaixo:
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 14 }}>
            Exemplo: 123456789 (só números, pode ser negativo para grupos)
          </div>

          <input
            style={{ ...S.inp, letterSpacing: 2 }}
            value={chatIdManual}
            onChange={e => setChatIdManual(e.target.value.trim())}
            placeholder="123456789"
            inputMode="numeric"
          />

          {erro && <div style={{ color: '#ef4444', fontSize: 12, margin: '10px 0' }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={S.btn('#6b7280', true)} onClick={() => { setEtapa('instrucoes'); setErro(''); }}>
              Voltar
            </button>
            <button style={S.btn(COR_TG)} onClick={salvarManual} disabled={busy}>
              {busy ? '⏳ Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      );
    }

    // instrucoes (default)
    return (
      <div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 16, lineHeight: 1.6 }}>
          Vincule seu Telegram para receber notificações de{' '}
          {isPrestador ? 'slots, tarefas e alertas' : 'ocorrências, turnos e relatórios'}{' '}
          direto no app.
        </div>

        {/* Passos */}
        <div style={{ marginBottom: 20 }}>
          {[
            { n: 1, txt: `Abra o Telegram e busque por ${nomeBot}`, ativo: true },
            { n: 2, txt: 'Toque em "Iniciar" ou envie /start', ativo: false },
            { n: 3, txt: 'O bot envia um código de 6 dígitos', ativo: false },
            { n: 4, txt: 'Digite o código aqui para confirmar', ativo: false },
          ].map(p => (
            <div key={p.n} style={S.step(p.ativo)}>
              <div style={S.numCircle(p.ativo)}>{p.n}</div>
              <div style={{ fontSize: 13, color: p.ativo ? '#dce8ff' : 'rgba(255,255,255,.45)', alignSelf: 'center' }}>
                {p.txt}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {onFechar && (
            <button style={S.btn('#6b7280', true)} onClick={onFechar}>
              Depois
            </button>
          )}
          <button style={S.btn(COR_TG)} onClick={() => setEtapa('codigo')}>
            Já enviei /start →
          </button>
        </div>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 12, cursor: 'pointer' }}
            onClick={() => setEtapa('manual')}
          >
            Inserir Chat ID manualmente
          </button>
        </div>
      </div>
    );
  };

  // ─── Render por modo ──────────────────────────────────────────────────────

  if (modo === 'inline') {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: etapa === 'ok' ? `${COR_TG}08` : 'rgba(255,255,255,.03)',
        border: `1px solid ${etapa === 'ok' ? COR_TG + '30' : 'rgba(255,255,255,.08)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: etapa === 'ok' ? 10 : 14 }}>
          <span style={{ fontSize: 18 }}>✈️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: etapa === 'ok' ? COR_TG : '#dce8ff' }}>
              {etapa === 'ok' ? 'Telegram vinculado' : 'Vincular Telegram'}
            </div>
            {etapa !== 'ok' && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
                Receba notificações direto no app
              </div>
            )}
          </div>
        </div>
        {renderConteudo()}
      </div>
    );
  }

  if (modo === 'banner') {
    if (etapa === 'ok') return null; // Banner some quando vinculado
    return (
      <div style={S.banner}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>✈️</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COR_TG }}>
            Vincule seu Telegram{' '}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.45)' }}>
            para receber notificações de slots e alertas
          </span>
        </div>
        <button
          style={S.btn(COR_TG)}
          onClick={() => setEtapa('codigo')}
        >
          Vincular
        </button>
        {onFechar && (
          <button
            onClick={onFechar}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  // modo 'modal' (default)
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar?.()}>
      <div style={S.modal}>
        <div style={S.header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: COR_TG }}>
              ✈️ Vincular Telegram
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
              {usuario.nome}
            </div>
          </div>
          {onFechar && (
            <button onClick={onFechar} style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 20,
            }}>✕</button>
          )}
        </div>
        <div style={S.body}>
          {renderConteudo()}
        </div>
      </div>
    </div>
  );
}

// ─── Banner pós-login (uso em App.tsx) ───────────────────────────────────────
// Adicionar no App.tsx, junto dos outros estados:
//
//   const [showTgBanner, setShowTgBanner] = useState(false);
//   const { vinculado: tgVinculado } = useTelegramVinculado(usuario?.uid ?? '');
//
// Após o usuário logar (useEffect em cima do onAuthStateChanged):
//   useEffect(() => {
//     if (usuario && tgVinculado === false) {
//       // Só mostra o banner se for prestador (eles recebem DMs)
//       if (usuario.tipoCadastro === 'prestador') {
//         setShowTgBanner(true);
//       }
//     }
//   }, [usuario, tgVinculado]);
//
// No render, antes do mapa (ou acima do header):
//   {showTgBanner && usuario && (
//     <TelegramVinculo
//       usuario={usuario}
//       modo="banner"
//       onFechar={() => setShowTgBanner(false)}
//       onVinculado={() => setShowTgBanner(false)}
//     />
//   )}
//
// No painel de perfil do prestador (LogisticaModule ou onde mostrar info do user):
//   <TelegramVinculo usuario={usuario} modo="inline" />
