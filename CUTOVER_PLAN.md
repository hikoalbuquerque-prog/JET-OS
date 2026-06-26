# Supabase Fase 2 — Plano de Cutover (Auth + Dados)

> Migração Firebase → Supabase. **Faseada, por domínio, atrás de flag, com rollback.** O flip do Auth é o ÚLTIMO passo. GPS (o portão) já passou ✅.

## Estado atual (20/06)
- **Supabase já ativo (dual-run):** GPS, analytics (`VITE_ANALYTICS_PROVIDER`), slots, escala. 24 migrations aplicadas.
- **Auth:** Firebase primário + sessão-sombra Supabase (`auth-login`/`jet_supa_refresh`).
- **Ainda no Firestore (~25 coleções, 45 arquivos):** estacoes(23), ocorrencias(19), usuarios(16), poligonos(13), slots(11), tarefas_logistica(9), tarefas(8), disponibilidades(6), prestadores(5), slot_aceites(5), turnos(4), solicitacoes_prestadores(4), pagamentos_semana(4), locais_operacionais(4), penalidades(3), pagamentos_locais(3), feriados(3), config_auto_slots(3), turnos_logistica(2), pagamentos_config(2), monitor_alertas(2), etc.

## Padrão de cada estágio (repetível)
1. **Schema** no Supabase (tabela + RLS) — migration.
2. **Backfill** dos dados Firestore → Supabase (script idempotente, mapeando uid via `uid-map.json`).
3. **Lib dual-run** (`<dominio>-supabase.ts`) + flag.
4. **Trocar reads/writes** do módulo (atrás do flag) Firestore → Supabase.
5. **Verificar** (paridade de dados, RLS, fluxo no app) → ligar o flag.
6. **Espelhamento temporário** (dual-write) durante a transição p/ não perder dado novo.

## Ordem sugerida (menor → maior risco)
**Onda A — leitura pesada, escrita rara (baixo risco):**
1. `estacoes` + `poligonos` (mapa) — núcleo, muito lido, muda pouco.
2. `locais_operacionais` / financeiro.

**Onda B — operacional (médio):**
3. `ocorrencias` (Guard) — já espelhado p/ Supabase (mirror); falta ler de lá.
4. `tarefas` / `tarefas_logistica`.
5. `prestadores` / `disponibilidades` / `turnos` / `penalidades`.
6. `pagamentos_*`.

**Onda C — Auth (alto risco, POR ÚLTIMO):**
7. `usuarios` como mestre no Supabase (já pré-provisionado).
8. Flip do login: app loga direto no Supabase; autorização via RLS.
9. Aposentar dual-auth (`auth-login` shim) e Firebase Auth.

## Pré-requisitos antes do flip de Auth
- TODAS as leituras/escritas dos módulos já em Supabase (ondas A+B completas), OU mantidas com fallback.
- RLS revisada por tabela (quem lê/escreve o quê).
- Plano de rollback por flag (poder voltar cada domínio pro Firestore).
- Backfill final + janela de dual-write pra não perder dado em trânsito.

## ⚠️ BLOQUEIO DESCOBERTO (21/06) — sessão JS precisa vir ANTES dos read-switches
Piloto das estações revelou: ler do Supabase no JS exige **sessão autenticada** (RLS). Teste: token de usuário → lê; sem sessão (só anon) → **0 linhas silenciosas**. Hoje o cliente JS é **session-less** porque compartilha o refresh token com o GPS nativo (se o JS renovasse, invalidaria o token do GPS). Logo, ligar read-switch agora = mapa esvazia em silêncio após ~1h/reload.
**Reordenação:** o **precursor de sessão JS** sobe na fila — desacoplar a sessão do JS da sessão do GPS nativo (auth-login separados / famílias de refresh token distintas; JS com autoRefresh próprio, GPS faz login próprio no check-in). Só depois disso os read-switches (estações/zonas/etc.) ficam seguros.
View `estacoes_geo` (migration 0027, security_invoker) já criada e validada — pronta pra quando a sessão estiver resolvida.

