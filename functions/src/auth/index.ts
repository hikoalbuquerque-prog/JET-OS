// functions/src/auth/index.ts
import * as admin from 'firebase-admin';
import { erroResponse, okResponse, logEvento } from '../utils';
import { supabaseGet, supabaseGetOne, supabaseInsert, supabaseUpdate, supabaseUpsert } from '../lib/supabase-rest';

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

  // Cria ou busca usuário no Firebase Auth
  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(sol.email);
  } catch {
    userRecord = await admin.auth().createUser({
      email:       sol.email,
      password:    Math.random().toString(36).slice(-10) + 'A1!',
      displayName: sol.nome
    });
  }

  // Cria / sobrescreve perfil no Supabase com role correto
  await supabaseUpsert('usuarios', {
    uid:           userRecord.uid,
    email:         sol.email,
    nome:          sol.nome,
    role:          roleFinal,
    paises:        sol.paises,
    ativo:         true,
    criado_em:     new Date().toISOString(),
    ultimo_acesso: null
  });

  // Envia email de reset de senha para o novo usuário definir a senha
  try {
    const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';
    if (FIREBASE_WEB_API_KEY) {
      const axios = (await import('axios')).default;
      await axios.post(
        'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + FIREBASE_WEB_API_KEY,
        {
          requestType: 'PASSWORD_RESET',
          email:        sol.email,
          continueUrl:  'https://jet-os-7.web.app'
        }
      );
      console.log('[aprovar] Email de reset enviado para ' + sol.email);
    } else {
      const link = await admin.auth().generatePasswordResetLink(sol.email, {
        url: 'https://jet-os-7.web.app'
      });
      console.log('[aprovar] Link de reset para ' + sol.email + ': ' + link);
    }
  } catch (e) {
    console.error('[aprovar] Erro ao enviar email:', e);
    // Não falha a aprovação por causa do email
  }

  // Atualiza solicitação
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
    uid:      userRecord.uid,
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
