const admin = require('./node_modules/firebase-admin');
admin.initializeApp({
  storageBucket: 'jet-os-7.firebasestorage.app'
});
const db     = admin.firestore();
const bucket = admin.storage().bucket();
const https  = require('https');

const driveToDownload = (url) => {
  const m = url.match(/\/d\/([^/?]+)/);
  return m ? 'https://drive.google.com/uc?export=download&id=' + m[1] : url;
};

const downloadBuffer = (url, redirects = 0) => new Promise((resolve, reject) => {
  if (redirects > 5) return reject(new Error('Too many redirects'));
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
    if (res.statusCode === 301 || res.statusCode === 302)
      return downloadBuffer(res.headers.location, redirects + 1).then(resolve).catch(reject);
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }).on('error', reject);
});

async function main() {
  // Descobrir bucket name
  const [buckets] = await admin.storage().getBuckets ? 
    admin.storage().getBuckets() : 
    [[ bucket ]];
  console.log('Bucket:', bucket.name);

  const snap = await db.collection('estacoes').get();
  const comDrive = snap.docs.filter(d => {
    const f = d.data().imagens?.foto || d.data().foto || '';
    return f.includes('drive.google.com');
  });
  console.log('Migrando', comDrive.length, 'fotos...');

  let ok = 0, erros = 0;
  for (let i = 0; i < comDrive.length; i++) {
    const docSnap = comDrive[i];
    const d = docSnap.data();
    const fotoUrl = d.imagens?.foto || d.foto || '';
    try {
      const buf = await downloadBuffer(driveToDownload(fotoUrl));
      const path = 'estacoes/fotos/' + docSnap.id + '_mig.jpg';
      await bucket.file(path).save(buf, { contentType: 'image/jpeg', public: true });
      const novaUrl = 'https://storage.googleapis.com/' + bucket.name + '/' + path;
      const update = d.imagens?.foto ? { 'imagens.foto': novaUrl } : { foto: novaUrl };
      await docSnap.ref.update(update);
      ok++;
      if (ok % 50 === 0) console.log(ok + '/' + comDrive.length + ' migradas...');
    } catch(e) {
      erros++;
      if (erros <= 5) console.log('ERRO', docSnap.id, ':', e.message);
    }
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 300));
  }
  console.log('Concluido! OK:', ok, '| Erros:', erros);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
