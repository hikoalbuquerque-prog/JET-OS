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
exports.gerarCroqui = gerarCroqui;
exports.gerarCroquisLote = gerarCroquisLote;
// src/croquis/index.ts — Geração de croquis via Google Slides API
const admin = __importStar(require("firebase-admin"));
const utils_1 = require("../utils");
const supabase_rest_1 = require("../lib/supabase-rest");
const TEMPLATE_PUBLICO_BR = '1i0Za1wf1rK_W3-HLFQ6X2xZwoC7aaEZ_9tjpC0v6120';
const TEMPLATE_PRIVADO_BR = '1x4wQ4DuOBQuxZehy5HCL60luET3xRdc9h_EzUv2GINA';
const PASTA_CROQUIS_ROOT = '1o5V7xBylld1Omn7aLbzw0F3qxGMJt-vw';
// ── GOOGLE APIs CLIENT ───────────────────────────────────────────
async function getGoogleClients() {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(process.env.OAUTH_CLIENT_ID, process.env.OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const slides = google.slides({ version: 'v1', auth: oauth2Client });
    return { drive, slides, authClient: oauth2Client };
}
// ── PASTA NO DRIVE ───────────────────────────────────────────────
async function getOuCriarPasta(drive, nome, paiId) {
    const q = `name='${nome}' and '${paiId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const resp = await drive.files.list({ q, fields: 'files(id,name)' });
    if (resp.data.files?.length > 0)
        return resp.data.files[0].id;
    const criar = await drive.files.create({
        requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [paiId] },
        fields: 'id'
    });
    return criar.data.id;
}
// ── TOKEN MAP ────────────────────────────────────────────────────
function buildTokenMap(e) {
    const bairroSubpref = [e.bairro, e.subprefeitura].filter(Boolean).join(' / ');
    const hoje = new Date().toLocaleDateString('pt-BR');
    const faixaIA = e.ia?.largura || '';
    const faixaMan = e.larguraFaixa ? String(e.larguraFaixa) : '';
    const faixaLivre = faixaIA || faixaMan;
    const faixaSufixo = faixaIA ? ' m (IA)' : (faixaMan ? ' m' : '');
    const linha = (label, valor, suf = '') => valor ? `${label}: ${valor}${suf}` : '';
    return {
        '{{TITULO_CROQUI}}': 'Croqui de Implementação de Estação',
        '{{ID_ESTACAO}}': e.codigo || e.id,
        '{{CODIGO_ESTACAO}}': e.codigo || e.id,
        '{{CIDADE}}': e.cidade || '',
        '{{BAIRRO_SUBPREFEITURA}}': bairroSubpref,
        '{{ENDERECO}}': e.endereco || '',
        '{{LOCALIZACAO}}': e.localizacao || `${e.lat}, ${e.lng}`,
        '{{TIPO_ESTACAO}}': e.tipo === 'PUBLICA'
            ? 'Estação em Espaço Público'
            : 'Estação em Área Privada',
        '{{LOCAL_PRIVADO}}': e.privado?.nomeLocal || '',
        '{{LINHA_CAPACIDADE}}': linha('Capacidade', e.capacidade || ''),
        '{{LINHA_DIMENSOES}}': linha('Dimensões', e.dimensoes || ''),
        '{{LINHA_AREA_TOTAL}}': linha('Área', e.areaTotal || ''),
        '{{LINHA_FAIXA_LIVRE}}': linha('Faixa livre', faixaLivre, faixaSufixo),
        '{{LINHA_FAIXA_MINIMA}}': linha('Faixa mínima', e.faixaMinima || '', ' m'),
        '{{LINHA_CONDICAO}}': linha('Condição', e.condicao || ''),
        '{{BASE_LEGAL}}': 'Documento técnico elaborado conforme levantamento em campo e diretrizes aplicáveis ao uso do espaço urbano.',
        '{{RESPONSAVEL_TECNICO}}': 'Equipe técnica JET',
        '{{DATA_LEVANTAMENTO}}': hoje,
        '{{OBSERVACOES_TECNICAS}}': 'Implantação analisada considerando circulação de pedestres, acessibilidade e segurança viária.',
        '{{LARGURA_IA}}': faixaIA,
        '{{SCORE_IA}}': e.ia?.score ? String(e.ia.score) : '',
        '{{APROVADO_IA}}': e.ia?.aprovado != null
            ? (e.ia.aprovado ? 'Aprovado' : 'Reprovado') : '',
        '{{CONFIANCA_IA}}': e.ia?.confianca || '',
        '{{MOTIVO_IA}}': '',
        // Privado
        '{{LINHA_AUTORIZANTE}}': linha('Autorizante', e.privado?.nomeAutorizante || ''),
        '{{LINHA_CARGO}}': linha('Cargo', e.privado?.cargoAutorizante || ''),
        '{{LINHA_TELEFONE}}': linha('Telefone', e.privado?.telefone || ''),
        '{{LINHA_EMAIL}}': linha('E-mail', e.privado?.email || ''),
        '{{LINHA_DOCUMENTO}}': linha('Documento', e.privado?.documento || ''),
        '{{LINHA_DATA}}': e.privado?.dataAutorizacao
            ? `Data: ${new Date(e.privado.dataAutorizacao).toLocaleDateString('pt-BR')}`
            : `Data: ${hoje}`,
        '{{DECLARACAO_AUTORIZACAO}}': 'A implantação ocorre integralmente em área privada, mediante autorização expressa do responsável legal.',
        '{{RESPONSABILIDADE_CIVIL}}': 'A responsabilidade civil pelo uso do espaço é atribuída ao autorizante.',
        '{{VALIDADE_AUTORIZACAO}}': 'Autorização válida enquanto mantidas as condições descritas neste documento.',
    };
}
// ── SUBSTITUI TEXTOS ─────────────────────────────────────────────
async function substituirTextos(slides, presId, tokenMap) {
    const requests = Object.entries(tokenMap)
        .filter(([, v]) => v !== undefined)
        .map(([find, replace]) => ({
        replaceAllText: {
            containsText: { text: find, matchCase: true },
            replaceText: replace || ''
        }
    }));
    if (!requests.length)
        return;
    await slides.presentations.batchUpdate({
        presentationId: presId,
        requestBody: { requests }
    });
}
// ── INSERE IMAGEM SUBSTITUINDO PLACEHOLDER ───────────────────────
async function inserirImagem(slides, presId, placeholder, imageUrl) {
    if (!imageUrl)
        return;
    const pres = await slides.presentations.get({ presentationId: presId });
    let elementId = null;
    let pageObjectId = null;
    let size = null;
    let transform = null;
    for (const slide of (pres.data.slides || [])) {
        for (const el of (slide.pageElements || [])) {
            const txt = el.shape?.text?.textElements
                ?.map((t) => t.textRun?.content || '').join('') || '';
            if (txt.includes(placeholder)) {
                elementId = el.objectId;
                pageObjectId = slide.objectId;
                size = el.size;
                transform = el.transform;
                break;
            }
        }
        if (elementId)
            break;
    }
    if (!elementId || !pageObjectId)
        return;
    await slides.presentations.batchUpdate({
        presentationId: presId,
        requestBody: {
            requests: [
                { deleteObject: { objectId: elementId } },
                { createImage: { url: imageUrl, elementProperties: { pageObjectId, size, transform } } }
            ]
        }
    });
}
// ── EXPORTA PDF ──────────────────────────────────────────────────
async function exportarPDF(drive, fileId) {
    const resp = await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
    return Buffer.from(resp.data);
}
// ── SALVA PDF NO DRIVE ───────────────────────────────────────────
async function salvarPDFnoDrive(drive, buffer, nome, pastaId) {
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    const resp = await drive.files.create({
        requestBody: { name: nome + '.pdf', parents: [pastaId], mimeType: 'application/pdf' },
        media: { mimeType: 'application/pdf', body: stream },
        fields: 'id'
    });
    return resp.data.id;
}
// ── FUNÇÃO PRINCIPAL ─────────────────────────────────────────────
async function gerarCroqui(estacaoId, uid, email) {
    // Supabase-first read with Firestore fallback
    let e = null;
    try {
        const sb = await (0, supabase_rest_1.supabaseGetOne)('estacoes', `id=eq.${estacaoId}&select=*`)
            ?? await (0, supabase_rest_1.supabaseGetOne)('estacoes', `firebase_id=eq.${estacaoId}&select=*`);
        if (sb)
            e = sb;
    }
    catch { /* fallback to Firestore */ }
    if (!e) {
        const snap = await (0, utils_1.db)().collection('estacoes').doc(estacaoId).get();
        if (!snap.exists)
            return (0, utils_1.erroResponse)('Estação não encontrada.');
        e = { id: snap.id, ...snap.data() };
    }
    if (!e.lat || !e.lng)
        return (0, utils_1.erroResponse)('Estação sem coordenadas.');
    const isPrivado = e.tipo === 'PRIVADA';
    const templateId = isPrivado ? TEMPLATE_PRIVADO_BR : TEMPLATE_PUBLICO_BR;
    const tokenMap = buildTokenMap(e);
    const { drive, slides } = await getGoogleClients();
    // Pastas: Root / País / Cidade
    const pais = (e.pais || 'BR').toUpperCase();
    const pastaPais = await getOuCriarPasta(drive, pais, PASTA_CROQUIS_ROOT);
    const pastaCidade = await getOuCriarPasta(drive, e.cidade, pastaPais);
    const nomeArquivo = `${e.endereco || e.codigo} - croqui`;
    // Copia template
    const copiaResp = await drive.files.copy({
        fileId: templateId,
        requestBody: { name: nomeArquivo, parents: [pastaCidade] },
        fields: 'id'
    });
    const copiaId = copiaResp.data.id;
    try {
        // Substitui tokens de texto
        await substituirTextos(slides, copiaId, tokenMap);
        // Insere imagens (foto com fallback para SV)
        const fotoUrl = e.imagens?.foto || e.imagens?.streetView || '';
        if (fotoUrl)
            await inserirImagem(slides, copiaId, '{{FOTO_ESTACAO}}', fotoUrl);
        if (e.imagens?.satelite)
            await inserirImagem(slides, copiaId, '{{SAT_IMG}}', e.imagens.satelite);
        if (e.imagens?.mapa)
            await inserirImagem(slides, copiaId, '{{MAP_IMG}}', e.imagens.mapa);
        // Assinatura do autorizante (privado)
        if (isPrivado && e.privado?.assinatura) {
            await inserirImagem(slides, copiaId, '{{ASSINATURA}}', e.privado.assinatura);
        }
        // Exporta PDF e salva
        const pdfBuffer = await exportarPDF(drive, copiaId);
        const pdfId = await salvarPDFnoDrive(drive, pdfBuffer, nomeArquivo, pastaCidade);
        const pdfUrl = `https://drive.google.com/file/d/${pdfId}/view`;
        // Remove Slides temporário
        await drive.files.delete({ fileId: copiaId }).catch(() => { });
        // Atualiza estação (Firestore + dual-write Supabase)
        await (0, utils_1.db)().collection('estacoes').doc(estacaoId).update({
            'imagens.croqui': pdfUrl,
            croquiStatus: 'OK',
            croquiGeradoEm: admin.firestore.FieldValue.serverTimestamp()
        });
        (0, supabase_rest_1.supabaseUpsert)('estacoes', {
            firebase_id: estacaoId,
            imagens: { croqui: pdfUrl },
            croqui_status: 'OK',
            croqui_gerado_em: new Date().toISOString(),
        }, 'firebase_id').catch(() => { });
        await (0, utils_1.logEvento)({
            tipo: 'CROQUI_GERADO', uid, email,
            descricao: `Croqui: ${e.codigo}`,
            meta: { pdfId, pdfUrl }
        });
        return (0, utils_1.okResponse)({ pdfUrl, pdfId });
    }
    catch (err) {
        // Remove cópia em caso de erro
        await drive.files.delete({ fileId: copiaId }).catch(() => { });
        await (0, utils_1.db)().collection('estacoes').doc(estacaoId).update({
            croquiStatus: 'ERRO',
            croquiUltimoErro: err.message
        });
        (0, supabase_rest_1.supabaseUpsert)('estacoes', {
            firebase_id: estacaoId,
            croqui_status: 'ERRO',
            croqui_ultimo_erro: err.message,
        }, 'firebase_id').catch(() => { });
        throw err;
    }
}
// ── CROQUIS EM LOTE ──────────────────────────────────────────────
async function gerarCroquisLote(cidade, pais, loteSize, uid, email) {
    // Supabase-first query with Firestore fallback
    let todasSemCroqui = [];
    try {
        const sbRows = await (0, supabase_rest_1.supabaseGet)('estacoes', `pais=eq.${encodeURIComponent(pais)}&cidade=eq.${encodeURIComponent(cidade)}&select=*`);
        if (sbRows && sbRows.length > 0) {
            todasSemCroqui = sbRows
                .filter((r) => !r.croqui_status || r.croqui_status === 'PENDENTE' || r.croqui_status === 'ERRO')
                .map((r) => ({ id: r.firebase_id || r.id, data: () => r }));
        }
        else {
            throw new Error('fallback');
        }
    }
    catch {
        const snapSem = await (0, utils_1.db)().collection('estacoes')
            .where('pais', '==', pais)
            .where('cidade', '==', cidade)
            .get();
        todasSemCroqui = snapSem.docs
            .filter((d) => {
            const data = d.data();
            return !data.croquiStatus || data.croquiStatus === 'PENDENTE' || data.croquiStatus === 'ERRO';
        });
    }
    const semCroqui = todasSemCroqui.slice(0, loteSize);
    const totalRestantes = todasSemCroqui.length;
    if (!semCroqui.length) {
        return (0, utils_1.okResponse)({ processados: 0, restantes: 0, mensagem: 'Todos os croquis já foram gerados.' });
    }
    let processados = 0;
    let erros = 0;
    const detalhes = [];
    for (const docSnap of semCroqui) {
        const estacaoId = docSnap.id;
        try {
            const res = await gerarCroqui(estacaoId, uid, email);
            if (res.ok) {
                processados++;
                detalhes.push({ codigo: docSnap.data().codigo, status: 'OK', url: res.pdfUrl });
            }
            else {
                erros++;
                detalhes.push({ codigo: docSnap.data().codigo, status: 'ERRO' });
            }
        }
        catch (e) {
            erros++;
            const msg = e.message || 'Erro desconhecido';
            detalhes.push({ codigo: docSnap.data().codigo, status: 'ERRO: ' + msg });
            console.error(`[CroquisLote] Erro em ${docSnap.data().codigo}:`, msg);
        }
    }
    return (0, utils_1.okResponse)({
        processados,
        erros,
        restantes: Math.max(0, totalRestantes - processados),
        detalhes
    });
}
//# sourceMappingURL=index.js.map