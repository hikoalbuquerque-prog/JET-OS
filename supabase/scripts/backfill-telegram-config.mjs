#!/usr/bin/env node
// backfill-telegram-config.mjs — copia telegram_config do Firestore → Supabase.
// Uso: node supabase/scripts/backfill-telegram-config.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

if (!getApps().length) initializeApp();
const db = getFirestore();
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const snap = await db.collection('telegram_config').doc('global').get();
  if (!snap.exists) { console.log('telegram_config/global não existe no Firestore'); return; }
  const d = snap.data();
  console.log('Firestore telegram_config:', { botToken: d.botToken ? '***' : 'VAZIO', botUsername: d.botUsername });

  const { error } = await supa.from('telegram_config').upsert({
    id: 'global',
    bot_token: d.botToken || null,
  }, { onConflict: 'id' });

  if (error) { console.error('Erro upsert:', error); process.exit(1); }
  console.log('OK — telegram_config sincronizado no Supabase');
}

main().catch(e => { console.error(e); process.exit(1); });
