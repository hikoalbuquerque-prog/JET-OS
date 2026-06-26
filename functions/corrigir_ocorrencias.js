// corrigir_ocorrencias.js
// Corrige os campos de coordenada das ocorrências importadas com schema errado.
//
// Problema detectado:
//   endereco_inicial = "-23,59576743"  → era a latitude (vírgula no lugar de ponto)
//   bairro_inicial   = "-46,65241241"  → era a longitude
//   cidade_inicial   = endereço completo do Nominatim
//   lat_final = 0, lng_final = 0
//
// Correção aplicada:
//   lat_inicial  ← parse de endereco_inicial (trocar vírgula por ponto)
//   lng_inicial  ← parse de bairro_inicial   (trocar vírgula por ponto)
//   cidade_inicial ← extraída do endereço completo (último campo antes do CEP/Brasil)
//   bairro_inicial ← mantido vazio se era coordenada
//   endereco_inicial ← mantido vazio se era coordenada

const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── helpers ────────────────────────────────────────────────────────
function parseCoordenada(str) {
  if (!str || typeof str !== 'string') return null;
  // Troca vírgula por ponto e converte
  const n = parseFloat(str.replace(',', '.'));
  return isNaN(n) ? null : n;
}

function pareceCoordenada(str) {
  if (!str || typeof str !== 'string') return false;
  // Coordenada começa com - e tem apenas dígitos, vírgula ou ponto
  return /^-?\d+[,.]?\d*$/.test(str.trim());
}

function extrairCidade(enderecoCompleto) {
  if (!enderecoCompleto || typeof enderecoCompleto !== 'string') return '';
  // Endereço do Nominatim: "Rua X, Bairro, Cidade, Estado, CEP, Brasil"
  // A cidade costuma ser a 3ª ou 4ª parte
  const partes = enderecoCompleto.split(',').map(p => p.trim());

  // Procura a parte que parece uma cidade (não tem número, não é CEP, não é "Brasil")
  const ignorar = ['brasil', 'brazil', 'são paulo', 'sp', 'rj', 'mg', 'rs', 'pr'];
  for (let i = partes.length - 1; i >= 0; i--) {
    const p = partes[i].toLowerCase();
    if (!p || /^\d{5}-\d{3}$/.test(p) || p === 'brasil' || p === 'brazil') continue;
    // Tenta achar "São Paulo", "Campinas", etc. — palavras sem número
    if (!/\d/.test(partes[i]) && partes[i].length > 3) {
      // Verifica se é um estado abreviado (2 letras)
      if (partes[i].trim().length === 2) continue;
      return partes[i].trim();
    }
  }
  // Fallback: terceiro segmento
  return partes[2] || partes[1] || '';
}

function extrairBairro(enderecoCompleto) {
  if (!enderecoCompleto || typeof enderecoCompleto !== 'string') return '';
  const partes = enderecoCompleto.split(',').map(p => p.trim());
  // Bairro costuma ser o segundo segmento após o logradouro
  return partes[1] || '';
}

// ── main ───────────────────────────────────────────────────────────
async function corrigir() {
  const snap = await db.collection('ocorrencias').get();
  console.log('Total de documentos:', snap.size);

  let corrigidos = 0;
  let ignorados  = 0;
  let erros      = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // Só corrige docs importados (com _importado: true ou coordenadas erradas)
    const eImportado = data._importado === true;
    const enderecoPareceCoordenada = pareceCoordenada(data.endereco_inicial);
    const bairroPareceCoordenada   = pareceCoordenada(data.bairro_inicial);

    if (!eImportado && !enderecoPareceCoordenada) {
      // Doc registrado normalmente pelo TelaGuard — não mexer
      ignorados++;
      continue;
    }

    // Extrai lat/lng dos campos invertidos
    const lat = enderecoPareceCoordenada
      ? parseCoordenada(data.endereco_inicial)
      : (Number(data.lat_inicial) || Number(data.lat_final) || null);

    const lng = bairroPareceCoordenada
      ? parseCoordenada(data.bairro_inicial)
      : (Number(data.lng_inicial) || Number(data.lng_final) || null);

    if (!lat || !lng) {
      console.log('  SEM COORDS:', docSnap.id, '| endereco_inicial:', data.endereco_inicial, '| bairro_inicial:', data.bairro_inicial);
      erros++;
      continue;
    }

    // Extrai cidade e bairro do endereço completo que estava em cidade_inicial
    const enderecoCompleto = typeof data.cidade_inicial === 'string' && data.cidade_inicial.length > 30
      ? data.cidade_inicial
      : '';

    const cidadeCorrigida  = enderecoCompleto ? extrairCidade(enderecoCompleto)  : (data.cidade_final || '');
    const bairroCorrigido  = enderecoCompleto ? extrairBairro(enderecoCompleto)  : '';
    const enderecoCorrigido= enderecoCompleto || '';

    const update = {
      lat_inicial:      lat,
      lng_inicial:      lng,
      cidade_inicial:   cidadeCorrigida,
      bairro_inicial:   bairroCorrigido,
      endereco_inicial: enderecoCorrigido,
      _corrigido:       true,
    };

    try {
      await db.collection('ocorrencias').doc(docSnap.id).update(update);
      console.log('OK:', docSnap.id, '| lat:', lat, '| lng:', lng, '| cidade:', cidadeCorrigida);
      corrigidos++;
    } catch (e) {
      console.error('ERRO ao atualizar', docSnap.id, e.message);
      erros++;
    }
  }

  console.log('\n────────────────────────────');
  console.log('Corrigidos:', corrigidos);
  console.log('Ignorados (já ok):', ignorados);
  console.log('Erros / sem coords:', erros);
  console.log('────────────────────────────');
  process.exit(0);
}

corrigir().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
