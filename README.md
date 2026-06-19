# JET OS

Sistema operacional interno da Jet para gestão de operações de micromobilidade.

**URL produção:** https://jet-os-1.web.app  
**Firebase project:** `jet-os-1`  
**Região:** `southamerica-east1`

---

## Stack

- **Frontend:** React + Vite + TypeScript + Leaflet + deck.gl (Capacitor para Android)
- **Backend:** Firebase Cloud Functions v2 (Node.js 22)
- **Banco:** Firestore + Firebase Storage
- **Auth:** Firebase Authentication (Email/Password)

---

## Estrutura de arquivos principais

```
frontend/src/
  App.tsx                          — componente principal (~6500+ linhas), mapa, modais, FABs
  UsuariosManager.tsx              — gestão de usuários e aprovação de prestadores
  AnalyticsManager.tsx             — analytics deck.gl, upload XLSX
  DashboardManager.tsx             — dashboard + exportação
  ZonasManager.tsx                 — editor de polígonos/vértices
  TelaGuard.tsx                    — tela de segurança (guardas)
  TelaPrestadorPerfil.tsx          — perfil do prestador (dados, PIX, Telegram)
  GuiaPanel.tsx                    — painel do guia/scout
  MonitorPanel.tsx                 — monitoramento de slots em tempo real
  LogisticaModule.tsx              — módulo de logística
  SlotsModule.tsx                  — gestão de slots/baterias
  EstacoesCampo.tsx                — visão de campo das estações

  components/
    FotoMedidas.tsx                — editor de medidas sobre foto (Konva)
    FotoCaptura.tsx                — captura de foto com câmera
    PagamentosModule.tsx           — módulo de pagamentos do prestador (NF semanal)
    PagamentosAdminPanel.tsx       — painel admin de pagamentos (NFs + config)
    MonitorConfigPanel.tsx         — configuração de thresholds M1/M2/M3
    TarefasLogisticaModule.tsx     — tarefas de logística com GPS
    GoJetOverlay.tsx               — overlay GoJet com painéis integrados
    CandidatosManager.tsx          — gestão de candidatos
    GestorLogisticaPanel.tsx       — painel do gestor logístico
    GoJetCidadesPanel.tsx          — painel de cidades GoJet

functions/src/
  index.ts                         — entry point, exporta todas as functions
  auth/index.ts                    — getUsuario, criarSlotAuth
  telegram-vinculo.ts              — vinculação Telegram + notificações
  notificacoes-prestador.ts        — trigger: notifica gestor em nova solicitação
  automacao.ts                     — limpeza, notificações, ocorrências
  automacao-tarefas.ts             — geração automática/manual de tarefas
  relatorios.ts                    — relatórios semanais/diários
  gps-alertas.ts                   — verificação de atrasos e chegada a pontos
```

---

## Roles do sistema

| Role | Acesso |
|---|---|
| `admin` | Tudo |
| `supergestor` | Tudo exceto configurações de sistema |
| `gestor` | Gestão operacional completa |
| `gestor_seg` | Segurança — aprova guard/segurança |
| `gestor_log` | Logística — aprova logística |
| `guard` | Tela de segurança |
| `viewer` | Visualização de cidades permitidas |
| `logistica` | Tarefas logísticas das cidades gerenciadas |
| `prestador_pendente` | Aguardando aprovação |
| `desativado` | Acesso revogado |

**tipoCadastro:** `'interno'` (padrão) | `'prestador'`  
**statusPrestador:** `'pendente_aprovacao'` | `'ativo'`

---

## Coleções Firestore

| Coleção | Descrição |
|---|---|
| `estacoes` | Estações de bicicleta |
| `usuarios` | Perfis e permissões |
| `solicitacoes_prestadores` | Cadastros de prestadores pendentes |
| `tarefas_logistica` | Tarefas de campo (scout/charger) |
| `slots` | Slots de bicicletas por estação |
| `ocorrencias` | Ocorrências registradas |
| `pagamentos_config` | Valor por tarefa por cidade |
| `pagamentos_semana` | Registros semanais de pagamento |
| `notas_fiscais` | Metadados de NFs enviadas |
| `monitor_config` | Thresholds M1/M2/M3 por cidade |
| `telegram_config` | Configuração de bot Telegram por cidade |
| `gojet_config` | Configuração GoJet por cidade (`ativo`, `url`) |
| `turnos` | Registros de entrada/saída de turno |
| `log_slots_auto` | Log de geração automática de slots |
| `gps_logistica` | Posições GPS de logística em tempo real |
| `gps_logistica_hist` | Histórico GPS |
| `eficiencias_logistica` | Métricas de eficiência |
| `eventos` | Eventos especiais (pontos temporários M3) |

