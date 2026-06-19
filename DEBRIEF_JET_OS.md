# Jet OS Firebase — Master Debrief
**Atualizado em:** 14/06/2026 (GPS NATIVO em 2º plano — Seção 10.8 · Aceite LGPD — Seção 11 · **Módulo NFS-e Automática — Seção 13**)  
**Projeto:** jet-os-1 | Firebase Hosting + Firestore + Storage + Cloud Functions  
**Stack:** React + Vite + TypeScript + Leaflet + deck.gl | Node.js 22 Cloud Functions

---

## 1. STACK E INFRAESTRUTURA

### Projeto Firebase
- **Project ID:** `jet-os-1`
- **Account:** 3nr1k.ia@gmail.com
- **Bucket Storage:** `jet-os-1.firebasestorage.app`
- **URL produção:** https://jet-os-1.web.app
- **Pasta local:** `C:\Users\hikoa\Downloads\Jet OS\`

### Deploy commands (sempre usar na ordem certa)
```bash
# Frontend only (mais comum)
cd "C:\Users\hikoa\Downloads\Jet OS\frontend"
npm run build && cd .. && firebase deploy --only hosting

# Functions (quando mudar Cloud Functions)
cd "C:\Users\hikoa\Downloads\Jet OS\functions"
npm run build && cd ..
firebase deploy --only functions

# Regras Firestore/Storage
firebase deploy --only firestore:rules,storage

# Tudo junto
npm run build && firebase deploy
```

### Arquivos principais
| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/App.tsx` | Componente principal (~3000 linhas), mapa Leaflet, modais, FABs |
| `frontend/src/AnalyticsManager.tsx` | Analytics deck.gl, upload XLSX, corridas por hora |
| `frontend/src/DashboardManager.tsx` | Dashboard, exportação, zonas inline |
| `frontend/src/ZonasManager.tsx` | Editor de polígonos/vértices |
| `frontend/src/CidadesExpansao.tsx` | Planejamento de expansão de cidades |
| `functions/src/index.ts` | Cloud Functions (geocode, croquis, normalização) |

---

## 2. ERROS CRÍTICOS QUE SE REPETIRAM — NUNCA REPETIR

### 2.1 Template literals em Python heredoc
**Problema recorrente:** Ao gerar código TypeScript via Python `<< 'PYEOF'`, backticks `` ` `` dentro de strings eram interpretados pelo shell ou corrompidos, quebrando os template literals do TypeScript.

**Sintoma:** TypeScript reclamava de tokens inesperados em linhas com `` ` ``. O TSC via `tsc && vite build` mostrava dezenas de erros em cascata a partir de uma única linha.

**Solução definitiva:**
- SEMPRE verificar o byte exato com `python3 -c "... raw[linha]"` antes de assumir encoding errado
- Para strings longas com backtick em Python heredoc, usar `f'\`'` ou construir via concatenação
- Nunca usar `\\`` — resulta em backtick escapado que quebra o template literal

### 2.2 Inserção de código dentro do JSX do componente
**Problema:** Ao fazer `content.replace("export default function X(", new_component + "export default function X(")`, o `new_component` era inserido DENTRO do return JSX se o índice estava errado.

**Sintoma:** TypeScript reclamava de JSX element sem closing tag na linha do componente novo.

**Solução:** Sempre usar `content.rfind("export default function")` para garantir que está antes do componente principal, não dentro.

### 2.3 Dois `export default` no mesmo arquivo
**Causa:** Inserção duplicada. Arquivo ficou com dois `export default function DashboardManager`.

**Diagnóstico:** `grep -n "export default function" arquivo.tsx`

**Solução:** Identificar os limites exatos das duas funções com `content.split('\n')` e slice manual.

### 2.4 Fechamento de JSX faltando
**Causa:** Remoção cirúrgica de bloco (ex: aba Custos) deixou `)}` órfão no arquivo.

**Diagnóstico:** O TSC aponta linha com `)}` que não fecha nada.

**Solução:** Buscar por `{/* ── CUSTOS ── */}\n\n        )}` e remover o `)}` órfão.

### 2.5 `content.replace()` não encontra o padrão
**Causa:** Whitespace diferente, \n vs \r\n, ou código foi modificado em iteração anterior.

**Diagnóstico:** `print("OK:", "texto_esperado" in content)` → False

**Solução:** Sempre verificar com `grep -n` antes de qualquer replace cirúrgico. Se o padrão não está lá, usar `sed -n 'X,Yp'` para ver o que realmente está na região.

### 2.6 SVG `polyline` com coordenadas em `%`
**Problema:** SVG `points` não aceita porcentagem. Código gerava `points="50% 100 75% 50"` que resultava em linha invisível.

**Solução:** Usar `viewBox="0 0 230 140"` com `preserveAspectRatio="none"` e coordenadas absolutas dentro do viewBox.

### 2.7 `position: fixed` dentro de painel scrollável
**Problema:** `ZonasManager` usa `position: fixed` para o drawer e tomava a tela inteira ao ser embutido dentro do Dashboard.

**Solução:** Nunca embutir componentes com `position: fixed` em outros componentes. Criar versão "inline" (`ZonasInline`) sem fixed positioning.

### 2.8 zIndex insuficiente
**Problema:** Analytics abre com `zIndex: 2000`. Popup de estação também com `zIndex: 2000` ficava atrás.

**Regra:** Sempre verificar a hierarquia de zIndex do projeto antes de definir um novo:
- Mapa Leaflet: 0-400
- Drawers/painéis: 450-1200  
- ZonasManager: 1200
- Modais: 1500-2000
- Analytics overlay: 2000
- Popups sobre analytics: **4000+**

### 2.9 `stale closure` em event listeners
**Problema:** `addEventListener` dentro de `useEffect` com `deps` capturava estado antigo. O handler não via updates de estado.

**Solução:** Para listeners globais em `window`, usar `useEffect(() => { ... }, [])` com `deps: []` e acessar estado via forma funcional do setter: `setState(prev => ...)`.

### 2.10 Detecção de colunas XLSX — ordem importa
**Problema crítico:** `keys.find(k => k.includes('nício'))` encontrava `'Data de início do aluguel'` antes de `'Local de transporte (início da viagem)'`. Resultado: 0 corridas parseadas, R$0 de receita.

**Regra:** Sempre usar testes mais específicos primeiro (AND com múltiplos includes). Nunca usar substring genérico como único critério.

```typescript
// ERRADO
ls: keys.find(k => k.includes('nício'))

// CORRETO
ls: findCol([
  k => k.includes('Local de transporte') && k.includes('início'),
  k => k.includes('Место транспорта') && k.includes('начало'),
])
```

### 2.11 Signed URL sem service account
**Problema:** `storage.file().getSignedUrl()` falha com "Cannot sign data without client_email" quando rodando com Application Default Credentials sem service account.

**Solução:** Usar URL pública direta:
```js
const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
```

### 2.12 Variável TypeScript não tipada em forEach
**Erro frequente:** `Parameter 'c' implicitly has an 'any' type` em `.forEach(c => ...)`.

**Causa:** O tipo da coleção não é inferido quando vem de `useCidadesExpansao()` e o tipo não está declarado no arquivo que o usa.

**Solução:** Sempre exportar o tipo junto com o hook. Sempre importar o tipo no arquivo consumidor com `import { type CidadeExpansao }`.

### 2.13 Componente não encontrado (module not found)
**Causa:** Arquivo criado em `/mnt/user-data/outputs/` mas não copiado para `frontend/src/`.

**Solução:** Sempre criar o arquivo diretamente em `frontend/src/` via `create_file` com path correto, OU copiar explicitamente com bash.

### 2.14 Nova coleção Firestore sem regra = permission-denied
**Problema:** Criar coleção nova (ex: `cidades_expansao`) e usar `onSnapshot` sem adicionar regra em `firestore.rules` resulta em `permission-denied` silencioso — o listener falha mas não quebra o app visivelmente.

**Diagnóstico:** Abrir F12 → Console → procurar `[code=permission-denied]`.

**Solução:** Sempre que criar nova coleção, imediatamente adicionar regra em `firestore.rules` e fazer deploy:
```bash
firebase deploy --only firestore:rules
```

### 2.15 `dblclick` em marker Leaflet draggable não funciona
**Causa:** O evento `dblclick` é consumido pelo drag handler antes de chegar ao listener da camada.

**Solução:** Usar `contextmenu` (botão direito) como trigger primário + detector manual de duplo clique com timestamp:
```typescript
let lastClick = 0;
marker.on('click', (e) => {
  L.DomEvent.stopPropagation(e);
  const now = Date.now();
  if (now - lastClick < 350) removeVertex();
  lastClick = now;
});
marker.on('contextmenu', removeVertex);
```

---

## 3. PADRÕES QUE FUNCIONAM — SEMPRE USAR

### 3.1 Diagnóstico antes de qualquer mudança
```bash
# Ver estrutura
grep -n "function NomeComponente\|export default\|useState\|useEffect" arquivo.tsx | head -20

# Ver linha específica
sed -n 'X,Yp' arquivo.tsx

# Contar divs
python3 -c "
content = open('arquivo.tsx').read()
print('<div:', content.count('<div'))
print('</div:', content.count('</div>'))
"
```

### 3.2 Verificar resultado de cada replace
```python
content = content.replace(old, new)
print("OK:", "texto_chave_do_new" in content)
# Se False: o replace não encontrou o padrão — investigar antes de continuar
```

### 3.3 Script Node.js para operações no Firestore/Storage
Para reimportar dados, corrigir campos ou fazer uploads em lote, usar script Node.js em `functions/` com `firebase-admin` — mais confiável que via browser:
```bash
cd "C:\Users\hikoa\Downloads\Jet OS\functions"
node meu_script.js
```

### 3.4 Reload de dados sem full reload
Preferir mutação local + `_refreshMapa()` em vez de `recarregarEstacoes()`. Evita delay de 3s.

### 3.5 Python para gerar JSONs corretos
Antes de confiar no parser do browser, sempre validar em Python:
```python
import openpyxl
wb = openpyxl.load_workbook('arquivo.xlsx', data_only=True)
ws = wb.active
headers = [c.value for c in ws[1]]
# Simular detecção de colunas exatamente como o JS faz
```

---

## 4. ARQUITETURA — DECISÕES IMPORTANTES

### 4.1 GAS/campo.html descontinuado
O projeto original usava Google Apps Script + Google Sheets. Migrado totalmente para Firebase. Não voltar para GAS.

### 4.2 Gemini desativado
`analisarCalcadaFn` retorna stub por custos. Não reativar sem verificar billing.

### 4.3 APIs gratuitas usadas
- **Leaflet** — mapa principal
- **deck.gl** — analytics (heatmap, arcos, hexbin)
- **Overpass API** — POIs OSM (fallback: overpass.kumi.systems)
- **Nominatim** — geocode reverso (1 req/seg — respeitar!)
- **Esri World Imagery** — camada satélite
- **Google Maps Embed** — Street View (gratuito)

### 4.4 Service Worker
O SW (`campo-v5`) não deve interceptar chamadas ao GAS (302 redirect para `script.googleusercontent.com` causa `TypeError: Failed to fetch`). Excluir URLs do GAS do SW.

### 4.5 Analytics — Storage vs Firestore
- **Storage:** guarda o JSON completo com todas as rides (pode ser MB)
- **Firestore:** guarda só metadados (`meta.total`, `meta.by_hour`, `storage_path`, `url`)
- Rides são carregadas do Storage on-demand ao selecionar o dia

### 4.6 Chaves compostas no Analytics
Quando região é detectada: `2026-05-03_SP` (data + região).
Quando filename genérico (Pedidos_, data_, etc.): chave simples `2026-05-03`.
`filterRides` e `toggleDay` devem sempre procurar tanto chave exata quanto `startsWith(data + '_')`.

### 4.7 Zonas — dois componentes
- `ZonasManager.tsx` — componente completo com `position: fixed`, editor de vértices drag. Acessível via `zonasModulo = true`.
- `ZonasInline` (dentro de DashboardManager) — versão leve sem fixed, lista com ativar/desativar/excluir.

---

## 5. COLEÇÕES FIRESTORE

| Coleção | Campos chave |
|---|---|
| `estacoes` | id, codigo, lat, lng, cidade, pais, bairro, endereco, tipo, status, imagens, ia, croquiStatus |
| `poligonos` | nome, grupo, fase, cor, poligono[], ativo, cidade, pais, prioridade |
| `analytics_days` | date, total, total_rev, avg_dist_km, avg_dur_min, by_hour, storage_path, url, regiao |
| `locais_operacionais` | nome, tipo, lat, lng, cidade, pais, obs |
| `cidades_expansao` | nome, pais, lat, lng, status, populacao, mercadoEst, investimentoEst, dataPrevista, responsavel, obs |
| `usuarios` | email, role (admin/gestor/viewer), cidades[], criadoEm |
| `gojet_snapshots` | parkings[], bikes[], cityId, cidade, total, savedAt; se chunked: chunked=true, totalChunks |
| `gojet_config` | (doc id = nome da cidade) cityId, ativo |

### 5.1 Regras Firestore — padrão por coleção

**CRÍTICO:** Toda nova coleção precisa de regra explícita em `firestore.rules`. Sem regra = `permission-denied` em produção mesmo com usuário autenticado.

```javascript
// Após adicionar coleção nova, sempre adicionar em firestore.rules:
match /nome_colecao/{id} {
  allow read: if isCampo();   // ou isGestor() se restrito
  allow write: if isGestor();
}
```

**Deploy das regras** (separado do frontend):
```bash
firebase deploy --only firestore:rules
```

| Coleção | Read | Write |
|---|---|---|
| `estacoes` | isCampo | isCampo (criar), isGestor (excluir) |
| `poligonos` | isCampo | isGestor |
| `analytics_days` | isGestor | isGestor |
| `locais_operacionais` | isCampo | isGestor |
| `cidades_expansao` | isGestor | isGestor |
| `usuarios` | próprio uid ou isGestor | isAdmin |
| `config` | isCampo | isAdmin |
| `gojet_snapshots` | isCampo | isCampo (write via browser scraper) |
| `gojet_config` | isCampo | isAdmin |

---

## 6. GOJET — SCRAPER E PROXY

### Arquitetura
- **GoJet API:** `https://logistic.gojet.app/api/v0/urent` — CORS aberto, sem auth
- **Bloqueio:** GCP Cloud Run IPs são bloqueados pelo Cloudflare via TLS fingerprint (JA3/JA4). Spoofar User-Agent e headers não resolve.
- **Solução adotada:**
  1. **Browser-side scraping** (`frontend/src/lib/gojet-scraper.ts`) — para o botão "Atualizar agora". Funciona porque o browser tem TLS fingerprint real.
  2. **Vercel proxy** (`gojet-proxy/api/gojet.js`, deploy: `https://gojet-proxy.vercel.app`) — para o scheduler automático. IPs da Vercel não são bloqueados.

### Cloud Function Scheduler
- **Função:** `scraperGoJet` — `every 15 minutes` (não voltar para 5 min sem aumentar cota de CPU do Cloud Run)
- **Env var:** `GOJET_PROXY_URL=https://gojet-proxy.vercel.app/api/gojet` em `functions/.env`
- **Fallback:** se `GOJET_PROXY_URL` não estiver definido, usa GoJet direto (vai falhar com 403)

