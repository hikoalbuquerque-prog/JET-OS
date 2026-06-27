                                                                                                                                                                const admin = require('firebase-admin');                                                                                                                          
const serviceAccount = require('./serviceAccountKey.json');                                                                                                       
                                                                                                                                                                   
admin.initializeApp({                                                                                                                                             
   credential: admin.credential.cert(serviceAccount),                                                                                                              
   storageBucket: 'jet-os-7.firebasestorage.app'                                                                                                                   
 });                                                                                                                                                               
                                                                                                                                                                   
 const db = admin.firestore();                                                                                                                                     
 const bucket = admin.storage().bucket();                                                                                                                          
 const https = require('https');                                                                                                                                   
                                                                                                                                                                   
 async function downloadBuffer(url) {                                                                                                                              
   return new Promise((resolve, reject) => {                                                                                                                       
                                                                                                                                                                        
     https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {                                                                                         
       if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));                                                                           
       const chunks = [];                                                                                                                                          
       res.on('data', c => chunks.push(c));                                                                                                                        
       res.on('end', () => resolve(Buffer.concat(chunks)));                                                                                                        
     }).on('error', reject);                                                                                                                                       
   });                                                                                                                                                             
 }                                                                                                                                                                 
                                                                                                                                                                   
 async function main() {                                                                                                                                           
   console.log('--- Iniciando Migração Final ---');                                                                                                                
   const snap = await db.collection('estacoes').where('pais', '==', 'MX').get();                                                                                   
                                                                                                                                                                   
   let ok = 0, erros = 0;                                                                                                                                          
  for (const doc of snap.docs) {                                                                                                                                  
  const data = doc.data();                                                                                                                                      
     const foto = data.imagens?.foto || data.foto || '';                                                                                                           
                                                                                                                                                                   
     // Pula se já for do Firebase ou se não tiver drive                                                                                                           
     if (!foto || !foto.includes('drive.google.com') || foto.includes('storage.googleapis.com')) continue;                                                         
                                                                                                                                                                   
     try {                                                                                                                                                         
       const fileId = foto.match(/[-\w]{25,}/)?.[0];                                                                                                               
       const dlUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;                                                                                   
       const buf = await downloadBuffer(dlUrl);                                                                                                                    
                                                                                                                                                                   
       const path = `estacoes/fotos/${doc.id}_mig.jpg`;                                                                                                            
       const file = bucket.file(path);                                                                                                                             
       await file.save(buf, { contentType: 'image/jpeg' });                                                                                                        
                                                                                                                                                                                                                                                                                                                                               await file.makePublic();                                                                                                                                 
                                                                                                                                                                    
       await doc.ref.update({                                                                                                                                      
         'imagens.foto': `https://storage.googleapis.com/jet-os-7.firebasestorage.app/${path}`,                                                                    
         'migracaoOk': true                                                                                                                                        
      });                                                                                                                                                         
                                                                                                                                                                   
      ok++;                                                                                                                                                       
       console.log(`[OK] ${doc.id}`);                                                                                                                              
     } catch (e) {                                                                                                                                                 
       erros++;                                                                                                                                                    
      console.log(`[ERRO] ${doc.id}: ${e.message}`);                                                                                                              
     }                                                                                                                                                             
   }                                                                                                                                                               
   console.log(`--- Fim: ${ok} migradas, ${erros} erros ---`);                                                                                                     
   process.exit(0);                                                                                                                                                
 }                                                                                                                                                                 
 main();                                                                                                                                                           