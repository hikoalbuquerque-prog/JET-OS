# Jet OS — Onboarding Guide

## What is Jet OS?
Jet OS is an operations management platform for shared bike/scooter services. It provides real-time fleet monitoring, workforce scheduling, zone management, task automation, fraud detection, and GoJet integration through a map-centric web app.

## Tech Stack
- **Frontend:** React + Vite + TypeScript + Leaflet + deck.gl
- **Hosting:** Firebase Hosting (`jet-os-1.web.app`)
- **Backend:** Supabase (PostgreSQL + PostgREST + Edge Functions + Realtime) — migrating from Firebase/Firestore
- **Cloud Functions:** Node.js 22 on Cloud Run (Firebase Functions Gen2)
- **Mobile:** Android APK (Capacitor-based, GPS tracking)
- **i18n:** 4 languages (pt/en/es/ru) via i18next

## Project IDs
- **Firebase:** `jet-os-1`
- **Supabase:** `ducdbrupxpzqcblfreqn`
- **Production URL:** https://jet-os-1.web.app

## Key Directories
```
frontend/src/views/TelaMapa.tsx    — Main map view (~3800 lines), FABs, panels
frontend/src/components/           — Feature panels (SlotsTeams, GoJet, Guard, CommandCenter, etc.)
frontend/src/lib/                  — Supabase client helpers (*-supabase.ts), offline-queue
frontend/src/i18n/                 — Translation files (pt/en/es/ru.json)
functions/src/                     — Cloud Functions (TypeScript source)
supabase/functions/                — Supabase Edge Functions (Deno/TypeScript)
supabase/migrations/               — SQL migrations (0001–0106)
```

## Deploy Commands
```bash
# Frontend (most common)
cd frontend && npm run build && cd .. && npx firebase deploy --only hosting --project jet-os-1

# Edge Functions
npx supabase functions deploy <name> --project-ref ducdbrupxpzqcblfreqn --no-verify-jwt

# Migrations
npx supabase db push --linked

# Cloud Functions (careful — CPU quota in sa-east1, deploy individually)
cd functions && npm run build && cd .. && npx firebase deploy --only functions:<name> --project jet-os-1
```

## Architecture Decisions

### Supabase Migration (Strangler Pattern)
- Firebase→Supabase migration is in progress, phase by phase
- New features go Supabase-first; legacy reads still hit Firestore as fallback
- PostgREST requires **UNIQUE CONSTRAINT** (not just index) for `on_conflict` upsert
- After DDL changes: `NOTIFY pgrst, 'reload schema'`
- PostGIS requires `search_path=public,extensions,topology`

### Supabase Realtime (T1)
- `tarefas_logistica` and `slots` tables are in the `supabase_realtime` publication
- Frontend uses `postgres_changes` channels with 60s polling fallback
- GPS still uses 10s polling (table structure TBD)

### Slot Generation Engine
- Unified engine per city via `escala_config` table (faixas, perfis, mapa_dias, zonas)
- Edge Function `gerar-slots-escala` generates slots idempotently
- GoJet live data adjusts slot counts based on zone deficit/surplus/low-battery
- Backward-compatible with legacy `turnosConfig`

### GoJet Integration
- Zone detection from parking names via emoji prefix (🟥→Z1, ⬛→Z2, etc.)
- Auto-discover zones: queries `parkings` by `city_id`, populates `zonas_ativas`
- GoJet layer auto-enables when city has `gojet_config`
- API fallback: `validar-bike` and `bike-guard` fall back to cached `bikes` table when GoJet API is down
- `gojet_api_status` on `cidade_config` tracks API health (ok/degraded/down)

### Command Center (19 blocos)
- KPI dashboard: empty/excess parkings, scouts, tasks, battery histogram, health score
- Demand prediction: `v_demanda_por_hora` (28-day moving average by dow×hour)
- ROI card: cost vs revenue per city (7 days)
- Capacity planning: recommended scouts per shift per city
- Live map: Leaflet with dark tiles, SLA pulsing markers, OSRM polylines
- City comparison tab (`ComparativoCidades`)