### Proxy Vercel
- **URL:** `https://gojet-proxy.vercel.app/api/gojet`
- **Uso:** `GET /api/gojet?path=parkings&city_id=...&page=1&limit=500`
- **Pasta local:** `C:\Users\hikoa\Downloads\Jet OS\gojet-proxy\`
- **Re-deploy:** `cd gojet-proxy && npx vercel --prod`

### Cidades configuradas (`gojet_config`)
| Cidade | cityId | ativo |
|---|---|---|
| São Paulo | `669f89ebd06775867c31b984` | true |
| Recife | `66faadb8cd18349215c874c4` | true |
| Santo André | `67ab79f4cd4d3cbb07a0c02e` | false ← ativar quando pronto |

### Snapshots — padrão de documentos
- `latest_{cityId}` — parkings da cidade (ou `chunked: true` + `_chunk0`, `_chunk1`...)
- `bikes_latest_{cityId}` — bikes da cidade
- `latest` / `bikes_latest` — legacy, compatibilidade, SP apenas
- Chunk threshold: parkings > 3000, bikes > 4000

---

## 7. SEGURANÇA — ROLES

| Role | Permissões |
|---|---|
| `admin` | Tudo, incluindo gerenciar usuários |
| `gestor` | CRUD estações, zonas, analytics, locais operacionais |
| `viewer` | Só leitura |

**Regras Firestore:** verificam `role` via `get(/databases/.../documents/usuarios/$(request.auth.uid))`.

---

## 8. PROBLEMAS CONHECIDOS / PENDÊNCIAS

### Pendências ativas (14/06/2026)
- [ ] **🔴 TESTAR EM CELULAR REAL o GPS nativo (APK 2.0-gps-nativo / versionCode 11)** — a reescrita para upload nativo (Seção 10.8) só pode ser validada em campo. Cenários críticos: app **fechado** (deslizado dos recentes) 10-15 min, tela travada 15 min, e **reinício do celular** com turno ativo. Ver checklist na Seção 10.8.6.
- [ ] **Painel de stats GPS no app** — com o upload nativo, o JS não recebe mais ponto-a-ponto; o contador "pontos enviados" não atualiza (mapa/posição vêm do Firestore normalmente). Ajustar o painel para ler do Firestore se confundir os operadores.
- [ ] **Firestore `permission-denied` no GoJet snapshot listener** — verificar `firestore.rules` para coleção `gojet_snapshots`; provável que falta regra de leitura para isCampo
- [x] **APK rebuild** — histórico: 1.6-gps-bg(7) fix minimizar → 1.7(8) fix abrir config → 1.8-lgpd(9) aceite LGPD → 1.9-bgloc-req(10) permissão "o tempo todo" via API → **2.0-gps-nativo(11) upload nativo**. Gerado via `gradlew assembleRelease` (assinatura no build.gradle).
- [x] **Aceite LGPD de rastreamento** — feito. Ver **Seção 11**. Deploy de regras + hosting concluído.
- [ ] **APK ícone** — ícone errado/feio, precisa tela cheia (splashscreen). Ver `frontend/public/icon-192.png` e configurar `capacitor.config.ts`
- [ ] **Ativar Santo André** no GoJet — mudar `ativo: false` → `true` em `gojet_config/Santo André`
- [ ] **Quota CPU Cloud Run** — scheduler GoJet em 15min por causa de quota. Para voltar a 5min: aumentar quota em GCP Console → IAM & Admin → Quotas → "Cloud Run CPU allocation"

### Backlog
- [ ] Croquis em lote: integração com Storage para imagens (Mapbox free tier 50k/mês)
- [ ] Templates MX (croquis México)
- [ ] Tradução PT/ES/EN/RU
- [ ] Link TPU nas estações
- [ ] Vertex removal com dblclick inconsistente em mobile (usar contextmenu)
- [ ] Analytics: `loadRidesForDay` carrega arquivo inteiro mesmo para comparativos — considerar chunking para dias com muitas corridas
- [ ] Normalização Nominatim: 1 req/seg pode ser lento para muitas estações — considerar batch com delay

---

## 9. CHECKLIST ANTES DE CADA DEPLOY

```
[ ] npm run build roda sem erros TypeScript
[ ] Verificar que não há dois `export default` no mesmo arquivo
[ ] Verificar zIndex de novos modais vs overlays existentes
[ ] Se mudou Cloud Functions: firebase deploy --only functions primeiro
[ ] Se mudou regras Firestore: firebase deploy --only firestore:rules
[ ] Testar no mobile (wordBreak, overflow, touch events)
[ ] Confirmar que SW não intercepta novas chamadas externas
```

---

## 10. GPS EM SEGUNDO PLANO (APK ANDROID) — ARQUITETURA E FIX

> **Contexto:** O GPS dos operadores de campo parava de rastrear quando o app era
> minimizado. Investigado e corrigido em Junho 2026. APK `1.6-gps-bg` (versionCode 7).

### 10.1 Como funciona (stack atual — equimaps)
- Plugin: `@capacitor-community/background-geolocation` (equimaps) v1.2.26.
- O **Foreground Service nativo** (`com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService`, `foregroundServiceType="location"`) é declarado **pelo próprio manifest do plugin** e mesclado no APK. **NÃO declarar manualmente** no `AndroidManifest.xml` do app.
- Fluxo: serviço nativo coleta GPS (FusedLocation, ~1s) → entrega cada posição ao **JS via bridge do WebView** → `gps-background.ts` faz `uploadPonto()` no Firestore.
- Estratégia dupla: Android = Foreground Service; iOS/PWA = `navigator.geolocation` + Wake Lock.

### 10.2 A causa-raiz (por que parava ao minimizar)
**O upload pro Firestore roda dentro de um callback JavaScript.** Quando o app é minimizado, o Android **suspende o motor de JS do WebView** → o callback nunca executa → nenhum ponto é gravado, **mesmo com o serviço e a notificação vivos**. Esse é o elo fraco de toda a arquitetura equimaps.

### 10.3 As 4 correções aplicadas
| # | Arquivo | Correção |
|---|---|---|
| 1 | `frontend/android/app/src/main/java/com/jet/os/MainActivity.java` | `webView.onResume()+resumeTimers()` em `onPause` **E** `onStop` (só onPause não basta — onStop re-suspende o renderer em vários OEMs). **Causa nº1.** |
| 2 | `BatteryPlugin.java` + `AndroidPermissionGate.tsx` | Checar/pedir **ACCESS_BACKGROUND_LOCATION** ("Permitir o tempo todo"). Antes o código só pedia foreground e fingia `locBackground = locForeground`. No Android 11+ só dá via Configurações. |
| 3 | `AndroidManifest.xml` | Removido `<service>` fantasma com nome errado (`com.equimodos...` — classe inexistente). O real vem do plugin. |
| 4 | `frontend/src/lib/gps-background.ts` | Filtro de staleness 30s → **180s (3 min)**. O antigo descartava todo o lote de fixes bufferizados durante o background ao retomar. |

### 10.4 Permissões essenciais no celular (operador de campo)
Ambas obrigatórias para sobreviver minimizado:
1. **Localização → "Permitir o tempo todo"** (ACCESS_BACKGROUND_LOCATION)
2. **Isenção de otimização de bateria** (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)

### 10.5 Gerar deploy + APK novo
```powershell
# Assinatura já configurada em android/app/build.gradle (keystore jet-os-release.jks)
# Lembrar de subir versionCode/versionName a cada build novo

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd "C:\Users\hikoa\Downloads\Jet OS\frontend"
npm run build
npx cap sync android
firebase deploy --only hosting          # web

cd android
.\gradlew.bat assembleRelease           # APK assinado
# Saída: frontend/android/app/build/outputs/apk/release/app-release.apk
```

### 10.6 Teste decisivo (validar o fix)
1. Instalar APK, conceder "Permitir o tempo todo" + isenção de bateria.
2. Iniciar turno → apertar **Home** (minimizar) + travar tela.
3. Deixar **5–10 min** (parado/andando).
4. Conferir `gps_logistica` no Firestore — os pontos devem continuar chegando **sem buraco** durante o período minimizado.

### 10.7 Plano B — migração para upload nativo (SE persistir em OEMs agressivos)
Xiaomi/Samsung/Motorola podem matar o serviço mesmo com tudo acima. Solução definitiva: trocar para `@transistorsoft/capacitor-background-geolocation` (SDK **pago** para release), que faz **upload HTTP 100% nativo** (SQLite + autoSync), sem depender do JS em background.

**O que muda:**
- `gps-background.ts` (parte Android): configurar plugin com `url`/`headers`/`autoSync` em vez de `addWatcher` + `uploadPonto`. PWA/iOS fica igual.
- **Nova Cloud Function HTTP de ingestão** (`ingestGPS`): o transistorsoft envia para uma URL, e o Firestore não aceita POST direto. A lógica do `uploadPonto` (mock detection, histórico, `updateDoc` em `usuarios`, alerta de mock) migra para essa função.
- Remover hacks do `MainActivity`, `BatteryPlugin` e gate de permissões (o plugin assume isso).
- Custo: licença (centenas de USD) + ~1 dia de trabalho.

**Recomendação:** ~~só migrar se o teste 10.6 falhar~~ → **SUPERADO.** O teste 10.6 falhou no caso "app fechado", então foi feita a migração para upload nativo — mas pela rota **GRATUITA** (serviço nativo próprio, sem o transistorsoft pago). Ver **Seção 10.8**.

---

## 10.8 GPS NATIVO EM 2º PLANO — REESCRITA (14/06/2026)

> **Por que reescrever:** os fixes da Seção 10.3 resolvem o app *minimizado* (processo
> vivo), mas **não** o app *fechado*. Lendo o código do equimaps confirmou-se:
> `BackgroundGeolocation.java#handleOnDestroy` chama `service.stopService()` ao destruir a
> Activity (app deslizado dos recentes) e `BackgroundGeolocationService.java#onUnbind` para
> todos os watchers. Além disso **não há buffer nativo** — cada ponto é só um broadcast; se
> o JS está congelado, o ponto se perde. Conclusão: o equimaps não rastreia com app fechado.

