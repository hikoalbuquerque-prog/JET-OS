/**
 * importar_sheets_para_firestore.gs
 * ─────────────────────────────────────────────────────────────────
 * Script de migração único: lê a planilha atual e grava no Firestore
 * via REST API (sem SDK — roda direto no GAS da conta antiga).
 *
 * COMO USAR:
 *   1. Preencha as constantes abaixo
 *   2. Cole no GAS do projeto ATUAL (conta antiga)
 *   3. Rode importarTudo() uma vez
 *   4. Acompanhe o progresso em Ver → Logs
 *
 * DEPENDÊNCIAS:
 *   - Service Account do Firebase com permissão Firestore Editor
 *   - Chave JSON da Service Account salva em Script Properties
 *     como FIREBASE_SA_JSON
 * ─────────────────────────────────────────────────────────────────
 */

// ── CONFIGURE AQUI ───────────────────────────────────────────────
var FIREBASE_PROJECT_ID = 'SEU_PROJECT_ID_AQUI';
var PAIS_PADRAO         = 'BR'; // BR ou MX
var BATCH_SIZE          = 100;  // documentos por lote (max 500)
// ─────────────────────────────────────────────────────────────────

var FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/'
  + FIREBASE_PROJECT_ID + '/databases/(default)/documents';

// ── ENTRADA PRINCIPAL ────────────────────────────────────────────

function importarTudo() {
  Logger.log('=== INÍCIO DA IMPORTAÇÃO ===');
  Logger.log('Projeto Firebase: ' + FIREBASE_PROJECT_ID);

  var token = _getFirebaseToken_();
  if (!token) { Logger.log('ERRO: Não foi possível obter token Firebase.'); return; }

  var stats = { estacoes: 0, poligonos: 0, erros: 0 };

  // 1. Estações
  Logger.log('--- Importando estações...');
  stats.estacoes = _importarEstacoes_(token);

  // 2. Polígonos
  Logger.log('--- Importando polígonos...');
  stats.poligonos = _importarPoligonos_(token);

  Logger.log('=== IMPORTAÇÃO CONCLUÍDA ===');
  Logger.log('Estações: '  + stats.estacoes);
  Logger.log('Polígonos: ' + stats.poligonos);
  Logger.log('Erros: '     + stats.erros);
}

// ── ESTAÇÕES ────────────────────────────────────────────────────

function _importarEstacoes_(token) {
  var ss      = SpreadsheetApp.getActive();
  var sh      = ss.getSheetByName('Estacoes') || ss.getSheetByName('ESTACOES') || ss.getSheetByName('Estações');
  if (!sh) { Logger.log('ERRO: Aba Estacoes não encontrada.'); return 0; }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log('Sem dados na aba Estacoes.'); return 0; }

  var dados = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var count = 0;

  function idx(nome) { return headers.indexOf(nome); }
  function get(row, nome) {
    var i = idx(nome);
    return i >= 0 ? row[i] : '';
  }

  dados.forEach(function(row, i) {
    try {
      var lat = parseFloat(String(get(row, 'Localização') || '').split(',')[0]);
      var lng = parseFloat(String(get(row, 'Localização') || '').split(',')[1]);
      if (isNaN(lat) || isNaN(lng)) return;

      var codigo = String(get(row, 'CodigoEstacao') || '').trim();
      if (!codigo) return;

      var doc = {
        id:           codigo,
        codigo:       codigo,
        rowKey:       String(get(row, 'RowKey') || ''),
        pais:         PAIS_PADRAO,
        cidade:       String(get(row, 'Cidade') || ''),
        bairro:       String(get(row, 'Bairro') || ''),
        subprefeitura:String(get(row, 'Subprefeitura') || ''),
        endereco:     String(get(row, 'Endereço completo da estação') || ''),
        lat:          lat,
        lng:          lng,
        tipo:         String(get(row, 'TipoEstacao') || 'PUBLICA').toUpperCase(),
        tipoPublica:  String(get(row, 'TipoPublica') || '').toUpperCase() || null,
        status:       String(get(row, 'Status') || 'SOLICITADO').toUpperCase(),
        condicao:     String(get(row, 'CondicaoImplantacao') || '') || null,
        larguraFaixa: parseFloat(get(row, 'Largura da Faixa Livre (m)')) || null,
        capacidade:   parseFloat(get(row, 'Capacidade')) || null,
        dimensoes:    String(get(row, 'Dimensões da Estação') || '') || null,
        imagens: {
          foto:       String(get(row, 'Foto da Estação') || '') || null,
          satelite:   String(get(row, 'Imagem Satélite') || '') || null,
          mapa:       String(get(row, 'Imagem Mapa') || '') || null,
          streetView: String(get(row, 'Street View') || '') || null,
          croqui:     String(get(row, 'Croqui') || '') || null
        },
        croquiStatus:     String(get(row, 'CroquiStatus') || 'PENDENTE'),
        croquiTentativas: parseInt(get(row, 'CroquiTentativas')) || 0,
        ia: _extrairIA_(row, headers),
        privado: _extrairPrivado_(row, headers),
        seqGlobal: String(get(row, 'SeqGlobal') || '') || null,
        addrNorm:  String(get(row, 'AddrNorm') || '') || null,
        dupGrupo:  String(get(row, 'DupGrupo') || '') || null,
        operador:  'importacao@sistema.com',
        origem:    'IMPORTACAO',
        criadoEm:  { '__time__': new Date().toISOString() },
        atualizadoEm: { '__time__': new Date().toISOString() }
      };

      // Remove campos nulos para economizar espaço
      doc = _limparNulos_(doc);

      _gravarDocumento_(token, 'estacoes', codigo, doc);
      count++;

      if (count % 50 === 0) Logger.log('  ' + count + ' estações importadas...');

    } catch(e) {
      Logger.log('ERRO na linha ' + (i + 2) + ': ' + e.message);
    }
  });

  return count;
}

