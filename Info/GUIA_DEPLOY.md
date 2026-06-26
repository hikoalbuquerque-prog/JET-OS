# 🚀 JET OS — Guia de Deploy & Implementação

## FASE 0: Preparação (15 min)

### 1. Copiar Arquivos para Repo Local

```bash
# Pasta local
cd C:\Users\hikoa\Downloads\Jet OS

# Copiar frontend
copy /Y ...\AnalyticsManager.tsx frontend\src\
copy /Y ...\DashboardManager.tsx frontend\src\
copy /Y ...\App.tsx frontend\src\
copy /Y ...\firebase.ts frontend\src\lib\

# Copiar backend
copy /Y ...\index.ts functions\src\
copy /Y ...\relatorios.ts functions\src\
copy /Y ...\pois.ts functions\src\
```

### 2. Verificar Variáveis de Ambiente

**Frontend** — `frontend\.env.local`:
```
VITE_FIREBASE_API_KEY=AIzaS...
VITE_FIREBASE_AUTH_DOMAIN=jet-os-7.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=jet-os-7
VITE_FIREBASE_STORAGE_BUCKET=jet-os-7.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123...
```

**Backend** — `functions\.env`:
```
GMAPS_KEY=AIzaS...
OAUTH_REFRESH_TOKEN=1//0...
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=-123456789
```

✅ Obter no Firebase Console:
- https://console.firebase.google.com/project/jet-os-7/settings/general
- https://console.firebase.google.com/project/jet-os-7/settings/serviceaccounts

### 3. Verificar Dependencies

```bash
# Frontend
cd frontend
npm install

# Backend
cd ../functions
npm install
```

---

## FASE 1: Deploy Inicial (30 min)

### 1. Build Frontend

```bash
cd "C:\Users\hikoa\Downloads\Jet OS\frontend"
npm run build
```

Expected:
```
✓ 123 modules transformed
dist/index.html                   12.45 kB
dist/assets/app.js               456.78 kB
✨ Build complete
```

### 2. Deploy Frontend

```bash
cd ..
firebase deploy --only hosting
```

Expected:
```
✔ Deploy complete!
✔ Hosting URL: https://jet-os-7.web.app
```

### 3. Build Backend

```bash
cd "C:\Users\hikoa\Downloads\Jet OS\functions"
npm run build
```

Expected:
```
✓ Compiled successfully
dist/
├── index.js
├── pois.js
├── relatorios.js
└── ...
```

### 4. Deploy Backend

```bash
cd ..
firebase deploy --only functions
```

Expected:
```
✔ Deploy complete!
✔ 28 functions deployed

Functions deployed:
  - addEstacaoFn
  - editarEstacaoFn
  - buscarPOIsFn
  - relatorioGuardDiarioFn
  - ... (total 28)
```

### 5. Testar App

1. Abrir https://jet-os-7.web.app
2. Login com conta Firebase
3. Navegar para Dashboard
4. Criar estação de teste
5. Carregar mapa

---

## FASE 2: Implementação das Pendências (2–3 horas)

### ✅ PENDÊNCIA 1: OSM via Cloud Function

**Objetivo:** Mover Overpass do browser para servidor (resolver 429)

**Arquivo:** `functions/src/pois.ts`

**Passos:**

1. Adicionar função `buscarPOIsOSM`:
   ```typescript
   export const buscarPOIsOSM = onCall(
     { timeoutSeconds: 120, memory: '256MiB' },
     async (r: any) => {
       // ... implementação
     }
   );
   ```

2. Atualizar `buscarPOIsFn` em `functions/src/index.ts`:
   ```typescript
   export const buscarPOIsFn = onCall(
     { timeoutSeconds: 120, memory: '256MiB' },
     async (request) => {
       const [resultadoOSM, resultadoGoogle] = await Promise.allSettled([
         buscarPOIsOSM(...),
         buscarSalvarPOIsGoogle(...)
       ]);
       // deduplica + retorna
     }
   );
   ```

3. Deploy:
   ```bash
   cd functions && npm run build && cd .. && firebase deploy --only functions
   ```

4. Testar:
   ```
   POST https://us-central1-jet-os-7.cloudfunctions.net/buscarPOIsFn
   {
     "lat": -8.0,
     "lng": -34.8,
     "raio": 300,
     "tipos": ["restaurant", "cafe"]
   }
   ```

---

### ✅ PENDÊNCIA 2: POIs Google — Grid de Pontos

**Objetivo:** Cobertura 100% de área (evitar gaps)

**Arquivo:** `functions/src/pois.ts`

**Passos:**

1. Adicionar helper `gerarGridPontos`:
   ```typescript
   function gerarGridPontos(
     centerLat: number,
     centerLng: number,
     raioM: number,
     pontosPerLado: number = 3
   ): Array<{ lat: number; lng: number }> {
     // ... implementação
   }
   ```

2. Modificar `buscarSalvarPOIsGoogle`:
   ```typescript
   const pontosParaBusca = raioM > 5000
     ? gerarGridPontos(lat, lng, raioM, 3)
     : [{ lat, lng }];

   // Buscar em cada ponto do grid
   for (const ponto of pontosParaBusca) {
     // ... buscarNearbySearch(ponto.lat, ponto.lng, ...)
   }
   ```

3. Deploy:
   ```bash
   cd functions && npm run build && cd .. && firebase deploy --only functions
   ```

4. Testar:
   ```
   POST https://us-central1-jet-os-7.cloudfunctions.net/buscarSalvarPOIsGoogle
   {
     "lat": -8.0,
     "lng": -34.8,
     "raioM": 10000
   }
   ```

---

### ✅ PENDÊNCIA 3: Relatório Guard — Campo "Procurando"

**Objetivo:** Destaque visual para roubos em busca (segurança)

