// functions/src/tasks.ts — firebase-functions v2
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export async function createTask(data: any, context: any) {
  try {
    const { slotId, zona, tipo, descricao } = data;
    const uid = context.auth?.uid;
    if (!uid || !slotId || !tipo || !descricao) throw new Error('Dados incompletos');

    const taskRef = db.collection('tasks').doc();
    await taskRef.set({
      id:           taskRef.id,
      slotId, zona, tipo, descricao,
      criadorId:    uid,
      atribuidoPara:null,
      status:       'pendente',
      criadoEm:     new Date(),
      atualizadoEm: new Date(),
    });

    return { success: true, taskId: taskRef.id };
  } catch (error: any) {
    console.error('Erro ao criar tarefa:', error);
    throw new HttpsError('internal', error.message);
  }
}

export async function approveTask(data: any, context: any) {
  try {
    const { taskId } = data;
    const uid = context.auth?.uid;
    if (!uid || !taskId) throw new Error('Dados incompletos');

    await db.collection('tasks').doc(taskId).update({
      status:     'aprovada',
      aprovadoPor:uid,
      aprovadoEm: new Date(),
    });

    return { success: true };
  } catch (error: any) {
    console.error('Erro ao aprovar tarefa:', error);
    throw new HttpsError('internal', error.message);
  }
}

export async function updateTaskProgress(data: any, context: any) {
  try {
    const { taskId, progresso, fotos } = data;
    const uid = context.auth?.uid;
    if (!uid || !taskId) throw new Error('Dados incompletos');

    await db.collection('tasks').doc(taskId).update({
      progresso,
      fotos:        fotos || [],
      atualizadoEm: new Date(),
    });

    return { success: true };
  } catch (error: any) {
    console.error('Erro ao atualizar tarefa:', error);
    throw new HttpsError('internal', error.message);
  }
}