**✅ RESOLVIDO (21/06) — desacoplamento de sessão + piloto de leitura (web):**
- `supabase.ts`: cliente JS agora `persistSession:true, autoRefreshToken:true` (sessão A gerenciada, sobrevive reload/renova).
- `supabase-auth.ts`: `estabelecerSessaoSupabase` faz **2 auth-logins** → sessão B (refresh token em `localStorage['jet_supa_refresh']`, p/ o GPS nativo) e sessão A (setSession no cliente JS). Famílias independentes → renovar A não invalida B (GPS).
- `estacoes-supabase.ts`: `carregarEstacoesSupabase(cidade)` (lê `estacoes_geo`) + flag `mapaProviderSupabase()` via `localStorage['jet_mapa_provider']='supabase'` (toggle por browser, sem afetar ninguém) ou `VITE_MAPA_PROVIDER`.
- `TelaMapa`: leitura de estações ramificada atrás do flag (Supabase = carga única por cidade; Firestore = onSnapshot original). **Read-only** (writes ainda Firestore — dual-write é o próximo passo).
- **Deploy WEB only** — APK instalada (build 23:24) NÃO muda → GPS no celular intacto. Re-verificar GPS quando a APK for rebuildada com este código.
- ✅ **Leitura validada no app** (paridade + persiste reload). ✅ **Dual-write** via Cloud Function `espelharEstacaoSupabase` (migration 0028 firebase_id único; onDocumentWritten estacoes → upsert/delete no Supabase por firebase_id; usa SUPABASE_URL/SERVICE_ROLE do functions/.env; testado create→upsert / delete→remove). **Domínio estações = dual-run COMPLETO** (read+write+sessão). Falta só **realtime** (hoje carga única por cidade — minor).
- **Template provado.** ✅ **Replicado pra ZONAS e LOCAIS (21/06):** migration 0029 (views `zonas_geo` com GeoJSON / `locais_geo` lat-lng + firebase_id único); read libs `carregarZonasSupabase` (parse GeoJSON→pontos) / `carregarLocaisSupabase` no mesmo flag `mapaProviderSupabase`; switches em TelaMapa (polígonos), ZonasManager, LocaisFinanceiro; mirrors `espelharZonaSupabase` (poligonos→zonas, geom EWKT, campos pontos|poligono) + `espelharLocalSupabase` (deployados). **ONDA A = read+write completa no Supabase, atrás de flag, com dual-write.** Falta só realtime (carga única — minor).
- **Validar no app:** com `localStorage['jet_mapa_provider']='supabase'`, o mapa carrega estações+zonas do Supabase e a aba financeiro/locais idem.

## ✅ Onda B — ocorrências/Guard (read switch, 21/06)
Mirror de escrita (`espelharOcorrenciaSupabase`) já existia. Adicionado:
- **migration 0030** — view `ocorrencias_geo` (`security_invoker`): expõe `lat/lng` (de `geo`) + `registrado_por_uid` (join `usuarios.firebase_uid`) p/ casar com o app.
- **read lib** `frontend/src/lib/ocorrencias-supabase.ts`: `guardProviderSupabase()` (flag **separada** do mapa — `localStorage['jet_guard_provider']='supabase'` ou `VITE_GUARD_PROVIDER`), `carregarMinhasOcorrenciasSupabase` (registrador), `carregarOcorrenciasSupabase` (gestor, filtros cidade/status/desde/limit), `buscarOcorrenciaSupabase` (codigo→asset_id). `mapRow` traduz snake_case→shape do app (mantém lat_inicial+lat, cidade_inicial+cidade etc); `canonStatus` restaura status capitalizado (mirror grava lowercase).
- **Read switch (8 arquivos, atrás da flag, READ-ONLY — escrita segue Firestore):** TelaGuard (minhas, 24h), GuardDashboard, PainelRoubos, PainelControlePerdasSeg, SlotsModule (aba ocorrências), TelaMapa (KPIs), AnalyticsManager (incidentes histórico + heatmap Guard), AppShell (GuardOverlay), DashboardManager (export CSV + export XLSX + auditor de busca). Datas ISO tratadas onde havia `criadoEm?.toDate()`.
- **Não tocado:** `slots-schema.ts ouvirOcorrencias` = código morto (nunca importado, status 'aberta'/'em_tratamento' não bate com os dados).
- ⚠️ **Falta:** aplicar migration 0030; validar paridade no app com a flag ligada; **realtime** (hoje carga única — perde o onSnapshot ao vivo). Escrita ainda Firestore (dual-write via mirror).

