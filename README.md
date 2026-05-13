# App Estações — Migração Firebase
## Fase 1: Infraestrutura

---

## Pré-requisitos

- Node.js 20+
- Conta Google nova (conta de destino)
- Firebase CLI: `npm install -g firebase-tools`

---

## Passo 1 — Criar projeto Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → nome: `app-estacoes` (ou o de sua preferência)
3. Desative Google Analytics (opcional)
4. Aguarde a criação

No projeto criado, ative:
- **Firestore Database** → Create database → Production mode → `southamerica-east1`
- **Authentication** → Get started → Email/Password → Enable
- **Storage** → Get started → Production mode → `southamerica-east1`
- **Functions** → Get started (requer billing — plano Blaze, mas tem free tier generoso)

---

## Passo 2 — Service Account para importação

1. No Firebase Console → **Project Settings** → **Service accounts**
2. **Generate new private key** → baixa o arquivo JSON
3. **Guarde esse arquivo com segurança** — ele dá acesso total ao projeto

---

## Passo 3 — Importar dados da planilha atual

> Este passo roda na **conta antiga** via GAS

1. Abra o projeto GAS da conta antiga
2. Cole o arquivo `scripts/importar_sheets_para_firestore.gs`
3. Edite a constante no topo:
   ```javascript
   var FIREBASE_PROJECT_ID = 'seu-project-id-aqui'; // do Firebase Console
   ```
4. Cole o JSON da Service Account na função `salvarFirebaseSA()` e rode-a
5. Rode `testarConexaoFirebase()` — deve mostrar "Conexão Firebase OK"
6. Rode `importarTudo()` e acompanhe os logs

A importação é idempotente — pode rodar mais de uma vez sem duplicar dados.

---

## Passo 4 — Deploy das regras e índices

```bash
# Na pasta firebase-estacoes/
firebase login --reauth
firebase use --add  # selecione o projeto criado no Passo 1

# Deploy das regras e índices
firebase deploy --only firestore:rules,firestore:indexes,storage
```

---

## Passo 5 — Criar usuário admin inicial

No Firebase Console → **Authentication** → **Add user**:
- Email: seu email da conta nova
- Senha: senha forte

Depois no **Firestore** → coleção `usuarios` → **Add document**:
- Document ID: (o UID gerado pelo Auth, visível na lista de usuários)
- Campos:
  ```
  uid:        (mesmo UID)
  email:      seu@email.com
  nome:       Seu Nome
  role:       admin
  paises:     [BR]
  ativo:      true
  criadoEm:   (timestamp atual)
  ```

---

## Passo 6 — Configurar variáveis de ambiente das Functions

```bash
firebase functions:config:set \
  app.gmaps_key="SUA_GMAPS_API_KEY" \
  app.gemini_key="SUA_GEMINI_API_KEY" \
  app.mapillary_token="SEU_MAPILLARY_TOKEN" \
  app.add_pass="SENHA_PARA_ADICIONAR_ESTACOES"
```

---

## Estrutura do Firestore

```
/estacoes/{codigoEstacao}     — dados completos da estação
/usuarios/{uid}               — perfis e permissões
/poligonos/{id}               — polígonos de mapeamento
/solicitacoes/{id}            — solicitações de acesso
/jet_import/{id}              — dados JET Cross
/eventos/{id}                 — log de ações
/config/{id}                  — configurações do sistema
```

---

## Estrutura do Storage

```
/estacoes/{codigoEstacao}/fotos/{file}     — fotos de campo
/estacoes/{codigoEstacao}/streetview/{file}— street view
/croquis/{codigoEstacao}.png              — croqui exportado
/croquis/{codigoEstacao}.pdf              — croqui PDF
```

---

## Próximas fases

| Fase | O que é | Arquivo |
|------|---------|---------|
| 2 | Cloud Functions (backend) | `functions/src/` |
| 3 | Geração de croqui via Slides API | `functions/src/croqui.ts` |
| 4 | Frontend React + Vite | `src/` |
| 5 | Varredura automática | `functions/src/varredura.ts` |

---

## Sobre os templates de Slides

Na conta nova, crie os templates do zero no Google Slides e anote os IDs.
Configure no Firestore em `/config/sistema`:
```
slideTemplatePublicoBR:  "ID_DO_SLIDE_PUBLICO_BR"
slideTemplatePrivadoBR:  "ID_DO_SLIDE_PRIVADO_BR"
slideTemplatePublicoMX:  "ID_DO_SLIDE_PUBLICO_MX"
slideTemplatePrivadoMX:  "ID_DO_SLIDE_PRIVADO_MX"
slideOutputFolderId:     "ID_DA_PASTA_DRIVE_SAIDA"
```

Assim os IDs ficam no banco, não hardcoded no código.
