# Jet OS — Onboarding Guide

## What is Jet OS?
Jet OS is an operations management platform for shared bike/scooter services. It provides real-time fleet monitoring, workforce scheduling, zone management, and GoJet integration through a map-centric web app.

## Tech Stack
- **Frontend:** React + Vite + TypeScript + Leaflet + deck.gl
- **Hosting:** Firebase Hosting (`jet-os-1.web.app`)
- **Backend:** Supabase (PostgreSQL + PostgREST + Edge Functions) — migrating from Firebase/Firestore
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
frontend/src/components/           — Feature panels (SlotsTeams, GoJet, Guard, etc.)
frontend/src/lib/                  — Supabase client helpers (*-supabase.ts)
frontend/src/i18n/                 — Translation files (pt/en/es/ru.json)
functions/src/                     — Cloud Functions (TypeScript source)
supabase/functions/                — Supabase Edge Functions (Deno/TypeScript)
supabase/migrations/               — SQL migrations (0001–0076)
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

### Slot Generation Engine
- Unified engine per city via `escala_config` table (faixas, perfis, mapa_dias, zonas)
- Edge Function `gerar-slots-escala` generates slots idempotently
- GoJet live data adjusts slot counts based on zone deficit/surplus/low-battery
- Backward-compatible with legacy `turnosConfig`

### GoJet Integration
- Zone detection from parking names via emoji prefix (🟥→Z1, ⬛→Z2, etc.)
- Auto-discover zones: queries `parkings` by `city_id`, populates `zonas_ativas`
- GoJet layer auto-enables when city has `gojet_config`

### FAB Organization (6 visible groups)
1. **🛠 Ferramentas** — Locais + POIs + SV tools (gestor only)
2. **🗺 Camadas** — Satellite, Cycleways, Zones, Radius
3. **🛴 GoJet** — Layer + Dashboard + Analytics + Shifts
4. **⏱ Turno** — Shift registration (campo/logistica/motorista)
5. **🛡 Guard** — Incident reporting
6. **🧭 Localização** — GPS location

## Common Pitfalls
1. **Never use `--project jet-os-7`** — production is `jet-os-1`
2. **Shell:** User uses `cmd` (Prompt de Comando), not PowerShell
3. **PostgREST on_conflict:** Must match a UNIQUE CONSTRAINT, not just an index
4. **Cloud Run CPU quota:** Deploy functions individually in sa-east1, use `maxInstances:10`
5. **Telegram webhook:** Must be manually registered via `setWebhook` after deploy
6. **Firebase UID ≠ Supabase UUID:** Use `session.user.id` for Supabase, not `usuario.uid`
7. **Edge Function deploy:** Use `--project-ref`, not `--linked`

## Current Pending Work
| Priority | Item |
|---|---|
| 🔴 Critical | Rotate Supabase service_role key (exposed) |
| 🔴 Critical | Move keystore password from build.gradle to env var |
| 🟡 High | Prestadores (service providers) workflow |
| 🟡 High | Verify escala_config seed — SP vs global row |
| 🟢 Medium | NFS-e automatic invoice module |
| 🟢 Medium | Remove duplicate satellite button (FAB + bottom-center) |