### 10.8.1 Decisões do usuário
- **Necessidade:** posição **ao vivo** com o app fechado (não só trajeto registrado depois).
- **Rota:** gratuita. (mauron85 foi descartado — morto no Android 14+; ver issues #728/#676.)
- **Solução:** serviço nativo próprio escrito contra o SDK 36 + Cloud Function de ingestão.

### 10.8.2 Arquitetura nova (Android)
Serviço nativo coleta GPS, enfileira em SQLite e faz **POST direto** para a Cloud Function —
sem depender do JS do WebView. Sobrevive a minimizar, fechar e reiniciar o celular.

| Arquivo | Papel |
|---|---|
| `android/app/src/main/java/com/jet/os/GpsTrackerService.java` | Foreground service (`foregroundServiceType=location`). FusedLocation → fila SQLite → uploader (thread própria, POST a cada ~20s). `START_STICKY` + config em SharedPreferences + `onTaskRemoved` vazio → sobrevive a fechar o app. |
| `GpsQueueDb.java` | Fila durável SQLite (enqueue/peek/delete/trim, teto 5000). |
| `GpsTokenManager.java` | Troca refresh token → ID token via `securetoken.googleapis.com` (sem SDK). Renova sozinho com app fechado horas. |
| `GpsTrackerPlugin.java` | Plugin Capacitor: `start` / `updateSlot` / `stop`. Registrado em `MainActivity.java`. |
| `GpsBootReceiver.java` | Reinicia no `BOOT_COMPLETED` se turno ativo (em try/catch — FGS de localização no boot tem restrição no Android 14+). |
| `frontend/src/lib/gps-native.ts` | Bridge JS: passa `functionUrl`, `apiKey` (Web API key pública) e `auth.currentUser.refreshToken`. |
| `frontend/src/lib/gps-background.ts` | Roteia p/ nativo quando `isAndroidNative()`, pulando watchdog/equimaps. PWA/iOS = caminho antigo. |

### 10.8.3 Backend — Cloud Function `ingestGps`
- `functions/src/gps-ingest.ts` (`onRequest`, southamerica-east1, público).
- Auth: `Authorization: Bearer <Firebase ID token>` → `verifyIdToken` → **uid sempre do token** (anti-spoof; ignora uid do corpo).
- Grava em `gps_logistica` (dispara `verificarChegadaPonto`) + `gps_logistica_hist` + atualiza `usuarios/{uid}`. Máx **200 pontos/req** (limite de batch).
- URL: `https://southamerica-east1-jet-os-1.cloudfunctions.net/ingestGps`
- **Deploy feito.** Testado via curl: 401 sem token, `invalid_token` com token inválido.

### 10.8.4 Manifest
Adicionados `<service .GpsTrackerService foregroundServiceType="location">` e
`<receiver .GpsBootReceiver>` (BOOT_COMPLETED) em `AndroidManifest.xml`.
Dependência nova em `app/build.gradle`: `play-services-location:21.3.0`.

### 10.8.5 Fluxo de auth (importante)
JS lê `auth.currentUser.refreshToken` no `start` → passa ao serviço nativo → serviço guarda
em SharedPreferences → renova o ID token quando precisa (mesmo offline por horas) → POST.
Refresh tokens são de longa duração; só param se a conta for revogada.

### 10.8.6 🔴 CHECKLIST de teste em CELULAR REAL (pendente)
1. Instalar APK 2.0, conceder permissões (localização "o tempo todo" + bateria).
2. Iniciar slot → **minimizar** 10 min → mapa deve seguir atualizando.
3. **Fechar o app** (deslizar dos recentes) 10-15 min → deve seguir atualizando. ← caso que o equimaps falhava
4. **Travar a tela** 15 min → idem.
5. **Reiniciar o celular** com turno ativo → deve retomar sozinho (mais incerto; se não, retoma ao abrir o app).
6. Conferir `gps_logistica` no Firestore — pontos com `estrategia: "background_android_native"`, sem buracos.

### 10.8.7 Se ainda falhar em OEM específico
Pedir ao usuário desativar "apps em suspensão"/otimização agressiva (MIUI/Samsung/Moto).
Último recurso continua sendo transistorsoft (pago) — mas a arquitetura de ingestão (`ingestGps`)
já está pronta e seria reaproveitada.

---

## 11. ACEITE LGPD DE RASTREAMENTO (14/06/2026)

> Consentimento informado para coleta de localização — segurança jurídica (Lei 13.709/2018).

### 11.1 Componentes
- `frontend/src/components/LgpdConsentGate.tsx` — tela de aceite. Termo cobre: coleta **só durante turnos/slots/tarefas**, finalidade restrita, **sem uso para outros fins**, retenção, base legal (arts. 7º I e V), direitos. Checkbox + "Aceitar e continuar" / "Não aceito — sair".
- Integrado em `App.tsx`: gate **antes** do permission gate, para `ROLES_RASTREADOS = [logistica, campo, charger, scalt, promotor, guard]`, em web e APK.

### 11.2 Registro auditável (prova jurídica)
- Coleção Firestore `consentimentos_lgpd`, doc id = `{uid}_v{versao}`.
- Grava uid, email, nome, role, **versão do termo, data/hora (serverTimestamp), dispositivo, idioma**.
- Regra: **imutável** (`allow update, delete: if false`). `get` pelo próprio, `list` por gestorSeg. **Deploy feito.**

### 11.3 Revisar o termo depois
- Texto redigido alinhado à LGPD, mas **recomenda-se validação por advogado**.
- Para reapresentar após revisão: incrementar `LGPD_VERSAO` em `LgpdConsentGate.tsx` → novo aceite é exigido automaticamente (id muda).

---

## 12. FIX — BOTÃO "ABRIR CONFIGURAÇÕES" E PERMISSÃO "O TEMPO TODO" (14/06/2026)

### 12.1 Erro `ERR_INVALID_RESPONSE` ao abrir config
- **Causa:** `window.open('android.settings.APPLICATION_DETAILS_SETTINGS')` — string de Intent não é URL; o WebView resolvia como `https://localhost/android.settings...`. E `app-settings:` é só iOS.
- **Fix:** método nativo `BatteryPlugin.openAppSettings()` (Intent `ACTION_APPLICATION_DETAILS_SETTINGS`). `AndroidPermissionGate.abrirConfiguracoes()` usa o plugin.

### 12.3 Gate estrito + permissão de CÂMERA (15/06/2026)
- **Problema:** a foto de entrada do turno usa `<input type="file" capture>` no WebView. A CAMERA
  está declarada no manifest mas **não era pedida em runtime** → no Samsung o `<input capture>`
  não retornava arquivo ("foto não grava"). E o gate deixava avançar via "Continuar mesmo assim" /
  "Pular por agora".
- **Fix em `AndroidPermissionGate.tsx`:** adicionada a permissão **Câmera** (via `@capacitor/camera`
  `requestPermissions`) para roles de campo; **removidos os escapes** — só mostra "✓ Continuar"
  quando TODAS as permissões necessárias (localização + o-tempo-todo + notificações + **câmera** +
  bateria) estão concedidas. APK regerado 15/06 20:09.

### 12.2 "Permitir o tempo todo" sem ir às configurações
- **Limitação real:** Android 11+ **proíbe** conceder `ACCESS_BACKGROUND_LOCATION` por diálogo de um toque (privacidade da plataforma) — vale p/ todo app.
- **Melhoria:** `BatteryPlugin.requestBackgroundLocation()` usa a API nativa de permissão. Android 10 = diálogo de um toque; Android 11+ = vai **direto à tela de localização do app** (1 toque), em vez da árvore genérica de config. Fallback p/ abrir config se recusar.

---

## 13. MÓDULO NFS-e AUTOMÁTICA — EMISSÃO EM NOME DOS PRESTADORES (PLANO)

> **Status:** PLANEJADO — próximo módulo a entrar.
> **Objetivo:** automatizar a emissão da NFS-e de cada prestador (MEI), tendo a **Jet como
> tomadora**, sem o prestador precisar emitir/enviar a nota toda semana e sem o gestor
> validar PDF na mão. Substitui o fluxo manual de upload do módulo de pagamentos atual.

### 13.1 Resumo executivo (para Diretoria)

**O que é:** hoje cada prestador emite a própria NFS-e no portal e faz upload no app; o gestor
confere PDF a PDF e libera o pagamento. É manual, sujeito a erro, atrasa pagamento e não escala.
O módulo novo faz a **Jet emitir a NFS-e automaticamente em nome de cada prestador**, com a
Jet como tomadora, integrando à API da NFS-e Nacional.

**Como, sem custo de certificado por prestador (Opção A):** a NFS-e Nacional (obrigatória desde
2026, LC 214/2025; MEI desde set/2023) exige assinatura digital. Em vez de um certificado por
prestador (caro e inviável), a Jet usa **um único certificado e-CNPJ** e cada prestador concede
**procuração eletrônica** (gratuita, via gov.br) autorizando a Jet a emitir por ele. É o mesmo
mecanismo que escritórios de contabilidade usam para emitir por centenas de clientes com um só
certificado.

**Benefícios:**
- Elimina o trabalho semanal do prestador (emitir + enviar nota).
- Elimina a conferência manual de NF pelo gestor (hoje, gargalo).
- Garante conformidade fiscal (nota correta, no prazo, padrão nacional).
- Reduz atraso de pagamento e disputa por nota errada/rejeitada.
- Escala para centenas de prestadores sem aumentar trabalho administrativo.

**Custo:** ~R$200/ano (1 certificado e-CNPJ A1) + custo do meio de emissão (API Nacional direta =
sem custo por nota; ou gateway = ~R$0,10–0,50/nota). **Sem custo recorrente por prestador.**

**Prazo:** ~6 a 9 semanas de calendário (≈3 a 4 semanas de desenvolvimento efetivo), sendo a
maior parte dependências externas (validação contábil/jurídica, certificado, homologação).

**Risco principal a destravar antes de codar:** confirmar com o contador/no portal que a
**procuração da NFS-e Nacional cobre o ato de EMITIR** (não só consultar) para o enquadramento
dos prestadores. É barato confirmar e é o único ponto que a documentação técnica não garante 100%.

### 13.2 Por que a Opção A (e não as alternativas)

| Caminho | Custo | Automação | Veredito |
|---|---|---|---|
| Certificado A1 por prestador | ~R$150–250/ano **× N prestadores** | Total | Inviável por custo |
| Login/senha gov.br (robô) | R$0 | Frágil | **Descartado** — 2FA, fere termos gov.br, risco LGPD grave |
| **1 certificado Jet + procuração (Opção A)** | ~R$200/ano **total** | **Total** | **Escolhido** |
| Emissão assistida (zero certificado) | R$0 | Parcial (prestador ainda clica) | Plano B se a procuração não cobrir emissão |

### 13.3 Papéis na nota (não confundir)
- **Prestador do serviço / emitente** = o prestador (MEI). A nota sai no CNPJ dele.
- **Tomador do serviço** = a **Jet** (CNPJ da Jet).
- **Quem assina** = a Jet, como **procuradora**, com o **certificado e-CNPJ da Jet**.

### 13.4 Arquitetura técnica

```
[App prestador]            [Firestore]              [Cloud Functions]            [NFS-e Nacional]
 cadastro fiscal ────────► prestadores_fiscal
 + aceite/procuração ────► (autorizado_em)
                                  │
 tarefas concluídas ────► tarefas_logistica
                                  │
 (semana fecha → gestor aprova o VALOR)
                                  ▼
                          pagamentos_semana ──trigger──► emitirNFSe()  ──API+assinatura──► gera DPS/NFS-e
                                                              ▲ (certificado Jet)               │
                                                        retorno/consulta ◄──────────────────────┘
                                                              │ (nº, chave, XML, PDF)
                                  ◄───────────────────────────┘
                          grava nf_numero, nf_chave, nf_xml_url, nf_status='autorizada'
                                  │
                          notificarStatusNF (Telegram) ── já existe ──► avisa prestador
                                  │
                          segue p/ "A Pagar" → "pago"
```

**Decisão de meio de emissão:**
- **Recomendado p/ v1 — API NFS-e Nacional direta:** combina melhor com o modelo de **1
  certificado + procuração** (a maioria dos gateways assume 1 certificado por emitente). Exige
  dev de mTLS + assinatura do DPS (XML), mas **sem custo por nota**.
- **Alternativa — gateway (Focus NFe / PlugNotas / NFE.io):** mais rápido de integrar (1 REST),
  porém **confirmar antes** se o gateway suporta emissão por procuração com 1 certificado; se não,
  o gateway implica certificado por prestador (volta o problema de custo).

**Custódia do certificado:** o e-CNPJ A1 (.pfx) da Jet fica em **Secret Manager + KMS**, NUNCA
em Firestore/Storage. Acesso só pela Cloud Function `emitirNFSe`.

### 13.5 Modelo de dados (novo)

```
prestadores_fiscal/{uid}
├── cnpj                  // MEI do prestador
├── razao_social
├── cpf_responsavel
├── inscricao_municipal
├── regime_tributario     // "MEI" / "Simples Nacional"
├── codigo_servico        // item LC 116 (ex.: 16.02 transporte municipal de passageiros/carga)
├── aliquota_iss
├── municipio_incidencia  // cód. IBGE
├── email_fiscal
├── procuracao_status     // "pendente" | "ativa" | "revogada"
├── autorizado_em         // timestamp do aceite no app (prova) + ip/versao
├── faturamento_ano       // acumulado p/ travar antes do teto MEI (R$ 81k/ano)
└── ativo
```

Estende `pagamentos_semana` (já existe): `+ nf_numero, nf_chave, nf_xml_url, nf_protocolo`,
e novos `status`: `valor_aprovado → emitindo → nf_autorizada → pago` (+ `nf_erro`).

`pagamentos_config/{cidade}`: adicionar `codigo_servico` e `aliquota_iss` padrão por cidade.

**Regra Firestore (CRÍTICO — ver 2.14):** `prestadores_fiscal` legível pelo próprio uid e por
gestor/admin; certificado nunca exposto; campos fiscais graváveis só por gestor.

### 13.6 Backend — Cloud Functions novas

| Função | Tipo | Papel |
|---|---|---|
| `emitirNFSe` | trigger em `pagamentos_semana` (status→`valor_aprovado`) ou agendada (fim da semana ISO) | Monta DPS (tomador=Jet, prestador=MEI, valor, código serviço), assina com certificado Jet, envia à NFS-e Nacional, trata retorno assíncrono. |
| `nfseWebhook` / `consultarNFSe` | onRequest / agendada | Recebe/consulta o status da nota (autorizada/rejeitada), grava número, chave, XML, PDF no doc, dispara Telegram. |
| `cancelarNFSe` | callable (gestor) | Cancela nota via API (prazo varia por município). |
| `validarTetoMEI` | helper | Antes de emitir, soma `faturamento_ano`; se aproximar de R$81k, bloqueia e alerta gestor. |

Reaproveita `notificarStatusNF` (já existe em `functions/src/notificacoes-prestador.ts`) para
avisar "NF emitida ✅" / "Falha ⚠️".

### 13.7 Mudanças no frontend

- **`PagamentosModule.tsx`** (prestador): troca "Enviar Nota Fiscal" por seção **"Cadastro
  Fiscal"** (CNPJ, dados, **termo de procuração** com aceite registrado). A nota passa a aparecer
  **pronta** (link PDF/XML) — ele não envia mais nada.
- **`PagamentosAdminPanel.tsx`** (gestor): aba "NFs Pendentes" deixa de validar PDF e vira
  **"Aprovar valor"** + monitor de `nf_erro`. Mantém "A Pagar" / "Histórico" / exportação CSV.

### 13.8 Máquina de estados (antes → depois)

```
ANTES (manual):
aberto → nf_enviada (upload prestador) → nf_aprovada (gestor confere PDF) → pago

DEPOIS (automático):
aberto → valor_aprovado (gestor confirma só o VALOR) → emitindo → nf_autorizada → pago
                                                          └────────► nf_erro → alerta gestor
```

### 13.9 Custos detalhados

**CAPEX (uma vez):**
- Desenvolvimento: ~3 a 4 semanas de dev efetivo.
- Certificado e-CNPJ A1: ~R$150–250 (validade 1 ano).

**OPEX (recorrente):**
- Renovação do certificado: ~R$200/ano.
- Emissão:
  - **API Nacional direta:** sem custo por nota.
  - **Gateway (se escolhido):** ~R$0,10–0,50/nota ou plano mensal (~R$49–199/mês conforme volume).
- Firebase: marginal (algumas execuções de função por nota).
- **Custo por prestador: R$0.** O modelo NÃO escala custo com nº de prestadores.

**Modelo de estimativa (preencher na apresentação):**
`OPEX/ano ≈ R$200 (certificado) + [notas/mês × 12 × tarifa do gateway, se houver]`.
Ex.: 400 notas/mês via gateway a R$0,20 = ~R$960/ano + R$200 = **~R$1.160/ano** para qualquer
quantidade de prestadores.

### 13.10 Cronograma (fases)

| Fase | Conteúdo | Duração | Tipo |
|---|---|---|---|
| 0 | **Validar procuração (contador/portal)** + adquirir certificado e-CNPJ | 1–2 sem | Externo (bloqueante) |
| 1 | Cadastro fiscal + fluxo de procuração (UI + Firestore + regras) | 3–5 dias | Dev |
| 2 | Integração API Nacional + `emitirNFSe` + webhook/consulta + custódia certificado | 5–8 dias | Dev |
| 3 | Ajuste de `PagamentosModule` / `PagamentosAdminPanel` + novos estados | 3–4 dias | Dev |
| 4 | Homologação (ambiente de testes da NFS-e) + testes ponta a ponta | 1–2 sem | Externo + Dev |
| 5 | Piloto com poucos prestadores → rollout geral | 1–2 sem | Operação |

**Total:** ~6 a 9 semanas de calendário. Fases 0 e 4 dominam o prazo (dependências externas),
não o desenvolvimento.

### 13.11 Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Procuração não cobrir emissão | Bloqueia a Opção A | **Fase 0** confirma antes de codar; Plano B = emissão assistida (Seção do chat, zero certificado) |
| Cadastro fiscal errado (alíquota/código) | Nota errada em nome do prestador → risco p/ Jet | Validação do cadastro + homologação antes de produção |
| Estouro do teto MEI (R$81k/ano) | Problema fiscal sério p/ prestador | `validarTetoMEI` trava e alerta antes |
| Cancelamento/correção de nota | Operacional | `cancelarNFSe` + prazo por município documentado |
| Vazamento do certificado | Crítico | Secret Manager + KMS; nunca em Firestore/Storage |
| LGPD (CNPJ/CPF/procuração) | Jurídico | Minimizar dados, registrar aceite, alinhado à Seção 11 |

### 13.12 Pré-requisitos para começar (checklist)
```
[ ] Contador confirma que procuração NFS-e Nacional cobre EMISSÃO p/ MEI
[ ] Definir CNPJ da Jet como tomador + dados fiscais
[ ] Adquirir certificado e-CNPJ A1
[ ] Decidir: API Nacional direta (recomendado) vs gateway
[ ] Levantar nº de prestadores e estimativa de notas/mês (p/ custo)
[ ] Lista de prestadores com CNPJ/MEI + inscrição municipal + código de serviço por cidade
```

### 13.13 ESCALA — volume real: ~2.500 NF/semana

> **Dado informado pelo usuário:** média de **2.500 prestadores/NF por semana**.
> Isso é **~130.000 notas/ano** (~10.800/mês). Muda custo e arquitetura.

**Impacto no custo — API direta vira obrigatória, não opcional:**

| Meio | Custo/ano a 130k notas |
|---|---|
| **API NFS-e Nacional direta** | **~R$200/ano** (só certificado) + Firebase marginal |
| Gateway a R$0,05/nota | ~R$6.500/ano |
| Gateway a R$0,10/nota | ~R$13.000/ano |
| Gateway a R$0,20/nota | ~R$26.000/ano |
| Gateway a R$0,50/nota | ~R$65.000/ano |

→ O delta de dev da API direta (mTLS + assinatura XML) é ~+1 semana, mas economiza
**R$6,5k–65k/ano**. **Recomendação a 2.500/sem: API Nacional direta.** Gateway só se a
operação não puder absorver a manutenção dos layouts da API.

**Novos desafios de engenharia nesse volume:**
1. **Fila de emissão (não emitir 2.500 de uma vez):** reusar o padrão de fila durável que já
   usamos no GPS nativo (Seção 10.8 — SQLite/queue + worker). Aqui: fila no Firestore/Cloud
   Tasks, worker que emite em lotes respeitando rate limit da API, com **retry e idempotência**
   (não emitir nota duplicada).
2. **Monitor de teto MEI em massa:** `validarTetoMEI` roda para 2.500 CNPJs. R$81k/ano ≈
   **R$1.558/semana** — quem passa disso estoura o MEI antes de 1 ano. Precisa de **alerta
   preventivo por prestador** e relatório de quem está perto do teto.
3. **Importação em lote do cadastro fiscal:** 2.500 × (CNPJ, inscrição municipal, código de
   serviço, alíquota). Usar o padrão de import XLSX/JSON + script Node `firebase-admin`
   (Seção 3.3). Validar dados em Python antes (Seção 3.5).
4. **Cancelamento/erro em escala:** painel precisa lidar com dezenas de `nf_erro` por ciclo
   sem travar o gestor (lote, filtro, reprocessar).

**Onboarding de 2.500 procurações = maior esforço do projeto (mais que o código):**
- Cada prestador concede a procuração **uma vez** (gov.br, gratuito), mas são 2.500 pessoas.
- Precisa de: fluxo guiado no app, acompanhamento de quem já concedeu (`procuracao_status`),
  campanha de comunicação e suporte, e **rollout faseado** (não ligar para todos de uma vez).
- **Sugestão:** piloto com 1 cidade/lote pequeno → ajustar → expandir em ondas.

**A confirmar (afeta dimensionamento):**
- Os 2.500 são **recorrentes** (mesmas pessoas/semana) ou **pool rotativo**? Recorrente =
  procuração uma vez; rotativo = onboarding contínuo.
- **Todos são MEI?** Se houver PJ de outros regimes, o cálculo de ISS/código de serviço varia
  e alguns podem já ter certificado próprio (caminho alternativo p/ esses).

**Custo total revisado (2.500/sem):**
- CAPEX: ~4 a 5 semanas de dev (inclui fila + import em lote + monitor de teto).
- OPEX: **~R$200/ano** (certificado) via API direta. **Não escala com prestadores.**
- O gargalo de prazo passa a ser **onboarding das procurações**, não o desenvolvimento.

### 13.14 PROCURAÇÃO — o que é, o que tem, como concede (confirmado: todos MEI)

> **CORREÇÃO IMPORTANTE:** procuração **NÃO** é login/senha do prestador. NÃO existe "2FA
> desativada". Dar login/senha (robô que loga como o prestador) é o caminho **descartado**
> (inseguro, fere termos gov.br, quebra com 2FA). Na procuração, **ninguém loga como o
> prestador**: a Jet emite com o **certificado da própria Jet**; o prestador autentica-se
> **uma vez** (a 2FA dele continua ligada) só para outorgar.

**Dados da procuração:**
| Campo | Valor |
|---|---|
| Outorgante | Prestador — CNPJ do MEI (+ CPF responsável) |
| Procurador | Jet — CNPJ que detém o certificado e-CNPJ |
| Poderes | **Emissão de NFS-e** (+ consulta + cancelamento, recomendado) |
| Validade | Até 5 anos (e-CAC) ou prazo definido pelo outorgante |
| Aprovação | Automática, na hora |

**Como o prestador concede (uma vez, sozinho):** entra com **conta gov.br nível PRATA ou OURO**
→ portal (e-CAC / Emissor Nacional) → "Procurações" → informa **CNPJ da Jet** → seleciona
**emitir NFS-e** → confirma.

**O que a Jet precisa:** 1 certificado **e-CNPJ A1** (o procurador é obrigado a ter certificado)
+ CNPJ cadastrado como procurador.

**⚠️ Onboarding a 2.500:** exige **conta gov.br prata/ouro** do prestador. Muito MEI tem só
**bronze** — subir é gratuito (login via banco ou facial no app gov.br), mas precisa ser
**passo 1 da campanha** ("suba para prata/ouro → conceda a procuração"). É o trabalho real do
projeto.

**Fase 0 (contador confirma):** (1) **onde** se registra a procuração que o Emissor Nacional
honra para EMITIR — e-CAC (Receita) ou dentro do próprio Emissor Nacional; (2) que o poder
cobre **emissão**, não só consulta.

### 13.15 CHECKLIST DE DADOS — O QUE CADA LADO PRECISA

**A) O que a JET precisa ter (uma vez):**
```
[ ] Certificado e-CNPJ A1 da Jet (~R$200/ano) — obrigatório p/ assinar como procuradora
[ ] CNPJ da Jet + Inscrição Municipal + dados cadastrais (será o TOMADOR da nota)
[ ] Conta gov.br nível prata/ouro do responsável legal da Jet
[ ] CNPJ da Jet cadastrado como procurador nas procurações dos prestadores
[ ] Custódia do certificado em Secret Manager + KMS (nunca em Firestore/Storage)
[ ] Definição do código de serviço (item LC 116) e alíquota ISS por cidade de operação
[ ] Ambiente de homologação da NFS-e Nacional habilitado (testes antes de produção)
```

