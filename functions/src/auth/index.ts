// functions/src/auth/index.ts
import * as admin from 'firebase-admin';
import { db, erroResponse, okResponse, logEvento } from '../utils';

// ── GET USUÁRIO ──────────────────────────────────────────────────
export async function getUsuario(uid: string) {
  const docSnap = await db().collection('usuarios').doc(uid).get();
  if (!docSnap.exists) return erroResponse('Usuário não encontrado.');
  const data = docSnap.data()!;
  if (!data.ativo) return erroResponse('Usuário inativo.');
  await db().collection('usuarios').doc(uid).update({
    ultimoAcesso: admin.firestore.FieldValue.serverTimestamp()
  });
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

  const existente = await db().collection('solicitacoes')
    .where('email', '==', email)
    .where('status', '==', 'PENDENTE')
    .get();
  if (!existente.empty) {
    return erroResponse('Já existe uma solicitação pendente para este email.');
  }

  const rolesValidos = ['campo', 'guard'];
  const roleValido   = rolesValidos.includes(roleDesejado || '') ? roleDesejado : 'campo';

  await db().collection('solicitacoes').add({
    email,
    nome,
    paises,
    motivo:      motivo || '',
    roleDesejado: roleValido,
    status:      'PENDENTE',
    criadoEm:    admin.firestore.FieldValue.serverTimestamp()
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
  const ref     = db().collection('solicitacoes').doc(solicitacaoId);
  const docSnap = await ref.get();
  if (!docSnap.exists) return erroResponse('Solicitação não encontrada.');
  const sol = docSnap.data()!;

  // Determina role final: override > roleDesejado da solicitação > fallback 'campo'
  const rolesPermitidos = ['campo', 'guard'];
  let roleFinal = 'campo';
  if (roleOverride && rolesPermitidos.includes(roleOverride)) {
    roleFinal = roleOverride;
  } else if (sol.roleDesejado && rolesPermitidos.includes(sol.roleDesejado)) {
    roleFinal = sol.roleDesejado;
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

  // Cria / sobrescreve perfil no Firestore com role correto
  await db().collection('usuarios').doc(userRecord.uid).set({
    uid:          userRecord.uid,
    email:        sol.email,
    nome:         sol.nome,
    role:         roleFinal,
    paises:       sol.paises,
    ativo:        true,
    criadoEm:     admin.firestore.FieldValue.serverTimestamp(),
    ultimoAcesso: null
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
  await ref.update({
    status:        'APROVADA',
    resolvidoEm:   admin.firestore.FieldValue.serverTimestamp(),
    resolvidoPor:  email,
    roleAtribuido: roleFinal
  });

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
  const snap = await db().collection('solicitacoes')
    .where('status', '==', 'PENDENTE')
    .orderBy('criadoEm', 'desc')
    .get();
  return okResponse({
    solicitacoes: snap.docs.map(d => ({ id: d.id, ...d.data() }))
  });
}

// ── LISTAR USUÁRIOS ──────────────────────────────────────────────
export async function listarUsuarios() {
  const snap = await db().collection('usuarios')
    .orderBy('criadoEm', 'desc')
    .get();
  return okResponse({
    usuarios: snap.docs.map(d => d.data())
  });
}