**Arquivos:** `frontend/src/DashboardManager.tsx` + `functions/src/relatorios.ts`

**Passos:**

1. **Frontend** — Adicionar checkbox ao formulário:
   
   ```typescript
   // Em DashboardManager.tsx, no useState de ocorrenciaForm:
   const [ocorrenciaForm, setOcorrenciaForm] = useState({
     // ... campos existentes
     procurando: false
   });

   // No JSX do modal (form):
   <label style={{ marginTop: '12px' }}>
     <input
       type="checkbox"
       checked={ocorrenciaForm.procurando || false}
       onChange={(e) => setOcorrenciaForm({
         ...ocorrenciaForm,
         procurando: e.target.checked && ocorrenciaForm.tipo === 'roubo'
       })}
       disabled={ocorrenciaForm.tipo !== 'roubo'}
     />
     {' '}Procurando (destaque no relatório)
   </label>
   ```

2. **Backend** — Filtrar e destacar em `relatorios.ts`:

   ```typescript
   function gerarRelatorioGuard(dataCustom?: string): Promise<any> {
     // ... código existente

     const ocorrenciasProcurando = ocorrenciasRoubos.filter(
       (o: any) => o.procurando === true
     );

     return {
       totalOcorrencias: ocorrenciasRoubos.length,
       procurando: ocorrenciasProcurando.length,
       ocorrencias: ocorrenciasRoubos,
       procurandoList: ocorrenciasProcurando
     };
   }

   // Adaptar enviarRelatorioTelegram para incluir:
   const msgProcurando = relatorio.procurandoList?.length > 0
     ? '🚨 PROCURANDO (' + relatorio.procurandoList.length + '):\n' +
       relatorio.procurandoList.map((o: any) =>
         '📍 ' + o.estacaoNome + ' (' + o.bairro + ') - ' + o.descricao
       ).join('\n')
     : '';

   const msgFinal = msgProcurando
     ? msgRelatorio + '\n\n' + msgProcurando
     : msgRelatorio;
   ```

3. Deploy:
   ```bash
   # Frontend
   cd frontend && npm run build && cd ..
   firebase deploy --only hosting

   # Backend
   cd functions && npm run build && cd ..
   firebase deploy --only functions
   ```

4. Testar:
   - Criar ocorrência de roubo
   - Marcar "Procurando"
   - Disparar relatório manual
   - Verificar mensagem Telegram

---

### ⏳ PENDÊNCIA 4: Bugs Pós-Deploy

**Status:** Dinâmico — Acompanhar logs

**Monitoramento:**
- Cloud Functions: https://console.firebase.google.com/project/jet-os-7/functions/logs
- Firestore: https://console.firebase.google.com/project/jet-os-7/firestore/data
- Analytics: https://console.firebase.google.com/project/jet-os-7/analytics/overview
- Performance: https://console.firebase.google.com/project/jet-os-7/performance

**Padrão para debug:**
1. Reproduzir erro na app
2. Abrir Cloud Functions logs
3. Procurar por `[funcName]` + timestamp
4. Verificar input/output
5. Se Firestore: verificar quota + operações

---

## FASE 3: Validação Pós-Deploy (30 min)

### Checklist de Testes

| Teste | Resultado | Status |
|-------|-----------|--------|
| **Login** | Autenticar com Firebase | ⏳ |
| **Criar Estação** | CRUD completo | ⏳ |
| **Street View** | Gerar para estação | ⏳ |
| **Buscar POIs** | Overpass + Google em paralelo | ⏳ |
| **Carregar POIs** | Exibir no mapa | ⏳ |
| **Criar Ocorrência** | Roubo com "Procurando" | ⏳ |
| **Relatório Guard** | Enviar Telegram | ⏳ |
| **Analytics** | Eventos registrados | ⏳ |
| **PWA** | Offline básico | ⏳ |

### Monitoramento Contínuo

```bash
# Ver logs em tempo real
firebase functions:log --region southamerica-east1

# Ver erros do Firestore
firebase emulators:start --inspect-functions
```

---

## 🔧 TROUBLESHOOTING COMUM

### Erro: 429 Rate Limit (Overpass)
**Causa:** Browser fazendo muitas requisições  
**Solução:** Usar `buscarPOIsOSM` (Cloud Function)

### Erro: "GMAPS_KEY não configurada"
**Causa:** .env não carregado  
**Solução:**
```bash
firebase functions:secrets:set GMAPS_KEY
firebase functions:secrets:set OAUTH_REFRESH_TOKEN
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
firebase functions:secrets:set TELEGRAM_CHAT_ID
```

### Erro: "Firestore quota excedida"
**Causa:** Muitas leituras/escritas simultâneas  
**Solução:**
- Aumentar delay entre requests
- Implementar batch operations
- Usar cache agressivamente

### Erro: "Street View: 429"
**Causa:** Google Static Street View rate limit  
**Solução:** Implementar cache + exponential backoff

### Erro: "Deploy falhou: no valid package.json"
**Causa:** Pasta functions não tem package.json  
**Solução:**
```bash
cd functions
npm init -y
npm install firebase-functions firebase-admin
```

---

## 📝 PRÓXIMOS PASSOS

1. ✅ Copiar 7 arquivos
2. ✅ Verificar .env
3. ✅ Deploy frontend + backend
4. ✅ Testar em https://jet-os-7.web.app
5. ✅ Implementar Pendência 1 (Overpass)
6. ✅ Implementar Pendência 2 (Grid)
7. ✅ Implementar Pendência 3 (Procurando)
8. ✅ Monitorar Pendência 4 (Bugs)

---

**Estimado:** 4–5 horas (incluindo testes)  
**Pronto para começar?** 🚀

Avise quando tiver copiado os arquivos para o repo local!