**B) O que cada PRESTADOR precisa fazer (uma vez, no onboarding):**
```
[ ] Ter conta gov.br nível PRATA ou OURO (subir de bronze é grátis: banco ou facial no app)
[ ] Conceder procuração à Jet (CNPJ da Jet) com poder de EMITIR NFS-e
[ ] Aceitar o termo de autorização no app Jet OS (prova/auditoria — grava autorizado_em)
```
> O prestador NÃO entrega login, NÃO entrega senha, NÃO desativa 2FA, NÃO compra certificado.

**C) Dados fiscais de cada prestador (importação em lote — coleção `prestadores_fiscal`):**
```
cnpj                 // MEI
razao_social
cpf_responsavel
inscricao_municipal
regime_tributario    // "MEI"
codigo_servico       // item LC 116 (ex.: 16.02)
aliquota_iss
municipio_incidencia // cód. IBGE
email_fiscal
procuracao_status    // pendente | ativa | revogada
autorizado_em        // aceite no app (timestamp + ip + versão)
faturamento_ano      // acumulado p/ travar teto MEI (R$ 81k/ano)
ativo
```

**D) Dados que a Jet gera por nota (gravados em `pagamentos_semana`):**
```
prestador (emitente)     = CNPJ do MEI
tomador                  = CNPJ da Jet
valor_total              = tarefas_count × valor_unitario (já calculado hoje)
competencia              = semana ISO
codigo_servico, aliquota = do prestador/cidade
→ retorno: nf_numero, nf_chave, nf_protocolo, nf_xml_url, nf_status
```

### 13.16 Material para Diretoria
Apresentação executiva gerada em **`NFSe_Automatica_Apresentacao_Diretoria.pptx`** (raiz do
projeto), cobrindo problema, solução, papéis, custos (2.500/sem), cronograma, riscos e a decisão
solicitada. Conteúdo derivado desta Seção 13.

### 13.17 PROCURAÇÃO VIA APP — FLUXO, CONTROLE (ATIVO × PENDENTE) E AUTOMAÇÃO

> **O que dá e o que não dá no app (limite real):** a **outorga** da procuração acontece
> **obrigatoriamente no gov.br/e-CAC** (sessão autenticada do prestador, possível código no app
> gov.br). **Não é possível outorgar dentro do app da Jet.** Tudo o mais — orientar, levar até lá,
> detectar, acompanhar, lembrar — fica **dentro do Jet OS**.

**Detecção automática (o controle de quem já deu):**
Existe a **API de Procuração do gov.br (Login Único — `acesso.gov.br/roteiro-tecnico`)** que
permite ao **procurador (a Jet) listar todas as procurações em que é o outorgado**. Isso habilita
controle **automático**:
- Cloud Function **`verificarProcuracoes`** (agendada, ex.: a cada 6–12 h) autentica como a Jet,
  consulta a API → recebe a lista de **CNPJs que outorgaram à Jet** com poder de NFS-e.
- Atualiza `prestadores_fiscal/{uid}`: quem está na lista → `procuracao_status = ativa`
  (+ `procuracao_verificada_em`); quem não está → `pendente`; quem saiu da lista → `revogada`.
- **Fallback** se a API não estiver disponível p/ o caso: tentativa de *consulta/emissão de teste*
  como procurador — sucesso ⇒ ativa. Ou confirmação manual do prestador + validação do gestor.
- **Pré-requisito:** credenciamento da Jet no **Login Único gov.br** (OAuth/Access Token) — tarefa
  da Fase 0/2.

**Campos novos em `prestadores_fiscal`:**
```
procuracao_status        // pendente | ativa | revogada
procuracao_concedida_em
procuracao_verificada_em // última checagem automática
nivel_govbr              // desconhecido | bronze | prata | ouro (auto-declarado/detectado)
lembretes_enviados       // contador p/ campanha
onda                     // lote de rollout (cidade/grupo)
```

**Fluxo do prestador no app (onboarding, guiado):**
1. Tela "Ative sua emissão automática de NF" (explica o ganho: não emitir nota toda semana).
2. **Passo 1 — nível gov.br:** verifica/pergunta se a conta é prata/ouro; botão "Como subir meu
   nível" com **deep link p/ o app gov.br** + instruções (banco / facial).
3. **Passo 2 — conceder procuração:** botão "Conceder procuração à Jet" → **deep link p/
   e-CAC/Portal NFS-e** + tela passo a passo com os **dados prontos p/ copiar** (CNPJ da Jet,
   poder "emitir NFS-e").
4. App entra em "aguardando confirmação"; botão "Já concedi — verificar agora" força a checagem.
5. `verificarProcuracoes` confirma e o status vira **ativa** sozinho → notifica via Telegram
   (infra já existe em `notificacoes-prestador.ts`).

**Painel de controle do gestor (nova aba em `PagamentosAdminPanel.tsx`):**
- **KPIs:** total de prestadores, % com procuração **ativa**, **pendentes**, **revogadas**,
  com **nível gov.br insuficiente**.
- **Lista filtrável:** nome, cidade, CNPJ, status, última verificação, onda.
- **Ações em lote:** disparar **lembrete** (Telegram), **exportar pendentes** (CSV), reenviar
  instruções — por cidade/onda.
- **Alerta de revogação:** se um prestador cancela a procuração, o sistema **para de emitir por
  ele** automaticamente e avisa o gestor (evita emitir sem autorização).

**Resumo "tudo via app":** onboarding, orientação, deep links, **detecção automática do status**,
acompanhamento, lembretes e relatórios = **100% no Jet OS**. Único passo fora: o clique de
outorga no gov.br (exigência legal, ~2 min, uma vez por prestador).

---

## 13.18 ESBOÇOS DE IMPLEMENTAÇÃO (verificarProcuracoes · emitirNFSe · fila · painel)

> Padrões do projeto seguidos: Functions v2 em `southamerica-east1`; `import * as admin`;
> Telegram via `telegram_config/global.botToken`; batch Firestore ≤ 500 ops; segredos via
> `defineSecret` (Secret Manager); `export * from './arquivo'` no `index.ts`. Os blocos abaixo
> são **esboços** — o layout XML do DPS e a assinatura seguem o manual oficial da NFS-e Nacional.

### 13.18.0 Dependências e segredos
```bash
# functions/
npm i xml-crypto node-forge            # assinatura XML-DSig + leitura do .pfx (A1)
# zlib e https são nativos do Node 22
```
```bash
# Segredos (Secret Manager) — NUNCA no código/Firestore:
firebase functions:secrets:set JET_CERT_PFX_B64     # certificado A1 (.pfx) em base64
firebase functions:secrets:set JET_CERT_PFX_PASS    # senha do .pfx
firebase functions:secrets:set GOVBR_CLIENT_ID      # credenciamento Login Único gov.br
firebase functions:secrets:set GOVBR_CLIENT_SECRET
```
Estados novos em `pagamentos_semana.status` (estende o union atual):
`valor_aprovado → emitindo → nf_autorizada → pago` (+ `nf_erro`). Campos novos:
`nf_numero, nf_chave, nf_protocolo, nf_xml_url, nf_emitida_em, nf_tentativas, nf_erro_motivo`.

### 13.18.1 `verificarProcuracoes` — detecção automática do status
```ts
// functions/src/nfse-procuracoes.ts
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';

const db = admin.firestore();
const GOVBR_CLIENT_ID = defineSecret('GOVBR_CLIENT_ID');
const GOVBR_CLIENT_SECRET = defineSecret('GOVBR_CLIENT_SECRET');
const CNPJ_JET = '00000000000000';

// 1) Access Token OAuth2 (client_credentials) da API de Procuração do gov.br (Login Único)
async function getGovbrToken(): Promise<string> {
  const basic = Buffer.from(`${GOVBR_CLIENT_ID.value()}:${GOVBR_CLIENT_SECRET.value()}`).toString('base64');
  const r = await fetch('https://gov.br/.../token', {            // URL do ambiente (homolog/prod)
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=procuracoes',
  });
  if (!r.ok) throw new Error(`govbr token ${r.status}`);
  return (await r.json()).access_token;
}

// 2) Lista os CNPJs que outorgaram à Jet o poder de EMITIR NFS-e
async function listarOutorgantes(token: string): Promise<Set<string>> {
  const r = await fetch(`https://gov.br/.../procuracoes?procurador=${CNPJ_JET}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`govbr procuracoes ${r.status}`);
  const data = await r.json();
  return new Set((data.procuracoes || [])
    .filter((p: any) => p.ativo && p.poderes?.includes('NFSE_EMISSAO'))
    .map((p: any) => String(p.outorgante_cnpj).replace(/\D/g, '')));
}

export const verificarProcuracoes = onSchedule(
  { schedule: 'every 8 hours', timeZone: 'America/Sao_Paulo', region: 'southamerica-east1',
    memory: '256MiB', timeoutSeconds: 300, secrets: [GOVBR_CLIENT_ID, GOVBR_CLIENT_SECRET] },
  async () => {
    let ativos: Set<string>;
    try {
      ativos = await listarOutorgantes(await getGovbrToken());
    } catch (e) {
      console.error('[verificarProcuracoes] API gov.br falhou — status preservado:', e);
      return;                                  // não altera nada se a fonte caiu
    }

    const snap = await db.collection('prestadores_fiscal').where('ativo', '==', true).get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let batch = db.batch(), ops = 0, mudancas = 0;

    for (const docSnap of snap.docs) {
      const d = docSnap.data();
      const cnpj = String(d.cnpj || '').replace(/\D/g, '');
      const novo = ativos.has(cnpj) ? 'ativa'
                 : d.procuracao_status === 'ativa' ? 'revogada' : 'pendente';

      const patch: any = { procuracao_verificada_em: now };
      if (novo !== d.procuracao_status) {
        patch.procuracao_status = novo;
        if (novo === 'ativa')     patch.procuracao_concedida_em = now;
        if (novo === 'revogada')  await alertarRevogacaoTelegram(d);   // gestor é avisado
        mudancas++;
      }
      batch.update(docSnap.ref, patch);
      if (++ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops) await batch.commit();
    console.log(`[verificarProcuracoes] ${snap.size} verificados, ${mudancas} mudanças`);
  }
);
```
> **Revogação para a emissão sozinha:** `emitirNFSe` checa `procuracao_status === 'ativa'` antes
> de emitir; se a função acima marcou `revogada`, a emissão é bloqueada automaticamente.

### 13.18.2 `emitirNFSe` — monta DPS + assina + envia + grava
```ts
// functions/src/nfse-emitir.ts
import * as admin from 'firebase-admin';
import * as https from 'https';
import * as zlib from 'zlib';
import { defineSecret } from 'firebase-functions/params';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { notificarStatusNF } from './notificacoes-prestador';

const db = admin.firestore();
const CERT_PFX_B64 = defineSecret('JET_CERT_PFX_B64');
const CERT_PFX_PASS = defineSecret('JET_CERT_PFX_PASS');
const CNPJ_JET = '00000000000000';
const NFSE_API = 'https://sefin.nfse.gov.br/sefinnacional';     // ambiente nacional (homolog/prod)

// Lê o A1 (.pfx) → PEM (cert + chave) para assinar e para o mTLS
function carregarCertificado(pfxB64: string, senha: string) {
  const p12Der = forge.util.decode64(pfxB64);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), senha);
  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]![0];
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]![0];
  return {
    keyPem:  forge.pki.privateKeyToPem(keyBag.key as forge.pki.PrivateKey),
    certPem: forge.pki.certificateToPem(certBag.cert as forge.pki.Certificate),
  };
}

// STUB: monta o XML do DPS no layout oficial (preencher conforme manual da NFS-e Nacional)
function montarDPS(p: {
  dpsId: string; prestadorCnpj: string; inscricaoMunicipal: string; tomadorCnpj: string;
  codigoMunicipio: string; codigoServico: string; aliquotaIss: number; valor: number;
  competencia: string; discriminacao: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="${p.dpsId}">
  <!-- prest=${p.prestadorCnpj} (MEI) · tomador=${p.tomadorCnpj} (Jet) · valor=${p.valor} -->
  <!-- mun=${p.codigoMunicipio} · servico=${p.codigoServico} · iss=${p.aliquotaIss} -->
  <!-- competencia=${p.competencia} · ${p.discriminacao} -->
</infDPS></DPS>`;
}

// Assina o DPS (XML-DSig) com o certificado da Jet, referenciando o Id de infDPS
function assinarXml(xml: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml);
  return sig.getSignedXml();
}

const gzipB64 = (s: string) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');

async function marcarErro(ref: FirebaseFirestore.DocumentReference, motivo: string, transitorio = false) {
  await ref.update({ status: 'nf_erro', nf_erro_motivo: motivo,
    nf_erro_em: admin.firestore.FieldValue.serverTimestamp() });
  if (transitorio) throw new Error(motivo);    // relança → fila faz retry
}

// CORE — chamada pelo worker da fila (idempotente)
export async function emitirNFSe(pagamentoId: string): Promise<void> {
  const ref = db.collection('pagamentos_semana').doc(pagamentoId);
  const pg = (await ref.get()).data();
  if (!pg) return;
  if (['emitindo', 'nf_autorizada', 'pago'].includes(pg.status)) return;   // idempotência

  const fiscal = (await db.collection('prestadores_fiscal').doc(pg.uid).get()).data();
  if (!fiscal || fiscal.procuracao_status !== 'ativa') return marcarErro(ref, 'procuracao_inativa');
  if ((fiscal.faturamento_ano || 0) + pg.valor_total > 81000)  return marcarErro(ref, 'teto_mei');

  await ref.update({ status: 'emitindo', nf_tentativas: admin.firestore.FieldValue.increment(1) });

  // 1) DPS — id determinístico = idempotência também no lado do servidor (não duplica nota)
  const dpsId = `DPS${String(fiscal.cnpj).replace(/\D/g, '')}${pagamentoId}`.slice(0, 45);
  const xml = montarDPS({
    dpsId, prestadorCnpj: fiscal.cnpj, inscricaoMunicipal: fiscal.inscricao_municipal,
    tomadorCnpj: CNPJ_JET, codigoMunicipio: fiscal.municipio_incidencia,
    codigoServico: fiscal.codigo_servico, aliquotaIss: fiscal.aliquota_iss,
    valor: pg.valor_total, competencia: `${pg.ano}-W${pg.semana_iso}`,
    discriminacao: `Serviços de entrega — semana ${pg.semana_iso}/${pg.ano} (${pg.tarefas_count} tarefas)`,
  });

  // 2) Assina com o certificado da Jet (procuradora)
  const { certPem, keyPem } = carregarCertificado(CERT_PFX_B64.value(), CERT_PFX_PASS.value());
  const xmlAssinado = assinarXml(xml, certPem, keyPem);

  // 3) Envia à API Nacional usando o MESMO certificado no mTLS
  const agent = new https.Agent({ cert: certPem, key: keyPem });
  let resp: Response;
  try {
    resp = await fetch(`${NFSE_API}/nfse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dpsXmlGZipB64: gzipB64(xmlAssinado) }),
      // @ts-ignore — agent mTLS (node-fetch/undici)
      agent,
    });
  } catch (e: any) {
    return marcarErro(ref, `rede_${e?.code || 'erro'}`, true);    // transitório → retry
  }
  if (resp.status >= 500) return marcarErro(ref, `api_${resp.status}`, true);   // transitório → retry
  if (!resp.ok)           return marcarErro(ref, `rejeicao_${resp.status}`);     // fiscal → nf_erro (sem retry)

  // 4) Retorno: número, chave, XML autorizado, PDF (DANFSE)
  const nota = await resp.json();
  await ref.update({
    status: 'nf_autorizada',
    nf_numero: nota.nfseNumero, nf_chave: nota.chaveAcesso, nf_protocolo: nota.protocolo,
    nf_xml_url: await salvarXmlNoStorage(pagamentoId, nota.nfseXmlGZipB64),
    nf_emitida_em: admin.firestore.FieldValue.serverTimestamp(),
    nf_erro_motivo: admin.firestore.FieldValue.delete(),
  });

  // 5) Acumula teto MEI + notifica o prestador (Telegram já existe)
  await db.collection('prestadores_fiscal').doc(pg.uid)
    .update({ faturamento_ano: admin.firestore.FieldValue.increment(pg.valor_total) });
  await notificarStatusNF(pg.uid, 'nf_autorizada', pg);
}
// salvarXmlNoStorage(): grava o XML no bucket e devolve a URL pública (padrão da Seção 2.11).
```

### 13.18.3 Fila de emissão em lote — 2.500/semana (Cloud Tasks)
```ts
// functions/src/nfse-fila.ts
import * as admin from 'firebase-admin';
import { getFunctions } from 'firebase-admin/functions';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { emitirNFSe } from './nfse-emitir';

