// frontend/src/components/BugReportButton.tsx
// Botão flutuante "Reportar problema" + modal. Disponível em todas as telas do app.
// Grava em bug_reports (lib/bugReport). Foto opcional passa pelo util HEIC-safe.
// Gestores (admin/gestor/supergestor/gestor_seg) também abrem o painel de reports.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enviarBugReport, type BugUserCtx } from '../lib/bugReport';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem } from '../lib/imageUtils';
import BugReportsPanel from './BugReportsPanel';

const ROLES_GESTAO = ['admin', 'gestor', 'supergestor', 'gestor_seg'];

const T = {
  tituloBotao: { pt: 'Reportar problema', en: 'Report a problem', es: 'Reportar un problema', ru: 'Сообщить о проблеме' },
  titulo: { pt: '🐞 Reportar problema', en: '🐞 Report a problem', es: '🐞 Reportar un problema', ru: '🐞 Сообщить о проблеме' },
  enviado: { pt: 'Report enviado!', en: 'Report sent!', es: '¡Reporte enviado!', ru: 'Отчёт отправлен!' },
  agradecimento: {
    pt: 'Obrigado. A equipe vai analisar. Você pode fechar.',
    en: 'Thank you. The team will review it. You can close this.',
    es: 'Gracias. El equipo lo revisará. Puedes cerrar.',
    ru: 'Спасибо. Команда рассмотрит это. Вы можете закрыть окно.',
  },
  fechar: { pt: 'Fechar', en: 'Close', es: 'Cerrar', ru: 'Закрыть' },
  instrucao: {
    pt: 'Descreva o que aconteceu (o que você fez, o que esperava, o que deu errado). Dados técnicos (versão, dispositivo, tela) são anexados automaticamente.',
    en: 'Describe what happened (what you did, what you expected, what went wrong). Technical data (version, device, screen) is attached automatically.',
    es: 'Describe lo que pasó (qué hiciste, qué esperabas, qué salió mal). Los datos técnicos (versión, dispositivo, pantalla) se adjuntan automáticamente.',
    ru: 'Опишите, что произошло (что вы делали, что ожидали, что пошло не так). Технические данные (версия, устройство, экран) прикрепляются автоматически.',
  },
  placeholder: {
    pt: 'Ex: ao iniciar o turno, a foto não aparece / o app travou ao abrir slots…',
    en: 'E.g.: when starting the shift, the photo does not appear / the app froze when opening slots…',
    es: 'Ej.: al iniciar el turno, la foto no aparece / la app se colgó al abrir slots…',
    ru: 'Напр.: при начале смены фото не появляется / приложение зависло при открытии слотов…',
  },
  anexar: { pt: 'Anexar print (opcional)', en: 'Attach screenshot (optional)', es: 'Adjuntar captura (opcional)', ru: 'Прикрепить скриншот (необязательно)' },
  enviar: { pt: 'Enviar report', en: 'Send report', es: 'Enviar reporte', ru: 'Отправить отчёт' },
  enviando: { pt: 'Enviando…', en: 'Sending…', es: 'Enviando…', ru: 'Отправка…' },
  verPainel: {
    pt: 'Ver reports recebidos (gestão) →',
    en: 'View received reports (management) →',
    es: 'Ver reportes recibidos (gestión) →',
    ru: 'Просмотреть полученные отчёты (управление) →',
  },
  erroMin: {
    pt: 'Descreva o problema (mín. 5 caracteres).',
    en: 'Describe the problem (min. 5 characters).',
    es: 'Describe el problema (mín. 5 caracteres).',
    ru: 'Опишите проблему (мин. 5 символов).',
  },
  erroFalha: {
    pt: 'Falha ao enviar. Tente novamente.',
    en: 'Failed to send. Please try again.',
    es: 'Error al enviar. Inténtalo de nuevo.',
    ru: 'Не удалось отправить. Попробуйте снова.',
  },
};

interface Usuario { uid: string; nome?: string; email?: string; role?: string; tipoCadastro?: string; }

