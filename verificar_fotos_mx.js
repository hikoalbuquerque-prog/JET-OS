// Verifica e migra fotos Drive das estações do México
// Detecta MX por coordenada geográfica
const admin = require('./node_modules/firebase-admin');
const https = require('https');
const http  = require('http');

admin.initializeApp({ storageBucket: 'jet-os-7.firebasestorage.app' });
const db     = admin.firestore();
const bucket = admin.storage().bucket();

const isDrive   = u => u && u.includes('drive.google.com');
const isStorage = u => u && (u.includes('firebasestorage') || u.includes('storage.googleapis.com'));
const isMX      = (lat,lng) => lat>14&&lat<33&&lng>-118&&lng<-86;

const driveToDownload = url => {
  const m = url.match(/\/d\/([^/?]+)/);
  if (m) return 'https://drive.google.com/uc?export=download&id='+m[1];
  const m2 = url.match(/id=([^&]+)/);
  return m2 ? 'https://drive.google.com/uc?export=download&id='+m2[1] : url;
};

const download = (url, redirects=0) => new Promise((resolve,reject) => {
  if (redirects>6) return reject(new Error('Too many redirects'));
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { headers: { 'User-Agent':'Mozilla/5.0' } }, res => {
    if ([301,302,303,307,308].includes(res.statusCode))
      return download(res.headers.location, redirects+1).then(resolve).catch(reject);
    if (res.statusCode !== 200) return reject(new Error('HTTP '+res.statusCode));
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end',  () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }).on('error', reject);
});

const isHtml = buf => {
  const s = buf.slice(0,20).toString();
  return s.includes('<!') || s.includes('<html');
};

async function main() {
  const snap = await db.collection('estacoes').get();
  console.log('Total estações:', snap.size);

  // Filtrar MX
  const mx = snap.docs.filter(d => {
    const { lat, lng } = d.data();
    return isMX(Number(lat||0), Number(lng||0));
  });
  console.log('Estações MX:', mx.length);

  // Categorizar fotos
  const semFoto    = mx.filter(d => !d.data().fotoUrl && !d.data().imagens?.foto && !d.data().foto);
  const jaMigradas = mx.filter(d => {
    const u = d.data().imagens?.foto || d.data().foto || d.data().fotoUrl || '';
    return isStorage(u);
  });
  const drive = mx.filter(d => {
    const u = d.data().imagens?.foto || d.data().foto || d.data().fotoUrl || '';
    return isDrive(u) && !isStorage(u);
  });
  const nanFoto = mx.filter(d => {
    const u = d.data().imagens?.foto || d.data().foto || d.data().fotoUrl || '';
    return u === 'nan' || u === 'null' || u === '';
  });

  console.log('\n📊 Status das fotos MX:');
  console.log('  ✅ Já no Storage:', jaMigradas.length);
  console.log('  🔗 Drive pendente:', drive.length);
  console.log('  🚫 Sem foto/nan:',  nanFoto.length + semFoto.length);

  if (drive.length === 0) {
    console.log('\n✅ Nenhuma foto Drive pendente!');
    process.exit(0);
  }

  console.log('\n🔄 Migrando', drive.length, 'fotos do Drive...');
  let ok = 0, erros = 0;

  for (let i = 0; i < drive.length; i++) {
    const docSnap = drive[i];
    const d = docSnap.data();
    const fotoUrl = d.imagens?.foto || d.foto || d.fotoUrl || '';
    const codigo  = d.codigo || docSnap.id;

    try {
      const buf = await download(driveToDownload(fotoUrl));
      if (isHtml(buf)) {
        erros++;
        if (erros <= 5) console.log('  ⚠ Acesso negado Drive:', codigo);
        continue;
      }
      const path = 'estacoes/fotos/' + docSnap.id + '_mx.jpg';
      const f = bucket.file(path);
      await f.save(buf, { contentType: 'image/jpeg' });
      await f.makePublic();
      const novaUrl = 'https://storage.googleapis.com/jet-os-7.firebasestorage.app/' + path;

      // Salvar no campo correto
      const update = {};
      if (d.imagens?.foto) update['imagens.foto'] = novaUrl;
      else if (d.foto)     update['foto'] = novaUrl;
      else                 update['imagens'] = { ...(d.imagens||{}), foto: novaUrl };

      await docSnap.ref.update(update);
      ok++;
      if (ok % 50 === 0) console.log(' ', ok+'/'+drive.length, 'migradas...');
    } catch(e) {
      erros++;
      if (erros <= 10) console.log('  ✗', codigo, e.message?.slice(0,60));
    }

    if (i % 10 === 9) await new Promise(r => setTimeout(r,300));
  }

  console.log('\n✅ Concluído!');
  console.log('  Migradas com sucesso:', ok);
  console.log('  Erros/Sem acesso:', erros);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
