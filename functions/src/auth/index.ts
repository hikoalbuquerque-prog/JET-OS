// functions/src/auth/index.ts
import { erroResponse, okResponse, logEvento } from '../utils';
import { supabaseGet, supabaseGetOne, supabaseInsert, supabaseUpdate, supabaseUpsert } from '../lib/supabase-rest';

const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE ?? '';

async function sbAdminRequest(method: string, path: string, body?: any) {
  const res = await fetch(`${SB_URL()}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase Auth ${method} ${path}: ${res.status} ${txt}`);
  }
  return res.json();
}
import { notificarGestorNovaSolicitacao } from '../notificacoes-prestador';

// ── GET USUÁRIO ──────────────────────────────────────────────────
export async function getUsuario(uid: string) {
  const data = await supabaseGetOne<any>('usuarios', `select=*&uid=eq.${encodeURIComponent(uid)}`);
  if (!data) return erroResponse('Usuário não encontrado.');
  if (!data.ativo) return erroResponse('Usuário inativo.');
  await supabaseUpdate('usuarios', {
    ultimo_acesso: new Date().toISOString()
  }, `uid=eq.${encodeURIComponent(uid)}`);
  return okResponse({
    usuario: {
      uid:    data.uid,
      email:  data.email,
      nome:   data.nome,
      role:   data.role,
      paises: data.paises || ['BR']
    }
  });
}

// ── SOLICITAR ACESSO ─────────────────────────────────────────────
// roleDesejado: 'campo' | 'guard' — default 'campo'
export async function solicitarAcesso(payload: {
  email:        string;
  nome:         string;
  paises:       string[];
  motivo?:      string;
  roleDesejado?: string;
}) {
  const { email, nome, paises, motivo, roleDesejado } = payload;
  if (!email || !nome || !paises?.length) {
    return erroResponse('Email, nome e países são obrigatórios.');
  }

  const existente = await supabaseGet<any>('solicitacoes_prestadores', `select=id&email=eq.${encodeURIComponent(email)}&status=eq.PENDENTE`);
  if (existente && existente.length > 0) {
    return erroResponse('Já existe uma solicitação pendente para este email.');
  }

  const rolesValidos = ['campo', 'guard'];
  const roleValido   = rolesValidos.includes(roleDesejado || '') ? roleDesejado : 'campo';

  await supabaseInsert('solicitacoes_prestadores', {
    email,
    nome,
    paises,
    motivo:        motivo || '',
    role_desejado: roleValido,
    status:        'PENDENTE',
    criado_em:     new Date().toISOString()
  });

  notificarGestorNovaSolicitacao({ nome, cargo: roleValido, cidade: paises?.[0] ?? '', email }).catch(() => {});

  return okResponse({ mensagem: 'Solicitação enviada com sucesso.' });
}

// ── APROVAR SOLICITAÇÃO ──────────────────────────────────────────
// roleOverride: gestor pode forçar o role na hora de aprovar
//   'campo' → acessa TelaMapa (estações)
//   'guard' → acessa TelaGuard (ocorrências)
export async function aprovarSolicitacao(
  solicitacaoId: string,
  uid:           string,
  email:         string,
  roleOverride?: string
) {
  const sol = await supabaseGetOne<any>('solicitacoes_prestadores', `select=*&id=eq.${encodeURIComponent(solicitacaoId)}`);
  if (!sol) return erroResponse('Solicitação não encontrada.');

  // Determina role final: override > roleDesejado da solicitação > fallback 'campo'
  const rolesPermitidos = ['campo', 'guard'];
  let roleFinal = 'campo';
  if (roleOverride && rolesPermitidos.includes(roleOverride)) {
    roleFinal = roleOverride;
  } else if (sol.role_desejado && rolesPermitidos.includes(sol.role_desejado)) {
    roleFinal = sol.role_desejado;
  }

  // Cria ou busca usuário no Supabase Auth
  let userId: string;
  try {
    const existing = await sbAdminRequest('GET', `users?filter=${encodeURIComponent(sol.email)}`);
    const found = existing?.users?.find((u: any) => u.email === sol.email);
    if (found) {
      userId = found.id;
    } else {
      const created = await sbAdminRequest('POST', 'users', {
        email: sol.email,
        password: Math.random().toString(36).slice(-10) + 'A1!',
        email_confirm: true,
        user_metadata: { nome: sol.nome },
      });
      userId = created.id;
    }
  } catch (e) {
    console.error('[aprovar] Erro ao criar usuário Supabase Auth:', e);
    return erroResponse('Erro ao criar usuário no Auth.');
  }

  await supabaseUpsert('usuarios', {
    uid:           userId,
    email:         sol.email,
    nome:          sol.nome,
    role:          roleFinal,
    paises:        sol.paises,
    ativo:         true,
    criado_em:     new Date().toISOString(),
    ultimo_acesso: null
  });

  // Envia link de recovery (reset de senha) via Supabase Auth
  try {
    const linkData = await sbAdminRequest('POST', 'generate_link', {
      type: 'recovery',
      email: sol.email,
      options: { redirect_to: 'https://jet-os-1.web.app' },
    });
    console.log('[aprovar] Link de recovery gerado para ' + sol.email + ': ' + (linkData?.action_link || 'ok'));
  } catch (e) {
    console.error('[aprovar] Erro ao gerar link de recovery:', e);
  }

  await supabaseUpdate('solicitacoes_prestadores', {
    status:         'APROVADA',
    resolvido_em:   new Date().toISOString(),
    resolvido_por:  email,
    role_atribuido: roleFinal
  }, `id=eq.${encodeURIComponent(solicitacaoId)}`);

  await logEvento({
    tipo:     'STATUS_CHANGED',
    uid,
    email,
    descricao: 'Solicitação aprovada como [' + roleFinal + ']: ' + sol.email
  });

  return okResponse({
    uid:      userId,
    role:     roleFinal,
    mensagem: 'Usuário criado como ' + roleFinal + '.'
  });
}

// ── LISTAR SOLICITAÇÕES PENDENTES ────────────────────────────────
export async function listarSolicitacoesPendentes() {
  const rows = await supabaseGet<any>('solicitacoes_prestadores', 'select=*&status=eq.PENDENTE&order=criado_em.desc');
  return okResponse({
    solicitacoes: rows ?? []
  });
}

// ── LISTAR USUÁRIOS ──────────────────────────────────────────────
export async function listarUsuarios() {
  const rows = await supabaseGet<any>('usuarios', 'select=*&order=criado_em.desc');
  return okResponse({
    usuarios: rows ?? []
  });
}
