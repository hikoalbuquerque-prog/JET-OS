// ============================================================================
// JET OS — Import do HISTÓRICO de perdas (BRPD) -> Supabase como ocorrências 'Perda'
//
// Fonte: JET_Guard.xlsx, aba "Cópia de ROUBOS" — agregado POR FILIAL
//   (Patinetes furtados / Bicicletas furtadas / Baterias furtadas por região/filial).
// Como o relatório novo conta perdas como OCORRÊNCIAS (paridade com roubos), expandimos
// cada contagem agregada em ocorrências 'Perda' individuais no Supabase.
//
// Premissas (ajuste aqui se necessário ANTES de rodar):
//   - 1 ocorrência por unidade perdida; ativo_tipo = Patinete | Bicicleta | Bateria.
//   - cidade = nome da filial (dimensão de quebra do relatório); status = 'encerrado'.
//   - criado_em = DATA_HISTORICA (não cai em 24h/7d — entra só no total/por-região).
//   - firebase_doc_id sintético e estável -> IDEMPOTENTE (rode quantas vezes quiser).
// O trigger espelharOcorrenciaSupabase NÃO interfere (ele só trata escritas no Firestore;
// aqui escrevemos direto no Supabase). Perdas NOVAS continuam vindo do app (tipo 'Perda').
//
// Pré-requisitos (na pasta supabase/scripts):
//   npm i xlsx                       # @supabase/supabase-js já está aqui (mirror.mjs)
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role>
//   node import-perdas-historico.mjs
//
// Para REMOVER tudo o que este script criou (rollback):
//   delete from public.ocorrencias where firebase_doc_id like 'PERDA-HIST-%';
// ============================================================================

import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = join(__dirname, '..', '..', 'JET_Guard.xlsx'); // raiz do projeto
const SHEET     = 'Cópia de ROUBOS';
const DATA_HISTORICA = '2026-06-06T00:00:00.000Z'; // "desde o início" — carimbo histórico

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Colunas da aba (por posição — o cabeçalho está na 1ª linha):
// 0 Região | 1 Filial | 2 Patinetes | 3 Bicicletas | 4 Baterias | 5 Total | 6 Período
const EQUIP = [
  { col: 2, ativo: 'Patinete' },
  { col: 3, ativo: 'Bicicleta' },
  { col: 4, ativo: 'Bateria'  },
];

(async () => {
  console.log('== Import perdas históricas (BRPD) -> Supabase ==');
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[SHEET];
  if (!ws) { console.error(`Aba "${SHEET}" não encontrada em ${XLSX_PATH}`); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });

  const ocor = [];
  for (let i = 1; i < rows.length; i++) {        // pula cabeçalho (linha 0)
    const r = rows[i];
    const regiao = (r[0] || '').toString().trim();
    const filial = (r[1] || '').toString().trim();
    if (!filial || /total geral/i.test(regiao)) continue; // pula linha de total
    for (const e of EQUIP) {
      const qtd = parseInt(r[e.col], 10) || 0;
      for (let k = 1; k <= qtd; k++) {
        ocor.push({
          firebase_doc_id: `PERDA-HIST-${slug(filial)}-${e.ativo.toLowerCase()}-${String(k).padStart(3, '0')}`,
          codigo:          `PERDA-HIST-${slug(filial)}-${e.ativo.toLowerCase()}-${String(k).padStart(3, '0')}`,
          tipo:            'Perda',
          status:          'encerrado',
          ativo_tipo:      e.ativo,
          cidade:          filial,
          descricao:       `Perda histórica (BRPD) — ${regiao} / ${filial}. Importado de JET_Guard.xlsx (aba "${SHEET}").`,
          origem_registro: 'Planilha',
          criado_em:       DATA_HISTORICA,
          data_manual:     DATA_HISTORICA,
        });
      }
    }
  }

  console.log(`  Geradas ${ocor.length} ocorrências 'Perda' (${new Set(ocor.map(o => o.cidade)).size} filiais).`);
  let total = 0;
  for (const part of chunk(ocor, 500)) {
    const { error } = await sb.from('ocorrencias').upsert(part, { onConflict: 'firebase_doc_id' });
    if (error) { console.error('  [ocorrencias] erro:', error.message); process.exit(1); }
    total += part.length;
    console.log(`  upsert ${total}/${ocor.length}`);
  }
  console.log('== Concluído ==  (rollback: delete from ocorrencias where firebase_doc_id like \'PERDA-HIST-%\')');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