function _extrairIA_(row, headers) {
  function get(nome) {
    var i = headers.indexOf(nome);
    return i >= 0 ? row[i] : '';
  }
  var largura = get('LarguraFaixaIA');
  if (!largura && !get('ScoreCalcadaIA')) return null;
  return {
    largura:   String(largura || ''),
    score:     parseFloat(get('ScoreCalcadaIA')) || 0,
    aprovado:  String(get('AprovadoIA') || '').toUpperCase() === 'SIM',
    confianca: String(get('ConfiancaIA') || 'baixa').toLowerCase(),
    motivo:    String(get('MotivoIA') || ''),
    analisadoEm: { '__time__': new Date().toISOString() }
  };
}

function _extrairPrivado_(row, headers) {
  function get(nome) {
    var i = headers.indexOf(nome);
    return i >= 0 ? row[i] : '';
  }
  var tipo = String(get('TipoEstacao') || '').toUpperCase();
  if (tipo !== 'PRIVADA') return null;
  return {
    nomeLocal:         String(get('NomeLocalPrivado') || '') || null,
    nomeAutorizante:   String(get('NomeAutorizante') || '') || null,
    cargoAutorizante:  String(get('CargoAutorizante') || '') || null,
    telefone:          String(get('TelefoneAutorizante') || '') || null,
    email:             String(get('EmailAutorizante') || '') || null,
    documentoAuth:     String(get('DocumentoAutorizacao') || '') || null,
    observacao:        String(get('ObservacaoPrivado') || '') || null
  };
}

// ── POLÍGONOS ────────────────────────────────────────────────────

function _importarPoligonos_(token) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Limites_Mapeamento');
  if (!sh) { Logger.log('Aba Limites_Mapeamento não encontrada — pulando.'); return 0; }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  var dados = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var count = 0;

  dados.forEach(function(row) {
    try {
      function get(nome) {
        var i = headers.indexOf(nome);
        return i >= 0 ? row[i] : '';
      }

      var nome = String(get('Nome') || get('nome') || '').trim();
      if (!nome) return;

      var cidade = String(get('Cidade') || get('cidade') || '').trim();
      var fase   = String(get('Fase') || get('fase') || 'MAPEAMENTO').trim().toUpperCase();
      var cor    = String(get('Cor') || get('cor') || '#3b82f6').trim();

      // Converte coordenadas pipe-separated "lat,lng|lat,lng|..."
      var coordsRaw = String(get('Coordenadas') || get('POLIGONO') || '').trim();
      var coords = coordsRaw.split('|').map(function(par) {
        var parts = par.split(',');
        return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
      }).filter(function(c) { return isFinite(c.lat) && isFinite(c.lng); });

      if (coords.length < 3) return;

      var id  = cidade.toLowerCase().replace(/\s+/g, '_') + '_' + nome.toLowerCase().replace(/\s+/g, '_');
      var doc = {
        id: id, nome: nome, cidade: cidade, pais: PAIS_PADRAO,
        fase: fase, cor: cor, coords: coords,
        criadoEm:     { '__time__': new Date().toISOString() },
        atualizadoEm: { '__time__': new Date().toISOString() }
      };

      _gravarDocumento_(token, 'poligonos', id, doc);
      count++;
    } catch(e) {
      Logger.log('ERRO polígono: ' + e.message);
    }
  });

  return count;
}

