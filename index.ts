// src/auth/index.ts
import * as admin from 'firebase-admin';
import { db, erroResponse, okResponse, logEvento } from '../utils';

// ── LOGIN (valida usuário no Firestore) ──────────────────────────
export async function getUsuario(uid: string) {
  const doc = await db().collection('usuarios').doc(uid).get();
  if (!doc.exists) return erroResponse('Usuário não encontrado.');

  const data = doc.data()!;
  if (!data.ativo) return erroResponse('Usuário inativo.');

  // Atualiza último acesso
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
export async function solicitarAcesso(payload: {
  email: string;
  nome: string;
  paises: string[];
  motivo?: string;
}) {
  const { email, nome, paises, motivo } = payload;

  if (!email || !nome || !paises?.length) {
    return erroResponse('Email, nome e países são obrigatórios.');
  }

  // Verifica se já tem solicitação pendente
  const existente = await db().collection('solicitacoes')
    .where('email', '==', email)
    .where('status', '==', 'PENDENTE')
    .get();

  if (!existente.empty) {
    return erroResponse('Já existe uma solicitação pendente para este email.');
  }

  await db().collection('solicitacoes').add({
    email, nome, paises,
    motivo:    motivo || '',
    status:    'PENDENTE',
    criadoEm:  admin.firestore.FieldValue.serverTimestamp()
  });

  return okResponse({ mensagem: 'Solicitação enviada com sucesso.' });
}

// ── APROVAR SOLICITAÇÃO (gestor/admin) ───────────────────────────
export async function aprovarSolicitacao(
  solicitacaoId: string,
  uid: string, email: string
) {
  const ref = db().collection('solicitacoes').doc(solicitacaoId);
  const doc = await ref.get();
  if (!doc.exists) return erroResponse('Solicitação não encontrada.');

  const sol = doc.data()!;

  // Cria usuário no Auth (ou busca existente)
  let userRecord: admin.auth.UserRecord;
  let isNovo = false;
  try {
    userRecord = await admin.auth().getUserByEmail(sol.email);
  } catch {
    userRecord = await admin.auth().createUser({
      email:       sol.email,
      password:    Math.random().toString(36).slice(-10) + 'A1!',
      displayName: sol.nome
    });
    isNovo = true;
  }

  // Cria perfil no Firestore
  await db().collection('usuarios').doc(userRecord.uid).set({
    uid:          userRecord.uid,
    email:        sol.email,
    nome:         sol.nome,
    role:         'campo',
    paises:       sol.paises,
    ativo:        true,
    criadoEm:     admin.firestore.FieldValue.serverTimestamp(),
    ultimoAcesso: null
  });

  // Envia email de boas-vindas com link para definir senha
  try {
    const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';

    if (FIREBASE_WEB_API_KEY) {
      const axios = (await import('axios')).default;
      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_WEB_API_KEY}`,
        {
          requestType: 'PASSWORD_RESET',
          email: sol.email,
          continueUrl: 'https://jet-os-7.web.app'
        }
      );
      console.log(`[aprovar] Email de reset enviado para ${sol.email}`);
    } else {
      // Fallback: gera o link e loga (admin pode enviar manualmente)
      const link = await admin.auth().generatePasswordResetLink(sol.email, {
        url: 'https://jet-os-7.web.app'
      });
      console.log(`[aprovar] Link de reset para ${sol.email}: ${link}`);
    }
  } catch(e) {
    console.error('[aprovar] Erro ao enviar email:', e);
    // Não falha a aprovação por causa do email
  }

  // Atualiza solicitação
  await ref.update({
    status:       'APROVADA',
    resolvidoEm:  admin.firestore.FieldValue.serverTimestamp(),
    resolvidoPor: email
  });

  await logEvento({
    tipo: 'STATUS_CHANGED',
    uid, email,
    descricao: `Solicitação aprovada: ${sol.email}`
  });

  return okResponse({ uid: userRecord.uid, mensagem: 'Usuário criado com sucesso.' });
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