## ✅ Onda B menores — solicitacoes_prestadores + turnos_logistica (21/06)
Estas NÃO tinham mirror. Adicionado read switch + dual-write:
- **migration 0031** (aplicada) — `firebase_id` único NÃO-parcial em ambas (a 0026 era parcial; PostgREST `on_conflict` não aceita parcial).
- **mirrors** `functions/src/mirror-onda-b-menores.ts` (`espelharSolicitacaoPrestadorSupabase` / `espelharTurnoLogisticaSupabase`, onDocumentWritten upsert/delete por firebase_id, mapeamento idêntico ao `backfill-wave-b.mjs`). Registrados no index e **DEPLOYADOS** (deploy cirúrgico, jet-os-1/southamerica-east1).
- **read lib** `frontend/src/lib/onda-b-supabase.ts`: flag `logisticaProviderSupabase()` (`localStorage['jet_logistica_provider']='supabase'` ou `VITE_LOGISTICA_PROVIDER`). `carregarSolicitacoesPendentesSupabase` / `carregarTurnosLogisticaSupabase`.
- **read switch:** UsuariosManager (solicitações pendentes) + GestorLogisticaPanel/AbaPresença (turnos do dia). Escrita ainda Firestore (agora espelhada).
- ⚠️ **Falta:** validar paridade no app com a flag ligada.
- **VAZIAS no Firestore (sem ação):** tarefas, prestadores, config_auto_slots, pagamentos_semana — criar tabela+mirror só quando tiverem dado.

## 🟡 Onda C — Auth (groundwork REVERSÍVEL feito 21/06; flip irreversível PENDENTE)

⚠️ **BLOQUEIO p/ o flip real:** toda ESCRITA do app ainda exige Firebase Auth (`request.auth != null` nas regras Firestore — ocorrências, slots, escala, usuarios, turnos…). Só leituras de alguns domínios migraram. **Aposentar o Firebase Auth (C.9) agora quebraria todas as escritas em produção.** Pré-req do flip continua: migrar as ESCRITAS (ou mantê-las com fallback) ANTES.

**✅ Groundwork reversível (não toca o login nem aposenta nada):**
- **migration 0032** (aplicada) — `usuarios.paises text[]` (schema pronto p/ o perfil vir 100% do Supabase).
- **flag** `authProviderSupabase()` (`localStorage['jet_auth_provider']='supabase'` / `VITE_AUTH_PROVIDER`). Liga SÓ a **fonte do perfil** (role/paises/nome): `useAuth` carrega de `public.usuarios` (por `firebase_uid`) em vez do Firestore. Firebase segue PRIMÁRIO (sessão + escritas + token do GPS intactos). Miss/erro → fallback Firestore.
- `carregarPerfilSupabase` em `frontend/src/lib/supabase-auth.ts`; mantém `uid`=firebase_uid (escritas filtram por uid Firebase). `paises` cai no fallback Firestore enquanto não backfillado.
- **RLS revisada:** `usuarios_sel` (`id = auth.uid() or is_gestor()`) cobre o auto-perfil sob a sessão A (persiste no reload). ✅
- **Rollback:** `jet_auth_provider`='firebase' (ou remover) volta tudo na hora.
- ✅ **Backfill `paises` FEITO (21/06):** `supabase/scripts/backfill-paises.mjs` (idempotente, DRY_RUN opcional, filtra lixo "[]"/"{}", só atualiza linhas existentes). Rodado: 56/57 usuarios com paises real; **0 usuarios sem firebase_uid** (loader acha todos). Ressalva: 1 admin (`uvMiotPn`) tem `paises=["[]"]` + `nome=null` no Firestore (dado sujo pré-existente; inofensivo — admin ignora escopo de país).
- ✅ **Validado (camadas verificáveis):** `npm run build` OK; amostra por role no Supabase confirma role+paises corretos (gestor/guard/logistica = ["BR"]). ⏳ **Falta só a validação RUNTIME** (precisa credenciais reais): logar com `localStorage['jet_auth_provider']='supabase'` e conferir role/paises na sessão + GPS intacto + reload mantém sessão A.
- **Rodar o backfill:** de `supabase/scripts/`, com SUPABASE_URL/SUPABASE_SERVICE_ROLE (de `functions/.env`) + GOOGLE_APPLICATION_CREDENTIALS (`serviceAccountKey-jet-os-1.json`); `SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE node backfill-paises.mjs`.

