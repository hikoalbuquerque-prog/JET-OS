// TelegramVinculo.tsx
// Componente de vinculação do Telegram para usuários logados.
//
// Aparece de duas formas:
//   1. Banner fixo no topo (após primeiro login, se ainda não vinculou)
//   2. Botão/modal na área de perfil do usuário (sempre disponível)
//
// Fluxo PRINCIPAL (1-toque / deep-link):
//   App chama iniciarVinculoTelegram → recebe t.me/<bot>?start=<token> (token ligado ao uid)
//   Usuário toca → Telegram manda /start <token> → telegramWebhook vincula DIRETO
//   App faz polling do telegramChatId e confirma sozinho (sem digitar nada, sem voltar).
//
// Fallbacks:
//   - Código de 6 dígitos: /start (sem token) → bot devolve código → usuário digita aqui.
//   - Chat ID manual: cola o Chat ID (obtido em @userinfobot).

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchUsuario, escreverUsuarioSupabase } from './lib/usuarios-supabase';
import { getEdgeCallable } from './lib/edge-functions';

// ─── i18n (pt/en/es/ru) — padrão objeto T + pick, sem json ─────────────────────

const T = {
  // estado "ok"
  vinculadoTitulo: {
    pt: 'Telegram vinculado',
    en: 'Telegram linked',
    es: 'Telegram vinculado',
    ru: 'Telegram привязан',
  },
  chatIdLabel: {
    pt: 'Chat ID:',
    en: 'Chat ID:',
    es: 'Chat ID:',
    ru: 'Chat ID:',
  },
  vinculadoDesc: {
    pt: 'Você receberá notificações de slots, tarefas e alertas diretamente no Telegram.',
    en: 'You will receive notifications about slots, tasks and alerts directly on Telegram.',
    es: 'Recibirás notificaciones de turnos, tareas y alertas directamente en Telegram.',
    ru: 'Вы будете получать уведомления о слотах, задачах и оповещениях прямо в Telegram.',
  },
  desvincular: {
    pt: 'Desvincular',
    en: 'Unlink',
    es: 'Desvincular',
    ru: 'Отвязать',
  },
  fechar: {
    pt: 'Fechar',
    en: 'Close',
    es: 'Cerrar',
    ru: 'Закрыть',
  },
  // etapa "codigo"
  codigoInstrucao1: {
    pt: 'Envie ',
    en: 'Send ',
    es: 'Envía ',
    ru: 'Отправьте ',
  },
  codigoInstrucao2: {
    pt: ' para {bot} no Telegram. O bot vai responder com um código de 6 dígitos. Digite ele abaixo:',
    en: ' to {bot} on Telegram. The bot will reply with a 6-digit code. Enter it below:',
    es: ' a {bot} en Telegram. El bot responderá con un código de 6 dígitos. Ingrésalo abajo:',
    ru: ' боту {bot} в Telegram. Бот ответит 6-значным кодом. Введите его ниже:',
  },
  voltar: {
    pt: 'Voltar',
    en: 'Back',
    es: 'Volver',
    ru: 'Назад',
  },
  verificando: {
    pt: '⏳ Verificando...',
    en: '⏳ Verifying...',
    es: '⏳ Verificando...',
    ru: '⏳ Проверка...',
  },
  confirmar: {
    pt: 'Confirmar',
    en: 'Confirm',
    es: 'Confirmar',
    ru: 'Подтвердить',
  },
  prefiroManual: {
    pt: 'Prefiro inserir o Chat ID manualmente →',
    en: 'I prefer to enter the Chat ID manually →',
    es: 'Prefiero introducir el Chat ID manualmente →',
    ru: 'Я предпочитаю ввести Chat ID вручную →',
  },
  // etapa "manual"
  manualInstrucao1: {
    pt: 'Envie uma mensagem para ',
    en: 'Send a message to ',
    es: 'Envía un mensaje a ',
    ru: 'Отправьте сообщение боту ',
  },
  manualInstrucao2: {
    pt: ' no Telegram. Ele vai responder com seu Chat ID. Cole abaixo:',
    en: ' on Telegram. It will reply with your Chat ID. Paste it below:',
    es: ' en Telegram. Te responderá con tu Chat ID. Pégalo abajo:',
    ru: ' в Telegram. Он ответит вашим Chat ID. Вставьте его ниже:',
  },
  manualExemplo: {
    pt: 'Exemplo: 123456789 (só números, pode ser negativo para grupos)',
    en: 'Example: 123456789 (numbers only, can be negative for groups)',
    es: 'Ejemplo: 123456789 (solo números, puede ser negativo para grupos)',
    ru: 'Пример: 123456789 (только цифры, может быть отрицательным для групп)',
  },
  salvando: {
    pt: '⏳ Salvando...',
    en: '⏳ Saving...',
    es: '⏳ Guardando...',
    ru: '⏳ Сохранение...',
  },
  salvar: {
    pt: 'Salvar',
    en: 'Save',
    es: 'Guardar',
    ru: 'Сохранить',
  },
  // etapa "instrucoes"
  instrucoesDescPrestador: {
    pt: 'slots, tarefas e alertas',
    en: 'slots, tasks and alerts',
    es: 'turnos, tareas y alertas',
    ru: 'слотах, задачах и оповещениях',
  },
  instrucoesDescOutro: {
    pt: 'ocorrências, turnos e relatórios',
    en: 'incidents, shifts and reports',
    es: 'incidencias, turnos e informes',
    ru: 'инцидентах, сменах и отчётах',
  },
  instrucoesDesc1: {
    pt: 'Vincule seu Telegram para receber notificações de ',
    en: 'Link your Telegram to receive notifications about ',
    es: 'Vincula tu Telegram para recibir notificaciones de ',
    ru: 'Привяжите ваш Telegram, чтобы получать уведомления о ',
  },
  instrucoesDesc2: {
    pt: ' direto no app.',
    en: ' right in the app.',
    es: ' directamente en la app.',
    ru: ' прямо в приложении.',
  },
  aguardandoTitulo: {
    pt: 'Aguardando confirmação no Telegram…',
    en: 'Waiting for confirmation on Telegram…',
    es: 'Esperando confirmación en Telegram…',
    ru: 'Ожидание подтверждения в Telegram…',
  },
  aguardandoDesc1: {
    pt: 'Toque em ',
    en: 'Tap ',
    es: 'Toca ',
    ru: 'Нажмите ',
  },
  aguardandoIniciar: {
    pt: 'Iniciar',
    en: 'Start',
    es: 'Iniciar',
    ru: 'Запустить',
  },
  aguardandoOu: {
    pt: ' (ou ',
    en: ' (or ',
    es: ' (o ',
    ru: ' (или ',
  },
  aguardandoStart: {
    pt: 'Start',
    en: 'Start',
    es: 'Start',
    ru: 'Start',
  },
  aguardandoDesc2: {
    pt: ') na conversa que abriu. A vinculação é automática — você não precisa voltar aqui nem digitar nada.',
    en: ') in the chat that opened. Linking is automatic — you do not need to come back here or type anything.',
    es: ') en la conversación que se abrió. La vinculación es automática — no necesitas volver aquí ni escribir nada.',
    ru: ') в открывшемся чате. Привязка происходит автоматически — вам не нужно возвращаться сюда или что-либо вводить.',
  },
  cancelar: {
    pt: 'Cancelar',
    en: 'Cancel',
    es: 'Cancelar',
    ru: 'Отмена',
  },
  abrindoTelegram: {
    pt: '⏳ Abrindo Telegram…',
    en: '⏳ Opening Telegram…',
    es: '⏳ Abriendo Telegram…',
    ru: '⏳ Открытие Telegram…',
  },
  vincularUmToque: {
    pt: '✈️ Vincular com 1 toque',
    en: '✈️ Link with 1 tap',
    es: '✈️ Vincular con 1 toque',
    ru: '✈️ Привязать в 1 касание',
  },
  vincularUmToqueDesc1: {
    pt: 'Abre o ',
    en: 'Opens ',
    es: 'Abre ',
    ru: 'Открывает ',
  },
  vincularUmToqueDesc2: {
    pt: ' no Telegram e vincula sozinho — sem digitar código.',
    en: ' on Telegram and links automatically — no code needed.',
    es: ' en Telegram y vincula solo — sin escribir código.',
    ru: ' в Telegram и привязывает автоматически — без ввода кода.',
  },
  usarCodigo: {
    pt: 'Usar código de 6 dígitos',
    en: 'Use 6-digit code',
    es: 'Usar código de 6 dígitos',
    ru: 'Использовать 6-значный код',
  },
  inserirChatId: {
    pt: 'Inserir Chat ID manualmente',
    en: 'Enter Chat ID manually',
    es: 'Introducir Chat ID manualmente',
    ru: 'Ввести Chat ID вручную',
  },
  depois: {
    pt: 'Depois',
    en: 'Later',
    es: 'Después',
    ru: 'Позже',
  },
  // inline / banner / modal
  inlineVincular: {
    pt: 'Vincular Telegram',
    en: 'Link Telegram',
    es: 'Vincular Telegram',
    ru: 'Привязать Telegram',
  },
  inlineSubtitulo: {
    pt: 'Receba notificações direto no app',
    en: 'Get notifications right in the app',
    es: 'Recibe notificaciones directamente en la app',
    ru: 'Получайте уведомления прямо в приложении',
  },
  bannerTitulo: {
    pt: 'Vincule seu Telegram ',
    en: 'Link your Telegram ',
    es: 'Vincula tu Telegram ',
    ru: 'Привяжите ваш Telegram ',
  },
  bannerSubtitulo: {
    pt: 'para receber notificações de slots e alertas',
    en: 'to receive notifications about slots and alerts',
    es: 'para recibir notificaciones de turnos y alertas',
    ru: 'чтобы получать уведомления о слотах и оповещениях',
  },
  bannerVincular: {
    pt: 'Vincular',
    en: 'Link',
    es: 'Vincular',
    ru: 'Привязать',
  },
  modalTitulo: {
    pt: '✈️ Vincular Telegram',
    en: '✈️ Link Telegram',
    es: '✈️ Vincular Telegram',
    ru: '✈️ Привязать Telegram',
  },
  // mensagens de erro / confirm
  erroUmToqueIndisponivel: {
    pt: 'Vínculo 1-toque indisponível (bot não configurado). Use o código.',
    en: '1-tap linking unavailable (bot not configured). Use the code.',
    es: 'Vinculación de 1 toque no disponible (bot no configurado). Usa el código.',
    ru: 'Привязка в 1 касание недоступна (бот не настроен). Используйте код.',
  },
  erroIniciarVinculo: {
    pt: 'Erro ao iniciar vínculo',
    en: 'Error starting linking',
    es: 'Error al iniciar la vinculación',
    ru: 'Ошибка при начале привязки',
  },
  erroCodigo6: {
    pt: 'Código deve ter 6 dígitos',
    en: 'Code must have 6 digits',
    es: 'El código debe tener 6 dígitos',
    ru: 'Код должен состоять из 6 цифр',
  },
  erroCodigoInvalido: {
    pt: 'Código inválido ou expirado',
    en: 'Invalid or expired code',
    es: 'Código inválido o expirado',
    ru: 'Неверный или истёкший код',
  },
  erroValidar: {
    pt: 'Erro ao validar',
    en: 'Error validating',
    es: 'Error al validar',
    ru: 'Ошибка проверки',
  },
  erroInformeChatId: {
    pt: 'Informe o Chat ID',
    en: 'Enter the Chat ID',
    es: 'Introduce el Chat ID',
    ru: 'Введите Chat ID',
  },
  erroChatIdInvalido: {
    pt: 'Chat ID inválido (apenas números, ex: 123456789)',
    en: 'Invalid Chat ID (numbers only, e.g. 123456789)',
    es: 'Chat ID inválido (solo números, ej: 123456789)',
    ru: 'Неверный Chat ID (только цифры, напр.: 123456789)',
  },
  erroSalvar: {
    pt: 'Erro ao salvar',
    en: 'Error saving',
    es: 'Error al guardar',
    ru: 'Ошибка сохранения',
  },
  erroGenerico: {
    pt: 'Erro',
    en: 'Error',
    es: 'Error',
    ru: 'Ошибка',
  },
  confirmDesvincular: {
    pt: 'Desvincular o Telegram? Você não receberá mais notificações.',
    en: 'Unlink Telegram? You will no longer receive notifications.',
    es: '¿Desvincular Telegram? Ya no recibirás notificaciones.',
    ru: 'Отвязать Telegram? Вы больше не будете получать уведомления.',
  },
};

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
    fetchUsuario(uid).then(u => {
      const id = u?.telegramChatId ?? null;
      setChatId(id);
      setVinculado(!!id);
    });
  }, [uid]);

  return { vinculado, chatId };
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function TelegramVinculo({ usuario, modo = 'modal', onFechar, onVinculado }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [etapa, setEtapa] = useState<'instrucoes' | 'codigo' | 'manual' | 'ok'>('instrucoes');
  const [codigo, setCodigo] = useState('');
  const [chatIdManual, setChatIdManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [chatIdAtual, setChatIdAtual] = useState<string | null>(null);
  const [aguardando, setAguardando] = useState(false); // esperando o toque no Telegram (deep-link)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pararPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => pararPoll(), []); // limpa ao desmontar

  const isPrestador = usuario.tipoCadastro === 'prestador';
  const [nomeBot, setNomeBot] = useState('@jet_os_bot');

  // Carrega chatId atual + nome real do bot do Supabase
  useEffect(() => {
    fetchUsuario(usuario.uid).then(u => {
      const id = u?.telegramChatId;
      if (id) { setChatIdAtual(id); setEtapa('ok'); }
    });
    // Bot username from config (best-effort)
    import('./lib/supabase').then(({ supabase }) => {
      supabase.from('telegram_config').select('bot_username').eq('id', 'global').maybeSingle()
        .then(({ data }) => {
          const username = data?.bot_username;
          if (username) setNomeBot(username.startsWith('@') ? username : `@${username}`);
        });
    }).catch(() => {});
  }, [usuario.uid]);

  // ── Vínculo 1-toque (deep-link) ──
  // App gera token ligado ao uid, abre t.me/<bot>?start=<token>; o webhook vincula
  // direto. Aqui só fazemos polling do telegramChatId pra confirmar sem o usuário voltar.
  const vincularUmToque = async () => {
    setBusy(true); setErro('');
    try {
      const fn = getEdgeCallable('iniciarVinculoTelegram')!();
      const res = await fn({ data: {} }) as any;
      const deepLink = res.data?.deepLink as string;
      if (!deepLink) {
        // bot username não configurado no Firestore → cai pro fluxo de código
        setErro(pick(T.erroUmToqueIndisponivel));
        setEtapa('codigo');
        return;
      }
      window.open(deepLink, '_blank', 'noopener');
      setAguardando(true);
      // Poll do usuário até o webhook gravar o telegramChatId (~2,5 min)
      pararPoll();
      let tentativas = 0;
      pollRef.current = setInterval(async () => {
        tentativas++;
        try {
          const u = await fetchUsuario(usuario.uid);
          const id = u?.telegramChatId;
          if (id) {
            pararPoll();
            setChatIdAtual(id); setAguardando(false); setEtapa('ok');
            onVinculado?.();
          }
        } catch { /* ignora erro de rede pontual */ }
        if (tentativas >= 50) { pararPoll(); setAguardando(false); } // ~2,5 min
      }, 3000);
    } catch (e: any) {
      setErro(e.message ?? pick(T.erroIniciarVinculo));
    } finally {
      setBusy(false);
    }
  };

  // ── Validar código (Cloud Function) ──
  const validarCodigo = async () => {
    if (codigo.length !== 6) { setErro(pick(T.erroCodigo6)); return; }
    setBusy(true);
    setErro('');
    try {
      const fn = getEdgeCallable('validarVinculoTelegram')!();
      const result = await fn({ data: { codigo: codigo.trim() } }) as any;
      if (result.data?.sucesso) {
        setChatIdAtual(result.data.chatId);
        setEtapa('ok');
        onVinculado?.();
      } else {
        setErro(result.data?.erro ?? pick(T.erroCodigoInvalido));
      }
    } catch (e: any) {
      setErro(e.message ?? pick(T.erroValidar));
    } finally {
      setBusy(false);
    }
  };

  // ── Salvar Chat ID manual ──
  const salvarManual = async () => {
    const id = chatIdManual.trim();
    if (!id) { setErro(pick(T.erroInformeChatId)); return; }
    if (!/^-?\d{5,15}$/.test(id)) { setErro(pick(T.erroChatIdInvalido)); return; }
    setBusy(true);
    setErro('');
    try {
      await escreverUsuarioSupabase(usuario.uid, {
        telegramChatId: id,
        telegramVinculadoEm: new Date().toISOString(),
        telegramModo: 'manual',
      });
      setChatIdAtual(id);
      setEtapa('ok');
      onVinculado?.();
    } catch (e: any) {
      setErro(e.message ?? pick(T.erroSalvar));
    } finally {
      setBusy(false);
    }
  };

  // ── Desvincular ──
  const desvincular = async () => {
    if (!window.confirm(pick(T.confirmDesvincular))) return;
    setBusy(true);
    try {
      await escreverUsuarioSupabase(usuario.uid, {
        telegramChatId: null,
        telegramVinculadoEm: null,
      });
      setChatIdAtual(null);
      setCodigo('');
      setChatIdManual('');
      setEtapa('instrucoes');
    } catch (e: any) {
      setErro(e.message ?? pick(T.erroGenerico));
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
            {pick(T.vinculadoTitulo)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 16 }}>
            {pick(T.chatIdLabel)} <code style={{ color: COR_TG }}>{chatIdAtual}</code>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 20, lineHeight: 1.6 }}>
            {pick(T.vinculadoDesc)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn('#6b7280', true)} onClick={desvincular} disabled={busy}>
              {pick(T.desvincular)}
            </button>
            {onFechar && (
              <button style={S.btn(COR_TG)} onClick={onFechar}>
                {pick(T.fechar)}
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
            {pick(T.codigoInstrucao1)}<code style={{ color: COR_TG, background: `${COR_TG}15`, padding: '2px 6px', borderRadius: 4 }}>/start</code>{pick(T.codigoInstrucao2).replace('{bot}', nomeBot)}
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
              {pick(T.voltar)}
            </button>
            <button style={S.btn(COR_TG)} onClick={validarCodigo} disabled={busy || codigo.length !== 6}>
              {busy ? pick(T.verificando) : pick(T.confirmar)}
            </button>
          </div>

          <button
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 12, cursor: 'pointer', padding: 0 }}
            onClick={() => { setEtapa('manual'); setErro(''); }}
          >
            {pick(T.prefiroManual)}
          </button>
        </div>
      );
    }

    if (etapa === 'manual') {
      return (
        <div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 8, lineHeight: 1.6 }}>
            {pick(T.manualInstrucao1)}<code style={{ color: COR_TG }}>@userinfobot</code>{pick(T.manualInstrucao2)}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 14 }}>
            {pick(T.manualExemplo)}
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
              {pick(T.voltar)}
            </button>
            <button style={S.btn(COR_TG)} onClick={salvarManual} disabled={busy}>
              {busy ? pick(T.salvando) : pick(T.salvar)}
            </button>
          </div>
        </div>
      );
    }

    // instrucoes (default)
    return (
      <div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 16, lineHeight: 1.6 }}>
          {pick(T.instrucoesDesc1)}
          {isPrestador ? pick(T.instrucoesDescPrestador) : pick(T.instrucoesDescOutro)}
          {pick(T.instrucoesDesc2)}
        </div>

        {aguardando ? (
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✈️</div>
            <div style={{ fontSize: 13, color: '#dce8ff', fontWeight: 700, marginBottom: 4 }}>
              {pick(T.aguardandoTitulo)}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', lineHeight: 1.5, marginBottom: 14 }}>
              {pick(T.aguardandoDesc1)}<b>{pick(T.aguardandoIniciar)}</b>{pick(T.aguardandoOu)}<b>{pick(T.aguardandoStart)}</b>{pick(T.aguardandoDesc2)}
            </div>
            <button style={S.btn('#6b7280', true)} onClick={() => { pararPoll(); setAguardando(false); }}>
              {pick(T.cancelar)}
            </button>
          </div>
        ) : (
          <>
            <button
              style={{ ...S.btn(COR_TG), width: '100%', flex: 'unset', padding: '13px', fontSize: 14 }}
              onClick={vincularUmToque} disabled={busy}
            >
              {busy ? pick(T.abrindoTelegram) : pick(T.vincularUmToque)}
            </button>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
              {pick(T.vincularUmToqueDesc1)}{nomeBot}{pick(T.vincularUmToqueDesc2)}
            </div>
          </>
        )}

        {erro && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 12, textAlign: 'center' }}>{erro}</div>}

        {/* Alternativas */}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <button
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', fontSize: 12, cursor: 'pointer' }}
            onClick={() => { pararPoll(); setAguardando(false); setErro(''); setEtapa('codigo'); }}
          >
            {pick(T.usarCodigo)}
          </button>
          <button
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', fontSize: 12, cursor: 'pointer' }}
            onClick={() => { pararPoll(); setAguardando(false); setErro(''); setEtapa('manual'); }}
          >
            {pick(T.inserirChatId)}
          </button>
        </div>

        {onFechar && !aguardando && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 12, cursor: 'pointer' }} onClick={onFechar}>
              {pick(T.depois)}
            </button>
          </div>
        )}
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
              {etapa === 'ok' ? pick(T.vinculadoTitulo) : pick(T.inlineVincular)}
            </div>
            {etapa !== 'ok' && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
                {pick(T.inlineSubtitulo)}
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
            {pick(T.bannerTitulo)}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.45)' }}>
            {pick(T.bannerSubtitulo)}
          </span>
        </div>
        <button
          style={S.btn(COR_TG)}
          onClick={() => setEtapa('codigo')}
        >
          {pick(T.bannerVincular)}
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
              {pick(T.modalTitulo)}
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