export default function BugReportButton({ usuario }: { usuario: Usuario }) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [aberto, setAberto] = useState(false);
  const [painel, setPainel] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState('');

  const podeVerPainel = ROLES_GESTAO.includes(usuario.role || '');
  const userCtx: BugUserCtx = {
    uid: usuario.uid, nome: usuario.nome, email: usuario.email,
    role: usuario.role, tipoCadastro: usuario.tipoCadastro,
  };

  const enviar = async () => {
    if (descricao.trim().length < 5) { setErro(pick(T.erroMin)); return; }
    setEnviando(true); setErro('');
    try {
      let fotoUrl: string | null = null;
      if (foto) {
        const comp = await comprimirImagem(foto).catch(() => foto);
        fotoUrl = await uploadComRetry(comp, `bug_reports/${usuario.uid}/${Date.now()}.jpg`);
      }
      await enviarBugReport({ tipo: 'manual', descricao, fotoUrl }, userCtx);
      setOk(true); setDescricao(''); setFoto(null);
    } catch (e: any) {
      setErro(e.message || pick(T.erroFalha));
    } finally {
      setEnviando(false);
    }
  };

  const fechar = () => { setAberto(false); setOk(false); setErro(''); setDescricao(''); setFoto(null); };

  return (
    <>
      {/* Botão flutuante discreto (canto inferior esquerdo, longe dos FABs da direita) */}
      <button onClick={() => setAberto(true)} title={pick(T.tituloBotao)} aria-label={pick(T.tituloBotao)}
        style={{ position: 'fixed', left: 12, bottom: 100, zIndex: 1500, width: 40, height: 40,
          borderRadius: 20, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(15,25,41,.85)',
          color: '#fbbf24', fontSize: 18, cursor: 'pointer', backdropFilter: 'blur(4px)',
          boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}>
        🐞
      </button>

      {aberto && (
        <div style={ov} onClick={e => e.target === e.currentTarget && fechar()}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#dce8ff' }}>{pick(T.titulo)}</div>
              <button onClick={fechar} aria-label={pick(T.fechar)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            {ok ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 14, color: '#dce8ff', fontWeight: 700 }}>{pick(T.enviado)}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 6, lineHeight: 1.5 }}>
                  {pick(T.agradecimento)}
                </div>
                <button onClick={fechar} style={{ ...acao('#3b82f6'), marginTop: 16, width: '100%' }}>{pick(T.fechar)}</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 10, lineHeight: 1.5 }}>
                  {pick(T.instrucao)}
                </div>
                <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
                  placeholder={pick(T.placeholder)}
                  rows={5} style={{ width: '100%', boxSizing: 'border-box', padding: 11, borderRadius: 8,
                    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)',
                    color: '#dce8ff', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10,
                  fontSize: 12, color: '#60a5fa', cursor: 'pointer' }}>
                  📎 {foto ? foto.name.slice(0, 28) : pick(T.anexar)}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => setFoto(e.target.files?.[0] ?? null)} />
                </label>

                {erro && <div style={{ color: '#f87171', fontSize: 12, marginTop: 10 }}>{erro}</div>}

                <button onClick={enviar} disabled={enviando} style={{ ...acao('#3b82f6'), marginTop: 14, width: '100%', opacity: enviando ? 0.6 : 1 }}>
                  {enviando ? pick(T.enviando) : pick(T.enviar)}
                </button>

                {podeVerPainel && (
                  <button onClick={() => { setAberto(false); setPainel(true); }}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
                      fontSize: 12, cursor: 'pointer', marginTop: 12, width: '100%', textDecoration: 'underline' }}>
                    {pick(T.verPainel)}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {painel && <BugReportsPanel onFechar={() => setPainel(false)} />}
    </>
  );
}

const ov: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const card: React.CSSProperties = {
  width: '100%', maxWidth: 440, background: '#0d1521', borderRadius: 16,
  border: '1px solid rgba(255,255,255,.1)', padding: 20, fontFamily: 'Inter,sans-serif',
};
const acao = (cor: string): React.CSSProperties => ({
  padding: '12px', borderRadius: 8, border: 'none', background: cor, color: '#fff',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
});
