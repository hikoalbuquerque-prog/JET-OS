// frontend/src/lib/bugReport.ts
// Canal de report de bug/erro → Firestore (coleção bug_reports).
//   - Report MANUAL: botão "Reportar problema" (ver components/BugReportButton).
//   - Captura AUTOMÁTICA: erros não-tratados (window.error / unhandledrejection).
// Gestão lê em components/BugReportsPanel. Sem Telegram/e-mail (decisão do produto).

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

export const APP_VERSAO = '1.0.0'; // manter alinhado com frontend/package.json

export interface BugReportInput {
  tipo: 'manual' | 'auto';
  descricao: string;
  fotoUrl?: string | null;
  erro?: { mensagem?: string; stack?: string; origem?: string } | null;
}

// Contexto técnico anexado a todo report — ajuda a reproduzir o problema.
function coletarContexto() {
  const plataforma =
    (navigator as any).userAgentData?.platform || navigator.platform || '';
  return {
    appVersao:  APP_VERSAO,
    plataforma,
    userAgent:  navigator.userAgent.slice(0, 300),
    idioma:     navigator.language,
    online:     navigator.onLine,
    url:        location.href.slice(0, 500),
    titulo:     document.title,
    tela:       (window.innerWidth <= 768 ? 'mobile' : 'desktop'),
    viewport:   `${window.innerWidth}x${window.innerHeight}`,
  };
}

// Dados do usuário logado (passados de fora para evitar acoplar ao App).
export interface BugUserCtx {
  uid?: string; nome?: string; email?: string; role?: string; tipoCadastro?: string;
}

export async function enviarBugReport(input: BugReportInput, user?: BugUserCtx): Promise<void> {
  const uid = user?.uid || auth.currentUser?.uid;
  if (!uid) throw new Error('Faça login para enviar um report.');
  await addDoc(collection(db, 'bug_reports'), {
    uid,
    nome:         user?.nome ?? auth.currentUser?.displayName ?? '',
    email:        user?.email ?? auth.currentUser?.email ?? '',
    role:         user?.role ?? '',
    tipoCadastro: user?.tipoCadastro ?? '',
    tipo:         input.tipo,
    descricao:    (input.descricao || '').slice(0, 4000),
    fotoUrl:      input.fotoUrl ?? null,
    erro:         input.erro ?? null,
    status:       'aberto',
    contexto:     coletarContexto(),
    criadoEm:     serverTimestamp(),
    criadoEmTs:   Date.now(),
  });
}

// ─── Captura automática de erros não-tratados ────────────────────────────────
// Throttle + dedupe para não inundar o Firestore (e nunca lançar erro próprio).

let instalado = false;
const vistos = new Set<string>();
let enviados = 0;
const MAX_AUTO_POR_SESSAO = 25;

function assinatura(msg: string, stack?: string): string {
  return (msg + '|' + (stack || '').split('\n').slice(0, 3).join('|')).slice(0, 300);
}

/**
 * Instala os listeners globais de erro. Chamar UMA vez após o login.
 * @param userRef função que devolve o usuário atual (para anexar ao report).
 */
export function instalarCapturaErros(userRef: () => BugUserCtx | undefined): void {
  if (instalado) return;
  instalado = true;

  const capturar = (mensagem: string, stack: string | undefined, origem: string) => {
    if (enviados >= MAX_AUTO_POR_SESSAO) return;
    const sig = assinatura(mensagem, stack);
    if (vistos.has(sig)) return;       // mesmo erro já reportado nesta sessão
    vistos.add(sig);
    enviados++;
    // best-effort: nunca propaga falha do próprio reporter
    void enviarBugReport(
      { tipo: 'auto', descricao: '(erro automático)', erro: { mensagem, stack, origem } },
      userRef(),
    ).catch(() => { /* silencioso */ });
  };

  window.addEventListener('error', (ev: ErrorEvent) => {
    const msg = ev.message || String(ev.error?.message || 'Erro desconhecido');
    capturar(msg, ev.error?.stack, `window.error @ ${ev.filename}:${ev.lineno}`);
  });

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r: any = ev.reason;
    const msg = r?.message ? String(r.message) : String(r);
    capturar(msg, r?.stack, 'unhandledrejection');
  });
}
