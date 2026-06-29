# DEBRIEF — UX Overhaul (Jet OS)

**Data:** 2026-06-27  
**Commit:** `e1eaca9` — feat: UX overhaul — ConfirmDialog, ToastQueue, skeleton loaders, aria-labels, modal exclusivity  
**Autor:** Henrique + Claude Opus 4.6  
**Escopo:** 29 arquivos | +746 / -387 linhas

---

## 1. Resumo Executivo

Sessao de overhaul completo de UX no Jet OS. Foram eliminados todos os `alert()`, `window.confirm()` e `window.prompt()` nativos do navegador, substituidos por um sistema de toasts com fila (`ToastQueue`) e dialogos estilizados (`ConfirmDialog`/`PromptDialog`). Adicionados skeleton loaders a 5 paineis de dados, implementada exclusividade mutua entre todos os 29 paineis overlay via `closeAllPanels`/`openPanel`, adicionados `aria-label` a 37+ botoes icon-only, corrigido contraste de cores em KPIs, e adicionado CSS global para `focus-visible`, table striping, `sr-only`, altura minima de botao e breakpoint mobile 640px.

---

## 1.1 GoJet API — Referência Rápida

**Base URL:** `https://logistic.gojet.app`  
**CORS:** aberto (funciona direto do browser, sem auth)

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/v0/urent/cities` | GET | Lista cidades: `{id, name, timezone}` |
| `/api/v0/urent/parkings?city_id=X&page=N&limit=1000` | GET | Parkings paginado (estações) |
| `/api/v0/urent/bikes?city_id=X&page=N&limit=1000` | GET | Bikes paginado (6 páginas para SP) |
| `/api/v0/urent/techzones?city_id=X` | GET | Lista zonas técnicas: `{id, name}` (10 zonas SP) |
| `/api/v0/urent/techzones/{zone_id}` | GET | Detalhe zona: `{name, coordinates: [{lat,lon}...]}` — **polígono completo** |
| `/api/v0/ml/techzones/{zone_id}/activity?start=...&end=...` | GET | Aluguéis por ponto/hora: `[{parking_id, starts, finishes}]` |

**City IDs em produção:**
- Santo André: `67ab79f4cd4d3cbb07a0c02e`
- São Paulo: `669f89ebd06775867c31b984`
- Balneário Camboriú: `659410d8ec1dc43990626c21`

**Endpoints que NÃO existem:** `/rentals`, `/trips`, `/statistics` (404)

---

## 2. Componentes Novos

### `frontend/src/components/ui/ConfirmDialog.tsx`
- **ConfirmDialog** — Dialog modal estilizado para substituir `window.confirm()`. Props: `title`, `message`, `variant` (danger/warning/info), `confirmLabel`, `cancelLabel`. Suporta `onConfirm` async com estado `busy`. Fecha com Escape e click no overlay.
- **PromptDialog** — Dialog modal com input para substituir `window.prompt()`. Suporta `placeholder`, `defaultValue`, submit com Enter.
- **DialogProvider** — Context provider que renderiza o dialog ativo. Montado no `App.tsx`.
- **confirmDialog(title, message?, opts?)** — Funcao imperativa, retorna `Promise<boolean>`.
- **promptDialog(title, opts?)** — Funcao imperativa, retorna `Promise<string | null>`.
- Acessibilidade: `role="dialog"`, `aria-modal="true"`, `aria-label={title}`, focus automatico no botao/input.

### `frontend/src/components/ui/ToastQueue.tsx`
- **ToastProvider** — Provider que renderiza fila de ate 5 toasts empilhados no bottom-center.
- **showToastGlobal(msg, tipo?, acao?)** — Funcao imperativa global. Tipos: `success`, `error`/`erro`, `warn`, `info`. Timeout: 4s (info/success/warn) ou 6s (error). Suporta botao de acao opcional.
- Acessibilidade: container com `role="status"` e `aria-live="polite"`. Botao fechar com `aria-label="Fechar"`.

### `frontend/src/components/ui/Skeleton.tsx`
- **SkeletonLine** — Barra pulsante (width/height configuraveis).
- **SkeletonCard** — Card com N linhas skeleton (default 3).
- **SkeletonTable** — Tabela skeleton com N linhas x M colunas.
- **SkeletonPulseStyle** — Injeta `@keyframes skel-pulse` no DOM.

---

## 3. Substituicoes em Massa

### alert() → showToastGlobal()
~28 substituicoes em 18 arquivos:

| Arquivo | Qty |
|---------|-----|
| `AnalyticsManager.tsx` | 3 |
| `DashboardManager.tsx` | 3 |
| `TelaGuard.tsx` | 2 |
| `TelaPrestadorPerfil.tsx` | 2 |
| `UsuariosManager.tsx` | 1 |
| `ZonasManager.tsx` | 1 |
| `CidadesExpansao.tsx` | 1 |
| `AppShell.tsx` | 1 |
| `BugReportButton.tsx` | 1 |
| `CandidatosManager.tsx` | 2 |
| `FotoCaptura.tsx` | 1 |
| `FotoMedidas.tsx` | 1 |
| `GestorLogisticaPanel.tsx` | 2 |
| `LocaisFinanceiro.tsx` | 2 |
| `MapaHelpers.tsx` | 1 |
| `PagamentosModule.tsx` | 1 |
| `SlotsTeamsModule.tsx` | 1 |
| `TelaMapa.tsx` | 4 |

### window.confirm() → confirmDialog()
~13 substituicoes nos arquivos: `CandidatosManager.tsx`, `GestorLogisticaPanel.tsx`, `LocaisFinanceiro.tsx`, `MapaHelpers.tsx`, `POIPanel.tsx`, `PagamentosModule.tsx`, `SlotsTeamsModule.tsx`, `StreetViewModal.tsx`, `TelaPrestadorPerfil.tsx`, `TelegramVinculo.tsx`.

### window.prompt() → promptDialog()
~3 substituicoes nos arquivos: `GoJetDashboard.tsx`, `ShiftPanel.tsx`, `POIPanel.tsx`.

---

## 4. Acessibilidade

### aria-labels adicionados (~37+)
Botoes icon-only que tinham apenas emoji como conteudo agora possuem `aria-label` descritivo. Arquivos principais:
- `TelaMapa.tsx` — Usuarios, Configuracoes, Notificacoes, Perfil, Sair, FABs (addLocal, zonas, parkings, etc.)
- `AppShell.tsx` — Botoes de navegacao
- `LocaisFinanceiro.tsx` — Botoes de acao em tabela
- `MapaHelpers.tsx` — Controles do mapa
- `CandidatosManager.tsx` — Acoes em lista

### focus-visible
Regra global em `main.tsx`: `:focus-visible { outline: 2px solid #307FE2; outline-offset: 2px; }` — garante anel de foco visivel para navegacao por teclado sem afetar cliques.

### sr-only
Classe `.sr-only` adicionada globalmente para conteudo acessivel a screen readers mas oculto visualmente.

### Dialogs
- `role="dialog"` e `aria-modal="true"` em ConfirmDialog e PromptDialog
- Focus automatico no botao de confirmacao (ConfirmDialog) ou input (PromptDialog)
- Escape fecha o dialog

### Toasts
- Container com `role="status"` e `aria-live="polite"` — screen readers anunciam novos toasts

---

## 5. Contraste de Cores

Cores de texto dos KPIs no header do mapa foram ajustadas para melhor contraste:

| Elemento | Antes | Depois | Ratio |
|----------|-------|--------|-------|
| KPI labels (Ativas, Ocorrencias) | `#4a5a7a` | `#7a8ba8` | ~4.5:1 vs fundo escuro |
| Textos secundarios diversos | `#64748b` | `#8a96b0` | ~4.5:1 vs fundo escuro |

---

## 6. Exclusividade de Modais

### Padrao `closeAllPanels` / `openPanel` em `TelaMapa.tsx`

Problema anterior: usuario podia abrir multiplos paineis overlay simultaneamente, causando sobreposicao e confusao visual.

Solucao: funcao `closeAllPanels()` que zera todos os 29 estados de painel, e funcao `openPanel(setter)` que chama `closeAllPanels()` antes de ativar o painel desejado. Botoes toggle agora usam `panel ? setSetter(false) : openPanel(setSetter)`.

### Paineis gerenciados (29):
1. `showNotif` — Notificacoes
2. `usuariosModulo` — Gestao de Usuarios
3. `painelConfig` — Configuracoes
4. `guiaModulo` — Guia/Manual
5. `dashboardModulo` — Dashboard
6. `analyticsModulo` — Analytics
7. `slotsModulo` — Slots
8. `turnoRegistro` — Registro de Turno
9. `gojetAnalytics` — GoJet Analytics
10. `gojetDash` — GoJet Dashboard
11. `financeiro` — Financeiro
12. `showPerfilPrestador` — Perfil Prestador
13. `cidadeModal` — Seletor de Cidade
14. `guardModulo` — Guard (registro de ocorrencia)
15. `guardDash` — Guard Dashboard
16. `logisticaModulo` — Logistica
17. `gestorLogistica` — Gestor Logistica
18. `pagamentosOpen` — Pagamentos (prestador)
19. `pagamentosAdminOpen` — Pagamentos Admin
20. `shiftPanel` — Painel de Turno
21. `showWorkers` — Workers/Prestadores no mapa
22. `painelRoubos` — Painel de Roubos
23. `painelPerdas` — Painel de Perdas
24. `tarefasLogistica` — Tarefas Logistica
25. `candidatosModulo` — Candidatos
26. `zonasModulo` — Zonas
27. `cidadesExpShow` — Cidades Expansao
28. `novaOcorrencia` — Nova Ocorrencia
29. (+ sub-menus: showLocaisOp, showPOIsFab)

---

## 7. Skeleton Loaders

5 paineis receberam skeleton loading state:

| Painel | Componente Skeleton | Descricao |
|--------|---------------------|-----------|
| `AnalyticsManager.tsx` | `SkeletonCard` (grid 2x2) | 4 cards skeleton enquanto carrega dados analytics |
| `DashboardManager.tsx` | `SkeletonTable` (6x4) | Tabela skeleton durante carga do dashboard |
| `UsuariosManager.tsx` | `SkeletonTable` (6x4) | Tabela skeleton durante carga da lista de usuarios |
| `GestorLogisticaPanel.tsx` | `SkeletonTable` (6x4) | Tabela skeleton na carga do painel de gestao logistica |
| `PagamentosModule.tsx` | `SkeletonTable` (6x4) x2 | Tabelas skeleton para historico e resumo de pagamentos |

---

## 8. CSS Global (`main.tsx`)

Adicoes ao bloco de estilos globais injetados em `main.tsx`:

```css
/* Altura minima de botao para touch targets */
button { cursor: pointer; min-height: 36px; }

/* Anel de foco para navegacao por teclado */
:focus-visible { outline: 2px solid #307FE2; outline-offset: 2px; }

/* Zebra striping em tabelas */
table tr:nth-child(even) td { background: rgba(255,255,255,.02); }
table tr:hover td { background: rgba(255,255,255,.04); }

/* Breakpoint mobile 640px */
@media (max-width: 640px) {
  .jet-header-desktop { display: none !important; }
  .jet-fab-group { bottom: 70px !important; }
}

/* Screen-reader only */
.sr-only { position: absolute; width: 1px; height: 1px; ... }
```

---

## 9. Responsividade Mobile

### `jet-header-desktop`
Classe aplicada ao header desktop complexo. Escondida abaixo de 640px via media query global. (Nota: a classe foi definida mas a aplicacao ao header depende de refactor futuro — ver Pendencias.)

### `jet-fab-group`
Classe aplicada ao container de FABs em `TelaMapa.tsx`. Abaixo de 640px, `bottom` e ajustado para 70px para nao sobrepor a barra de navegacao mobile.

---

## 10. Pendencias UX Futuras

| Pendencia | Motivo | Prioridade |
|-----------|--------|------------|
| Menu hamburger mobile | Header atual tem botoes demais com logica condicional complexa (role-based). Refactor arriscado sem testes E2E. | Alta |
| Reducao de FABs 15→5 | Parcialmente feito com sub-menus `showLocaisOp`/`showPOIsFab`. Ainda restam ~10 FABs visiveis. | Media |
| Skeleton nos paineis restantes | Apenas 5 dos ~29 paineis tem skeleton. Faltam: Guard, Slots, Financeiro, etc. | Media |
| Indicadores de sort em tabelas | Nenhuma tabela mostra seta de direcao de ordenacao. | Baixa |
| Auditoria de touch targets (44px min) | `min-height: 36px` global ajuda mas nao garante 44px em todos os botoes. Precisa auditoria manual. | Media |
| Temas claro/escuro | App e dark-only. Tema claro nao esta previsto mas pode ser pedido. | Baixa |
| Testes E2E para dialogs | ConfirmDialog/PromptDialog nao tem testes automatizados. | Media |

---

## 11. Arquivos Modificados (29)

| # | Arquivo | Descricao |
|---|---------|-----------|
| 1 | `AnalyticsManager.tsx` | alert→toast, skeleton loader, aria-labels |
| 2 | `App.tsx` | Montagem de DialogProvider e ToastProvider |
| 3 | `CidadesExpansao.tsx` | alert→toast |
| 4 | `DashboardManager.tsx` | alert→toast, skeleton loader |
| 5 | `TelaGuard.tsx` | alert→toast, confirm→confirmDialog |
| 6 | `TelaPrestadorPerfil.tsx` | alert→toast, confirm→confirmDialog |
| 7 | `TelegramVinculo.tsx` | confirm→confirmDialog |
| 8 | `UsuariosManager.tsx` | alert→toast, skeleton loader |
| 9 | `ZonasManager.tsx` | alert→toast |
| 10 | `components/AppShell.tsx` | alert→toast, aria-labels |
| 11 | `components/BugReportButton.tsx` | alert→toast |
| 12 | `components/CandidatosManager.tsx` | alert→toast, confirm→confirmDialog, aria-labels |
| 13 | `components/FotoCaptura.tsx` | alert→toast |
| 14 | `components/FotoMedidas.tsx` | alert→toast |
| 15 | `components/GestorLogisticaPanel.tsx` | alert→toast, confirm→confirmDialog, skeleton loader |
| 16 | `components/GoJetDashboard.tsx` | prompt→promptDialog |
| 17 | `components/LocaisFinanceiro.tsx` | alert→toast, confirm→confirmDialog, aria-labels |
| 18 | `components/MapaHelpers.tsx` | alert→toast, confirm→confirmDialog, aria-labels |
| 19 | `components/POIPanel.tsx` | confirm→confirmDialog, prompt→promptDialog |
| 20 | `components/PagamentosModule.tsx` | alert→toast, confirm→confirmDialog, skeleton loader |
| 21 | `components/PainelRoubos.tsx` | alert→toast |
| 22 | `components/ShiftPanel.tsx` | prompt→promptDialog |
| 23 | `components/SlotsTeamsModule.tsx` | alert→toast, confirm→confirmDialog |
| 24 | `components/StreetViewModal.tsx` | confirm→confirmDialog |
| 25 | `components/ui/ConfirmDialog.tsx` | **NOVO** — ConfirmDialog, PromptDialog, DialogProvider |
| 26 | `components/ui/Skeleton.tsx` | **NOVO** — SkeletonLine, SkeletonCard, SkeletonTable |
| 27 | `components/ui/ToastQueue.tsx` | **NOVO** — ToastProvider, showToastGlobal |
| 28 | `main.tsx` | CSS global: focus-visible, table striping, sr-only, min-height, mobile |
| 29 | `views/TelaMapa.tsx` | closeAllPanels/openPanel, alert→toast, aria-labels, cor contraste, jet-fab-group |

---

## 12. Como Testar

### Build
```bash
cd frontend
npm run build
```
Deve compilar sem erros TypeScript.

### Dev
```bash
npm run dev
```

### Verificacoes manuais

1. **Toasts** — Realizar qualquer acao que antes gerava `alert()` (ex: tentar salvar zona sem pontos). Deve aparecer toast estilizado no bottom-center, nao alert nativo.

2. **ConfirmDialog** — Tentar excluir uma estacao, zona ou usuario. Deve aparecer dialog estilizado com botoes Confirmar/Cancelar, nao `window.confirm()` nativo. Testar Escape para fechar.

3. **PromptDialog** — Em GoJet Dashboard ou ShiftPanel, acionar acao que pedia `window.prompt()`. Deve aparecer dialog com input estilizado.

4. **Exclusividade de modais** — Abrir Dashboard, depois clicar em Analytics. Dashboard deve fechar automaticamente. Nenhum painel deve sobrepor outro.

5. **Skeleton loaders** — Abrir AnalyticsManager (deve mostrar 4 cards pulsantes), DashboardManager, UsuariosManager, GestorLogisticaPanel, PagamentosModule (deve mostrar tabela skeleton antes dos dados carregarem).

6. **aria-labels** — Inspecionar botoes icon-only (emoji) no DevTools. Devem ter `aria-label` descritivo. Ou usar screen reader (NVDA/VoiceOver) para navegar o header.

7. **Focus-visible** — Navegar com Tab pelo header. Botoes devem mostrar anel azul `#307FE2`.

8. **Contraste** — Verificar KPIs no header (Ativas, Ocorrencias). Texto deve ser `#7a8ba8`, nao `#4a5a7a`.

9. **Mobile** — Redimensionar janela abaixo de 640px. FABs devem subir (`bottom: 70px`).

---

## §20 — GoJet Zones, Cidades Dinâmicas & Auto-Scraper (2026-06-28)

### 20.1 GoJet Cidades Dinâmicas
- **`GoJetCidadesPanel.tsx`**: Dropdown de cidades agora carrega de 3 fontes Supabase (`estacoes_geo`, `estacoes`, `usuarios`) + fallback com 10 cidades brasileiras. Antes só consultava `estacoes_geo` e mostrava apenas Balneário Camboriú.
- Mesmo padrão aplicado anteriormente em `TelegramConfigPanel.tsx` e `UsuariosManager.tsx`.

### 20.2 Zones/Geofences GoJet
- **Migration `0080`**: Adicionadas colunas `zones jsonb` e `total_zones int` ao `gojet_snapshots`.
- **`gojet-scraper.ts`**: `fetchZones(cityId)` busca endpoint `/zones` da API GoJet. `scraperGoJetBrowser` agora retorna `totalZones` e salva em `gojet_snapshots` (row `zones_latest_{cityId}`).
- **`GoJetOverlay.tsx`**: Novo state `zones[]` + `showZones` toggle. Zones renderizadas como `L.polygon` com cor, opacidade 12%, e popup com nome. Toggle "Zonas (N)" aparece no dashboard quando há zones.
- **`automacao-gojet/index.ts`** (Edge Function): `runScraper` agora busca zones para cada cidade ativa em `gojet_config` e salva no `gojet_snapshots`.

### 20.3 Auto-Scraper (Browser)
- **`GoJetOverlay.tsx`**: Novo `useEffect` de auto-scraping. Quando overlay visível e não é APK nativo:
  - Primeiro scrape 30s após montar (tempo para carregar snapshot salvo)
  - Repete a cada 15 minutos via `setInterval`
  - Usa `scraperGoJetBrowser` (fetch direto pela API GoJet com CORS aberto)
  - Atualiza snapshot no Supabase e recarrega dados locais
  - Desativado no APK Capacitor (`isNativeApp()`) pois CORS bloqueia
- **Cron server-side existente**: `automacao-gojet-15min` (pg_cron a cada 15min) já rodava o scraper pela Edge Function. Agora também busca zones.
- **Fluxo completo**: Browser faz scraping a cada 15min (dados mais frescos, por city_id), Edge Function cron faz scraping server-side a cada 15min (backup, todas as cidades), GoJetOverlay recarrega snapshot do Supabase a cada 5min.

### 20.4 Arquivos Alterados
| Arquivo | Mudança |
|---|---|
| `frontend/src/components/GoJetCidadesPanel.tsx` | Cidades dinâmicas multi-fonte |
| `frontend/src/components/GoJetOverlay.tsx` | Zones layer + auto-scraper 15min |
| `frontend/src/lib/gojet-scraper.ts` | Fix `.catch()` → `.then()` (TS compat) |
| `supabase/functions/automacao-gojet/index.ts` | Zones fetch per city |
| `supabase/migrations/0080_gojet_snapshots_zones_column.sql` | Colunas zones/total_zones |

---

## §21. Plano: Fluxo Inteligente de Scouts (Bike Tracking + Verificação GoJet)

**Data:** 2026-06-29  
**Status:** PLANO — aguardando aprovação para implementar  
**Origem:** Análise do sistema de automação atual + requisitos do usuário + padrões do jet-analise.vercel.app

---

### 21.1 Contexto e Gaps Identificados

O sistema atual (`automacao-tarefas/index.ts`) gera tarefas e slots, faz SLA escalation, e notifica via Telegram. Porém NÃO cobre:

| # | Gap | Impacto |
|---|-----|---------|
| G1 | Bike pode ser alugada durante transporte pelo scout | Tarefa impossível, scout perde tempo |
| G2 | Scout pode registrar bike inexistente na base | Fraude ou erro, sem validação |
| G3 | Sem cruzamento GPS scout × GPS bike | Não detecta se scout está longe da bike |
| G4 | Scout não pode trocar bike durante turno | Se bike dá problema, fica travado |
| G5 | Sem verificação GoJet pós-entrega | Não confirma se a bike realmente chegou |
| G6 | Monitor único (sem distinção dia/noite) | Thresholds fixos para turnos com demanda diferente |
| G7 | Atribuição sem considerar proximidade | Scout distante recebe tarefa perto de outro |

**Referência jet-analise.vercel.app:** Já implementa G5 (verificação GoJet 5min pós-conclusão), source/destination com raio, rota OSRM com ETA. Esses padrões serão portados.

---

### 21.2 Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 1: GERAÇÃO DE TAREFAS (já existe, melhorar)        │
│  automacao-gojet → detecta déficit → gera tarefa            │
│  + NOVO: origem/destino inteligente (nearest excess/empty)  │
│  + NOVO: bike IDs alvo específicos na tarefa                │
│  + NOVO: rota OSRM com ETA estimado                         │
│  + NOVO: thresholds dia/noite por monitor_config            │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 2: ATRIBUIÇÃO (melhorar)                            │
│  gerar-slots-inteligente → round-robin                      │
│  + NOVO: ST_Distance → scout mais próximo do ponto origem   │
│  + NOVO: push com bike IDs + rota + ETA                     │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 3: COLETA — NOVO                                    │
│  Scout registra bike_id (scan/manual)                       │
│  → Validação: bike existe na API GoJet?                     │
│  → Validação: GPS scout ~500m do GPS bike?                  │
│  → Validação: bike status != renting/reserved?              │
│  → Se inválido: rejeita + alerta gestor                     │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 4: TRANSPORTE — NOVO (Edge Fn cron 5min)            │
│  bike-guard: monitora bikes vinculadas a tarefas ativas     │
│  → Se bike.status mudou para renting → push ao scout        │
│  → Scout pode: trocar bike / descarregar / cancelar sub     │
│  → GPS tracking contínuo: scout.pos vs rota esperada        │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 5: VERIFICAÇÃO PÓS-ENTREGA — NOVO                  │
│  gojet-verify: 5min após conclusão                          │
│  → Checa GoJet: parking bikes_count aumentou?               │
│  → 35min sem confirmação → marca ⚠️ fail + alerta gestor   │
│  → Confirmado → marca ✅ badge GoJet OK                     │
│  (padrão portado do jet-analise.vercel.app)                 │
└─────────────────────────────────────────────────────────────┘
```

---

### 21.3 Migrations (6 novas)

#### M1: `0090_tarefas_bike_tracking.sql` — Colunas de bike tracking na tarefa
```sql
-- Nota: delivered_count, prioridade, parking_id, parking_lat/lng JÁ EXISTEM (migration 0060)
ALTER TABLE public.tarefas_logistica
  ADD COLUMN IF NOT EXISTS bike_ids         TEXT[],        -- bikes alvo da tarefa (array de identifiers)
  ADD COLUMN IF NOT EXISTS bike_id_atual    TEXT,          -- bike que o scout está transportando AGORA
  ADD COLUMN IF NOT EXISTS parking_destino  TEXT,          -- parking de destino (parking_id já é a origem)
  ADD COLUMN IF NOT EXISTS destino_lat      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destino_lng      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destino_nome     TEXT,
  ADD COLUMN IF NOT EXISTS rota_osrm        JSONB,         -- {distance_m, duration_s, geometry}
  ADD COLUMN IF NOT EXISTS eta_minutos      INT,           -- tempo estimado em minutos
  ADD COLUMN IF NOT EXISTS gojet_verified   BOOLEAN,       -- NULL=pendente, true=ok, false=fail
  ADD COLUMN IF NOT EXISTS gojet_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificacao_tentativas INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tarefas_bike_atual ON public.tarefas_logistica(bike_id_atual)
  WHERE bike_id_atual IS NOT NULL;
```

#### M2: `0091_bike_swap_log.sql` — Log de trocas de bike durante turno
```sql
CREATE TABLE IF NOT EXISTS public.bike_swap_log (
  id          BIGSERIAL PRIMARY KEY,
  tarefa_id   UUID REFERENCES public.tarefas_logistica(id),
  uid_scout   UUID REFERENCES public.usuarios(id),
  bike_id_old TEXT NOT NULL,
  bike_id_new TEXT NOT NULL,
  motivo      TEXT,  -- 'alugada', 'defeito', 'bateria', 'manual'
  gps_scout   JSONB, -- {lat, lon} no momento da troca
  gps_bike    JSONB, -- {lat, lon} da bike no GoJet
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bike_swap_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY bsl_sel ON public.bike_swap_log FOR SELECT TO authenticated USING (true);
CREATE POLICY bsl_ins ON public.bike_swap_log FOR INSERT TO authenticated WITH CHECK (true);
```

#### M3: `0092_bike_validation_log.sql` — Log de validações (fantasma, GPS diverge)
```sql
CREATE TABLE IF NOT EXISTS public.bike_validation_log (
  id          BIGSERIAL PRIMARY KEY,
  tarefa_id   UUID,
  uid_scout   UUID,
  bike_id     TEXT NOT NULL,
  tipo        TEXT NOT NULL, -- 'fantasma', 'gps_diverge', 'alugada', 'ok'
  detalhes    JSONB,         -- {gps_scout, gps_bike, distancia_m, status_gojet}
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bike_validation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY bvl_sel ON public.bike_validation_log FOR SELECT TO authenticated USING (true);
CREATE POLICY bvl_ins ON public.bike_validation_log FOR INSERT TO authenticated WITH CHECK (true);
```

#### M4: `0093_monitor_config_dia_noite.sql` — Thresholds dia/noite
```sql
ALTER TABLE public.monitor_config
  ADD COLUMN IF NOT EXISTS m1_dia  INT,  -- threshold M1 diurno (default usa m1 existente)
  ADD COLUMN IF NOT EXISTS m2_dia  INT,
  ADD COLUMN IF NOT EXISTS m3_dia  INT,
  ADD COLUMN IF NOT EXISTS m1_noite INT, -- threshold M1 noturno
  ADD COLUMN IF NOT EXISTS m2_noite INT,
  ADD COLUMN IF NOT EXISTS m3_noite INT;
-- Se NULL, usa o valor de m1/m2/m3 (retrocompatível)
```

#### M5: `0094_gojet_verify_queue.sql` — Fila de verificação pós-entrega
```sql
CREATE TABLE IF NOT EXISTS public.gojet_verify_queue (
  id            BIGSERIAL PRIMARY KEY,
  tarefa_id     UUID REFERENCES public.tarefas_logistica(id),
  parking_id    TEXT NOT NULL,
  bikes_count_before INT,  -- bikes no parking antes da entrega
  bikes_count_after  INT,  -- bikes no parking depois (quando verificado)
  status        TEXT NOT NULL DEFAULT 'pendente', -- pendente | ok | fail | timeout
  tentativas    INT DEFAULT 0,
  max_tentativas INT DEFAULT 7,  -- 7×5min = 35min
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  verificado_em TIMESTAMPTZ
);
ALTER TABLE public.gojet_verify_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY gvq_sel ON public.gojet_verify_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY gvq_svc ON public.gojet_verify_queue FOR ALL TO service_role USING (true);
```

#### M6: `0095_rpc_nearest_scout.sql` — Função para scout mais próximo
```sql
CREATE OR REPLACE FUNCTION public.nearest_available_scout(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_cidade TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE(uid UUID, nome TEXT, distancia_m DOUBLE PRECISION) AS $$
  SELECT u.id AS uid, u.nome,
         ST_Distance(
           u.ultima_pos::geography,
           ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
         ) AS distancia_m
  FROM public.usuarios u
  WHERE u.role IN ('campo', 'prestador')
    AND u.cidade = p_cidade
    AND u.ultima_pos IS NOT NULL
    AND u.id NOT IN (
      SELECT assignee_uid FROM public.tarefas_logistica
      WHERE status IN ('em_andamento') AND assignee_uid IS NOT NULL
    )
  ORDER BY distancia_m
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;
```

---

### 21.4 Edge Functions (3 novas/modificadas)

#### EF1: `bike-guard/index.ts` — Watcher de bikes em transporte (cron 5min)
**Ações:**
1. Lê `tarefas_logistica` com `status = 'em_andamento'` e `bike_id_atual IS NOT NULL`
2. Para cada tarefa, consulta GoJet API: `/bikes?identifier={bike_id_atual}`
3. Se bike `status = 'renting'` ou `reserved`:
   - Push Telegram ao scout: "⚠️ Bike {id} foi alugada! Troque a bike ou cancele."
   - Insere em `bike_validation_log` tipo='alugada'
4. Se bike não encontrada na API:
   - Marca tipo='fantasma' no `bike_validation_log`
   - Alerta gestor
5. Cruza GPS: `usuarios.ultima_pos` do scout vs bike GPS do GoJet
   - Se distância > 500m e tarefa em andamento há >10min: alerta 'gps_diverge'

#### EF2: `gojet-verify/index.ts` — Verificação pós-entrega (cron 5min)
**Ações (portado do jet-analise.vercel.app):**
1. Lê `gojet_verify_queue` com `status = 'pendente'`
2. Para cada item, checa se `criado_em + 5min < now()` (espera 5min antes de verificar)
3. Consulta GoJet API: `/parkings?id={parking_id}` → `available_bikes_count`
4. Se `bikes_count_after > bikes_count_before`:
   - Marca `status = 'ok'`, atualiza `tarefas_logistica.gojet_verified = true`
5. Se não melhorou e `tentativas < max_tentativas`:
   - Incrementa tentativas, tenta novamente em 5min
6. Se `tentativas >= max_tentativas` (35min):
   - Marca `status = 'fail'`, `tarefas_logistica.gojet_verified = false`
   - Alerta gestor via Telegram

#### EF3: Modificar `automacao-tarefas/index.ts` — Nova action `validar-bike`
**Ações (chamada pelo app do scout ao registrar bike):**
1. Recebe: `{tarefa_id, bike_id, gps_scout: {lat, lon}}`
2. Busca bike na API GoJet: existe? qual status? qual GPS?
3. Validações:
   - **Fantasma:** bike não existe → `{valido: false, motivo: 'fantasma'}`
   - **Alugada:** status renting/reserved → `{valido: false, motivo: 'alugada', sugestao: bikes próximas}`
   - **GPS diverge:** distância scout↔bike > 500m → `{valido: false, motivo: 'gps_diverge', distancia_m}`
   - **OK:** tudo certo → `{valido: true}`, atualiza `tarefas_logistica.bike_id_atual`
4. Loga em `bike_validation_log`

---

### 21.5 Modificações no Frontend

#### F1: `TarefasLogisticaModule.tsx` — Cards com bike info
- Mostrar `bike_id_atual` no card da tarefa
- Badge GoJet: ✅ verificado / ⚠️ falhou / ⏳ pendente
- Indicador de troca de bike (swap count)
- Botão "Ver rota" que abre mapa com polyline OSRM

#### F2: Novo componente `BikePickupFlow.tsx` — Fluxo de coleta
- Scout digita/scana o código da bike
- Chama `validar-bike` → mostra resultado
- Se inválido: mostra motivo + sugestões (bikes próximas disponíveis)
- Se válido: confirma e inicia transporte

#### F3: Novo componente `BikeSwapDialog.tsx` — Troca de bike
- Acessível durante tarefa em andamento
- Motivos: alugada, defeito, bateria baixa, outro
- Registra em `bike_swap_log` + atualiza `bike_id_atual`

#### F4: Modificar `MonitorConfigPanel.tsx` — Thresholds dia/noite
- Tabs "Dia" / "Noite" dentro de cada M1/M2/M3
- Se noite não preenchido, mostra "usa valor diurno" como placeholder

---

### 21.6 Fluxo Completo do Scout (cenários)

**Cenário A — Fluxo feliz:**
1. Scraper detecta parking vazio → gera tarefa com bike IDs alvo + parking destino
2. `nearest_available_scout()` atribui ao scout mais próximo
3. Scout recebe push com rota OSRM + ETA
4. Scout vai ao ponto, escaneia bike → `validar-bike` = OK
5. Scout transporta → `bike-guard` monitora a cada 5min
6. Scout entrega no destino + foto → entra na `gojet_verify_queue`
7. 5min depois: `gojet-verify` confirma bikes_count++ → ✅

**Cenário B — Bike alugada durante transporte:**
1. Steps 1-4 iguais
2. `bike-guard` detecta bike mudou para `renting` → push ao scout
3. Scout abre `BikeSwapDialog` → escolhe bike substituta → `validar-bike`
4. `bike_swap_log` registra troca, `bike_id_atual` atualizado
5. Scout continua transporte com nova bike

**Cenário C — Bike fantasma:**
1. Scout escaneia bike → `validar-bike` busca na API GoJet
2. Bike não encontrada → rejeita + loga em `bike_validation_log`
3. Scout tenta outra bike

**Cenário D — GPS diverge (possível fraude):**
1. Scout registra bike mas GPS scout está a 2km do GPS da bike
2. `validar-bike` retorna `gps_diverge` com distância
3. Flag para gestor revisar antes de aprovar pagamento

**Cenário E — Drop parcial (descarregar no caminho):**
1. Scout transporta 3 bikes, entrega 1 no parking intermediário
2. `delivered_count++`, foto + GPS registrados
3. `gojet_verify_queue` entra para o parking intermediário
4. Scout continua com as 2 restantes

---

### 21.7 Prioridade de Implementação

| Fase | O quê | Migrations | Edge Fns | Frontend | Esforço |
|------|--------|-----------|----------|----------|---------|
| **F1** | Schema + validar-bike | M1, M2, M3 | EF3 | F2 | 1 sessão |
| **F2** | Bike Guard + Swap | — | EF1 | F3 | 1 sessão |
| **F3** | GoJet Verify | M5 | EF2 | F1 (badges) | 1 sessão |
| **F4** | Proximity + OSRM | M6 | mod EF existente | — | 0.5 sessão |
| **F5** | Monitor dia/noite | M4 | — | F4 | 0.5 sessão |

**Total estimado: 4 sessões de implementação.**

---

### 21.8 Dependências Externas

| Dependência | Status | Nota |
|-------------|--------|------|
| GoJet API `/bikes` | ✅ Funciona do browser (CORS aberto) | Cloudflare bloqueia server-side; Edge Fn precisa proxy ou user-agent trick |
| GoJet API `/parkings` | ✅ Funciona | Idem |
| OSRM routing | ✅ API pública `router.project-osrm.org` | Sem rate limit duro, mas sem SLA |
| PostGIS `ST_Distance` | ✅ Disponível no Supabase | Já usado em outras partes |
| `usuarios.ultima_pos` | ✅ Populado pelo `ingest-gps` | Atualizado pelo APK a cada batch |
| Tabela `zones` | ✅ Schema criado (migration 0082) | Dados precisam ser importados via CSV |

---

### 21.9 Padrões Portados do jet-analise.vercel.app

| Padrão | Origem (jet-analise) | Destino (JET OS) |
|--------|---------------------|------------------|
| Verificação GoJet pós-entrega | `gojetBadge()` — 5min wait, check bikes_count, 35min timeout | `gojet-verify` Edge Fn + `gojet_verify_queue` |
| Source/Destination com raio | `nearestExcess()` / `nearestEmpty()` | Lógica em `gerarTarefasGojet` + campo `parking_origem`/`parking_destino` |
| Rota OSRM com ETA | `calcularRota()` via `router.project-osrm.org` | Campo `rota_osrm` + `eta_minutos` na tarefa |
| Foto comprovação downscale | Camera 1200px + JPEG 60% | Já tem `foto_conclusao_url`, adicionar multi-foto |
| Categorias de bike | `catBikes` (0%, NZ, idle, out-of-point) | Filtros no `gerarTarefasGojet` para priorizar bikes com problemas |

---

### 21.10 Melhorias v2 → v3 (pré-implementação)

**Data:** 2026-06-29  
**Contexto:** Revisão do plano considerando pontos piratas, escalabilidade multi-cidade, robustez, e decisões do usuário sobre roadmap futuro.

---

#### DECISÕES DO USUÁRIO (2026-06-29)

| Item | Decisão | Motivo |
|------|---------|--------|
| F3 Manutenção preventiva bikes | **FORA** | Responsabilidade da oficina, não dos scouts |
| F6 NFS-e auto por tarefa | **ADIADO** | Precisa decisão diretoria/jurídico. Pagamentos são semanais. Mapeado na seção NFS-e (§14) |
| F7 Ganhos tempo real do prestador | **SIM, com aviso** | Deve mostrar "valor estimado" + disclaimer que passa por verificação antes do pagamento |
| F11 App nativo scout separado | **PENSAR DEPOIS** | Provavelmente não, manter 1 app |
| F12 WhatsApp Business | **PENSAR DEPOIS** | Custo por msg escala demais para BR |

**Nota sobre NFS-e:** O módulo NFS-e (§14) deve considerar que `gojet_verified=true` pode ser um pré-requisito para liberar pagamento, mas a emissão em si é semanal/batch, não por tarefa individual. Fluxo: tarefas verificadas da semana → consolidar por prestador → emitir NFS-e do valor total. Detalhes pendentes de decisão jurídica/diretoria.

---

#### PONTOS PIRATAS / OPERAÇÕES ESPECIAIS

**P1 — Tabela `pontos_especiais`:**
Pontos temporários fora do sistema GoJet (ex: Av. Paulista nos FDS). Campos: lat/lon, nome, cidade, `ativo_de`/`ativo_ate` (janela temporal), tipo (`pirata`/`evento`/`parceiro`), `capacidade_alvo`, `criado_por`. Ativação automática por data — não precisa ação manual no dia.

**P2 — Verificação dual (GoJet vs foto+GPS):**
- Pontos oficiais (parking_id GoJet) → verificação via API (`bikes_count` aumentou?)
- Pontos piratas (ponto_especial_id) → verificação por foto obrigatória + GPS match
- Campo `gojet_verify_queue.modo` = `'gojet'` | `'foto_gps'`
- Elimina dependência da API GoJet para operações fora da rede oficial

**P3 — Novo kind `PONTO_ESPECIAL`:**
Tarefa de abastecer ponto pirata. Origem: ponto oficial com excesso → destino: ponto especial. Reversível: quando janela temporal acaba, auto-gera tarefa de recolhimento (bikes voltam para rede oficial).

**P4 — Calendário de operações especiais:**
Reaproveitar tabela `feriados` com `tipo='op_especial'` + referência ao `ponto_especial_id`. Agenda ativação/desativação automática. Permite planejar com antecedência (ex: cadastrar todos os FDS do mês).

---

#### ESCALABILIDADE (REPLICAR PARA N CIDADES)

**E1 — `cidade_config` com herança de defaults:**
Unificar `monitor_config` + `config_auto_slots` + `gojet_config` + `escala_config` em 1 tabela `cidade_config` com JSONB extensível. Config global `_default` → cidade herda e sobrescreve só o que difere. Nova cidade = 1 row + cadastrar prestadores → pronta pra operar.

```sql
CREATE TABLE IF NOT EXISTS public.cidade_config (
  cidade       TEXT PRIMARY KEY,
  city_id_gojet TEXT,              -- ID na API GoJet
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  timezone     TEXT DEFAULT 'America/Sao_Paulo',
  pais         TEXT DEFAULT 'BR',
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- config contém: thresholds (m1_dia, m1_noite...), gps_threshold_m,
  -- verify_delay_min, verify_timeout_min, velocidade_media_kmh,
  -- turnos (horários customizados), vagas_por_cargo, etc.
  ativo        BOOLEAN DEFAULT true,
  criado_em    TIMESTAMPTZ DEFAULT now()
);
-- Row '_default' contém valores base que todas as cidades herdam
```

**E2 — Zero constantes hardcoded:**

| Antes (hardcoded) | Depois (cidade_config.config) |
|---|---|
| 500m GPS threshold | `gps_threshold_m: 500` |
| 5min verify delay | `verify_delay_min: 5` |
| 35min timeout (7×5) | `verify_timeout_min: 35` |
| 15km/h OSRM speed | `velocidade_media_kmh: 15` |
| Turnos T0/T1/T2 fixos | `turnos: [{nome:"T0", inicio:"23:00", fim:"07:00"}, ...]` |
| M1 <30%, M2 <40%, M3 <50% | `thresholds: {m1_dia: 30, m1_noite: 20, ...}` |

**E3 — Onboarding checklist automático:**
1. `INSERT INTO cidade_config (cidade, city_id_gojet, lat, lon)` — pronto
2. Importar zones CSV (opcional)
3. Cadastrar prestadores com `cidade = 'nova_cidade'`
4. Primeira execução do scraper popula dados GoJet automaticamente

**E4 — Multi-timezone:**
`currentShift(now, tz)` ao invés de `now.getHours()`. Turnos definidos por cidade no `cidade_config.config.turnos`. Prepara para operação fora do Brasil (campo `pais` já existe na `tarefas_logistica`).

---

#### ARQUITETURA / ROBUSTEZ

**A1 — Batch tasks (já suportado!):**
`tarefas_logistica` já tem `target_count` + `delivered_count`. O plano já usa `bike_ids[]` (array). 1 tarefa = N bikes, scout faz entregas parciais. Não criar 5 tarefas para 5 bikes no mesmo ponto.

**A2 — Idempotência + retry:**
Todas as Edge Fns usam upsert/ON CONFLICT. `gojet_verify_queue.tentativas` com cap. `bike-guard` não duplica alertas se já alertou nos últimos 15min (coluna `ultimo_alerta_em` na tarefa).

**A3 — Offline-first no app do scout:**
Scout perde sinal na rua → scan bike salva em localStorage queue. Ao reconectar, sync em batch. Validação GoJet adia até online (não bloqueia o trabalho do scout). Foto + GPS são capturados offline e enviados depois.

**A4 — Audit trail unificado:**
Substituir `bike_swap_log` + `bike_validation_log` + `log_slots_auto` + `logs_automacao` por 1 tabela:
```sql
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         BIGSERIAL PRIMARY KEY,
  entity     TEXT NOT NULL,    -- 'tarefa', 'slot', 'bike', 'ponto_especial'
  entity_id  TEXT NOT NULL,    -- UUID ou identifier
  action     TEXT NOT NULL,    -- 'bike_swap', 'bike_validate', 'gojet_verify', 'sla_escalate'...
  actor_uid  UUID,
  cidade     TEXT,
  data       JSONB,            -- detalhes específicos da ação
  criado_em  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_entity ON public.audit_log(entity, entity_id, criado_em DESC);
CREATE INDEX idx_audit_cidade ON public.audit_log(cidade, criado_em DESC);
```
Query única pra ver timeline completa de uma tarefa. Mesma tabela serve pra dashboard de auditoria do gestor.

---

### 21.11 Plano Revisado — Migrations Finais

| # | Migration | O quê |
|---|-----------|-------|
| M0 | `0089_zone_plan.sql` | Adiciona `plan_frota INT` e `limite_default INT DEFAULT 3` na tabela `zones` + view `v_zone_matrix` |
| M1 | `0090_cidade_config.sql` | Tabela `cidade_config` + row `_default` + migrar dados das 4 configs existentes |
| M2 | `0091_tarefas_bike_tracking.sql` | Colunas bike_ids[], bike_id_atual, parking_destino, rota_osrm, gojet_verified etc |
| M3 | `0092_pontos_especiais.sql` | Tabela `pontos_especiais` + tipo em feriados |
| M4 | `0093_gojet_verify_queue.sql` | Fila de verificação com modo dual (gojet/foto_gps) |
| M5 | `0094_audit_log.sql` | Tabela unificada de auditoria (substitui 3 tabelas de log planejadas) |
| M6 | `0095_rpc_nearest_scout.sql` | Função PostGIS para scout mais próximo |

### 21.12 Fases Revisadas

| Fase | O quê | Esforço |
|------|--------|---------|
| **F0** | cidade_config + migrar configs existentes | 0.5 sessão |
| **F1** | Schema bike tracking + validar-bike + audit_log | 1 sessão |
| **F2** | Bike Guard + Swap + pontos especiais | 1 sessão |
| **F3** | GoJet Verify (dual mode) + badges frontend | 1 sessão |
| **F4** | Proximity + OSRM + offline queue | 1 sessão |
| **F5** | Calendário ops especiais + onboarding flow | 0.5 sessão |

**Total: ~5 sessões.** +1 sessão vs plano original, mas com suporte a pontos piratas, escalabilidade multi-cidade, e arquitetura mais limpa.

---

### 21.13 Melhorias v3 — Adições finais

#### OPERACIONAL (adições)

**O1 — Handoff entre turnos (ambas opções disponíveis):**
Scout T1 com tarefa em andamento às 15h (fim do turno). **Scout escolhe:**
- **Opção A — Finalizar (overtime):** Scout T1 continua. Flag `overtime=true`, SLA estendido +30min. Registra motivo no audit_log. Score da tarefa ganha bônus overtime.
- **Opção B — Passar adiante:** Auto-reatribui ao scout T2 mais próximo via `nearest_available_scout()`. Scout T1 marca "entrega parcial" no ponto atual. T2 recebe a tarefa com contexto (bike_id, rota restante, delivered_count atual).
- Push ao scout 15min antes do fim do turno: "Seu turno acaba em 15min. Finalizar ou passar?"
- Registro em `audit_log`: action='turno_handoff', data inclui decisão, motivo, scout anterior
- Campo na tarefa: `handoff_count INT DEFAULT 0`

**O2 — Detecção de fraude por padrão:**
Análise periódica (daily cron) que busca anomalias no `audit_log`:
- Scout que completa tarefas em <5min consistentemente (tempo impossível para a distância)
- Scout com >3 bike swaps por turno (abuso do mecanismo de troca)
- Scout com 100% entregas em pontos piratas (sem verificação GoJet, mais fácil de fraudar)
- Scout com GPS parado mas marcando entregas
- Gera alerta tipo `fraude_suspeita` no `audit_log` → flag pro gestor no dashboard
- **Não bloqueia o scout** — só alerta. Decisão é do gestor.

**O3 — Registro climático (sem bloqueio operacional):**
Chuva forte detectada durante tarefa em andamento (OpenWeather API, já integrada):
- **NÃO pausa automaticamente** — prestador decide se continua ou não (tem/recebe capa de chuva)
- Scout pode optar por pausar: status='pausado_clima', SLA timer congela. Retoma quando quiser.
- Sistema **registra condição climática** no audit_log de cada tarefa concluída durante chuva
- Dashboard do gestor: "Tarefa X concluída com chuva forte" → justifica tempo acima do normal
- Relatório semanal: "Na semana, 12 tarefas em chuva → tempo médio +40% vs normal"
- Campo: `pausado_em TIMESTAMPTZ`, `motivo_pausa TEXT`, `clima_registro JSONB` (salva weather snapshot)
- Utilidade: se resultado do turno foi baixo, gestor vê que choveu 3h → justificado, sem penalizar prestador

**O4 — Redistribuição inteligente pós-aluguel:**
Cliente aluga bike do ponto A → ponto A esvazia. Sistema detecta padrão de fluxo (A→B é comum) e auto-gera tarefa de rebalanceamento B→A antes que A fique zerado. Precisa: histórico de aluguéis por ponto (já temos `parking_history`). Implementação: média móvel de aluguéis por hora/ponto → threshold → tarefa preventiva.

**O5 — Previsão de demanda (ML leve):**
Média móvel por dia_semana × hora × ponto. "Av Paulista sáb 14h sempre esvazia em 2h" → pré-posicionar scouts 1h antes. Sem infra ML — query SQL simples sobre `parking_history`. Auto-sugere `vagas_por_cargo` no `cidade_config`.

---

#### FINANCEIRO (adições)

**F5 — ROI por tarefa / por cidade:**
Cada tarefa tem `custo_estimado` (hora scout × distância km) e `receita_estimada` (histórico de aluguel/hora da bike naquele ponto). Dashboard: "Curitiba gasta R$X/bike, gera R$Y/bike → ROI Z%". Justifica expansão com dados reais.

**F7 — Ganhos do prestador em tempo real (com disclaimer):**
App mostra: "Hoje: 5 entregas, ~R$87,50 estimado". **Aviso obrigatório**: "Valor estimado. Sujeito à verificação semanal das movimentações antes do pagamento." Cálculo: `SUM(tarefa.score × rate_cidade)` para tarefas concluídas do dia. Rate por cargo/cidade vem do `cidade_config.config.rates`.

---

#### TÉCNICO (adições)

**T1 — Realtime via Supabase channels:**
Substituir polling 10s por Supabase Realtime broadcast para tarefas+slots. Scout recebe push instantâneo. Reduz latência 10s→<1s, menos requests ao DB.

**T2 — GoJet API fallback/cache:**
Bike-guard tolera API GoJet down sem parar operação. Modo degradado: confia no GPS do scout + foto se API offline. Campo `gojet_api_status` no `cidade_config` (ok/degraded/down), atualizado pelo scraper.

**T3 — Rate limiting + abuse protection:**
Rate limit por uid (10 req/min) para `validar-bike`. Cache de bike lookup em `gojet_snapshots` (evita hit na API GoJet a cada scan). Protege contra scout malicioso e contra rate-limit do GoJet.

**T4 — Command center (mapa live + dashboard operacional):**
Overlay unificado no mapa: todos scouts (GPS), todas bikes (GoJet), todas tarefas ativas, pontos especiais ativos. Gestor vê operação inteira em tempo real.

#### Filtros (portados + expandidos do jet-analise)

**Filtro principal (top bar):**
- Cidade: SP, Curitiba, BC, ... (dropdown, alimentado por `cidade_config`)
- Turno: T0, T1, T2 (toggle, highlight ativo)

**Filtro de patinetes/bikes:**
- Todos / Nenhum (toggle global)
- Ociosos (sem aluguel há X horas) — on/off
- Bateria: slider ou faixas (<15%, <30%, <50%, todos)
- Localização: Todos | Em ponto | Fora de ponto (com contagem)

**Filtro de pontos:**
- Todos / Nenhum
- Por status: vazios (0 bikes), deficit (<30%), OK, excesso (>90%)
- Pontos especiais/piratas: mostrar/ocultar

**Filtro de zonas:**
- Lista de zonas com cor + contagem de bikes (ex: "🟥 Zona 1 Vermelha — 858")
- Multi-select: clicar zona filtra mapa + KPIs apenas para aquela zona
- "Fora de zona" como opção
- Zonas renderizadas como polígonos coloridos no mapa (já implementado no GoJetOverlay)

**Filtro de scouts:**
- Todos / Com tarefa / Ociosos
- Por cargo: promoter, logistica, charger

#### Painel — Blocos de KPIs (portado integral do jet-analise + expandido)

Todos os blocos respeitam filtros de cidade e zona. Visual premium.

**Bloco 1: Resumo de vagas vazias (header principal)**
- Total vagas vazias (absoluto + % da rede)
- 🔴 Monitores vazios (pontos com meta, sem bike) — absoluto + % dos monitores
- ⚫ Sem-monitor vazios (pontos sem meta, sem bike) — absoluto + % dos sem-monitor
- 🟢 Com patinete (% dos pontos)
- 🟠 Pontos com excesso (% dos pontos)
- Total de pontos da rede
- Gerado em: timestamp + fonte (GoJET snapshot ao vivo)

**Bloco 2: Comparativo & tendência**
- Agora: vagas vazias (absoluto + %)
- Média hoje vs ontem (com delta ▼▲)
- Mesmo dia da semana (média de 2 semanas)
- Indicador de tendência: 📉 Melhorando / 📈 Piorando / ≈ Estável
- Frase automática: "hoje em média X vagas vazias — Y% melhor que a média das últimas 2 [dia_semana]s (Z)"
- Gráfico: média de vagas vazias por dia (7 dias). Pontos amarelos = mesmo dia da semana.

**Bloco 3: Comparativo por zona — 7 dias**
Tabela com colunas: Zona | Agora (🔴 ⚫ Σ) | Hoje | Ontem | Anteontem | 3d | 4d | 5d | 6d | 7d | vs ontem (▼▲)
- Cada grupo (Agora + cada dia) tem 3 sub-colunas: 🔴 monitor · ⚫ não-monitor · Σ total
- Agora = snapshot atual; demais = média daquele dia
- ▼ verde = melhor que ontem · ▲ vermelho = pior
- Scroll horizontal para ver todos os dias
- Linha TOTAL no rodapé

**Bloco 4: Situação atual por zona**
Tabela: Zona | 🔴 | ⚫ | 🟢 | vazias (abs + %) | perfil
- Ordenado por onde há mais vaga vazia (🔴+⚫)

**Bloco 5: Matriz por zona (dashboard analítico completo)**
Tabela com colunas: Zona | Frota | Plan | Δplan | Disp | Aluguel | Manut | <15% | 48h | Em ponto | Fora | Pontos | Mon | Mon 0 | N-Mon 0 | Mon exc | N-Mon exc
- **Frota:** total de bikes na zona
- **Plan:** planejamento de frota (meta)
- **Δplan:** diferença frota vs plan (+/-)
- **Disp:** bikes disponíveis (não em manutenção/aluguel)
- **Aluguel:** bikes alugadas agora
- **Manut:** bikes em manutenção
- **<15%:** bikes com bateria < 15%
- **48h:** bikes paradas há >48h (ociosas)
- **Em ponto / Fora:** bikes em parking vs fora
- **Pontos / Mon:** total de pontos / monitores na zona
- **Mon 0 / N-Mon 0:** monitores vazios / não-monitores vazios
- **Mon exc / N-Mon exc:** monitores com excesso / não-monitores com excesso
- Linha TOTAL no rodapé. Tooltip com % ao hover.

**Bloco 6: Aluguéis**
- Hoje (total) × Ontem (mesma hora) × Semana passada (mesma hora) com variação %
- Curva 0h-23h (3 linhas: hoje, ontem, sem.passada) com marcador "agora"
- Clima por hora: 24 colunas com emoji + temperatura

**Bloco 7: Aluguéis por ponto (tabela scrollable)**
- Ponto (cor da zona como prefixo emoji) | Hoje | Ontem | Sem.pass
- Ordenado por aluguéis hoje (desc). Busca por nome. Click → zoom no mapa.

**Bloco 8: Estacionamentos vazios (agrupado por zona)**
Para cada zona, lista de pontos vazios ordenados por tempo vazio:
- ★ = monitor (com meta). Sem ★ = sem-monitor (limite padrão 3)
- Formato: "★ 🟧 Rua Vergueiro. 279 — meta 5 · vazio há 21h"
- Botões: 📍 Mostrar (zoom mapa) + 🧭 Maps (abre Google Maps)
- Cabeçalho da zona: cor + nome + contagem de 🔴 monitores vazios
- Busca: "🔎 Buscar estacionamento vazio" — filtra por nome, mostra se é 🔴 ou ⚫

**Bloco 9: Pontos com excesso (de onde retirar)**
Para cada zona, lista de pontos com bikes acima da meta/limite:
- ★ = monitor (meta definida). Sem ★ = sem-monitor (limite 3)
- Formato: "🟥 Alameda Joaquim Eugenio 383 — limite 3 · atual 24 · +21 acima"
- Ordenado pelo maior excesso dentro de cada zona
- Botões: 📍 Mostrar + 🧭 Maps
- **Uso operacional:** gestor vê de onde retirar bikes pra rebalancear

**Bloco 10: Tendência (gráficos manhã/tarde)**
- 🌅 Snapshots da manhã (até 13:00)
- 🌆 Snapshots da tarde/noite (após 13:00)
- Linhas: ● Total vazias (abs) · ● monitor vazios · ● non-monitor vazios · ● % da rede
- Eixo esquerdo: número absoluto. Eixo direito: % (quanto menor, melhor).

**Bloco 11: Scouts / Turno atual**
- Ativos | Com tarefa | Ociosos (cards com número grande)

**Bloco 12: Tarefas hoje**
- Barra empilhada: abertas | em andamento | concluídas
- Contagem de cada

**Bloco 13: Pontos especiais ativos**
- Nome | bikes atuais / meta | status
- Horário de recolhimento programado

**Bloco 14: Mapa live (Leaflet)**
- 🔴 Monitor vazio (meta definida, sem patinete)
- ⚫ Sem-monitor vazio
- 🟢 Com patinete
- 🟠 Excesso (acima da meta)
- 🔵 Scouts ativos (GPS)
- 🟣 Tarefas em andamento (rota OSRM)
- 🟡 Pontos especiais/piratas
- Polígonos de zonas com cor correspondente
- Legenda no canto
- Zoom ao clicar em qualquer item do painel

#### Fonte de dados de aluguéis

**Descoberta:** GoJet API tem endpoints `/rentals` e `/trips` (retornam 403 server-side via Cloudflare, mas 403 ≠ 404 — existem). O jet-analise provavelmente acessa do browser (CORS aberto) ou via proxy Vercel.

**Estratégia para JET OS:**
1. **Tentar acessar `/rentals` e `/trips` do browser** (como o gojet-scraper.ts já faz para /parkings e /bikes)
2. Se funcionar: dados de aluguéis por ponto com precisão total
3. Se não funcionar (precisa auth): **fallback = calcular via delta de snapshots** — compara `available_bikes_count` entre snapshots 15min. Delta negativo = aluguéis estimados. Menos preciso mas funcional.
4. Salvar em `parking_history` com campos `alugueis_hoje`, `alugueis_hora`

**TODO:** Testar `/rentals` e `/trips` do browser (fetch no console do Chrome). Se retornar dados, temos a fonte definitiva.

**T5 — Capacity planning:**
"Curitiba precisa de quantos scouts por turno?" Baseado em: tarefas históricas × tempo médio × distância média. Auto-sugere `vagas_por_cargo` no `cidade_config`. Query SQL sobre `audit_log` + `tarefas_logistica` das últimas 4 semanas.

---

### 21.14 Colunas extras no schema (custo zero agora, evita migration depois)

Adicionar na migration M2 (`0091_tarefas_bike_tracking.sql`):

```sql
-- Prepara ROI (F5)
ADD COLUMN IF NOT EXISTS custo_estimado    NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS receita_estimada  NUMERIC(10,2),
-- Prepara gamificação (O2/F7)
ADD COLUMN IF NOT EXISTS score             NUMERIC(8,2),
-- Prepara handoff entre turnos (O1)
ADD COLUMN IF NOT EXISTS handoff_count     INT DEFAULT 0,
-- Prepara pausa por clima (O3)
ADD COLUMN IF NOT EXISTS pausado_em        TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS motivo_pausa      TEXT,
-- Prepara overtime (O1)
ADD COLUMN IF NOT EXISTS overtime          BOOLEAN DEFAULT false,
-- Prepara registro climático (O3)
ADD COLUMN IF NOT EXISTS clima_registro    JSONB,  -- {temp, weather, rain_mm, description} no momento da conclusão
```

Adicionar na migration M5 (`0094_audit_log.sql`):
```sql
-- Prepara multi-canal (T1/futuro WhatsApp)
ADD COLUMN canal TEXT DEFAULT 'app',  -- 'app', 'telegram', 'whatsapp', 'system'
```

---

### 21.15 Fontes de Dados — jet-analise.vercel.app (CONFIRMADO via Chrome 2026-06-29)

| Dado | Fonte real | Status | Como pegar no JET OS |
|------|-----------|--------|---------------------|
| Bikes/patinetes (live) | GoJet `/api/v0/urent/bikes?city_id=X&page=N&limit=1000` (CORS aberto) | ✅ Confirmado | Já temos: `gojet-scraper.ts` |
| Parkings (live) | GoJet `/api/v0/urent/parkings?city_id=X&page=N&limit=1000` (CORS aberto, via proxy Vercel) | ✅ Confirmado | Já temos: `gojet-scraper.ts` |
| Cidades | GoJet `/api/v0/urent/cities` (retorna id+name+timezone) | ✅ Confirmado | Alimentar `cidade_config` |
| **Zonas técnicas (GoJet)** | GoJet `/api/v0/urent/techzones?city_id=X` → lista {id, name} | ✅ **NOVO** | 10 zonas para SP. Cada zona tem coordenadas do polígono |
| **Zona detalhe + polígono** | GoJet `/api/v0/urent/techzones/{zone_id}` → {id, name, coordinates: [{lat,lon}...]} | ✅ **NOVO** | **Importação automática de zonas!** 21 pontos por polígono |
| **Aluguéis por ponto/hora** | GoJet ML `/api/v0/ml/techzones/{zone_id}/activity?start=...&end=...` | ✅ **CONFIRMADO** | Retorna `[{parking_id, starts, finishes}]` por hora. **NÃO é delta de snapshots!** |
| Zonas customizadas | jet-analise `/api/points?kind=zones` (Google MyMaps) | ✅ Confirmado | Já temos tabela `zones` (0082) |
| Rotas | OSRM `router.project-osrm.org` (bike, ~15km/h) | ✅ Confirmado | Portar direto — sem auth, sem custo |
| Categorias de bikes | Client-side: battery_level, parking_id, status | ✅ Confirmado | Implementar nos filtros |
| Clima por hora | OpenWeather API (forecast 24h) | ✅ Confirmado | Já temos integração (automacao-tarefas) |
| Contagem por zona | Client-side: point-in-polygon (bike lat/lon × zona polígono) | ✅ Confirmado | PostGIS `ST_Contains` ou client-side |

#### Descobertas críticas (2026-06-29, Chrome conectado):

**1. Endpoint de aluguéis ENCONTRADO:**
- URL: `https://logistic.gojet.app/api/v0/ml/techzones/{zone_id}/activity?start=2026-06-29T10:00:00&end=2026-06-29T10:59:59`
- **Base path: `/api/v0/ml/`** (NÃO `/api/v0/urent/`!)
- CORS aberto, funciona direto do browser sem auth
- Retorna: `[{parking_id: "...", starts: 2, finishes: 0}, ...]`
- `starts` = aluguéis iniciados naquela hora naquele ponto
- `finishes` = devoluções naquela hora naquele ponto
- jet-analise chama 1× por hora × por zona × por dia (hoje: ~13h × 10 zonas = ~130 requests)
- Para dias passados: 24h × 10 zonas = ~240 requests por dia (cacheia em localStorage como `jet:act:v3:past:{zone_id}:{date}`)

**2. Endpoints que NÃO existem (404 do browser):**
- `/api/v0/urent/rentals` → 404
- `/api/v0/urent/trips` → 404
- `/api/v0/urent/statistics` → 404
- (retornavam 403 server-side por causa do Cloudflare, 404 do browser — **não existem**)

**3. Zonas GoJet com polígonos (importação automática):**
- `/api/v0/urent/techzones?city_id=X` → lista de zonas com {id, name}
- `/api/v0/urent/techzones/{id}` → detalhe com coordinates: [{lat, lon}, ...] (polígono completo)
- SP tem 10 zonas: "ZONA 1 - Bras", "zona Interlagos", etc.
- **Pode importar diretamente para tabela `zones`** — não precisa mais de CSV/Google MyMaps

**4. Estrutura de cache do jet-analise (localStorage):**
- `jet:act:v3:today:{zone_id}:{date}` → {hourlyStarts: [24], perPointHourly: {parking_id: [24]}}
- `jet:act:v3:past:{zone_id}:{date}` → mesmo formato
- `jet:cities:all` → lista de cidades com timezone
- `jet:gojetzones:v2:{city_id}` → zonas GoJet
- `jet:wx:day:{lat},{lon}` → clima por hora
- `jet:emptyhist:v2` → histórico de pontos vazios

**5. Delta de snapshots → DESNECESSÁRIO como fonte primária:**
- O endpoint `/api/v0/ml/` dá dados precisos de aluguéis por ponto/hora
- Delta de snapshots pode ser mantido como **fallback** se GoJet ML ficar offline
- Estratégia: API ML primeiro, delta como backup

**6. Cidades no GoJet (2026-06-29):**
SP, Curitiba, BC, Florianópolis (Campeche), Florianópolis (Ingleses), Palhoça, Joinville, Serra, Porto Belo, Rio de Janeiro — todos com timezone America/Sao_Paulo

---

### 21.16 Roadmap Futuro (pós plano v2/v3)

| Horizonte | Item | Dependência |
|-----------|------|-------------|
| **Curto (1-2 meses)** | F5 ROI por cidade | audit_log + custo_estimado (já no schema) |
| **Curto** | T2 GoJet API fallback | bike-guard (F2) |
| **Curto** | T4 Command center mapa live | GPS scouts + GoJet overlay (já existem) |
| **Médio (3-6 meses)** | O2 Detecção de fraude | audit_log (M5) |
| **Médio** | O4 Redistribuição pós-aluguel | parking_history |
| **Médio** | T1 Realtime Supabase channels | migração Firebase→Supabase (§14) |
| **Médio** | F7 Ganhos prestador tempo real | score + rates no cidade_config |
| **Médio** | T5 Capacity planning | 4+ semanas de dados em audit_log |
| **Longo (6-12 meses)** | O5 Previsão de demanda | parking_history + 3+ meses dados |
| **Longo** | NFS-e integração (ver §14) | Decisão jurídica/diretoria pendente |

**Itens descartados:**
- ~~F3 Manutenção preventiva bikes~~ → responsabilidade da oficina
- ~~F11 App nativo scout separado~~ → manter 1 app
- ~~F12 WhatsApp Business~~ → custo por msg escala demais para BR

---

### 21.17 Melhorias v4 — Bateria, Prestadores, Delta Snapshots, Pontos não-monitor (2026-06-29)

#### B1 — Monitoramento de bateria crítica (5% e 0%) — RISCO PATRIMONIAL

Patinetes com bateria ≤5% ou 0% representam risco de perda de equipamento: ficam parados, não são alugados, podem ser roubados ou esquecidos. Sistema deve alertar proativamente.

**Implementação:**
- **Cron (a cada scraper run):** após upsert de `gojet_snapshots`, filtrar bikes com `battery_level <= 5`
- **Categorias:**
  - 🔴 `battery_0`: bateria = 0% — URGENTE (equipamento pode estar perdido/danificado)
  - 🟠 `battery_5`: bateria 1-5% — ALERTA (recolher antes que zere)
- **Ações automáticas:**
  - Gerar tarefa `tipo='bateria_critica'` em `tarefas_logistica` se bike em ponto da zona com scout ativo
  - Se bike fora de ponto + 0%: alerta Telegram ao gestor com localização GPS
  - Dedup: não gerar tarefa se já existe aberta para mesma bike
- **Command Center (Bloco 15):**
  - Card: "⚡ Bateria crítica: X bikes a 0% · Y bikes a ≤5%"
  - Lista: bike_id | localização | bateria | tempo parado | em ponto? | ação
  - Ordenado: 0% primeiro, depois por tempo parado desc
  - Click → zoom no mapa
- **Matriz por zona (Bloco 5):** adicionar coluna `0%` e `≤5%` (além do `<15%` já existente)
- **Filtro de patinetes:** adicionar faixa "0%" e "1-5%" no seletor de bateria

**Schema (adicionar na M2):**
```sql
-- Já temos <15% no cálculo. Adicionar tracking:
-- Bike com 0% há >24h = candidata a "perdida"
-- Campo na gojet_snapshots? Não — calcular on-the-fly a partir do snapshot latest_bikes
-- No Command Center: client-side filter bikes.battery_level <= 5
```

**Regra de negócio:**
- 0% + fora de ponto + >24h = alerta "possível perda" ao gestor + diretoria
- 0% + em ponto = gerar tarefa de recolhimento para charger
- ≤5% + em ponto = prioridade alta na próxima rota de charger

---

#### B2 — Prestadores ativos: tempo na tarefa e tempo ocioso

Gestor precisa ver em tempo real: quem está trabalhando, há quanto tempo, e quem está parado sem tarefa.

**Implementação:**
- **Cálculo:**
  - `tempo_na_tarefa`: `NOW() - tarefas_logistica.updated_at` onde status='em_andamento' AND assignee_uid = scout
  - `tempo_ocioso`: `NOW() - MAX(t.concluido_em)` para scout sem tarefa ativa (tempo desde última conclusão)
  - Scout nunca concluiu nada no turno? `tempo_ocioso = NOW() - inicio_turno` (do slot)
- **Command Center — Bloco 11 expandido (Scouts/Turno):**

| Scout | Status | Tarefa atual | Tempo | Última conclusão | Ociosos há |
|-------|--------|-------------|-------|------------------|------------|
| João S. | 🟢 Em tarefa | Rebalancear Z1→Z3 | 42min | — | — |
| Maria L. | 🟢 Em tarefa | Zero-fill Vergueiro | 18min | — | — |
| Pedro R. | 🟡 Ocioso | — | — | Concluiu há 25min | 25min |
| Ana K. | 🔴 Ocioso longo | — | — | Concluiu há 1h12 | 1h12 |
| Carlos T. | ⚫ Sem ação | — | — | Nenhuma no turno | 2h30 |

  - **Thresholds:**
    - 🟢 Em tarefa: normal
    - 🟡 Ocioso <30min: ok (entre tarefas)
    - 🔴 Ocioso 30-60min: alerta visual
    - ⚫ Ocioso >60min ou zero tarefas no turno: alerta Telegram ao gestor
  - **Cards resumo:** "8 ativos | 5 em tarefa | 2 ociosos (<30min) | 1 ocioso longo (>30min)"
  - **SLA de ociosidade:** se scout ocioso >45min e existem tarefas abertas na zona → auto-sugerir atribuição
- **Filtro de scouts (expandido):**
  - Todos | Em tarefa | Ociosos (<30min) | Ociosos longos (>30min) | Sem ação no turno
- **Mapa:** scouts ociosos >30min piscam no mapa (vermelho pulsante)

**Dados necessários (já existem):**
- `tarefas_logistica.assignee_uid`, `status`, `updated_at`, `concluido_em`
- `slots.uid`, `turno`, `dia` (para saber início do turno)
- Não precisa migration nova — tudo calculável via queries existentes

---

#### B3 — Aluguéis: API GoJet ML (primária) + delta snapshots (fallback)

**RESOLVIDO (2026-06-29):** Endpoint de aluguéis ENCONTRADO e CONFIRMADO no Chrome.

**Estratégia definitiva:**
1. **API GoJet ML (PRIMÁRIA):** `https://logistic.gojet.app/api/v0/ml/techzones/{zone_id}/activity?start=...&end=...` — CORS aberto, sem auth, retorna `[{parking_id, starts, finishes}]` por hora
2. **Fallback delta snapshots:** se GoJet ML offline, calcular via diferença de `available_bikes_count` entre snapshots

**Implementação do delta:**
```
parking_history (nova coluna ou tabela auxiliar):
  parking_id | snapshot_ts | bikes_count | delta (calculado)

Delta = bikes_count(t-1) - bikes_count(t)
  Se delta > 0: ~delta aluguéis no intervalo
  Se delta < 0: ~|delta| devoluções/rebalanceamento
  Se delta = 0: sem mudança
```

**Limitações do delta (documentar no UI):**
- Precisão: ±1-2 bikes por intervalo (se scraper roda a cada 15min, perde aluguéis+devoluções no meio)
- Não distingue aluguel de rebalanceamento (scout entregou vs cliente alugou)
- Acumula bem ao longo do dia: soma de deltas negativos ≈ total aluguéis
- **Indicador no UI:** "~861 aluguéis (estimativa via snapshots)" com ícone ℹ️

**Migration (adicionar ao M0 ou criar M0b):**
```sql
CREATE TABLE IF NOT EXISTS public.parking_history (
  id           BIGSERIAL PRIMARY KEY,
  parking_id   TEXT NOT NULL,
  cidade       TEXT NOT NULL,
  bikes_count  INT NOT NULL,
  bikes_available INT,
  delta_alugueis INT,  -- negativo do delta de bikes_count (quando bikes_count diminui)
  snapshot_ts  TIMESTAMPTZ NOT NULL DEFAULT now(),
  fonte        TEXT DEFAULT 'gojet_snapshot'  -- 'gojet_snapshot' | 'gojet_rentals'
);
CREATE INDEX idx_ph_parking_ts ON public.parking_history(parking_id, snapshot_ts DESC);
CREATE INDEX idx_ph_cidade_ts ON public.parking_history(cidade, snapshot_ts DESC);

ALTER TABLE public.parking_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY ph_sel ON public.parking_history FOR SELECT TO authenticated USING (true);
CREATE POLICY ph_svc ON public.parking_history FOR ALL TO service_role USING (true);
```

**Edge function (automacao-gojet, adicionar ao scraper):**
Após upsert dos snapshots, para cada parking:
1. Ler último registro de `parking_history` para este parking_id
2. Calcular delta = bikes_count_anterior - bikes_count_atual
3. Se delta > 0: inserir com `delta_alugueis = delta`
4. Se delta ≤ 0: inserir com `delta_alugueis = 0` (devolução/rebalanceamento, não conta como aluguel)
5. Aluguéis hoje = `SUM(delta_alugueis) WHERE snapshot_ts >= DATE_TRUNC('day', NOW())`

---

#### B3b — Importação automática de zonas GoJet + zona-padrão para cidades sem zonas

**RESOLVIDO (2026-06-29):** Zonas podem ser importadas automaticamente da API GoJet.

**Importação:**
1. `GET /api/v0/urent/techzones?city_id=X` → lista de zonas {id, name}
2. Para cada zona: `GET /api/v0/urent/techzones/{zone_id}` → {name, coordinates: [{lat, lon}...]}
3. Converter coordinates para GeoJSON Polygon e inserir na tabela `zones`
4. Botão "Importar zonas GoJet" no admin (ou auto-import ao configurar cidade)

**Zona-padrão para cidades sem zonas configuradas:**
- Se cidade não tem zonas na tabela `zones` E GoJet não retorna techzones: criar zona `_default` que cobre toda a cidade
- Command Center funciona normalmente com 1 zona (sem breakdown por zona)
- Aviso no dashboard: "⚠ Esta cidade não tem zonas configuradas. Dados agregados. Configure zonas para análise por região."
- Não bloqueia o uso do Command Center

---

#### B4 — Pontos não-monitor: limite padrão 3 patinetes

**Regra:** pontos SEM meta definida (não são monitores) usam limite padrão de 3 patinetes.
- Acima de 3 = excesso (🟠)
- Igual a 0 = vazio (⚫, não 🔴 pois não é monitor)

**Implementação:**
- `zones.limite_default` já planejado (M0, DEFAULT 3)
- Para cada ponto sem registro em `monitor_config`: usar `limite_default` da zona
- Se ponto não pertence a nenhuma zona: usar `cidade_config.config.limite_default_global` (DEFAULT 3)
- **Cálculos no Command Center:**
  - Excesso não-monitor: `bikes_count > limite_default` (ou 3 se não definido)
  - Vazio não-monitor: `bikes_count = 0`
  - Separar claramente de monitores nos blocos 1, 3, 4, 5, 8, 9

**Config por cidade (cidade_config.config JSONB):**
```json
{
  "limite_default_global": 3,
  "limite_default_por_zona": {
    "zona_1": 5,
    "zona_2": 3
  }
}
```

---

#### B5 — Busca de melhorias adicionais (análise sistemática)

**Pontos identificados ao revisar o plano completo:**

| # | Melhoria | Impacto | Onde encaixa |
|---|----------|---------|-------------|
| B5.1 | **Alerta de bike sem movimento >72h** | Bike pode estar inacessível/presa | Bloco 15 (bateria) expandir para "Bikes em risco" |
| B5.2 | **Heatmap de aluguéis por hora no mapa** | Visualizar demanda geográfica | Command Center Bloco 14 (mapa) — layer toggle |
| B5.3 | **Score de saúde do ponto** | Priorizar pontos problemáticos | 0-100 baseado em: tempo vazio, frequência de excesso, aluguéis/dia, manutenção |
| B5.4 | **Notificação push pré-turno** | Scout sabe o que esperar | 30min antes: "Turno T1 em 30min. 12 tarefas na fila. Zona foco: Z3 Laranja" |
| B5.5 | **Comparativo entre cidades** | Gestão multi-cidade | Tab no Command Center: SP vs Curitiba vs BC — mesmos KPIs lado a lado |
| B5.6 | **Export CSV/PDF do Command Center** | Relatórios para diretoria | Botão export em cada bloco de KPI |
| B5.7 | **Tempo médio de tarefa por tipo** | Benchmark operacional | "Zero-fill: 23min avg · Rebalanceamento: 45min avg · Bateria: 18min avg" |
| B5.8 | **SLA visual no mapa** | Ver tarefas atrasadas no mapa | Tarefas >1x SLA piscam amarelo, >3x SLA piscam vermelho |
| B5.9 | **Auto-priorização de tarefas** | Scout recebe a mais urgente | Score = f(tempo_vazio, é_monitor, aluguéis_historico, distancia_scout) |
| B5.10 | **Dashboard de bateria da frota** | Visão geral de saúde da frota | Histograma: quantas bikes por faixa (0%, 1-5%, 6-15%, 16-30%, 31-50%, 51-100%) |

---

### 21.17b Gerenciamento de Cidades — Fluxo Admin (2026-06-29)

**Princípio:** Admin nunca precisa sair do JET OS para gerenciar cidades. Lista GoJet é puxada automaticamente.

**Fluxo:**
1. **Sync automático** (cron diário 06:00 + botão manual): Edge Fn `sync-gojet-cities` chama `GET /api/v0/urent/cities`, compara com `cidade_config`. Novas → insere com `ativo: false`. Removidas → marca `gojet_removida: true`.
2. **Notificação**: Telegram ao admin + badge 🔴 no menu Configurações → Cidades.
3. **Tela admin** (Configurações → Cidades): tabs Ativas/Inativas/Novas. Toggle liga/desliga. Mostra contagem de zonas e bikes.
4. **Ao ativar cidade**: auto-importa zonas GoJet (polígonos → tabela `zones`), cria zona `_default` se 0 zonas, inicia scraper, cidade aparece nos filtros do Command Center.
5. **Config por cidade (⚙)**: `limite_default`, `scraper_interval`, `turnos`, `rates`, `sla_minutos`. Herda de `_default` se não definido.

**Schema `cidade_config`:**
```sql
CREATE TABLE IF NOT EXISTS public.cidade_config (
  id          TEXT PRIMARY KEY,              -- GoJet city_id ou '_default'
  nome        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ativo       BOOLEAN NOT NULL DEFAULT false,
  gojet_removida BOOLEAN NOT NULL DEFAULT false,
  config      JSONB NOT NULL DEFAULT '{}',   -- limite_default, scraper_interval, turnos, rates, sla_minutos
  zonas_importadas BOOLEAN NOT NULL DEFAULT false,
  total_bikes INT,
  total_parkings INT,
  ultima_sync TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**61 cidades GoJet disponíveis (2026-06-29).** SP (10 zonas), RJ (13), Floripa Ingleses (9), Floripa Campeche (6), Curitiba (5), BC (4), Porto Belo (4), + 54 cidades menores.

---

### 21.18 Plano Revisado Final — Migrations v4

| # | Migration | Conteúdo |
|---|-----------|---------|
| M0 | `0089_zone_plan.sql` | `plan_frota INT`, `limite_default INT DEFAULT 3` na `zones` + view `v_zone_matrix` |
| M0b | `0090_parking_history.sql` | Tabela `parking_history` (delta aluguéis, snapshot tracking) |
| M1 | `0091_cidade_config.sql` | Tabela `cidade_config` + row `_default` + `limite_default_global` |
| M2 | `0092_tarefas_bike_tracking.sql` | Colunas bike tracking + ROI + handoff + clima + score |
| M3 | `0093_pontos_especiais.sql` | Tabela `pontos_especiais` + tipo em feriados |
| M4 | `0094_gojet_verify_queue.sql` | Fila de verificação com modo dual (gojet/foto_gps) |
| M5 | `0095_audit_log.sql` | Tabela unificada de auditoria + canal |
| M6 | `0096_rpc_nearest_scout.sql` | Função PostGIS para scout mais próximo |

### 21.19 Fases Revisadas v4

| Fase | O quê | Esforço |
|------|--------|---------|
| **F0** | cidade_config + zone_plan + import zonas GoJet + parking_history + GoJet ML activity scraper | 1 sessão |
| **F1** | Schema bike tracking + validar-bike + audit_log + bateria crítica (0%/5%) alertas | 1 sessão |
| **F2** | Bike Guard + Swap + pontos especiais + pontos não-monitor (limite 3) | 1 sessão |
| **F3** | GoJet Verify (dual mode) + badges + prestador tempo ativo/ocioso | 1 sessão |
| **F4** | Command Center completo (15 blocos) + filtros + mapa live + zona-padrão fallback | 1.5 sessão |
| **F5** | Proximity + OSRM + offline queue + auto-priorização | 1 sessão |
| **F6** | Calendário ops especiais + onboarding + export CSV/PDF | 0.5 sessão |

**Total: ~7 sessões.**

**Desbloqueios confirmados (2026-06-29):**
- ✅ Aluguéis por ponto: GoJet ML API confirmada (`/api/v0/ml/techzones/{id}/activity`)
- ✅ Zonas: importação automática via GoJet API (não precisa CSV/Google MyMaps)
- ✅ Cidades sem zonas: zona-padrão `_default` não bloqueia Command Center
- ⏳ GPS scouts: testar se APK popula `usuarios.ultima_pos`
- ⏳ Monitor config: pontos com meta vêm dos parkings GoJet (campo a confirmar quando API destravar rate limit)

---

### 21.20 Progresso de Implementação (2026-06-29)

#### F0 — cidade_config + zone_plan + import zonas ✅ COMPLETO

**Migrations aplicadas:**
| # | Arquivo | Status |
|---|---------|--------|
| 0083 | `cidade_config.sql` | ✅ Tabela + seed `_default` + migração de gojet_config |
| 0084 | `zone_plan.sql` | ✅ Colunas plan_frota/limite_default/gojet_zone_id em zones |
| 0085 | `parking_history.sql` | ✅ Tabela para histórico de aluguéis por ponto/hora |
| 0086 | `cidade_config_anon_read.sql` | ✅ Policy anon SELECT (pendente deploy) |
| 0087 | `zones_upsert_constraint.sql` | ✅ Fix: unique index non-partial para upsert funcionar |

**Edge Function:** `sync-gojet-cities` ✅ Deployed
- Action `sync`: 61 cidades GoJet sincronizadas (58 novas)
- Action `import-zones`: 10 zonas SP importadas com polígonos GeoJSON
- Action `fetch-activity`: funcional mas excede resource limit em cidades grandes (otimizar: batch por zona, não todas de uma vez)

**Frontend:**
- `GoJetCidadesPanel.tsx` — novo painel com tabs Ativas/Inativas/Novas, toggle ativar com auto-import zonas
- Movido de Dashboard > Config para **Configurações > GoJet** (dentro de PainelConfiguracoes)
- `cidade-config.ts` — CRUD completo + Realtime subscription + `buscarCityId` retrocompat
- `GoJetOverlay.tsx` e `TelaMapa.tsx` migrados de `gojet-config-supabase` → `cidade-config`

**Bugs corrigidos:**
- Migration 0083: query usava `data->>'cityId'` mas gojet_config tem colunas diretas (`city_id`, `cidade`)
- Migration 0085: tabela já existia com schema diferente → `DROP TABLE IF EXISTS` + recriação
- Zones upsert: partial unique index incompatível com PostgREST ON CONFLICT → index non-partial

#### F1 — Schema bike tracking + validar-bike + audit_log ✅ COMPLETO

**Migrations aplicadas:**
| # | Arquivo | Status |
|---|---------|--------|
| 0088 | `tarefas_bike_tracking.sql` | ✅ Colunas bike_ids, bike_id_atual, parking_destino, gojet_verified, etc. |
| 0089 | `bike_swap_log.sql` | ✅ Log de trocas de bike durante turno |
| 0090 | `bike_validation_log.sql` | ✅ Validações: fantasma, GPS, alugada, bateria |
| 0091 | `audit_log.sql` | ✅ Auditoria unificada (entidade, ação, dados, uid) |

**Edge Function:** `validar-bike` ✅ Deployed
- Valida bike via GoJet API: fantasma, alugada/reservada, GPS diverge (>500m), bateria 0%
- Loga em bike_validation_log + audit_log
- Se válido + tarefa_id: atualiza bike_id_atual na tarefa

#### F2 — Bike Guard + Swap + Pontos Especiais ✅ COMPLETO

**Migrations aplicadas:**
| # | Arquivo | Status |
|---|---------|--------|
| 0092 | `pontos_especiais.sql` | ✅ Tabela para eventos/feriados/manutenção por ponto |
| 0093 | `gojet_verify_queue.sql` | ✅ Fila de verificação pós-entrega |

**Edge Function:** `bike-guard` ✅ Deployed
- Monitora bikes em trânsito: fantasma, alugada, GPS diverge (>500m após 10min)
- Monitora bateria crítica: 0% (Telegram alert) e ≤5% (log)
- Dedup: não re-alerta mesma bike em 24h
- Telegram: alerta gestor para bikes alugadas durante transporte e bateria 0%

**Frontend:** `BikeSwapDialog.tsx` ✅ Criado
- Dialog para scout trocar bike durante tarefa ativa
- Motivos: alugada, defeito, bateria, manual
- Valida nova bike via `validar-bike` antes de confirmar
- Loga em bike_swap_log + atualiza bike_id_atual

#### F3 — GoJet Verify + Prestador Tracking ✅ COMPLETO

**Migrations aplicadas:**
| # | Arquivo | Status |
|---|---------|--------|
| 0094 | `prestador_tracking_view.sql` | ✅ View `v_prestador_status` com tempo na tarefa/ocioso/classificação |

**Edge Functions:**
- `gojet-verify` ✅ Deployed — verificação pós-entrega (cron 5min), dual mode (GoJet API + snapshot fallback), retry até 7× (35min), Telegram alert em falha
- (F2) `bike-guard` já inclui bateria crítica 0%/5%

**Frontend:**
- `PrestadorStatusPanel.tsx` ✅ — painel com seções Em tarefa/Ocioso/Sem ação, badges 🟢🟡🔴⚫, tempo em minutos/horas, integrado na aba Operadores do GestorLogisticaPanel
- `TarefasLogisticaModule.tsx` ✅ — badges de bike_id_atual (🛴), gojet_verified (✅/❌) nos cards de tarefa, interface expandida com campos bike tracking

#### Próximas fases

| Fase | Status | O quê |
|------|--------|-------|
| **F0** | ✅ | cidade_config + zone_plan + import zonas + parking_history |
| **F1** | ✅ | Schema bike tracking + validar-bike + audit_log |
| **F2** | ✅ | Bike Guard + Swap + pontos especiais + verify queue |
| **F3** | ✅ | GoJet Verify (dual mode) + badges + prestador tempo ativo/ocioso |
| **F4** | ✅ | Command Center (15/15 blocos): KPIs, matriz zona, vazios, excesso, scouts, tarefas, pontos especiais, bateria crítica, mapa live, tempo médio, bateria frota, saúde pontos |
| **F5** | ✅ | Proximity + OSRM + auto-priorização + assign-tarefa Edge Function |
| **F6** | ✅ | Calendário ops especiais + export CSV |

#### F4 — Command Center (sessão 4)
- `frontend/src/components/CommandCenter.tsx` — 8 blocos implementados:
  - Bloco 1: KPI cards (vagas vazias, monitores, sem-monitor, com bike, excesso, total)
  - Bloco 5: Matriz por zona (frota, pontos, Mon∅, NM∅, Mon↑, NM↑) — clicável para filtro
  - Bloco 8: Estacionamentos vazios (★ monitores primeiro)
  - Bloco 9: Pontos com excesso (sorted por excedente)
  - Bloco 11: Scouts (em tarefa / ociosos / sem ação)
  - Bloco 12: Tarefas hoje (abertas / andamento / concluídas + progress bar)
  - Filtro por zona no topo
  - Auto-refresh 60s, i18n pt/en/es/ru
- Aba 🎯 Command Center adicionada no GestorLogisticaPanel (2ª posição)
- **Blocos pendentes:** 2/3 (comparativo/tendência), 6/7 (aluguéis), 10 (manhã/tarde), 13 (pontos especiais), 14 (mapa live), 15 (bateria crítica) — dependem de dados não populados ou componente Leaflet separado

#### F5 — Proximity + OSRM + Auto-priorização (sessão 4)
- Migration `0095_proximity_assign.sql`:
  - `nearest_available_scout(cidade, lat, lng, max_distance)` — PostGIS ST_DWithin + GIST index, filtra scouts em_tarefa, GPS >2h
  - `tarefa_priority_score(tarefa_id)` — score = tempo_pendente + tipo_tarefa + bateria_critica + bike_ids
  - View `v_tarefas_pendentes_ranked` — tarefas pendentes ordenadas por score
- Edge Function `assign-tarefa`:
  - Auto-assign: chama `nearest_available_scout` RPC → atribui ao mais próximo
  - Manual assign: aceita `scout_uid` direto
  - OSRM routing: `router.project-osrm.org/route/v1/bike/` → calcula rota + ETA
  - Salva `rota_osrm` (polyline) e `eta_minutos` na tarefa
  - Audit log automático
- Frontend `TarefasLogisticaModule.tsx`:
  - Badge 🕐 ETA no card da tarefa
  - Botão "🎯 Auto-Atribuir (scout mais próximo)" no detalhe de tarefas pendentes
  - Campos `eta_minutos`, `rota_osrm` mapeados no fetch

#### F6 — Calendário + Export CSV (sessão 4)
- `frontend/src/components/CalendarioOpsEspeciais.tsx`:
  - CRUD de pontos especiais (feriado, evento, manutenção, sazonalidade)
  - Calendar grid mensal com dots coloridos por tipo
  - Modal de edição com campos: nome, tipo, parking_id, data_inicio/fim, meta_override, ativo
  - Legenda de tipos com cores
  - Lista de eventos com badge ativo/inativo
- `frontend/src/components/ExportPanel.tsx`:
  - Export CSV de: snapshots, tarefas (hoje), tarefas (7 dias), prestadores status, eventos especiais
  - UTF-8 BOM para Excel compatibilidade
  - Download direto no browser
- Abas 📅 Calendário e 📤 Exportar adicionadas no GestorLogisticaPanel (admin only)

#### Pendências técnicas
- ~~`fetch-activity` excede resource limit~~ ✅ Otimizado: busca últimas 4h (não 24), delay 200ms entre requests, bail out após 10 erros.
- ~~`bike-guard` e `gojet-verify` precisam ser registrados como cron~~ ✅ Migration 0096 aplicada (pg_cron cada 5min).
- Policy `cc_anon_sel` (migration 0086) aplicar se necessário para users sem sessão Supabase.
- Testar GPS scouts (APK → `usuarios.ultima_pos`).
- Confirmar campo de meta/target nos parkings GoJet quando rate limit destravar.
- Command Center blocos restantes (3/15): 2/3 (comparativo/tendência), 6/7 (aluguéis), 10 (manhã/tarde) — dependem de parking_history populado.
- ~~Rota OSRM polyline rendering no mapa~~ ✅ `CommandCenterMap.tsx` com decode polyline + Leaflet rendering.
- ~~Offline queue no app scout~~ ✅ `offline-queue.ts` com localStorage + auto-flush on online. Integrado no BikeSwapDialog.

---

#### B5.x — Features avançadas (sessão 4-5)
- **B5.1** ✅ Alerta bike >72h — `checkBikesStale` em bike-guard, view `v_bikes_stale`, Telegram alert com dedup 24h via audit_log
- **B5.3** ✅ Score de saúde do ponto — 0-100 no CommandCenter (vazio -40, excesso -20, sem-monitor -10)
- **B5.4** ✅ Push pré-turno — `turnos_config` + `v_proximo_turno` + Edge Function `push-pre-turno` + cron 5min
- **B5.5** ✅ Comparativo cidades — `ComparativoCidades.tsx` integrado como aba admin no GestorLogisticaPanel
- **B5.6** ✅ Export CSV — ExportPanel (F6)
- **B5.7** ✅ Tempo médio por tipo — card no Command Center
- **B5.8** ✅ SLA visual no mapa — pulsing markers (amarelo >1x, vermelho >3x SLA)
- **B5.9** ✅ Auto-priorização — `tarefa_priority_score` (F5)
- **B5.10** ✅ Dashboard bateria da frota — histograma 6 faixas no CommandCenter
- **Offline queue** — `frontend/src/lib/offline-queue.ts`: localStorage queue com auto-flush on `online` event, retry 5x

#### F7 — Ganhos prestador em tempo real (sessão 5)
- Card "Ganhos de hoje" no topo do PagamentosModule
- Mostra tarefas concluídas hoje × valor_por_tarefa da cidade
- Disclaimer obrigatório: "Valor estimado. Sujeito a verificação semanal antes do pagamento."
- i18n completo (pt/en/es/ru)

**Pendentes B5.x:**
- **B5.2** Heatmap de aluguéis por hora — depende de confirmação do endpoint `/rentals` ou `/trips` da GoJet API

#### T2 — GoJet API fallback/cache (sessão 5)
- `gojetGetWithFallback` em bike-guard: tenta API, fallback para `bikes` table cache
- Timeout 8s no fetch GoJet
- `updateApiStatus` atualiza `gojet_api_status` (ok/degraded/down) em `cidade_config` a cada run
- Migration 0099: colunas `gojet_api_status` + `gojet_api_last_ok` em `cidade_config`

#### T3 — Rate limiting + abuse protection (sessão 5)
- `validar-bike`: rate limiter in-memory 10 req/min per uid
- Retorna 429 com `motivo: "rate_limit"` quando excede
- Fallback para `bikes` table cache quando GoJet API falha

#### F5 — ROI por cidade (sessão 5)
- Migration 0100: colunas `custo_estimado` + `receita_estimada` em `tarefas_logistica`
- View `v_roi_cidade`: custo/receita/ROI% por cidade (últimos 7 dias)
- `assign-tarefa` agora popula `custo_estimado` baseado em `pagamentos_config.valor_por_tarefa`
- Card ROI no Command Center: custo × receita × ROI% com cores

#### T1 — Realtime Supabase channels (sessão 5)
- `subscribeTarefas`, `subscribeSlots`: migrados de polling 8s para Supabase Realtime (`postgres_changes`)
- Fallback poll 60s como safety net
- GPS mantém polling 10s (tabela pode ser view)
- Migration 0101: `ALTER PUBLICATION supabase_realtime ADD TABLE tarefas_logistica, slots`
- Latência: ~10s → <1s para tarefas/slots

#### O2 — Detecção de fraude (sessão 5)
- Edge Function `fraud-check`: cron diário às 06:00 UTC
- 3 checks: velocidade suspeita (<5min, >50%), swap excessivo (>3/dia), GPS estático (>2km de tarefas)
- Dedup 24h via audit_log (`entidade=fraude_suspeita`)
- Telegram alert automático
- Seção "Alertas de fraude" na aba Alertas do GestorLogisticaPanel
- **Não bloqueia scout** — apenas alerta para decisão do gestor

#### O4 — Redistribuição inteligente pós-aluguel (sessão 5)
- Edge Function `redistribuicao`: cron 30min, analisa previsão de demanda
- Usa `v_demanda_por_hora` para prever parkings que vão esvaziar na próxima hora
- Encontra parking fonte mais próximo com excesso e cria tarefa `ORGANIZACAO` preventiva
- Dedup por título no mesmo dia
- Views: `v_demanda_por_hora`, `v_parkings_drain`, `v_fluxo_pontos`

#### O5 — Previsão de demanda (sessão 5)
- View `v_demanda_por_hora`: média móvel 28 dias por dia_semana × hora × parking
- Card "Previsão próxima hora" no Command Center com parkings em risco
- Alimenta O4 (redistribuição) automaticamente

#### T5 — Capacity planning (sessão 5)
- Views: `v_produtividade_scout`, `v_fleet_utilization`, `v_capacidade_recomendada`
- `v_capacidade_recomendada`: calcula scouts necessários por turno (8 tarefas/scout/turno)
- Card "Capacidade por turno" no Command Center: T0/T1/T2 com tarefas/dia + scouts recomendados

#### O1 — Handoff entre turnos (sessão 5)
- Edge Function `handoff-turno`: POST `{ tarefa_id, decisao: 'finalizar'|'passar' }`
- Finalizar: `overtime=true`, SLA +30min, audit_log
- Passar: `nearest_available_scout()` → reatribui, `handoff_count++`, push ao novo scout
- Botões "⏰ Finalizar (overtime)" e "🔄 Passar adiante" no detalhe de tarefas em_execucao
- Migration 0106: colunas `handoff_count`, `overtime`

#### O3 — Registro climático (sessão 5)
- Botão "🌧 Pausar por clima" no detalhe de tarefas em_execucao
- Registra `pausado_em`, `motivo_pausa='clima'`, `clima_registro` (Open-Meteo snapshot)
- NÃO pausa automaticamente — scout decide
- Migration 0106: colunas `pausado_em`, `motivo_pausa`, `clima_registro`

---

### § Sessão 6 — GoJet Cities, Performance & Bug Fixes (2026-06-29)

#### Fixes críticos

| Bug | Causa raiz | Fix |
|-----|------------|-----|
| GoJet "não configurado" para cidades ativas | `buscarCityId` lia de `gojet_config` (tabela antiga), não `cidade_config` | Reescrito para ler de `cidade_config` onde `id` = GoJet city_id |
| Sync GoJet falhava silenciosamente | Edge function `sync-gojet-cities` bloqueada por Cloudflare (server-side) | Migrado sync + importZonas para browser-side fetch (CORS aberto) |
| Snapshot "não existe" + botão sem efeito | `fetchGojetSnapshot` lia de tabelas `parkings/bikes` (processo antigo), não de `gojet_snapshots` (onde scraper salva) | Reescrito para ler de `gojet_snapshots` com `id=latest_{cityId}` |
| Cidades ativadas não aparecem no mapa | RPC `cidades_estacoes` só retornava cidades com estações em `estacoes` | RPC v2: UNION com `cidade_config` + `parkings` (via `unaccent`) + fallback lat/lng manual |
| "São Paulo" e "Sao Paulo" duplicados | RPC retorna ambos (estacoes sem acento, cidade_config com) | Dedup NFD no frontend, prevalece nome acentuado |
| Delete estação 400 Bad Request | `id.eq.{firebase_id}` — PostgREST rejeita non-UUID em coluna UUID | Helper `idFilter`: se UUID usa `id.eq OR firebase_id.eq`, senão só `firebase_id.eq` |
| Belo Horizonte/Brasília sem coordenadas | `cidade_config` não tinha lat/lng, sem parkings nem estações | Migration 0108: colunas `lat`/`lng` + seed de coordenadas de 10 capitais |

#### Migrations aplicadas

- **0107** `rpc_cidades_estacoes_v2.sql` — RPC expandida: 3 UNIONs (estações + parkings accent-insensitive + lat/lng manual). `CREATE EXTENSION unaccent`.
- **0108** `cidade_config_latlng.sql` — Colunas `lat`/`lng` em `cidade_config` + seed SP, SA, BC, BH, BSB, CWB, RJ, POA, FOR, SSA.

#### Performance (bundle -65%)

| Métrica | Antes | Depois |
|---------|-------|--------|
| Bundle principal (`index-*.js`) | 2,436 KB | 842 KB |
| Chunks lazy-loaded | 0 | 25+ painéis |
| Cache estações | nenhum | in-memory 5min TTL |
| Cache RPC cidades | nenhum | sessionStorage 10min |

**Lazy-loaded panels:** ZonasManager, UsuariosManager, DashboardManager, PainelConfiguracoes, MonitorPanel, TelegramVinculo, TelaPrestadorPerfil, AnalyticsManager, GuiaPanel, GoJetDashboard, GestorLogisticaPanel, PagamentosModule, PagamentosAdminPanel, SlotsTeamsModule, LiveWorkersPanel, PainelRoubos, GuardDashboard, PainelControlePerdasSeg, TarefasLogisticaModule, TurnoRegistro, GoJetAnalyticsPanel, ShiftPanel, GoJetOverlay, LocaisFinanceiro, POIPanel, StreetViewModal, FotoCaptura, FotoMedidas, CandidatosManager.

#### Arquitetura — fluxo GoJet corrigido

```
Browser                        Supabase
  │                               │
  ├─ fetch GoJet /cities ────►    │
  │  (CORS aberto)                │
  ├─ upsert cidade_config ──────► │  (cidade_config.id = GoJet city_id)
  │                               │
  ├─ fetch GoJet /techzones ──►   │
  ├─ upsert zones ──────────────► │  (zones.city = cityId ou nome)
  │                               │
  ├─ fetch GoJet /parkings ───►   │
  ├─ fetch GoJet /bikes ──────►   │
  ├─ upsert gojet_snapshots ───► │  (id = latest_{cityId} / bikes_latest_{cityId})
  │                               │
  ├─ fetchGojetSnapshot() ◄────── │  (lê gojet_snapshots)
  └─ buscarCityId() ◄──────────── │  (lê cidade_config, não gojet_config)
```

**⚠ Edge function `sync-gojet-cities`**: ainda existe mas `sync` e `import-zones` actions estão obsoletas (browser-side agora). Só `fetch-activity` ainda usa a edge function (ML API).

#### Limpeza

- Removidos: `frontend/({`, `functions/{` (diretórios com nomes malformados), `teste.js`, `frontend_files.txt`, `functions_files.txt`, `firebase-debug.log`
- Map pins: removido badge de contagem de estações
- Seletor de cidades: badge só aparece se count > 0, removido sufixo "est."

#### Arquivos modificados (commit `94ea584`)

- `frontend/src/views/TelaMapa.tsx` — lazy imports, dedup cidades, idFilter, cache RPC, Suspense
- `frontend/src/lib/cidade-config.ts` — sync/import browser-side, buscarCityId de cidade_config
- `frontend/src/lib/analytics-supabase.ts` — fetchGojetSnapshot de gojet_snapshots
- `frontend/src/lib/estacoes-supabase.ts` — cache in-memory 5min + invalidarCacheEstacoes
- `frontend/src/components/GoJetOverlay.tsx` — zones query por nome ou cityId
- `supabase/migrations/0107_rpc_cidades_estacoes_v2.sql`
- `supabase/migrations/0108_cidade_config_latlng.sql`

*Atualizado em 2026-06-29. Referencia: sessões F0-F7 + T1-T5 + O1-O5 + F5 ROI + B5.x + CC 19 blocos + offline queue + §6 GoJet/perf.*
