// src/ia/index.ts
import axios from 'axios';
import { fetchFramesParaIA } from '../streetview';

const GEMINI_KEY   = process.env.GEMINI_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── PROMPT ───────────────────────────────────────────────────────
function montarPrompt(): string {
  return [
    'Auditor tecnico de implantacao de estacoes de micromobilidade.',
    'Analise as imagens Street View e decida se existe calcada PUBLICA implantavel.',
    '',
    'DISTINCAO IMPORTANTE:',
    '- CALCADA PUBLICA: passeio continuo na beira da via. PODE ser aprovado.',
    '- RECUO PRIVADO: area dentro do lote, atras de portao ou muro. REPROVAR.',
    '- Muro na borda do passeio NAO torna a calcada privada.',
    '',
    'APROVADO se: calcada publica visivel, mesmo lado da via, faixa >= 2.5m.',
    'OBSTACULOS TEMPORARIOS (cones, carros, lixeiras) NAO reprovam.',
    'Se calcada lateral for adequada, APROVE mesmo com frontal ruim.',
    '',
    'REPROVAR se: interior, estacionamento, garagem, escada, cruzamento sem passeio,',
    'largura estrutural < 2m, muro sem passeio adjacente.',
    '',
    'CONSENSO: aprovado=true se >= 1 imagem mostrar calcada implantavel.',
    '2+ imagens com bloqueio PERMANENTE: reprovar.',
    '',
    'SCORE: 0-25 reprovado, 26-32 aprovado com ressalvas, 33-40 aprovado.',
    'LARGURA: estime metros de faixa livre estrutural disponivel.',
    '',
    'Retorne APENAS JSON valido (sem markdown):',
    '{"aprovado":false,"larguraEstimada":"X metros ou indefinido","observacoes":"motivo",',
    '"confianca":"alta/media/baixa","score":0,',
    '"motivoCodigo":"CALCADA_OK|SEM_CALCADA|ESTACIONAMENTO|GARAGEM|ESCADA|INTERIOR|',
    'OUTRO_LADO_DA_RUA|OBSTRUCAO|LARGURA_INSUFICIENTE|IMAGEM_INSUFICIENTE|CRUZAMENTO|',
    'RECUO_PRIVADO|MURO_OU_LOTE",',
    '"imagensAnalisadas":0,"imagensPositivas":0,"imagensBloqueantes":0}'
  ].join('\n');
}

// ── NORMALIZAÇÃO ─────────────────────────────────────────────────
interface ResultadoIA {
  aprovado: boolean;
  larguraEstimada: string;
  observacoes: string;
  confianca: 'alta' | 'media' | 'baixa';
  score: number;
  motivoCodigo: string;
  imagensAnalisadas: number;
  imagensPositivas: number;
  imagensBloqueantes: number;
}

function normalizarResultado(raw: Partial<ResultadoIA>, totalFrames: number): ResultadoIA {
  const r: ResultadoIA = {
    aprovado:           raw.aprovado         === true,
    larguraEstimada:    String(raw.larguraEstimada  || 'indefinido'),
    observacoes:        String(raw.observacoes       || ''),
    confianca:          (raw.confianca        || 'baixa') as 'alta' | 'media' | 'baixa',
    score:              Number(raw.score       || 0),
    motivoCodigo:       String(raw.motivoCodigo || 'SEM_CALCADA'),
    imagensAnalisadas:  Number(raw.imagensAnalisadas || totalFrames),
    imagensPositivas:   Number(raw.imagensPositivas  || 0),
    imagensBloqueantes: Number(raw.imagensBloqueantes || 0),
  };

  // Regras de consistência
  if (r.confianca === 'baixa')                         r.aprovado = false;
  if (r.larguraEstimada.toLowerCase().includes('indefinido')) r.aprovado = false;
  if (r.score < 26)                                    r.aprovado = false;
  if (r.imagensBloqueantes >= 2)                       r.aprovado = false;
  if (r.imagensPositivas < 1)                          r.aprovado = false;

  return r;
}

function extrairJson(texto: string): Partial<ResultadoIA> {
  // Remove markdown backticks
  let t = texto.replace(/```json|```/g, '').trim();

  // Encontra o JSON balanceando chaves
  const inicio = t.indexOf('{');
  if (inicio < 0) throw new Error('Nenhum JSON encontrado na resposta Gemini.');

  let depth = 0, fim = -1;
  for (let i = inicio; i < t.length; i++) {
    if (t[i] === '{') depth++;
    if (t[i] === '}') depth--;
    if (depth === 0) { fim = i; break; }
  }

  if (fim < 0) throw new Error('JSON incompleto na resposta Gemini (MAX_TOKENS?).');
  return JSON.parse(t.slice(inicio, fim + 1));
}

// ── CHAMADA GEMINI ───────────────────────────────────────────────
async function chamarGemini(parts: unknown[]): Promise<string> {
  const resp = await axios.post(
    GEMINI_URL,
    {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.0,
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 512
      }
    },
    {
      headers: { 'x-goog-api-key': GEMINI_KEY },
      timeout: 30000
    }
  );

  const candidates = resp.data?.candidates || [];
  const finishReason = candidates[0]?.finishReason;

  if (finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini truncou a resposta (MAX_TOKENS).');
  }

  const parts2 = candidates[0]?.content?.parts || [];
  return parts2.map((p: {text?: string}) => p.text || '').join('');
}

// ── EXPORT PRINCIPAL ─────────────────────────────────────────────

export interface AnalisarCalcadaParams {
  lat: number;
  lng: number;
}

export async function analisarCalcadaIA(params: AnalisarCalcadaParams) {
  const { lat, lng } = params;

  if (!GEMINI_KEY) {
    return { ok: false, error: 'GEMINI_KEY não configurada.' };
  }

  try {
    const frames = await fetchFramesParaIA(lat, lng);

    if (!frames.length) {
      return { ok: false, error: 'Nenhuma imagem disponível para análise.' };
    }

    // Monta parts para o Gemini
    const parts: unknown[] = [{ text: montarPrompt() }];

    frames.forEach((f, idx) => {
      parts.push({
        text: `Imagem ${idx + 1} | ${f.label} | heading:${f.heading}`
      });
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: f.buffer.toString('base64')
        }
      });
    });

    const textoResposta = await chamarGemini(parts);
    const bruto         = extrairJson(textoResposta);
    const resultado     = normalizarResultado(bruto, frames.length);

    return { ok: true, resultado };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[analisarCalcadaIA] erro:', msg);
    return { ok: false, error: msg };
  }
}
