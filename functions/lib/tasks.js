"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTask = createTask;
exports.approveTask = approveTask;
exports.updateTaskProgress = updateTaskProgress;
// functions/src/tasks.ts — firebase-functions v2
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
async function createTask(data, context) {
    try {
        const { slotId, zona, tipo, descricao } = data;
        const uid = context.auth?.uid;
        if (!uid || !slotId || !tipo || !descricao)
            throw new Error('Dados incompletos');
        const taskRef = db.collection('tasks').doc();
        await taskRef.set({
            id: taskRef.id,
            slotId, zona, tipo, descricao,
            criadorId: uid,
            atribuidoPara: null,
            status: 'pendente',
            criadoEm: new Date(),
            atualizadoEm: new Date(),
        });
        return { success: true, taskId: taskRef.id };
    }
    catch (error) {
        console.error('Erro ao criar tarefa:', error);
        throw new https_1.HttpsError('internal', error.message);
    }
}
async function approveTask(data, context) {
    try {
        const { taskId } = data;
        const uid = context.auth?.uid;
        if (!uid || !taskId)
            throw new Error('Dados incompletos');
        await db.collection('tasks').doc(taskId).update({
            status: 'aprovada',
            aprovadoPor: uid,
            aprovadoEm: new Date(),
        });
        return { success: true };
    }
    catch (error) {
        console.error('Erro ao aprovar tarefa:', error);
        throw new https_1.HttpsError('internal', error.message);
    }
}
async function updateTaskProgress(data, context) {
    try {
        const { taskId, progresso, fotos } = data;
        const uid = context.auth?.uid;
        if (!uid || !taskId)
            throw new Error('Dados incompletos');
        await db.collection('tasks').doc(taskId).update({
            progresso,
            fotos: fotos || [],
            atualizadoEm: new Date(),
        });
        return { success: true };
    }
    catch (error) {
        console.error('Erro ao atualizar tarefa:', error);
        throw new https_1.HttpsError('internal', error.message);
    }
}
//# sourceMappingURL=tasks.js.map