const db = admin.firestore();
const CERT_PFX_B64 = defineSecret('JET_CERT_PFX_B64');
const CERT_PFX_PASS = defineSecret('JET_CERT_PFX_PASS');

// Enfileira 1 pagamento (id da task = dedupe: nunca enfileira a mesma nota 2x)
export async function enfileirarEmissao(pagamentoId: string) {
  await getFunctions().taskQueue('emitirNFSeWorker', 'southamerica-east1')
    .enqueue({ pagamentoId }, { id: `emit-${pagamentoId}`, dispatchDeadlineSeconds: 120 });
}

// Worker: Cloud Tasks chama com RATE LIMIT + RETRY automáticos
export const emitirNFSeWorker = onTaskDispatched(
  { region: 'southamerica-east1', memory: '512MiB',
    secrets: [CERT_PFX_B64, CERT_PFX_PASS],
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 30, maxDoublings: 4 },
    rateLimits: { maxConcurrentDispatches: 20, maxDispatchesPerSecond: 10 } }, // ajustar ao limite real da API
  async (req) => {
    await emitirNFSe((req.data as { pagamentoId: string }).pagamentoId);
    // se emitirNFSe lançar (erro transitório) → Cloud Tasks reexecuta com backoff
  }
);

// Gatilho 1: emissão na hora em que o gestor aprova o valor de uma semana
export const emitirAoAprovar = onDocumentUpdated(
  { document: 'pagamentos_semana/{id}', region: 'southamerica-east1' },
  async (ev) => {
    const a = ev.data?.before.data(), b = ev.data?.after.data();
    if (b && a?.status !== b.status && b.status === 'valor_aprovado') {
      await enfileirarEmissao(ev.params.id);
    }
  }
);

// Gatilho 2: fechamento semanal em massa (segunda 9h) — enfileira tudo que está aprovado
export const fecharSemanaEmitir = onSchedule(
  { schedule: '0 9 * * 1', timeZone: 'America/Sao_Paulo', region: 'southamerica-east1', timeoutSeconds: 540 },
  async () => {
    const snap = await db.collection('pagamentos_semana').where('status', '==', 'valor_aprovado').get();
    let n = 0;
    for (const d of snap.docs) { await enfileirarEmissao(d.id); n++; }
    console.log(`[fecharSemanaEmitir] ${n} emissões enfileiradas`);
  }
);
```
**Por que aguenta 2.500/semana, com segurança:**
- **Vazão:** `maxDispatchesPerSecond: 10` + `maxConcurrentDispatches: 20` → 2.500 notas saem em
  ~4 min, **respeitando o limite da API** (afinar os números ao limite real da NFS-e Nacional).
- **Retry:** falha de rede/5xx → Cloud Tasks reexecuta com backoff (até 5x). Rejeição fiscal (4xx)
  → vira `nf_erro` **sem** retry (não adianta repetir nota errada).
- **Idempotência tripla:** id da task (`emit-<id>`) evita enfileirar 2x · `emitirNFSe` pula se já
  `emitindo/autorizada` · `dpsId` determinístico evita nota duplicada no servidor.
- **Sem Cloud Tasks?** Fallback = fila no Firestore + worker `onSchedule` a cada minuto pegando
  lotes (mesmo padrão da fila do GPS nativo, Seção 10.8) — mais simples, porém rate-limit manual.

### 13.18.4 Painel — nova aba "Procurações" em `PagamentosAdminPanel.tsx`
**Layout (mantém o tema dark inline do componente):**
- `type Aba` ganha `'procuracoes'`; novo botão na barra de abas.
- **Linha de KPIs (5 cards):** Total · Ativas (verde) · Pendentes (âmbar) · Revogadas (vermelho) ·
  Nível gov.br insuficiente.
- **Filtros:** cidade (select) · status (select) · busca por nome/CNPJ.
- **Tabela:** Nome · Cidade · CNPJ · Status (badge colorido) · Nível gov.br · Última verificação · Ações.
- **Ações em lote:** "Lembrar pendentes (Telegram)" · "Exportar pendentes (CSV)".
```tsx
// Esboço do conteúdo da aba (dentro de PagamentosAdminPanel.tsx)
const [fiscais, setFiscais] = useState<PrestadorFiscal[]>([]);
const [fStatus, setFStatus] = useState<'todos'|'ativa'|'pendente'|'revogada'>('todos');