**Sequência do flip real (futuro, sessão dedicada, POR ÚLTIMO):**
1. Migrar ESCRITAS dos módulos p/ Supabase atrás de flag (pré-req duro).
   - ✅ **ocorrências FEITO (21/06):** migration 0033 (RLS escrita), helpers em `ocorrencias-supabase.ts`, dual-write em todos os sites atrás da flag `jet_guard_write` (default OFF). Mirror já cobre create+update+delete. Falta: validar no app + próximos domínios (slots/escala/turnos/usuarios).
2. C.8 — login primário no Supabase (Firebase vira secundário só enquanto restar escrita Firestore).
3. C.9 — aposentar dual-auth (`auth-login` shim) + Firebase Auth. Plano de rollback por flag + janela de dual-write.

## Riscos / regras
- **Nunca** virar tudo de uma vez. Um domínio por vez, com flag e verificação.
- Manter **dual-write** no domínio em transição até confirmar paridade.
- Auth por último — é o único verdadeiramente irreversível.
- Cada onda: backfill idempotente + conferência de contagem Firestore vs Supabase.

## Status de execução
- [~] **Onda A.1 estacoes+poligonos** — ✅ DADOS backfillados (estacoes 1458, zonas 43; migration 0025 add firebase_id; script `backfill-wave-a.mjs`). ⏳ FALTA: lib dual-run de leitura + trocar reads/writes do TelaMapa/ZonasManager (atrás de flag) + dual-write. Nota: poligonos no Firestore usam 2 campos (`pontos` OU `poligono`) — o backfill cobre os dois.
- [~] **Onda A.2 locais/financeiro** — ✅ DADOS: locais_operacionais (4) backfillado. ⏳ FALTA: contratos_locais/pagamentos_locais backfill + lib + switch do LocaisFinanceiro.
- **Próximo passo da leitura (geo):** as tabelas geo retornam `geography`; criar view/RPC que exponha `ST_Y(geo) as lat, ST_X(geo) as lng` (e GeoJSON p/ zonas) pra lib de leitura. Reads/writes atrás de flag novo (ex.: `VITE_MAPA_PROVIDER`), com dual-write, verificando paridade no app ANTES de ligar.
- [~] **Onda B (DADOS) ✅** — migration 0026 + `backfill-wave-b.mjs`. Backfillado: `solicitacoes_prestadores` (35), `turnos_logistica` (41, tabela nova), `pagamentos_config` (1, SP). Demais coleções da onda VAZIAS no Firestore (tarefas, tarefas_logistica, turnos, prestadores, prestadores_fiscal, pagamentos_semana, config_auto_slots = 0 docs) → sem dado a migrar. **NÃO tocadas (vivas via dual-run):** slots, disponibilidades, slot_aceites, penalidades, feriados, ocorrencias. ⏳ FALTA (switch): trocar reads/writes dos módulos Guard/tarefas/prestadores/pagamentos quando forem ativados, e backfill incremental se as coleções vazias passarem a ter dado.
  - Tabelas ainda inexistentes (criar quando o domínio for ativado, hoje sem dado): `tarefas`, `prestadores`, `config_auto_slots`.
- [ ] Onda C.7 usuarios mestre
- [ ] Onda C.8 flip login
- [ ] Onda C.9 aposentar dual-auth + Firebase
