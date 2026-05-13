# Jet OS Firebase — Master Debrief
**Gerado em:** Maio 2026  
**Projeto:** jet-os-7 | Firebase Hosting + Firestore + Storage + Cloud Functions  
**Stack:** React + Vite + TypeScript + Leaflet + deck.gl | Node.js 22 Cloud Functions

---

## 1. STACK E INFRAESTRUTURA

### Projeto Firebase
- **Project ID:** `jet-os-7`
- **Account:** 3nr1k.ia@gmail.com
- **Bucket Storage:** `jet-os-7.firebasestorage.app`
- **URL produção:** https://jet-os-7.web.app
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

---

## 6. SEGURANÇA — ROLES

| Role | Permissões |
|---|---|
| `admin` | Tudo, incluindo gerenciar usuários |
| `gestor` | CRUD estações, zonas, analytics, locais operacionais |
| `viewer` | Só leitura |

**Regras Firestore:** verificam `role` via `get(/databases/.../documents/usuarios/$(request.auth.uid))`.

---

## 7. PROBLEMAS CONHECIDOS / PENDÊNCIAS

- [ ] Croquis em lote: integração com Storage para imagens (Mapbox free tier 50k/mês)
- [ ] Templates MX (croquis México)
- [ ] Tradução PT/ES/EN/RU
- [ ] Link TPU nas estações
- [ ] Vertex removal com dblclick inconsistente em mobile (usar contextmenu)
- [ ] Analytics: `loadRidesForDay` carrega arquivo inteiro mesmo para comparativos — considerar chunking para dias com muitas corridas
- [ ] Normalização Nominatim: 1 req/seg pode ser lento para muitas estações — considerar batch com delay

---

## 8. CHECKLIST ANTES DE CADA DEPLOY

```
[ ] npm run build roda sem erros TypeScript
[ ] Verificar que não há dois `export default` no mesmo arquivo
[ ] Verificar zIndex de novos modais vs overlays existentes
[ ] Se mudou Cloud Functions: firebase deploy --only functions primeiro
[ ] Se mudou regras Firestore: firebase deploy --only firestore:rules
[ ] Testar no mobile (wordBreak, overflow, touch events)
[ ] Confirmar que SW não intercepta novas chamadas externas
```