useEffect(() => {                       // carrega prestadores_fiscal (join nome/cidade já denormalizado)
  getDocs(collection(db, 'prestadores_fiscal')).then(s =>
    setFiscais(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
}, []);

const kpi = {
  total:    fiscais.length,
  ativa:    fiscais.filter(f => f.procuracao_status === 'ativa').length,
  pendente: fiscais.filter(f => f.procuracao_status === 'pendente').length,
  revogada: fiscais.filter(f => f.procuracao_status === 'revogada').length,
  semNivel: fiscais.filter(f => f.nivel_govbr === 'bronze').length,
};
const lista = fiscais.filter(f => fStatus === 'todos' || f.procuracao_status === fStatus);

async function lembrarPendentes() {     // dispara Telegram em lote (callable)
  const fn = httpsCallable(getFunctions(undefined, 'southamerica-east1'), 'lembrarProcuracaoPendente');
  await fn({ uids: fiscais.filter(f => f.procuracao_status === 'pendente').map(f => f.uid) });
}
function exportarPendentesCSV() {       // CSV client-side (padrão já usado nas outras abas)
  const linhas = [['nome','cidade','cnpj','status'],
    ...fiscais.filter(f => f.procuracao_status !== 'ativa').map(f => [f.nome, f.cidade, f.cnpj, f.procuracao_status])];
  const blob = new Blob([linhas.map(l => l.join(';')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'procuracoes_pendentes.csv'; a.click();
}
// JSX: 5 KPI cards → barra de filtros → <table> com badge de status → botões de ação em lote.
```
Callable de apoio `lembrarProcuracaoPendente` (em `nfse-procuracoes.ts`): recebe `uids`, busca
`telegramChatId` em `usuarios` e envia o lembrete pelo padrão de `notificacoes-prestador.ts`.

### 13.18.5 Registrar no `index.ts`
```ts
export * from './nfse-procuracoes';  // verificarProcuracoes, lembrarProcuracaoPendente
export * from './nfse-emitir';       // (emitirNFSe é helper; exportado p/ testes)
export * from './nfse-fila';         // emitirNFSeWorker, emitirAoAprovar, fecharSemanaEmitir
```
**Regra Firestore (Seção 2.14):** `prestadores_fiscal` — `read` próprio uid ou gestor; `write`
gestor; certificado/segredos nunca trafegam pelo Firestore. (Detalhe completo na Seção 13.20.)

### 13.19 `montarDPS` — o XML do DPS no layout oficial
> Layout **Sistema Nacional NFS-e v1.x**. ⚠️ Confirmar a versão vigente do MOC na implementação:
> a Reforma Tributária (NT 004/005) **adiciona o grupo `IBSCBS`** ao DPS/NFS-e. MEI → `opSimpNac=2`.
> O **ISS do MEI é fixo (DAS)** — manter o grupo `tribMun`, mas validar o tratamento de `pAliq`
> p/ MEI com o contador (o Sefin Nacional calcula conforme o `opSimpNac`).
```ts
// functions/src/nfse-dps.ts
const esc = (v: any) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const dig = (v: any) => String(v ?? '').replace(/\D/g, '');
const pad = (v: any, n: number) => dig(v).padStart(n, '0').slice(-n);
const v2  = (n: number) => Number(n || 0).toFixed(2);   // 2 casas, ponto decimal

export interface DpsInput {
  ambiente: 1 | 2;                 // 1=produção, 2=homologação
  serie: string; numero: number;   // série + nº sequencial da DPS DO PRESTADOR
  dhEmissao: string;               // ISO c/ timezone, ex.: 2026-06-08T09:00:00-03:00
  competencia: string;             // YYYY-MM-DD (1º dia da competência)
  prestadorCnpj: string; inscricaoMunicipal: string;            // emitente = MEI
  tomadorCnpj: string; tomadorNome: string;                     // tomador = Jet
  tomadorMunicipioIbge: string; tomadorCep?: string;
  tomadorLogradouro?: string; tomadorNumero?: string; tomadorBairro?: string; tomadorEmail?: string;
  municipioIncidenciaIbge: string; // 7 díg (local da prestação/emissão)
  cTribNac: string;                // cód. de tributação nacional (6 díg) — do item LC 116
  cTribMun?: string; descricaoServico: string;
  valorServico: number; aliquotaIss: number; issRetido?: boolean;
}

// Chave/Id do DPS (45 caracteres) — DETERMINÍSTICO ⇒ idempotência no servidor
export function montarDpsId(i: DpsInput): string {
  return 'DPS'
    + pad(i.municipioIncidenciaIbge, 7)  // município emissor
    + '2'                                 // tpInsc: 2 = CNPJ
    + pad(i.prestadorCnpj, 14)
    + pad(i.serie, 5)
    + pad(String(i.numero), 15);
}

export function montarDPS(i: DpsInput): string {
  const id = montarDpsId(i);
  const tpRet = i.issRetido ? 2 : 1;     // 1=não retido (prestador recolhe), 2=retido
  const endToma = i.tomadorMunicipioIbge ? `
      <end><endNac><cMun>${pad(i.tomadorMunicipioIbge, 7)}</cMun>${
        i.tomadorCep ? `<CEP>${pad(i.tomadorCep, 8)}</CEP>` : ''}</endNac>${
        i.tomadorLogradouro ? `<xLgr>${esc(i.tomadorLogradouro)}</xLgr>` : ''}${
        i.tomadorNumero ? `<nro>${esc(i.tomadorNumero)}</nro>` : ''}${
        i.tomadorBairro ? `<xBairro>${esc(i.tomadorBairro)}</xBairro>` : ''}</end>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infDPS Id="${id}">
  <tpAmb>${i.ambiente}</tpAmb>
  <dhEmi>${i.dhEmissao}</dhEmi>
  <verAplic>JetOS-1.0</verAplic>
  <serie>${esc(i.serie)}</serie>
  <nDPS>${i.numero}</nDPS>
  <dCompet>${i.competencia}</dCompet>
  <tpEmit>1</tpEmit>
  <cLocEmi>${pad(i.municipioIncidenciaIbge, 7)}</cLocEmi>
  <prest>
    <CNPJ>${pad(i.prestadorCnpj, 14)}</CNPJ>
    <IM>${esc(i.inscricaoMunicipal)}</IM>
    <regTrib><opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib></regTrib>
  </prest>
  <toma>
    <CNPJ>${pad(i.tomadorCnpj, 14)}</CNPJ>
    <xNome>${esc(i.tomadorNome)}</xNome>${endToma}${
      i.tomadorEmail ? `\n    <email>${esc(i.tomadorEmail)}</email>` : ''}
  </toma>
  <serv>
    <locPrest><cLocPrestacao>${pad(i.municipioIncidenciaIbge, 7)}</cLocPrestacao></locPrest>
    <cServ>
      <cTribNac>${esc(i.cTribNac)}</cTribNac>${
        i.cTribMun ? `<cTribMun>${esc(i.cTribMun)}</cTribMun>` : ''}
      <xDescServ>${esc(i.descricaoServico)}</xDescServ>
    </cServ>
  </serv>
  <valores>
    <vServPrest><vServ>${v2(i.valorServico)}</vServ></vServPrest>
    <trib>
      <tribMun><tribISSQN>1</tribISSQN><pAliq>${v2(i.aliquotaIss)}</pAliq><tpRetISSQN>${tpRet}</tpRetISSQN></tribMun>
      <totTrib><indTotTrib>0</indTotTrib></totTrib>
    </trib>
  </valores>
</infDPS></DPS>`;
}
```
**Numeração (`nDPS`):** sequencial por prestador — usar contador transacional:
```ts
async function proximoNDPS(uid: string): Promise<number> {
  const ref = db.collection('prestadores_fiscal').doc(uid);
  return db.runTransaction(async (t) => {
    const n = ((await t.get(ref)).data()?.ultimo_ndps || 0) + 1;
    t.update(ref, { ultimo_ndps: n });
    return n;
  });
}
```
**Wire no `emitirNFSe` (Seção 13.18.2):** substituir o stub por `import { montarDPS } from './nfse-dps'`,
buscar `cTribNac`/`aliquota_iss`/`municipio_incidencia` de `prestadores_fiscal` (default por cidade em
`pagamentos_config`), `tomador*` = dados da Jet, `numero = await proximoNDPS(uid)`. O `dpsId` determinístico
substitui o `.slice(0,45)` anterior — **mesma semana nunca gera 2 notas**.

### 13.20 Regra Firestore + termo de aceite de `prestadores_fiscal`
**Regras** (`firestore.rules`) — prestador só edita os campos auto-declarados; gestor/Functions
controlam os fiscais sensíveis; aceite é **imutável** (igual `consentimentos_lgpd`, Seção 11.2):
```javascript
function isDono(uid)  { return request.auth != null && request.auth.uid == uid; }
// isGestor()/isAdmin() já existem nas regras do projeto

// Campos que o PRÓPRIO prestador pode gravar (auto-declarados no onboarding)
// Sensíveis (codigo_servico, aliquota_iss, municipio_incidencia, procuracao_status,
// faturamento_ano, ativo, onda, ultimo_ndps) → SÓ gestor/Functions.
match /prestadores_fiscal/{uid} {
  allow read: if isDono(uid) || isGestor();
  allow create: if isGestor()
    || (isDono(uid) && request.resource.data.keys()
        .hasOnly(['cnpj','razao_social','cpf_responsavel','inscricao_municipal','email_fiscal','nivel_govbr']));
  allow update: if isGestor()
    || (isDono(uid) && request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(['cnpj','razao_social','cpf_responsavel','inscricao_municipal','email_fiscal','nivel_govbr']));
  allow delete: if isAdmin();
}

// Termo de autorização (prova jurídica) — IMUTÁVEL
match /aceites_procuracao/{docId} {
  allow read:   if isDono(resource.data.uid) || isGestor();
  allow create: if isDono(request.resource.data.uid)
                && request.resource.data.versao is string;
  allow update, delete: if false;
}
```
> As Cloud Functions usam o Admin SDK e **ignoram** as regras — `verificarProcuracoes`/`emitirNFSe`
> gravam `procuracao_status`/`faturamento_ano`/`ultimo_ndps` normalmente. As regras só barram o cliente.

**Termo de aceite** (componente, modelo do `LgpdConsentGate` — Seção 11):
```tsx
// frontend/src/components/TermoProcuracaoGate.tsx
const TERMO_VERSAO = '1.0';
const TERMO = `Autorizo a JET (CNPJ XX.XXX.XXX/0001-XX), na qualidade de minha PROCURADORA, a emitir
Notas Fiscais de Serviço eletrônicas (NFS-e) em meu nome (meu CNPJ MEI), referentes
EXCLUSIVAMENTE aos serviços por mim prestados à JET. Declaro que:
• concederei à JET a procuração eletrônica no gov.br/e-CAC com o poder de emitir NFS-e;
• os dados fiscais que informei são verdadeiros e de minha responsabilidade;
• esta autorização vigora por prazo indeterminado e é revogável a qualquer momento por mim,
  bastando cancelar a procuração no gov.br;
• a JET emitirá as notas com base nas tarefas concluídas e no valor apurado no app Jet OS.`;

export async function registrarAceiteProcuracao(user: { uid: string; email: string; nome: string }) {
  const ref = doc(db, 'aceites_procuracao', `${user.uid}_v${TERMO_VERSAO}`);
  await setDoc(ref, {
    uid: user.uid, email: user.email, nome: user.nome,
    versao: TERMO_VERSAO,
    dispositivo: navigator.userAgent, idioma: navigator.language,
    aceito_em: serverTimestamp(),            // serverTimestamp = carimbo confiável
  });                                         // sem merge → create único e imutável
}
// UI: exibir TERMO + checkbox "Li e autorizo" + botão "Autorizar e continuar".
// Só habilita o Passo 2 (deep link p/ a procuração no gov.br) após o aceite.
```
**Carimbar `autorizado_em` sem o cliente tocar em campo sensível** — trigger no aceite:
```ts
// functions/src/nfse-procuracoes.ts
export const aoAceitarProcuracao = onDocumentCreated(
  { document: 'aceites_procuracao/{id}', region: 'southamerica-east1' },
  async (ev) => {
    const uid = ev.data?.data()?.uid;
    if (uid) await db.collection('prestadores_fiscal').doc(uid)
      .set({ autorizado_em: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
);
```
**Versionar o termo:** se o texto mudar, incrementar `TERMO_VERSAO` → novo doc `{uid}_v{nova}` é
exigido (mesmo padrão do `LGPD_VERSAO`, Seção 11.3). **Recomenda-se validação por advogado.**

---

# 14. ROADMAP DE MIGRAÇÃO PARA SUPABASE (PLANO COMPLETO)

> **Decisão:** migrar o Jet OS (Firebase) para **Supabase (Postgres + RLS + Edge Functions +
> Realtime + Storage)**, motivado por **custo a escala** (modelo por capacidade, não por operação)
> e **dados analíticos** (SQL/agregações). Reaproveita a linhagem V2 (já Supabase).
> **Status:** PLANEJADO. Esta seção é o passo a passo.

## 14.0 Regras de ouro (não violar)
1. **Paridade primeiro, features depois.** Nada de A/B/C antes do app atual rodar 1:1 no Supabase.
2. **Nunca migração + feature nova no mesmo módulo/PR.** Se quebrar, tem que ser óbvio o que foi.
3. **GPS é o PORTÃO.** Nenhum módulo novo entra antes do GPS nativo provado em campo no Supabase.
4. **Strangler / execução em paralelo.** Firebase e Supabase rodam juntos; corta-se módulo a módulo.
5. **Cada módulo tem portão de validação** (comparar saída Supabase × Firebase) e **plano de rollback**.
6. **Exceção:** o **NFS-e nasce direto no Supabase** (greenfield, não existe ainda — Seção 14.9).

## 14.1 Mapa de equivalências Firebase → Supabase
| Firebase | Supabase | Observação |
|---|---|---|
| Firestore (coleções/docs) | **Postgres** (tabelas) | modelar relacional; reusar schema V2 (ARCHITECTURE.md) |
| Security Rules | **RLS policies** + `is_current_user_admin()` (SECURITY DEFINER) | padrão V2 evita recursão |
| `onSnapshot` (realtime) | **Supabase Realtime** (`postgres_changes`) | mapa ao vivo, listas |
| Cloud Function `onRequest` | **Edge Function (Deno)** ou **RPC PostgREST** | |
| Cloud Function `onSchedule` | **pg_cron + pg_net** (ou Edge Fn agendada) | scraper, watchdogs, NF |
| Trigger `onDocument*` | **Trigger Postgres (plpgsql)** ou **DB Webhook → Edge Fn** | |
| Cloud Tasks (fila NF) | **pgmq** (fila Postgres) + worker via pg_cron | Seção 14.9 |
| Firebase Auth | **Supabase Auth (GoTrue)** | migração de senha: Seção 14.10 |
| Storage | **Supabase Storage** (buckets) | croquis, fotos, NF, OTA, APK |
| FCM / Messaging | **Web Push (VAPID)** + `push_subscriptions` | padrão V2 (`send-push`) |
| BigQuery (analytics) | **SQL nativo no Postgres** | o ganho analítico |
| Telegram (API externa) | **igual** (fetch no Edge Fn) | sem mudança de lógica |
| GoJet proxy (Vercel) | **igual** (Edge Fn chama o proxy) | mantém o proxy |
| **Firebase Hosting (PWA)** | **NÃO migra** — Supabase não hospeda frontend | manter o **URL** (Seção 14.1.1) |

### 14.1.1 Hospedagem da PWA — o URL NÃO precisa mudar
Supabase **não hospeda frontend**. A migração é de backend; a hospedagem é decisão à parte.
- **✅ DECISÃO (jun/2026): MANTER o Firebase Hosting por enquanto** → URL `https://jet-os-1.web.app`
  **inalterado**, convivendo com o backend Supabase. (Migrar a hospedagem fica para depois, se algum dia.)
- **Se trocar de host** (Vercel/Netlify/CF Pages) → usar **domínio próprio** para o link não mudar.
- **⚠️ PWA é por ORIGEM:** se o URL mudar, instalações na tela inicial quebram (SW/cache/push/IndexedDB/
  sessão são por origem → perdidos; usuários teriam que reinstalar). **Adotar domínio próprio** desacopla
  o front do provedor e preserva o link. O **APK** não usa esse URL (carrega bundle local; muda só a
  config de endpoints Firebase→Supabase).

## 14.2 Inventário a migrar
**Coleções Firestore →** tabelas: `estacoes, poligonos, zonas, analytics_days, locais_operacionais,
cidades_expansao, usuarios(+employee_profiles), gojet_snapshots, gojet_config, gps_logistica,
gps_logistica_hist, tarefas_logistica(tasks), slots, pagamentos_semana, pagamentos_config,
prestadores_fiscal, aceites_procuracao, consentimentos_lgpd, telegram_config/vinculos,
solicitacoes_prestadores, logs_acesso`.
**Cloud Functions →** Edge Fns/RPC/cron: `gps-ingest, gps-alertas, gps-historico, slots,
slot-confirmacao, automacao*, automacao-gojet-scraper, automacao-tarefas, relatorios, relatorio,
notificacoes-prestador, telegram-vinculo, auth, pois, geolocation, croquis, streetview`.
**Nativo Android →** re-apontar `GpsTrackerService`/`GpsTokenManager` para Edge Fn + JWT Supabase
(Seção 14.5). **Externos →** GoJet proxy (mantém), Telegram (mantém), Nominatim/Overpass (mantém).

## 14.3 Estratégia de dados (export → backfill → dual-run)
- **Backfill único:** script Node (`firebase-admin` lê Firestore) → transforma → insere no Postgres
  via `pg`/`supabase-js` (COPY p/ tabelas grandes como `gps_logistica_hist`).
- **Dual-run durante a transição:** enquanto um módulo está sendo validado, **escreve nos dois**
  (Firebase continua fonte de verdade até o cutover). Implementar via:
  - opção simples: o cliente/Edge Fn grava em ambos;
  - opção robusta: **Firestore trigger → Edge Fn** espelha a escrita no Postgres (one-way mirror).
- **Cutover por módulo:** quando o portão de validação passa, o módulo passa a ler/escrever **só no
  Supabase** e desliga-se o espelho. Firebase daquele módulo vira somente-leitura → depois removido.
- **⚠️ Efeitos externos = EMISSOR ÚNICO.** Dual-run vale para *dados* (espelho idempotente), NÃO para
  jobs que disparam **Telegram/push/e-mail** (relatórios Guard, alertas, notificações de NF). Se os
  dois schedulers rodarem, o gestor recebe **mensagem duplicada**. Regra: manter **exatamente um**
  emissor ativo — Firebase envia até o cutover; só então liga o `pg_cron` do Supabase e desliga o do
  Firebase. Telegram/bot/token/chats e o conteúdo das mensagens **ficam idênticos** (API externa);
  muda só onde o job roda (`onSchedule`→`pg_cron`, `onCall`→Edge Fn) e a leitura dos dados (→ SQL).
  Validar enviando a um **chat de teste** e comparando o texto Supabase × Firebase antes de cortar.

## 14.4 FASE 0 — Fundação (~2–3 semanas)
**Objetivo:** Supabase pronto para receber o primeiro módulo, sem tocar em produção.
Passos:
1. Criar projeto Supabase (região `sa-east-1`/São Paulo) — **dev** e **prod** separados.
2. **Schema consolidado** (migrations versionadas em `supabase/migrations/`): partir do schema V2
   (employees, tasks, zones, parking_history, bike_history, app_settings, push_subscriptions) +
   acrescentar o operacional do Firebase (estacoes, poligonos, gps_*, slots, gojet_*) + o fiscal
   (prestadores_fiscal, pagamentos_*, aceites_procuracao). DDL padrão por tabela com PK, FKs, índices.
3. **RLS** em todas as tabelas + `is_current_user_admin()` (SECURITY DEFINER, padrão V2).
4. **Storage buckets:** `croquis, fotos-tarefas, notas-fiscais, ota, apk` com policies.
5. **Edge Functions skeleton** + segredos (Telegram token, GoJet proxy URL, certificado NFS-e, etc.).
6. **pg_cron + pg_net + pgmq** habilitados (extensões).
7. **CI/migrations** (Supabase CLI) + ambiente de **dual-run** (script de espelho Firestore→PG).
8. **Backfill de teste** das tabelas de referência (estacoes, poligonos, usuarios) no dev.
**Validação:** schema aplica limpo no dev; RLS testado; backfill de referência confere contagens.
> ✅ **Schema 0001 esboçado:** `supabase/migrations/0001_init_schema.sql` — PostGIS, enums, perfil
> `usuarios` (↔ auth.users), helpers `is_admin()/is_gestor()`, RLS em todas as tabelas, operacional
> (estações/zonas/áreas geofence/GoJet/tarefas/slots/turnos/GPS), fiscal/NF (prestadores_fiscal,
> pagamentos_semana, aceites_procuracao, fila pgmq), LGPD, telegram/push/config, e triggers
> (perfil ao criar auth.user; carimbo de autorizado_em no aceite). Falta: revisar com dados reais,
> habilitar extensões no painel, e converter `gps_history` em particionada+TTL na escala.

## 14.5 FASE 1 — GPS NATIVO (o PORTÃO) (~2–3 semanas)
**Objetivo:** o rastreamento ao vivo (a parte mais difícil/arriscada) rodar no Supabase, validado
**em campo**, antes de qualquer outra coisa.
Passos:
1. **Edge Function `ingest-gps`** (equivalente ao `gps-ingest.ts`): recebe lote de pontos, valida
   **JWT do Supabase** (uid do token, anti-spoof), grava em `gps_locations` + histórico, atualiza
   `usuarios.ultima_posicao`. Dispara verificação de chegada (trigger/Realtime).
2. **Android nativo:** re-apontar `GpsTrackerService` para a URL da Edge Fn; trocar o
   `GpsTokenManager` (Firebase refresh→ID) por **refresh/JWT Supabase**. Resto da arquitetura
   (fila SQLite, boot receiver, foreground service) **fica igual** (Seção 10.8).
3. **Mapa ao vivo** via **Supabase Realtime** (`postgres_changes` em `gps_locations`/`usuarios`).
4. **Dual-run:** APK de teste envia para os DOIS (Firebase + Supabase) durante a validação.
**Validação (em celular real, checklist Seção 10.8.6):** app minimizado, **fechado**, tela travada,
reinício — **comparar pontos no Supabase × Firebase sem buracos**. Só passa o portão se idêntico.
**Rollback:** APK continua mandando p/ Firebase; é só não cortar até validar.

### 14.5.1 RUNBOOK passo a passo do `ingest-gps` (zero-erro)
Artefatos prontos: `supabase/migrations/0001_init_schema.sql`, `0002_ingest_gps_rpc.sql`,
`supabase/functions/ingest-gps/index.ts`.

**PARTE A — Conta e projeto (no site supabase.com):**
1. Criar conta → New project. **Region: South America (São Paulo)**. Guardar a **Database password**.
2. Settings → **API**: anotar `Project URL`, `anon key`, `service_role key` (secreta!).
3. Database → **Extensions**: habilitar **postgis, pg_cron, pg_net, pgmq, pg_trgm, pgcrypto**
   (ANTES de aplicar a migration — senão `create extension`/`pgmq.create` falham).

**PARTE B — CLI + migration (PowerShell, na pasta do projeto):**
4. Instalar CLI: `scoop install supabase`  (ou usar `npx supabase <cmd>` sem instalar).
5. `supabase login`  (abre o navegador para autorizar).
6. `supabase init`  (cria `supabase/config.toml`; mantém a pasta `migrations/` que já existe).
7. `supabase link --project-ref <REF>`  (REF = id do projeto, está na URL do dashboard).
8. Aplicar o schema: `supabase db push`  → cria todas as tabelas + RLS + o RPC.
   - Se algo travar por extensão, confirme a PARTE A.3 e rode de novo (migrations são idempotentes).
9. Conferir no dashboard → **Table editor** que as tabelas apareceram.

**PARTE C — Edge Function:**
10. Deploy: `supabase functions deploy ingest-gps`
    (SUPABASE_URL/ANON/SERVICE_ROLE são injetados automaticamente — não precisa setar segredo).
11. URL final: `https://<REF>.supabase.co/functions/v1/ingest-gps`.

**PARTE D — Teste end-to-end (sem o app):**
12. Criar um usuário de teste: dashboard → Authentication → Add user (email+senha).
13. Pegar um access_token desse usuário (PowerShell):
```powershell
$REF="<REF>"; $ANON="<anon key>"
$login = Invoke-RestMethod -Method Post -Uri "https://$REF.supabase.co/auth/v1/token?grant_type=password" `
  -Headers @{ apikey=$ANON; "Content-Type"="application/json" } `
  -Body '{"email":"teste@jet.com","password":"SENHA"}'
$TOKEN=$login.access_token
```
14. Enviar um ponto e conferir o retorno `{ ok:true, written:1 }`:
```powershell
Invoke-RestMethod -Method Post -Uri "https://$REF.supabase.co/functions/v1/ingest-gps" `
  -Headers @{ Authorization="Bearer $TOKEN"; apikey=$ANON; "Content-Type"="application/json" } `
  -Body '{"points":[{"lat":-23.56,"lng":-46.64,"accuracy":10,"capturedAt":"2026-06-14T12:00:00-03:00"}]}'
```
15. Conferir no Table editor → `gps_locations` (1 linha) e `usuarios.ultima_pos` atualizada.
    - 401 `invalid_token` = token errado/expirado. 500 `write_failed` = ver Logs da função.

**PARTE E — Android nativo (re-apontar para o Supabase):**
16. `frontend/src/lib/gps-native.ts`: passar ao serviço o `functionUrl` acima, o `anonKey`, e o
    **refresh token do Supabase** (`(await supabase.auth.getSession()).data.session.refresh_token`).
17. `GpsTokenManager.java`: trocar a troca de token do Firebase pela do Supabase —
    POST `https://<REF>.supabase.co/auth/v1/token?grant_type=refresh_token`
    com header `apikey: <anon>` e body `{"refresh_token":"..."}` → guarda o novo `access_token`/`refresh_token`.
18. `GpsTrackerService.java`: no POST, headers `Authorization: Bearer <access_token>` **e** `apikey: <anon>`;
    body `{ "points": [...] }` (mesmas chaves de hoje). Resto (fila SQLite, boot, foreground) **igual**.
19. **Dual-run:** durante a validação, o APK de teste envia para os DOIS (Firebase `ingestGps` +
    Supabase `ingest-gps`). Não cortar o Firebase ainda.

**PARTE F — Portão de validação (celular real, checklist 10.8.6):**
20. App minimizado / **fechado** / tela travada / **reiniciar o celular** com turno ativo.
21. Comparar pontos: `gps_locations` (Supabase) × `gps_logistica` (Firebase) — **sem buracos, iguais**.
22. Só então: cortar o envio do Firebase → Fase 1 concluída.

**Pegadinhas comuns:** (a) esquecer de habilitar extensões antes do `db push`; (b) `verify_jwt`
liga por padrão — o app PRECISA mandar um access_token Supabase válido; (c) mandar `apikey` junto do
`Authorization` (o gateway exige); (d) `slotId` precisa ser uuid válido ou vazio.

**✅ Código já preparado (plugável por provedor firebase|supabase):**
- `frontend/src/lib/supabase.ts` (cliente), `gps-native.ts` (escolhe provedor por
  `VITE_GPS_PROVIDER`), `GpsTrackerPlugin.java`/`GpsTrackerService.java`/`GpsTokenManager.java`
  (token + header `apikey` + rotação do refresh token do Supabase + compat com instalações Firebase).
- **Pré-requisitos para o APK de teste:** (1) `cd frontend && npm i @supabase/supabase-js`;
  (2) `env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, e `VITE_GPS_PROVIDER=supabase`
  (só no build de teste); (3) o usuário de teste precisa estar **logado no Supabase** no app (para
  haver `refresh_token` de sessão) — falta uma tela/sign-in de teste do Supabase.
- **⚠️ Rotação do refresh token — CONFIRMADO no 1º teste de campo (15/06):** o fluxo postou por ~4h
  e PAROU (último ponto 07:37 UTC; servidor 13:10 UTC). Causa: cliente JS (`autoRefreshToken`) e
  serviço nativo renovavam a MESMA sessão → a rotação do refresh token do Supabase invalidou o token
  do serviço nativo → parou de postar (pontos presos na fila SQLite).
  **FIX aplicado** em `supabase.ts`: `persistSession: false` + `autoRefreshToken: false` → o cliente
  JS não renova/persiste; cada início de turno faz login fresco e entrega o refresh token ao serviço
  nativo, que passa a ser o **único** a renovar. APK novo gerado 15/06 10:15.

**✅ BACKEND VALIDADO (15/06/2026):** projeto `ducdbrupxpzqcblfreqn` criado; `0001`–`0004` aplicadas;
Edge Function `ingest-gps` publicada. Teste end-to-end OK: token → `ingest-gps` → `written:2` →
linhas em `gps_locations` + `usuarios.ultima_pos` atualizada. "Confirm email" foi **desligado** no
Auth (signup já confirma).

**✅ PORTÃO DE CAMPO PASSOU (15/06/2026, após o fix de rotação):** com o APK corrigido —
app minimizado ✅, **app fechado** (continuou) ✅, **reboot** (retomou ~2,6 min após o boot —
**sem reabrir o app, confirmado pelo usuário** → `GpsBootReceiver` funcionando no Android 14+) ✅,
ao vivo ✅. Gaps de 2–5 min = parado (filtro de 10 m), não falha. Testado em **Samsung** (OEM agressivo).
**✅ SOAK PASSOU (~5h):** 182 pontos em ~4h sem parada total, ao vivo após 5h — confirma que o fix de
rotação resolveu a morte do token. Gaps esporádicos de 5–10 min = **Doze** (celular parado/ocioso),
recupera sozinho — fidelidade ajustável depois (heartbeat/wakelock) se o negócio exigir. **PORTÃO DA
FASE 1 FECHADO.**

**DEVICE ID (anti-compartilhamento) — implementado (15/06):** migration `0005_device_id.sql`
(coluna `device_id` em `gps_locations` + tabela `dispositivos` + view `dispositivos_compartilhados`
+ `ingest_gps` grava device + upsert). App captura `Device.getId()` (ANDROID_ID) e envia em cada
ponto. Detecção **soft** (aparelho novo = `aprovado=false`; aparelho com 2+ contas = a view).
Alerta Telegram ao gestor fica como follow-up. APK novo gerado com device id.

**FASE 2 — INICIADA (15/06):** migration `0006_geo_search_path_roles.sql` (PostGIS no search_path das
roles → geo via API/mirror funciona) + `supabase/scripts/mirror.mjs` (backfill Firestore→Supabase das
tabelas de referência sem dependência de auth: estações, cidades, locais, config GoJet, config
pagamentos). Próximos módulos: zonas (confirmar formato do polígono), depois usuários/auth
(destrava tarefas/slots/pagamentos), GoJet, analytics.

**🔴 PEGADINHA POSTGIS (vale para TODA função/RPC com geo):** neste projeto o PostGIS (tipo
`geography` + funções `ST_*`) está no schema **`topology`** (não no `extensions` padrão). Toda função
que usa geo precisa de `set search_path = public, extensions, topology` — senão dá
`type "geography" does not exist`. Foi o que travou o `ingest_gps` (resolvido na migration 0004).

**✅ DUAL-AUTH GPS VALIDADO EM PRODUÇÃO (16/06/2026):** o login real do app passou a estabelecer a
sessão Supabase em produção (sem credenciais de teste), e o serviço nativo posta no `ingest-gps` com o
**uid real do operador**. Confirmado em campo (Samsung SM-A057M, conta `hikoalbuquerque@gmail.com` /
`firebase_uid OyTGfuff50ZTbGPi3LpEdOpSCV02`): linha em `gps_history` com o uid correto, `[GPS-BG]
iniciado — serviço nativo` (não mais fallback Firebase).
- **Implementação (strangler/dual-auth):** helper `frontend/src/lib/supabase-auth.ts`
  (`estabelecerSessaoSupabase` chama a Edge Function `auth-login` via `functions.invoke` e grava o
  `refresh_token` no `localStorage` chave `jet_supa_refresh`; `encerrarSessaoSupabase` para o GPS nativo
  + `signOut` Supabase + limpa a chave). Plugado no **`App.tsx`** (`handleLogin`/`handleLogout`) — o
  login REAL do app é o do `App.tsx`, **não** o `useAuth` (que era código morto nesse fluxo).
- **`gps-native.ts`** lê o refresh do `localStorage` (com `persistSession:false`, o `getSession()` vem
  null em produção; só o localStorage é durável). Removidas as credenciais de teste do `env.local`.
- **🔴 CAUSA RAIZ do "GPS não posta como operador real":** **CORS da Edge Function `auth-login`** — o
  `Access-Control-Allow-Headers` não listava `authorization` nem `x-client-info`, então o **preflight**
  do `functions.invoke` (WebView) era rejeitado → sem sessão → GPS caía no fallback Firebase. O **curl
  passava** porque não faz preflight; só o navegador/WebView faz. Fix: `auth-login/index.ts` →
  `Access-Control-Allow-Headers: "authorization, apikey, content-type, x-client-info,
  x-supabase-api-version"`. **Lição:** toda Edge Function chamada do app via `functions.invoke` precisa
  desse CORS amplo.
- **Ferramenta de diagnóstico:** APK de release **não** é inspecionável (`chrome://inspect`); o debug do
  WebView fica gated por `FLAG_DEBUGGABLE` no `MainActivity`. Diagnóstico feito via **`adb logcat`**
  (tag `Capacitor/Console`) — caminho recomendado para depurar o WebView no APK.
- **🔴 PENDÊNCIAS antes de produção (manhã 16/06):** (1) o `estabelecerSessaoSupabase` **só roda no
  login MANUAL** — no **auto-restore** do Firebase (operador abre o app já logado) ele não roda, e o
  refresh token do localStorage fica **stale** após a rotação do serviço nativo → **DESLIGAR a rotação
  de refresh token** no Supabase Auth (Sessions) resolve a staleness E o bug histórico de 4h; e/ou
  re-emitir a sessão no `onAuthStateChanged`. (2) Gerar APK de **release** p/ campo (o validado foi
  debug). (3) Rotacionar `service_role` e senhas expostas.

## 14.6 FASE 2 — Operacional até a paridade (~4–6 semanas)
Migrar módulo a módulo (cada um: tabela + RLS + Edge Fn/RPC + tela lendo do Supabase + dual-run +
validação + cutover). Ordem sugerida (do mais isolado ao mais acoplado):
1. **Usuários/Auth** (Seção 14.10) · 2. **Zonas** · 3. **Estações/POIs** ·
4. **GoJet** (scraper → pg_cron+Edge Fn chamando o proxy; snapshots em tabela) ·
5. **Tarefas (tasks)** · 6. **Slots/Turno** · 7. **Analytics/Painéis** (deck.gl lê do Postgres via
   RPC — **aqui o SQL paga o investimento**) · 8. **Telegram/automações/relatórios** (Edge Fns).
**Validação por módulo:** shadow-compare (mesma entrada → mesma saída) + conferência de números nos
painéis. **Rollback por módulo:** reverter o flag de leitura para Firestore.

### 14.6.1 Módulo USUÁRIOS / AUTH (desenho — destrava tarefas/slots/pagamentos)
**Problema do uid:** o uid do Firebase **não é uuid** → não dá para reusar como `auth.users.id`.
Solução: **tabela de mapeamento** via `usuarios.firebase_uid` (migration 0007). Todo dado antigo
keyed por uid do Firebase é traduzido para o **novo uuid** do Supabase no backfill.

**Senha:** scrypt do Firebase não importa → **migração preguiçosa** via Edge Function
`auth-login` (já esboçada): tenta login Supabase; se falhar, verifica no Firebase
(`identitytoolkit`), grava a senha no Supabase e loga. Segredo `FIREBASE_API_KEY`.

**Passo a passo:**
1. **Pré-provisionar** (script admin, com Firebase Admin + service_role): `listUsers()` do Firebase
   → para cada um, `supabase.auth.admin.createUser({ email, email_confirm:true })` (GoTrue gera o
   uuid) → o trigger `handle_new_user` cria a linha em `usuarios` → `update usuarios set
   firebase_uid=<uid>, role/cidade/...` (do Firestore). Guardar o **mapa** `firebase_uid → uuid`.
2. **Backfill keyed-by-uid** (estende o `mirror.mjs`): tarefas, slots, turnos, pagamentos,
   prestadores_fiscal, gps_history — traduzindo o uid via o mapa.
3. **App**: trocar o login para chamar a Edge Function `auth-login` (em vez de `firebase.auth`).
   Roles continuam vindo de `public.usuarios.role` (RLS já usa isso) — sem claims no JWT.
4. **GPS real**: com auth migrado, `gps-native.ts` passa a usar a sessão Supabase do **próprio
   usuário** (hoje o build de teste usa o usuário fixo) — remover `VITE_SUPABASE_TEST_*`.
5. **Cutover/limpeza**: quando todos logarem ao menos 1x (ou após prazo), desligar a verificação
   Firebase no `auth-login`; depois decomissionar o Firebase Auth.

**Riscos:** contas desativadas (não pré-provisionar / `ativo=false`); e-mails CPF (V2) — manter o
mesmo e-mail dos dois lados; sem MFA (não usam). **Pré-requisito da execução:** service account do
Firebase + service_role nova + decisão de migrar todos vs só ativos.

**✅ PRÉ-PROVISIONAMENTO FEITO (15/06):** `preprovision-auth.mjs` rodou — **37 usuários** criados no
Supabase Auth (0 erros), `public.usuarios` preenchido (firebase_uid/role/cidade), e **`uid-map.json`**
(37 entradas) gerado para o backfill keyed-by-uid. `auth-login` deployada + `FIREBASE_API_KEY` setado.
**Pendente:** backfill de referência (`mirror.mjs`), backfill uid-keyed (tarefas/slots/pagamentos —
confirmar formato dos campos no Firestore), e troca do login do app para `auth-login`.

## 14.7 FASE 3 — Backfill de dados + cutover final (~2–3 semanas)
1. **Backfill completo** das tabelas grandes (`gps_logistica_hist`, `gojet_snapshots`, histórico).
2. **Cutover** de cada módulo já validado: Supabase vira fonte de verdade, desliga o espelho.
3. **Firebase em somente-leitura** → período de carência (1–2 semanas observando) → **decomissionar**
   (functions, Firestore, Storage) e **migrar arquivos** do Storage (croquis/fotos/NF) para buckets.
4. **APK final** (apenas Supabase) publicado via OTA/loja.
**Validação:** uma semana de produção 100% Supabase sem regressão; custos medidos (confirmar a tese).

## 14.8 FASE 4 — Features que faltavam: A / B / C (~3–5 semanas)
Só agora, sobre base estável. Ordem por valor/esforço (ref. comparativo V2):
- **A (frota/analytics, nascem em SQL):** A1 oficina/apreendidos (geofence), A3 ociosas >48h,
  A4 eficiência por zona, A2 relatório consolidado.
- **B (app):** B2 logout-tracker, B5 haptic, B6 atalhos AppSettings (caronas), B1 DebugScreen+Share,
  B3 notificações escalonadas, B4 SearchOverlay, B7 OTA (decidir Capgo × atual).
- **C (gestor legado):** reavaliar antes — Grafana/SPC Russo/inventário podem estar obsoletos.

## 14.9 NFS-e GREENFIELD no Supabase (trilha paralela)
Construir o módulo da Seção 13 **direto no Supabase** (não no Firebase). Re-mapeamento da casca
(a **lógica de negócio é a mesma**):
| Seção 13 (Firebase) | Versão Supabase |
|---|---|
| `verificarProcuracoes` (`onSchedule`) | **pg_cron** → Edge Fn (consulta API gov.br, atualiza `prestadores_fiscal`) |
| `emitirNFSe` (helper) | **Edge Function** `emitir-nfse` (monta DPS, assina, envia) — `montarDPS` igual (Seção 13.19) |
| Fila Cloud Tasks (`emitirNFSeWorker`) | **pgmq** (fila) + worker via **pg_cron**, com rate-limit/retry/idempotência |
| Gatilho `onDocumentUpdated` | **Trigger Postgres** em `pagamentos_semana` (status→`valor_aprovado`) → `pgmq.send` |
| Regras Firestore (13.20) | **RLS policies** (mesma lógica: dono edita campos auto-declarados; gestor/Service Role o resto) |
| Termo de aceite imutável | tabela `aceites_procuracao` com RLS `update/delete = false` |
| Certificado em Secret Manager | **Supabase Vault** (segredos) |
Pode ser construído em paralelo à Fase 2 (não depende do GPS).

## 14.10 Auth & usuários — migração de senha (decisão importante)
O hash de senha do Firebase (**scrypt** custom) **não importa direto** no GoTrue. Opções:
- **(Recomendado) Migração preguiçosa:** importar usuários sem senha; no 1º login, uma Edge Fn
  **verifica a senha contra o Firebase** (Admin SDK) e, se ok, **grava a senha no Supabase**.
  Transparente para o usuário; migra conforme as pessoas entram.
- **Reset em massa:** todos recebem "definir nova senha". Mais simples, porém atrito.
- Como muitos logins são por **CPF** (padrão V2 com e-mail derivado de CPF), avaliar reprovisionar.
Migrar também: `usuarios`↔`employee_profiles` (linkage Auth↔CPF), roles → claims/coluna + RLS.

## 14.11 Portões de validação (qualidade)
- **Shadow-compare** por módulo: mesma entrada nos dois → diff de saída = 0.
- **GPS:** comparação de pontos em campo (Seção 14.5) — portão duro.
- **Analytics:** conferir KPIs Supabase × painéis Firebase atuais.
- **Carga:** teste de volume no `ingest-gps` e na fila NF (2.500/sem).
- **Segurança:** suíte de testes de RLS (cada role só vê o que deve).

## 14.12 Riscos específicos da migração
| Risco | Mitigação |
|---|---|
| Regressão no GPS (app fechado) | GPS é o portão; dual-run + validação em campo antes de cortar |
| Perda/inconsistência de dados | Backfill idempotente + dual-run + reconciliação de contagens |
| Senhas não migram | Migração preguiçosa (14.10) |
| RLS mal configurada expõe dados | Suíte de testes de RLS por role antes do cutover |
| Ops de banco (tuning/índices/vacuum) | Sizing da instância + índices desde o schema; monitorar |
| Realtime com muitas conexões | Avaliar limites do plano; throttle de listeners |
| Janela de migração longa | Strangler permite entregar valor por módulo, sem big-bang |

## 14.13 Cronograma estimado
| Fase | Duração | Observação |
|---|---|---|
| 0 — Fundação | 2–3 sem | schema, RLS, Edge Fns, dual-run |
| 1 — GPS (portão) | 2–3 sem | inclui validação em campo |
| 2 — Operacional paridade | 4–6 sem | módulo a módulo |
| 3 — Backfill + cutover | 2–3 sem | decomissiona Firebase |
| 4 — Features A/B/C | 3–5 sem | sobre base estável |
| NFS-e (paralela) | 4–5 sem | greenfield, não bloqueia |
**Total: ~3–4 meses** (com a trilha NFS-e em paralelo). Congelar features grandes durante 1–3.

## 14.14 Checklist mestre
```
[ ] Projeto Supabase dev+prod (sa-east-1) + CLI/migrations + CI
[ ] Schema consolidado (V2 + operacional + fiscal) com RLS e índices
[ ] is_current_user_admin() + suíte de testes de RLS
[ ] Buckets de Storage + policies
[ ] pg_cron + pg_net + pgmq + Vault habilitados
[ ] Script de dual-run (espelho Firestore→Postgres)
[ ] Edge Fn ingest-gps + APK re-apontado + JWT Supabase
[ ] PORTÃO GPS validado em campo (minimizar/fechar/travar/reiniciar)
[ ] Módulos operacionais migrados, validados e com cutover
[ ] Auth/usuários migrados (migração preguiçosa de senha)
[ ] Backfill completo + reconciliação de contagens
[ ] 1 semana 100% Supabase sem regressão + custo medido
[ ] Firebase decomissionado + arquivos do Storage migrados
[ ] Features A/B/C + NFS-e greenfield entregues
```

---

# Seção 15 — SLOTS: convergência de modelo + roadmap de inteligência

> **Objetivo:** tornar o fluxo de slots **previsível, controlado e (depois) inteligente** — SEM bagunçar a migração. Princípio: **convergir o modelo → guardrails → inteligência**, nessa ordem. Não codar "inteligência" sobre base não-assentada.

## 15.1 Situação atual (16/06/2026)
Existem **dois sistemas de slots** coexistindo (achado durante a migração):

| | **A) SlotsModule** (zona/GoJet) | **B) SlotsTeamsModule** (escala) |
|---|---|---|
| Modelo | zonas Z1–Z6 (emoji), por turno/cargo | disponibilidade × dia × turno × função × feriado |
| Geração | automática 21h (demanda GoJet: déficit/ociosidade/bateria) | semi-automática (prévia a partir de disponibilidades declaradas) |
| Aceite | 1 slot = 1 aceitante | pool de candidatos + `slot_aceites` (gamificação: pontos/nível/streak/penalidades) |
| Uso | "não está em uso" (legado) | tela ativa, porém **vazia** (sem disponibilidades) |
| Supabase | portado (cron + RPCs + UI) | tabelas + leitura/geração/disponibilidade wiradas |

**Problema:** dois modelos, nenhum assentado, sem dado real → impossível ser "previsível" enquanto não convergir.

## 15.2 Caminho A — Unificar num só sistema
Um único motor de slots (base: o de **escala/disponibilidade**), consumindo a **demanda GoJet como insumo** (déficit/ociosidade por zona) + histórico.
- **Prós:** 1 fonte de verdade, 1 tela, 1 lógica; mais simples de manter e evoluir; a gamificação (engajamento dos prestadores) some o legado.
- **Contras:** exige fundir as duas lógicas (demanda automática + disponibilidade declarada) num motor só; migração de conceito maior; risco de regressão se feito às pressas.

## 15.3 Caminho B — Dois sistemas com papéis distintos
- **zona/GoJet** = tarefas operacionais reativas (scout/charger) dirigidas por demanda ao vivo.
- **escala** = turnos planejados por disponibilidade (perfil CLT/recorrente).
- **Prós:** cada um já existe e faz bem seu papel; menos refatoração; demanda ≠ planejamento são problemas realmente diferentes.
- **Contras:** dois lugares pra olhar; risco de sobreposição/duplicidade de slot pro mesmo prestador; UX fragmentada; dobro de manutenção.

## 15.4 Recomendação
**Caminho A (unificar), faseado** — mas só **depois** de assentar a migração. O sistema de **escala** é a base mais rica (disponibilidade + gamificação) e a **demanda GoJet vira um sinal de entrada** (já calculamos déficit/ociosidade por zona e gravamos `parking_history`). Resultado: 1 motor que combina *quem está disponível* × *onde há demanda* × *histórico*.

## 15.5 Guardrails (CONTROLE + PREVISIBILIDADE) — fazer primeiro, barato e de alto impacto
Independente do caminho, antes de qualquer "IA":
- **Janela de geração fixa** (ex.: 21h diário, +N dias de antecedência configurável) → previsível.
- **Tetos e mínimos** por zona/turno/função (cap de vagas) → controlado.
- **Override do gestor** (forçar/cancelar/ajustar vagas) com auditoria (`log_slots_auto`).
- **SLA de aceite** + reabertura automática (já existe `escalarSlotsSLA` a portar) → sem buraco.
- **Idempotência** (não duplicar slot do mesmo dia/turno/zona) — já implementado via `external_key`.
- **Status claros** e transições válidas (aberto→aceito→em_andamento→concluído / cancelado / reaberto).
- **Métricas de previsibilidade:** % preenchimento, antecedência média do aceite, variância de vagas dia-a-dia, taxa de reabertura, faltas/atrasos.

## 15.6 Inteligência (POR ÚLTIMO, dirigida por dados)
Com a base estável e dados fluindo:
- **Demanda:** déficit/ociosidade/bateria por zona (GoJet, já calculado) → quantas vagas e onde.
- **Histórico:** `parking_history`/`bike_history` → padrões por hora/dia/zona (sazonalidade).
- **Oferta:** disponibilidade declarada + confiabilidade do prestador (pontos/streak/faltas).
- **Alocação:** casar oferta×demanda priorizando confiabilidade e proximidade; sugerir (não impor) ao gestor.
- **Evolução:** começar heurístico (regras transparentes), medir, e só então considerar modelo preditivo.

## 15.7 Sequenciamento proposto
1. **Terminar a migração dos slots** (assentar modelo + paridade + cutover). 
2. **Decidir o caminho** (A unificar — recomendado).
3. **Guardrails** (15.5) — entrega previsibilidade/controle rápido.
4. **Coletar dados** algumas semanas (disponibilidade + GoJet + histórico).
5. **Inteligência** (15.6) incremental, medindo as métricas de 15.5.

> **Não** implementar 3–5 dentro da migração. Migração = paridade; melhoria = depois, sobre base estável.

## 15.8 Plano de execução — CAMINHO A (decidido) + guardrails/inteligência ASAP
**Decisão (16/06):** unificar no motor de **escala**; demanda GoJet vira **insumo**; guardrails (15.5) e inteligência (15.6) o quanto antes **após** a convergência.

**Fase 0 — Fechar a migração do motor de escala (paridade).** Pré-requisito.
- Completar o `SlotsTeamsModule` no Supabase: **aceite do operador** (`slot_aceites` + RPC `aceitar_escala`), `salvar` admin, abas **Ranking**/**Penalidades** (gamificação lê `slot_aceites`/`penalidades`/pontos).
- Portar `escalarSlotsSLA` (reabertura/escala de não-aceitos) p/ Edge Function + pg_cron.
- Validar fluxo: disponibilidade → prévia → confirmar → aceitar → check-in/out.

**Fase 1 — Convergência (unificar).** 
- Tornar o **gerador de escala o único** caminho do app; **aposentar a tela** `SlotsModule` (zona/GoJet) — sua lógica de demanda NÃO é descartada: vira sinal de entrada.
- **Demanda GoJet como insumo da escala:** reaproveitar o `statsPorZona` (déficit/ociosidade/bateria por zona Z1–Z6, já no `gerar-slots`) para **ajustar a quantidade de vagas** por zona/turno na geração da escala (`gerarPrevia` ganha um termo de demanda).
- Mapear zonas: a escala passa a conhecer as Z1–Z6 (hoje detectadas por emoji nos parkings) como dimensão.
- Desligar o `gerarSlotsAgendado` (Firebase) e o `gerar-slots` por-zona standalone (a demanda agora alimenta a escala, não gera slot próprio).

**Fase 2 — Guardrails (15.5).** Assim que a Fase 1 estabilizar: janela fixa, tetos/mínimos, override do gestor + auditoria, SLA, status, e o painel de **métricas de previsibilidade**.

**Fase 3 — Inteligência (15.6).** Com dados acumulando: oferta (disponibilidade + confiabilidade) × demanda (GoJet) × histórico (`parking_history`) → alocação **sugerida** ao gestor; heurístico transparente primeiro, medir, evoluir.

**Ordem firme:** Fase 0 (paridade) → Fase 1 (convergir) → Fase 2 (guardrails) → Fase 3 (inteligência). 2 e 3 começam **logo após** a 1, mas não antes.

---

# Seção 16 — MÓDULO GUARD (segurança/ocorrências): migração pendente do ESCRITOR

> **Para depois.** Documentado em 17/06/2026.

**Situação:** o módulo **Guard** (GuardDashboard/TelaGuard — seguranças registram ocorrências: foto + geo + dados) **ainda ESCREVE no Firebase (Firestore + Storage)**. Migramos só o **lado de leitura/analytics**: backfill único de `ocorrencias` → Supabase + PainelRoubos/PerdasSeg lendo das RPCs `analytics_ocorrencias`/`analytics_perdas`.

**Gap (importante):** como o Guard grava no Firestore e o analytics lê do Supabase (snapshot único), **ocorrências novas NÃO aparecem no analytics** → o Supabase fica desatualizado. Mesmo padrão "escritor no Firebase, leitor no Supabase" já resolvido em GoJet e Slots.

**Opções:**
1. **Migrar o escritor do Guard p/ Supabase (recomendado):** o registro de ocorrência passa a gravar em `public.ocorrencias` (Supabase). Analytics fica AO VIVO. *Caveat:* a foto sobe pro Firebase Storage (trilha deixada por último) → v1 grava a ocorrência no Supabase e **mantém a foto no Storage do Firebase** (só guarda a URL). Sem bloqueio.
2. Manter Guard no Firebase e **reverter PainelRoubos p/ ler do Firestore** (consistente, mas perde o SQL).
3. Sync contínuo Firestore→Supabase de `ocorrencias` (não recomendado).

**Recomendação:** Caminho 1 — porte do escritor (achar o ponto de registro de ocorrência no Guard → gravar em `ocorrencias` no Supabase atrás de flag; foto segue no Storage). Tabela `ocorrencias` já existe (migration 0008) com geo/registrado_por. Fecha o cutover do módulo de segurança (escrita + leitura no Supabase). Análogo aos portes de GoJet/Slots já feitos.

**Relacionado:** decidir a migração do **Firebase Storage** (fotos de ocorrências/turnos) — trilha própria, hoje adiada.

---

# Seção 17 — STATUS DA SESSÃO (18–19/06/2026): commits, deploy e pendências

> Snapshot do que foi entregue nesta sessão e o que falta. 15 commits (`39990ee..e8fb170`).

## 17.1 O que foi entregue (por frente)

**GPS em background no APK**
- `a601ae8` — projeto Android (Capacitor) + serviço nativo (`GpsTrackerService`/`Plugin`/`QueueDb`/`TokenManager`/`BootReceiver`) + Cloud Function `ingestGps`. Rastreio segue com app fechado/tela travada.
- `e0684b7` — captura pontual unificada (`capturarPosicaoUnica`) em turno/guard/appshell.

**LGPD**
- `dd18430` — `LgpdConsentGate` (termo + aceite imutável em `consentimentos_lgpd/{uid}_v{versao}`) + regra Firestore (create do dono, list gestão, update/delete negados). Plugado no `App.tsx` antes do permission gate.

**Migração Firebase → Supabase (strangler)**
- `42d1139` — libs frontend (`supabase`, `supabase-auth` dual-auth, `analytics/slots/escala-supabase`), 23 migrations, 6 edge functions, `mirror-ocorrencias` (dual-write Guard→Supabase), cutover de geração de slots (no-op no Firebase).
- `c3430ed` — `mirror.mjs` estendido: backfill de ocorrências Firestore→Supabase (rodado: **600 ocorrências**).

**NFS-e (campos no perfil)**
- `6a9a6c1` — aba "Nota Fiscal" no `TelaPrestadorPerfil` (cnpj, razão social, cpf_responsável, inscrição municipal, e-mail fiscal, nível gov.br) → `prestadores_fiscal/{uid}` + regra Firestore espelhando a RLS do Supabase.

**Guard — perdas como ocorrência (5a) — COMPLETO**
- `dbb301e` tipo `Perda` registrável (4 idiomas) · `c0de639` import histórico (planilha → **600 ocorrências `Perda`** no Supabase) · `4cb8def` relatório Telegram data-driven · `955f4e8` PDF data-driven + coluna Baterias · `e8fb170` aposenta o relatório de Perdas standalone (era PT-only/416 hardcoded e duplicava o envio das 7h).
- Resultado: perdas viraram ocorrência ao vivo (Supabase), em paridade com roubos, dentro do relatório Guard (Telegram + PDF, 4 idiomas). **Isso fecha parcialmente a Seção 16**: o `espelharOcorrenciaSupabase` (deployado) espelha ocorrências novas → analytics não fica mais stale.

**Infra/correções**
- `74a6dd9` — cap global `maxInstances:10` (ver [Seção 17.4]). `18e16f9` build deployável. `22ebe3e` docs. `49416ba` corrige comentário de horário (relatórios são **7h**, não 10h).

## 17.2 Estado de deploy (o que está no ar)
- ✅ **firestore:rules** deployado (regras de `prestadores_fiscal` e `consentimentos_lgpd` ativas).
- ✅ Functions do GPS/mirror/cutover/relatório-Perda no ar (deploy cirúrgico: `ingestGps`, `espelharOcorrenciaSupabase`, `gerarSlotsAgendado`, `relatorioGuardDiarioFn`, `relatorioGuardManualFn`).
- ✅ Backfill + import de perdas rodados (Supabase: 600 ocorrências + 600 perdas).

## 17.3 PENDÊNCIAS (ação do usuário no ambiente)
1. **Deletar** os 2 relatórios de perdas aposentados:
   `firebase functions:delete relatorioPerdasDiario relatorioPerdasSemanal --region southamerica-east1`
2. **Redeploy** dos relatórios Guard p/ ativar perdas data-driven:
   `firebase deploy --only functions:relatorioGuardDiarioFn,functions:relatorioGuardManualFn,functions:relatorioGuardSemanal,functions:enviarRelatorioManual`
3. **Supabase (#4):** `supabase db push` + deploy das edge functions + **validar o PORTÃO GPS em campo** (Seção 14.5.1). Depois Fase 2 (Auth/Usuários).
4. **Cap `maxInstances`** nas demais ~44 funções: aplicar em lotes OU após aumento de cota de CPU (ver 17.4).

## 17.4 Armadilha de cota (Cloud Run CPU, southamerica-east1)
`firebase deploy --only functions` (todas de uma vez) estoura **"Quota exceeded for total allowable CPU per project per region"** — ~60 funções 2ª gen recriadas juntas. Mitigado com `maxInstances:10` global. Quando a cota satura, vira deadlock (nem deploy de 1 função passa). **Saída:** deploy cirúrgico (poucas funções) OU aumentar a cota no GCP (IAM/Cotas → "Cloud Run Admin API: Total CPU allocation"). Falhas parciais **não derrubam** nada: a revisão anterior segue servindo.

## 17.5 Próximos passos
- **5c (em andamento):** vínculo/reconexão ao Telegram automatizado e simples.
- **5b (ADIADO):** relatório Guard por cidade → grupos Telegram específicos — fazer junto com **turnos/escala dos seguranças**, em outro momento.
- **NFS-e:** próximos passos do módulo (verificarProcuracoes, emissão) — campos do perfil já prontos.
- **Supabase:** seguir o roadmap da Seção 14.
