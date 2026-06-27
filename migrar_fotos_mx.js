 const admin = require('firebase-admin');                                                                                                                          
 const serviceAccount = require('./serviceAccountKey.json');                                                                                                       
                                                                                                                                                                   
 admin.initializeApp({                                                                                                                                             
   credential: admin.credential.cert(serviceAccount),                                                                                                              
   storageBucket: 'jet-os-7.firebasestorage.app'                                                                                                                   
 });                                                                                                                                                               
                                                                                                                                                                   
 const db = admin.firestore();                                                                                                                                     
 const bucket = admin.storage().bucket();                                                                                                                          
 const https = require('https');                                                                                                                                   
                                                                                                                                                                   
 // Função CORRIGIDA para seguir redirecionamentos                                                                                                                 
 async function downloadBuffer(url, redirects = 0) {                                                                                                               
   if (redirects > 5) throw new Error('Too many redirects');                                                                                                       
   return new Promise((resolve, reject) => {                                                                                                                       
                                                                                                                                                                        
     https.get(url, {                                                                                                                                              
       headers: { 'User-Agent': 'Mozilla/5.0' },                                                                                                                   
       timeout: 20000                                                                                                                                              
     }, res => {                                                                                                                                                   
       // Trata redirecionamentos (301, 302, 303)                                                                                                                  
       if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {                                                                                
         return downloadBuffer(res.headers.location, redirects + 1).then(resolve).catch(reject);                                                                   
       }                                                                                                                                                           
       if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));                                                                             
       const chunks = [];                                                                                                                                          
       res.on('data', c => chunks.push(c));                                                                                                                        
       res.on('end', () => resolve(Buffer.concat(chunks)));                                                                                                        
     }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));                                                                                     
   });                                                                                                                                                             
 }                                                                                                                                                                 

                                                                                                                                                                        
 async function main() {                                                                                                                                           
   console.log('--- Iniciando Migração com Redirecionamento ---');                                                                                                 
   const snap = await db.collection('estacoes').where('pais', '==', 'MX').get();                                                                                   
                                                                                                                                                                   
   let ok = 0, erros = 0;                                                                                                                                          
   for (const doc of snap.docs) {                                                                                                                                  
     const data = doc.data();                                                                                                                                      
     const foto = data.imagens?.foto || data.foto || '';                                                                                                           
                                                                                                                                                                   
     // Pula se já for do Firebase ou se não tiver drive                                                                                                           
     if (!foto || !foto.includes('drive.google.com') || foto.includes('storage.googleapis.com')) continue;                                                         
                                                                                                                                                                   
     try {                                                                                                                                                         
       const fileId = foto.match(/[-\w]{25,}/)?.[0];                                                                                                               
       if (!fileId) throw new Error('ID do Drive não encontrado');                                                                                                 
                                                                                                                                                                   
       const dlUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;                                                                                   
       const buf = await downloadBuffer(dlUrl);                                                                                                                    
                                                                                                                                                                        
       if (buf.length < 1000) throw new Error('Arquivo muito pequeno');                                                                                            
       const preview = buf.slice(0, 50).toString().toLowerCase();                                                                                                  
       if (preview.includes('<html') || preview.includes('<!doctype')) throw new Error('Conteúdo é HTML');                                                         
                                                                                                                                                                   
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
       console.log(`[ERRO] ${doc.id}: ${e.message} | URL: ${foto}`);                                                                                               
     }                                                                                                                                                             
   }                                                                                                                                                               
   console.log(`--- Fim: ${ok} migradas, ${erros} erros ---`);                                                                                                     
   process.exit(0);                                                                                                                                                
 }                                                                                                                                                                 
 main();                                                                                                                                                           