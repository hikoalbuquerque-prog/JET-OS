# Chat in-app JET OS — mini design doc (para revisão jurídica + planejamento)

> Status: **proposta**. Construir **pós-portão GPS / cutover Supabase**, com **sign-off do jurídico** (ver §6).

## 1. Objetivo
Canal de comunicação **corporativo** entre equipe (campo/logística/guard) e gestão, dentro do app, com as conversas **armazenadas** e **acessíveis aos gestores** (oversight + trilha de dados para análise).

⚠️ **Não é mensageiro privado.** É um canal **monitorado pela empresa** — isso muda o desenho legal (§6) e como é comunicado ao usuário.

## 2. Decisões de arquitetura
- **Plataforma: Supabase** (Postgres + Realtime). Motivo: estamos migrando do Firebase → não criar dívida nova nele. Realtime via `supabase.channel()`/Postgres changes.
- **Auth:** sessão Supabase já existente (a mesma do GPS — `auth-login`/`jet_supa_refresh`).
- **Notificações:** reusar o que já existe (Telegram + push) para avisar mensagem nova.

## 3. Modelo de dados (Postgres / RLS)
```
conversas
  id uuid pk
  tipo text           -- 'direta' | 'grupo' | 'suporte'
  titulo text         -- p/ grupos
  cidade text
  criado_em timestamptz

conversa_participantes
  conversa_id uuid fk
  uid uuid fk usuarios(id)
  papel text          -- 'membro' | 'gestor'
  PRIMARY KEY (conversa_id, uid)

mensagens
  id uuid pk
  conversa_id uuid fk
  autor_uid uuid fk
  texto text
  anexo_url text       -- foto opcional (câmera nativa, JPEG)
  criado_em timestamptz
  editada_em timestamptz null
  -- imutável p/ trilha: sem delete físico; "apagar" = marcar oculta_em

mensagem_leituras
  mensagem_id uuid fk
  uid uuid fk
  lida_em timestamptz
```
**RLS:**
- Participante lê/escreve nas suas conversas.
- **Gestão (admin/gestor/supergestor/gestor_seg) lê TODAS** as conversas da(s) sua(s) cidade(s) — base do oversight.
- Mensagens **não deletáveis** fisicamente (trilha auditável); "apagar" só oculta na UI.

## 4. Telas (frontend)
1. **Lista de conversas** — últimas mensagens, não-lidas, busca.
2. **Conversa** — bolhas, anexar foto (usa `imageUtils.capturarFotoNativa`, já HEIC-safe), indicador de lida.
3. **Compor / nova conversa** — escolher pessoa(s)/grupo.
4. **Painel de gestão** — gestor navega/filtra todas as conversas (cidade, pessoa, período) + **export** (CSV) para os "dados das conversas".

i18n desde o início (pt/en/es/ru) — público de campo es/ru.

## 5. Fases de implementação (estimativa)
1. **Schema + RLS** no Supabase (0,5–1 dia).
2. **Realtime + lista/conversa** (2–3 dias).
3. **Anexos + leituras + notificações** (1–2 dias).
4. **Painel de gestão + export** (1–2 dias).
5. **i18n + testes** (1 dia).
≈ **6–9 dias** de dev.

## 6. ⚠️ LGPD + trabalhista (BLOQUEADOR — resolver antes de codar)
Armazenar conversas de funcionários e dar acesso à gestão = **monitoramento de comunicação**. Exige:
1. **Transparência obrigatória** (LGPD art. 9º): o funcionário precisa ser **informado, de forma clara**, de que as conversas são **gravadas e acessíveis à gestão**. → incluir no **Termos de Uso + Política de Privacidade** (já temos os gates: `TermosUsoGate`/`LgpdConsentGate` — adicionar cláusula + **incrementar a versão** para forçar novo aceite).
2. **Finalidade e proporcionalidade**: definir e declarar o porquê (ex.: segurança operacional, registro de instruções de serviço). Evitar coleta excessiva.
3. **Base legal**: legítimo interesse / execução de contrato — confirmar com jurídico.
4. **Retenção**: definir prazo de guarda das mensagens.
5. **Risco trabalhista**: monitoramento de comunicação pessoal pode gerar passivo. Deixar explícito que é **canal de trabalho**, não pessoal.

**Recomendação:** levar este doc ao jurídico para (a) aprovar o monitoramento/armazenamento, (b) redigir a cláusula dos Termos, (c) definir retenção. Só então implementar.

## 7. Decisões em aberto (para o produto)
- Conversas **diretas** entre funcionários, ou só **funcionário↔gestão/suporte**? (quanto mais "social", maior o risco legal)
- Grupos por cidade/equipe?
- Gestor pode **escrever** em qualquer conversa ou só **ler**?
- Export/retenção: por quanto tempo guardar?