### Task Automation Pipeline
- `assign-tarefa`: auto/manual assignment with OSRM routing + ETA
- `tarefa_priority_score()`: scoring based on time pending + task type + battery
- `nearest_available_scout()`: PostGIS proximity search
- `redistribuicao`: cron 30min, creates preventive rebalancing tasks from demand prediction
- Offline queue: localStorage-based with auto-flush on `online` event

### Fraud Detection (O2)
- `fraud-check`: daily cron at 06:00 UTC
- 3 checks: speed fraud (<5min completion), swap abuse (>3/day), static GPS
- Alerts in `audit_log` + Telegram, shown in Alertas tab
- Does NOT block scouts — gestor decides

### Shift Handoff (O1)
- `handoff-turno`: scout chooses "finish (overtime +30min)" or "pass to next shift"
- Auto-reassigns via `nearest_available_scout()`, push notification to new scout

### Payments (F7)
- `PagamentosModule`: weekly task tracking + NF upload flow
- Daily earnings card: real-time estimated value with mandatory disclaimer
- `pagamentos_config` per city with `valor_por_tarefa`

### FAB Organization (6 visible groups)
1. **🛠 Ferramentas** — Locais + POIs + SV tools (gestor only)
2. **🗺 Camadas** — Satellite, Cycleways, Zones, Radius
3. **🛴 GoJet** — Layer + Dashboard + Analytics + Shifts
4. **⏱ Turno** — Shift registration (campo/logistica/motorista)
5. **🛡 Guard** — Incident reporting
6. **🧭 Localização** — GPS location

### Edge Functions (deployed)
| Function | Purpose | Schedule |
|---|---|---|
| `assign-tarefa` | Auto/manual task assignment + OSRM routing | On demand |
| `bike-guard` | Monitor bikes in transit, battery, stale >72h | Cron 5min |
| `gojet-verify` | Post-delivery verification | Cron 5min |
| `validar-bike` | Bike validation with rate limit (10/min/uid) | On demand |
| `fraud-check` | Daily fraud pattern detection | Cron daily 06:00 UTC |
| `redistribuicao` | Preventive rebalancing from demand prediction | Cron 30min |
| `handoff-turno` | Shift handoff (overtime / pass) | On demand |
| `push-pre-turno` | Push notification 30min before shift | Cron 5min |
| `sync-gojet-cities` | Sync GoJet parking/bike/activity data | Cron varies |

## Common Pitfalls
1. **Never use `--project jet-os-7`** — production is `jet-os-1`
2. **Shell:** User uses `cmd` (Prompt de Comando), not PowerShell
3. **PostgREST on_conflict:** Must match a UNIQUE CONSTRAINT, not just an index
4. **Cloud Run CPU quota:** Deploy functions individually in sa-east1, use `maxInstances:10`
5. **Telegram webhook:** Must be manually registered via `setWebhook` after deploy
6. **Firebase UID ≠ Supabase UUID:** Use `session.user.id` for Supabase, not `usuario.uid`
7. **Edge Function deploy:** Use `--project-ref`, not `--linked`
8. **tarefa_kind enum:** Values are `PONTO`, `PATINETE`, `ORGANIZACAO`, `CARGA_BATERIA` (NOT `zero_fill`)
9. **tarefas_logistica columns:** `kind` (not `tipo`), `criado_em` (not `updated_at`), `em_execucao` (not `em_andamento`)
10. **Supabase PromiseLike:** Wrap in `Promise.resolve()` if you need `.catch()`

## Current Pending Work
| Priority | Item | Blocked by |
|---|---|---|
| 🔴 Critical | Rotate Supabase service_role key (exposed) | — |
| 🔴 Critical | Move keystore password from build.gradle to env var | — |
| 🟡 High | Verify APK GPS populates `usuarios.ultima_pos` | Test on device |
| 🟢 Medium | NFS-e automatic invoice module | Legal/board decision |
| 🟢 Medium | B5.2 Heatmap de aluguéis | GoJet `/rentals` endpoint TBD |
| ⚪ Low | CC Blocos 2/3/6/7/10 (tendência, aluguéis) | Need 4+ weeks `parking_history` |
| ⚪ Low | Skeleton loaders (24 panels remaining) | UX polish |
