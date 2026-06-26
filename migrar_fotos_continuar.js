// Continua migração — pula estações que já têm URL do Firebase Storage
const admin = require('./node_modules/firebase-admin');
admin.initializeApp({ storageBucket: 'jet-os-7.firebasestorage.app' });
const db     = admin.firestore();
const bucket = admin.storage().bucket();
const https  = require('https');

const driveToDownload = (url) => {
  const m = url.match(/\/d\/([^/?]+)/);
  return m ? 'https://drive.google.com/uc?export=download&id=' + m[1] : url;
};

const downloadBuffer = (url, redirects) => new Promise((resolve, reject) => {
  if ((redirects||0) > 5) return reject(new Error('Too many redirects'));
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
    if (res.statusCode === 301 || res.statusCode === 302)
      return downloadBuffer(res.headers.location, (redirects||0)+1).then(resolve).catch(reject);
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }).on('error', reject);
});

const isDrive = (url) => url && url.includes('drive.google.com');
const isStorage = (url) => url && (
  url.includes('firebasestorage.app') ||
  url.includes('storage.googleapis.com') ||
  url.includes('firebasestorage.googleapis.com')
);

async function main() {
  console.log('Bucket:', bucket.name);
  const snap = await db.collection('estacoes').get();

  // Separar: Drive (pendentes) vs já migrados vs sem foto
  const pendentes = snap.docs.filter(d => {
    const f = (d.data().imagens && d.data().imagens.foto) ? d.data().imagens.foto : (d.data().foto || '');
    return isDrive(f) && !isStorage(f);
  });
  const jaMigradas = snap.docs.filter(d => {
    const f = (d.data().imagens && d.data().imagens.foto) ? d.data().imagens.foto : (d.data().foto || '');
    return isStorage(f);
  });

  console.log('Total:', snap.size, '| Já migradas:', jaMigradas.length, '| Pendentes:', pendentes.length);

  if (pendentes.length === 0) {
    console.log('Nada a fazer — todas já migradas!');
    process.exit(0);
  }

  let ok = 0, erros = 0;
  for (let i = 0; i < pendentes.length; i++) {
    const docSnap = pendentes[i];
    const d = docSnap.data();
    const fotoUrl = (d.imagens && d.imagens.foto) ? d.imagens.foto : (d.foto || '');
    try {
      const buf = await downloadBuffer(driveToDownload(fotoUrl));

      // Verificar se é HTML (página de erro do Drive)
      const preview = buf.slice(0, 20).toString();
      if (preview.includes('<!') || preview.includes('<html')) {
        erros++;
        if (erros <= 5) console.log('SKIP (html):', docSnap.id);
        continue;
      }

      const path = 'estacoes/fotos/' + docSnap.id + '_mig.jpg';
      const f = bucket.file(path);
      await f.save(buf, { contentType: 'image/jpeg' });
      await f.makePublic();
      const novaUrl = 'https://storage.googleapis.com/jet-os-7.firebasestorage.app/' + path;
      const update = (d.imagens && d.imagens.foto) ? { 'imagens.foto': novaUrl } : { foto: novaUrl };
      await docSnap.ref.update(update);
      ok++;
      if (ok % 100 === 0) console.log(ok + '/' + pendentes.length + ' migradas...');
    } catch(e) {
      erros++;
      if (erros <= 5) console.log('ERRO', docSnap.id, e.message);
    }
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 200));
  }
  console.log('\nConcluido! OK:', ok, '| Erros/Skip:', erros);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
