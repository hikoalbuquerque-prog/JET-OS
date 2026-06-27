const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'jet-os-1' });
const db = admin.firestore();

db.collection('slot_config').doc('global').set({
  webhookSecret: 'jet_os_n8n_2026',
  cidade: 'São Paulo',
  pais: 'BR',
  cityIdGoJet: '669f89ebd06775867c31b984',
  horarioGeracao: '21:00',
  multiplicadores: {
    ociosidadeAlta: 1, limiarOciosidade: 25,
    deficitAlto: 1, limiarDeficit: 20,
    bateriasBaixa: 1, limiarBateria: 50
  },
  zonas: [
    { zona: 'Z1 - Vermelha', turno: 'T1', cargo: 'scalt',   vagasBase: 2, ativo: true },
    { zona: 'Z1 - Vermelha', turno: 'T2', cargo: 'scalt',   vagasBase: 2, ativo: true },
    { zona: 'Z1 - Vermelha', turno: 'T0', cargo: 'charger', vagasBase: 1, ativo: true },
    { zona: 'Z2 - Preta',    turno: 'T1', cargo: 'scalt',   vagasBase: 2, ativo: true },
    { zona: 'Z2 - Preta',    turno: 'T2', cargo: 'scalt',   vagasBase: 2, ativo: true },
    { zona: 'Z2 - Preta',    turno: 'T0', cargo: 'charger', vagasBase: 2, ativo: true },
    { zona: 'Z3 - Laranja',  turno: 'T1', cargo: 'scalt',   vagasBase: 2, ativo: true },
    { zona: 'Z3 - Laranja',  turno: 'T2', cargo: 'scalt',   vagasBase: 2, ativo: true },
    { zona: 'Z3 - Laranja',  turno: 'T0', cargo: 'charger', vagasBase: 1, ativo: true },
    { zona: 'Z4 - Azul',     turno: 'T1', cargo: 'scalt',   vagasBase: 1, ativo: true },
    { zona: 'Z4 - Azul',     turno: 'T2', cargo: 'scalt',   vagasBase: 1, ativo: true },
    { zona: 'Z5 - Verde',    turno: 'T1', cargo: 'scalt',   vagasBase: 1, ativo: true },
    { zona: 'Z6 - Amarela',  turno: 'T1', cargo: 'scalt',   vagasBase: 1, ativo: true },
    { zona: 'Z6 - Amarela',  turno: 'T2', cargo: 'scalt',   vagasBase: 1, ativo: true }
  ]
}).then(() => db.collection('slot_config').doc('overrides').set({}))
  .then(() => { console.log('slot_config criado!'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