// ── FIRESTORE REST ───────────────────────────────────────────────

function _gravarDocumento_(token, colecao, docId, data) {
  var url = FIRESTORE_BASE + '/' + colecao + '/' + encodeURIComponent(docId);

  var resp = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ fields: _toFirestoreFields_(data) }),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() >= 300) {
    throw new Error('Firestore PATCH ' + docId + ': HTTP ' + resp.getResponseCode()
      + ' — ' + resp.getContentText().slice(0, 200));
  }
}

function _toFirestoreFields_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(key) {
    var val = obj[key];
    if (val === null || val === undefined) return;

    if (val && val['__time__']) {
      fields[key] = { timestampValue: val['__time__'] };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      fields[key] = { doubleValue: val };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(function(item) {
            if (typeof item === 'object' && item !== null) {
              return { mapValue: { fields: _toFirestoreFields_(item) } };
            }
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: _toFirestoreFields_(val) } };
    }
  });
  return fields;
}

function _limparNulos_(obj) {
  var limpo = {};
  Object.keys(obj).forEach(function(k) {
    if (obj[k] === null || obj[k] === undefined || obj[k] === '') return;
    if (typeof obj[k] === 'object' && !Array.isArray(obj[k]) && !(obj[k]['__time__'])) {
      var sub = _limparNulos_(obj[k]);
      if (Object.keys(sub).length > 0) limpo[k] = sub;
    } else {
      limpo[k] = obj[k];
    }
  });
  return limpo;
}

// ── AUTH: SERVICE ACCOUNT TOKEN ──────────────────────────────────

function _getFirebaseToken_() {
  try {
    var saJson = PropertiesService.getScriptProperties().getProperty('FIREBASE_SA_JSON');
    if (!saJson) {
      Logger.log('ERRO: FIREBASE_SA_JSON não configurada nas Script Properties.');
      Logger.log('Salve o JSON da Service Account Firebase com a chave FIREBASE_SA_JSON.');
      return null;
    }

    var sa = JSON.parse(saJson);
    var now = Math.floor(Date.now() / 1000);

    var header  = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    var payload = Utilities.base64EncodeWebSafe(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    }));

    var toSign = header + '.' + payload;
    var key    = sa.private_key;
    var sig    = Utilities.base64EncodeWebSafe(
      Utilities.computeRsaSha256Signature(toSign, key)
    );

    var jwt  = toSign + '.' + sig;
    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    });

    var result = JSON.parse(resp.getContentText());
    if (!result.access_token) {
      Logger.log('ERRO ao obter token: ' + resp.getContentText().slice(0, 300));
      return null;
    }

    return result.access_token;
  } catch(e) {
    Logger.log('ERRO _getFirebaseToken_: ' + e.message);
    return null;
  }
}

// ── SALVAR SERVICE ACCOUNT ───────────────────────────────────────

function salvarFirebaseSA() {
  // Cole o conteúdo do arquivo JSON da Service Account na variável abaixo
  // Exemplo: {"type":"service_account","project_id":"...","private_key":"..."}
  var json = 'COLE_O_JSON_COMPLETO_DA_SERVICE_ACCOUNT_AQUI';

  if (!json || json.indexOf('service_account') < 0) {
    Logger.log('ERRO: Cole o JSON válido da Service Account na variável json.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('FIREBASE_SA_JSON', json);
  Logger.log('FIREBASE_SA_JSON salva com sucesso.');
}

function testarConexaoFirebase() {
  Logger.log('Testando conexão com Firestore...');
  var token = _getFirebaseToken_();
  if (!token) return;

  var url  = FIRESTORE_BASE + '/config/test_connection';
  var resp = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({
      fields: {
        teste:      { stringValue: 'ok' },
        timestamp:  { timestampValue: new Date().toISOString() }
      }
    }),
    muteHttpExceptions: true
  });

  Logger.log('HTTP: ' + resp.getResponseCode());
  if (resp.getResponseCode() < 300) {
    Logger.log('Conexão Firebase OK');
  } else {
    Logger.log('Erro: ' + resp.getContentText().slice(0, 300));
  }
}