---

## Campos padronizados (prestador)

```
cpf_cnpj        — CPF ou CNPJ (snake_case, sem formatação)
pix_chave       — chave PIX
pix_tipo        — 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'
tipo_contrato   — 'pj' | 'autonomo' | 'clt'
cidade          — cidade principal de atuação
cidadesPermitidas — array de cidades onde pode trabalhar
cargoPrestador  — 'scout' | 'charger' | 'guard' | 'seguranca' | 'logistica'
```

---

## Fluxo de aprovação de prestadores

1. Prestador se cadastra → `role: 'prestador_pendente'`, `statusPrestador: 'pendente_aprovacao'`
2. Gestor vê solicitação filtrada por cargo vs. role do gestor:
   - `gestor_seg` → aprova guard/segurança
   - `gestor_log` → aprova logística
   - `admin/gestor/supergestor` → aprova tudo
3. Aprovação atualiza `role`, `statusPrestador: 'ativo'`, `cidadesPermitidas`
4. Telegram notifica prestador (se vinculado)

---

## Módulo de pagamentos

- **Período:** segunda → domingo (semana ISO)
- **ID do documento:** `{uid}_{ano}W{semana_padded}` ex: `abc123_2026W24`
- **Fluxo:** tarefas concluídas → prestador envia NF → gestor aprova → marca pago
- **Config por cidade:** `pagamentos_config/{cidade}` com `valor_por_tarefa` (R$)
- **Storage NF:** `notas_fiscais/{uid}/{ano}W{semana}.{ext}`

---

## Monitor automático (M1/M2/M3)

Configurável por cidade via `MonitorConfigPanel`:
- **M1** — crítico (vermelho): threshold baixo, alta prioridade
- **M2** — atenção (âmbar): threshold médio, prioridade média  
- **M3** — informativo (azul): threshold alto, baixa prioridade / eventos temporários

Config armazenada em `monitor_config/{cidade}`.

---

## Deploy

```bash
# Frontend (build + hosting)
cd frontend && npm run build && cd .. && firebase deploy --only hosting

# Function específica
cd functions && npm run build && cd .. && firebase deploy --only functions:nomeDaFunction

# Regras
firebase deploy --only firestore:rules,storage

# Indexes — ATENÇÃO: usar API direta (ver seção abaixo)
firebase deploy --only firestore:indexes
```

### Criação de indexes Firestore

O comando `firebase deploy --only firestore:indexes` via MCP **não cria novos indexes** (retorna success falso positivo). Sempre criar via API direta:

```
firestore_create_index(
  parent: "projects/jet-os-1/databases/(default)/collectionGroups/{colecao}",
  index: { queryScope: "COLLECTION", fields: [...] }
)
```

Também adicionar ao `firestore.indexes.json` para referência.

---

## Android (Capacitor)

```bash
cd frontend
npm run build
npx cap sync android
# Build APK no Android Studio ou:
# $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
# cd android && .\gradlew assembleDebug
```

APK gerado em: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

---

## zIndex hierarchy

| Camada | Valor |
|---|---|
| Mapa Leaflet | 0–400 |
| Drawers/painéis | 450–1200 |
| ZonasManager | 1200 |
| Modais | 1500–2000 |
| Editor FotoMedidas | 2000 |
| Analytics overlay | 2000 |
| Popups sobre analytics | 4000+ |

---

## Variáveis de ambiente

Arquivo `.env.local` (não commitado):
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=jet-os-1
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GMAPS_KEY=
```

---

## Criação de usuário admin inicial

No Firebase Console → Authentication → Add user  
Depois no Firestore → `usuarios/{uid}`:
```json
{
  "uid": "...",
  "email": "admin@empresa.com",
  "nome": "Admin",
  "role": "admin",
  "paises": ["BR"],
  "ativo": true
}
```
