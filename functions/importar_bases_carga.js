// importar_bases_carga.js
// Importa armários de bateria para a coleção locais_operacionais
//
// PRÉ-REQUISITOS (rode na pasta C:\Users\hikoa\Downloads\Jet OS\functions):
//   npm install firebase-admin
//
// EXECUTAR:
//   cd "C:\Users\hikoa\Downloads\Jet OS\functions"
//   node importar_bases_carga.js
//
// Usa Application Default Credentials — precisa estar logado com:
//   firebase login
//   gcloud auth application-default login   (se tiver gcloud instalado)
//
// OU: defina a env var GOOGLE_APPLICATION_CREDENTIALS apontando para
//   a service account JSON do projeto jet-os-7.

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const PROJECT_ID = 'jet-os-7';
const CIDADE     = 'Sao Paulo';
const PAIS       = 'BR';

const BASES = [
  { nome: 'Armario Estela',           lat: -23.5774349, lng: -46.6423486, endereco: 'R. Estela, 140 - Vila Mariana, São Paulo - SP, 04011-000' },
  { nome: 'Armario Ipiranga',         lat: -23.5980863, lng: -46.605582,  endereco: 'R. Bom Pastor, 2454 - Ipiranga, São Paulo - SP, 04203-002' },
  { nome: 'Armario Moema',            lat: -23.613817,  lng: -46.6662278, endereco: 'Av. dos Carinás, 428 - Indianópolis, São Paulo - SP, 04086-010' },
  { nome: 'Armario Helio Pellegrino', lat: -23.5976121, lng: -46.6769325, endereco: 'Rua Cavazzola, 24 - Vila Olímpia, São Paulo - SP, 04546-060' },
  { nome: 'Armario Butantã',          lat: -23.5826723, lng: -46.713278,  endereco: 'Av. Prof. Francisco Morato, 1449 - Jardim Guedala, São Paulo - SP, 05512-000' },
  { nome: 'Armario Campo Belo',       lat: -23.6263547, lng: -46.6985488, endereco: 'R. Chafic Maluf, 135 - Santo Amaro, São Paulo - SP, 04710-160' },
  { nome: 'Armario Vila Prudente',    lat: -23.5814446, lng: -46.5628503, endereco: 'Av. Vila Ema, 1420 - Vila Ema, São Paulo - SP, 03282-000' },
  { nome: 'Armario Pompeia',          lat: -23.5309778, lng: -46.6853505, endereco: 'Av. Pompéia, 729 - Pompeia, São Paulo - SP, 05023-000' },
  { nome: 'Armario DHL',              lat: -23.5762855, lng: -46.6870823, endereco: 'Av. Brigadeiro Faria Lima, 2225 - São Paulo - SP, 01452-000' },
  { nome: 'Armário Interlagos',       lat: -23.7034179, lng: -46.6878575, endereco: 'Praça Automóvel Clube Paulista, 963 - Jardim Satelite, São Paulo - SP, 04815-370' },
  { nome: 'Armario Bras',             lat: -23.5395723, lng: -46.6040537, endereco: 'R. Coimbra, 631 - Brás, São Paulo - SP, 03052-030' },
];

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const db = getFirestore();

  console.log(`\nImportando ${BASES.length} bases de carga → ${PROJECT_ID}/locais_operacionais\n`);

  let count = 0;
  for (const base of BASES) {
    const payload = {
      tipo:        'BASE_CARGA',
      nome:         base.nome,
      endereco:     base.endereco,
      lat:          base.lat,
      lng:          base.lng,
      cidade:       CIDADE,
      pais:         PAIS,
      ativo:        true,
      criadoEm:     Timestamp.now(),
      atualizadoEm: Timestamp.now(),
      importadoEm:  new Date().toISOString(),
      fonte:        'CSV BRSPC_Armarios_de_Baterias',
    };

    const ref = await db.collection('locais_operacionais').add(payload);
    console.log(`  ⚡ ${base.nome.padEnd(28)} → ${ref.id}`);
    count++;
  }

  console.log(`\n✅ ${count}/${BASES.length} bases importadas com sucesso!`);
  console.log('\nAbra o Jet OS, clique em "📍 Geo Log" e filtre por "Base de Carga" para ver no mapa.\n');
  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Erro:', e.message);
  console.error('\nSe der erro de credenciais, rode:');
  console.error('  gcloud auth application-default login');
  console.error('  -- OU --');
  console.error('  Baixe a service account key em: https://console.firebase.google.com/project/jet-os-7/settings/serviceaccounts/adminsdk');
  console.error('  e defina: set GOOGLE_APPLICATION_CREDENTIALS=C:\\caminho\\para\\key.json\n');
  process.exit(1);
});
