/**
 * PAOZINHOS V2 — migração da planilha V1 para Supabase.
 *
 * SEGURANÇA
 * - Nunca coloque a chave secreta do Supabase no GitHub.
 * - Configure nas Script Properties do Apps Script:
 *     SUPABASE_URL
 *     SUPABASE_SECRET_KEY
 *   (SUPABASE_SERVICE_ROLE_KEY também é aceito para compatibilidade.)
 *
 * O script somente LÊ a planilha e ESCREVE no Supabase.
 * A planilha V1 não é alterada.
 *
 * A migração usa IDs determinísticos derivados das linhas/IDs da origem,
 * portanto pode ser executada novamente sem criar duplicatas nas tabelas
 * que possuem chave primária explícita.
 */

const MIGRACAO_SUPABASE_SPREADSHEET_ID = '1SGbTg4xfsSsXb0SA3Z8v-mj_5xHV2jexhuZ6vuc9eas';

const MIGRACAO_SUPABASE_SHEETS = {
  vendas: 'Vendas',
  custos: 'Custos',
  clientes: 'Clientes',
  pedidos: 'Pedidos',
  producao: 'Produção',
  ajustes: 'Ajustes Estoque'
};

const MIGRACAO_SUPABASE_PRODUTOS = [
  {nome:'Frango', preco:8, ativo:true},
  {nome:'Frango com milho', preco:8, ativo:true},
  {nome:'Frango com milho e salada', preco:8, ativo:true},
  {nome:'Frango sem milho com salada', preco:8, ativo:true}
];

const MIGRACAO_SUPABASE_BATCH_SIZE = 250;

function supabaseConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(
    p.getProperty('SUPABASE_SECRET_KEY') ||
    p.getProperty('SUPABASE_SERVICE_ROLE_KEY') ||
    ''
  ).trim();

  if (!url || !key) {
    throw new Error(
      'Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas Propriedades do Script. ' +
      'A chave secreta não deve ser enviada pelo chat nem salva no GitHub.'
    );
  }

  return {url:url, key:key};
}

function supabaseRequest_(path, method, body, prefer) {
  const cfg = supabaseConfig_();
  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.key,
      apikey: cfg.key,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation'
    }
  };

  if (body !== undefined) options.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(cfg.url + path, options);
  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Supabase HTTP ' + code + ': ' + text.slice(0, 1200));
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Supabase retornou resposta não-JSON: ' + text.slice(0, 500));
  }
}

function supabaseInsertBatch_(table, rows, onConflict) {
  if (!rows || !rows.length) return [];

  const out = [];
  for (let i = 0; i < rows.length; i += MIGRACAO_SUPABASE_BATCH_SIZE) {
    const chunk = rows.slice(i, i + MIGRACAO_SUPABASE_BATCH_SIZE);
    const query = onConflict
      ? '?on_conflict=' + encodeURIComponent(onConflict)
      : '';

    const result = supabaseRequest_(
      '/rest/v1/' + encodeURIComponent(table) + query,
      'post',
      chunk,
      onConflict
        ? 'resolution=merge-duplicates,return=representation'
        : 'return=representation'
    );

    if (Array.isArray(result)) out.push.apply(out, result);
  }
  return out;
}

function supabaseSelectAll_(table, select) {
  const rows = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const path =
      '/rest/v1/' + encodeURIComponent(table) +
      '?select=' + encodeURIComponent(select || '*') +
      '&limit=' + limit +
      '&offset=' + offset;

    const batch = supabaseRequest_(path, 'get') || [];
    rows.push.apply(rows, batch);

    if (batch.length < limit) break;
    offset += limit;
  }

  return rows;
}

function migNormalize_(v) {
  return String(v == null ? '' : v).trim();
}

function migNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;

  const s = migNormalize_(v);
  if (!s) return 0;

  // Aceita tanto 1234.56 quanto 1.234,56 / R$ 1.234,56.
  const normalized = s
    .replace(/R\$\s?/gi, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  const n = Number(normalized);
  return isFinite(n) ? n : 0;
}

function migDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(
      v,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  const s = migNormalize_(v);
  if (!s) return null;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const p = s.split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(
      parsed,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  return null;
}

/**
 * UUID determinístico válido, derivado de uma chave estável da origem.
 */
function migUuid_(seed) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(seed),
    Utilities.Charset.UTF_8
  );

  let hex = '';
  bytes.forEach(function(b) {
    const n = b < 0 ? b + 256 : b;
    hex += ('0' + n.toString(16)).slice(-2);
  });

  // UUID v5-like + RFC variant.
  hex =
    hex.slice(0, 12) +
    '5' +
    hex.slice(13, 16) +
    ((parseInt(hex.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, '0')) +
    hex.slice(18);

  return (
    hex.slice(0,8) + '-' +
    hex.slice(8,12) + '-' +
    hex.slice(12,16) + '-' +
    hex.slice(16,20) + '-' +
    hex.slice(20,32)
  );
}

function migRead_(ss, name, width, startRow) {
  const sh = ss.getSheetByName(name);
  const first = startRow || 2;

  if (!sh || sh.getLastRow() < first) return [];

  const cols = Math.min(width, sh.getLastColumn());
  if (cols <= 0) return [];

  return sh
    .getRange(first, 1, sh.getLastRow() - first + 1, cols)
    .getValues();
}

function migStatus_(v) {
  const s = migNormalize_(v).toUpperCase();
  const map = {
    'RESERVADO':'pendente',
    'PENDENTE':'pendente',
    'AGUARDANDO':'pendente',
    'CONFIRMANDO':'pendente',
    'CONFIRMADO':'confirmado',
    'EM_PRODUCAO':'em_producao',
    'EM PRODUÇÃO':'em_producao',
    'EM PRODUCAO':'em_producao',
    'PRONTO':'pronto',
    'ENTREGUE':'entregue',
    'CANCELADO':'cancelado',
    'HISTÓRICO':'entregue',
    'HISTORICO':'entregue'
  };
  return map[s] || 'pendente';
}

function migItensPedido_(valor) {
  let itens = [];
  try {
    itens = JSON.parse(migNormalize_(valor) || '[]');
  } catch (_) {
    return [];
  }

  if (!Array.isArray(itens)) return [];

  return itens
    .map(function(item) {
      return {
        recheio: migNormalize_(item && item.recheio),
        quantidade: Math.max(
          0,
          Math.floor(migNumber_(item && item.quantidade))
        ),
        valorUnitario: migNumber_(
          item && (
            item.valorUnitario != null
              ? item.valorUnitario
              : item.preco
          )
        ) || 8
      };
    })
    .filter(function(item) {
      return item.recheio && item.quantidade > 0;
    });
}

function migProdutoMap_() {
  const rows = supabaseSelectAll_('produtos', 'id,nome');
  const map = {};

  rows.forEach(function(p) {
    map[migNormalize_(p.nome).toUpperCase()] = p.id;
  });

  return map;
}

function migDataMap_(rows, keyIndex) {
  const map = {};
  (rows || []).forEach(function(r) {
    const key = migNormalize_(r[keyIndex]);
    if (key) map[key] = r;
  });
  return map;
}

/**
 * Executa a migração completa.
 *
 * Importante:
 * - Vendas começam na linha 5 da aba Vendas na V1.
 * - Itens de pedido são enviados depois dos pedidos para respeitar FK.
 * - Custos, produção, pagamentos e movimentos também recebem IDs
 *   determinísticos para permitir reexecução sem duplicatas.
 */
function migrarDadosParaSupabase() {
  const ss = SpreadsheetApp.openById(MIGRACAO_SUPABASE_SPREADSHEET_ID);

  // 1) Produtos
  supabaseInsertBatch_(
    'produtos',
    MIGRACAO_SUPABASE_PRODUTOS,
    'nome'
  );

  const produtoMap = migProdutoMap_();

  // 2) Clientes
  const clientesRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.clientes,
    9,
    2
  );

  const clientes = [];
  const clienteMap = {};

  clientesRows.forEach(function(r) {
    const antigo = migNormalize_(r[0]);
    const nome = migNormalize_(r[1]);
    const telefone = migNormalize_(r[2]);

    if (!antigo || !nome || !telefone) return;

    const id = migUuid_('cliente|' + antigo);
    clienteMap[antigo] = id;

    clientes.push({
      id: id,
      nome: nome,
      telefone: telefone,
      email: migNormalize_(r[3]) || null,
      ativo: r[7] !== false,
      primeira_senha: true
    });
  });

  // A coluna telefone é UNIQUE. Se houver telefone repetido na V1,
  // preservamos somente o primeiro cliente desse telefone.
  const telefones = {};
  const clientesUnicos = [];

  clientes.forEach(function(c) {
    const tel = migNormalize_(c.telefone);
    if (telefones[tel]) {
      clienteMap[
        clientesRows.find(function(r) {
          return migNormalize_(r[2]) === tel && migNormalize_(r[1]) === c.nome;
        })?.[0] || ''
      ] = telefones[tel];
      return;
    }
    telefones[tel] = c.id;
    clientesUnicos.push(c);
  });

  if (clientesUnicos.length) {
    supabaseInsertBatch_('clientes', clientesUnicos, 'id');
  }

  // Recarrega clientes após o upsert para garantir o mapa real.
  const clientesBanco = supabaseSelectAll_(
    'clientes',
    'id,nome,telefone'
  );

  const clientePorTelefone = {};
  const clientePorNome = {};

  clientesBanco.forEach(function(c) {
    if (c.telefone) clientePorTelefone[migNormalize_(c.telefone)] = c.id;
    if (c.nome) clientePorNome[migNormalize_(c.nome).toUpperCase()] = c.id;
  });

  Object.keys(clienteMap).forEach(function(antigo) {
    const origem = clientesRows.find(function(r) {
      return migNormalize_(r[0]) === antigo;
    });
    if (!origem) return;

    const telefone = migNormalize_(origem[2]);
    const nome = migNormalize_(origem[1]);

    clienteMap[antigo] =
      clientePorTelefone[telefone] ||
      clientePorNome[nome.toUpperCase()] ||
      clienteMap[antigo];
  });

  // 3) Pedidos + itens
  const pedidosRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.pedidos,
    15,
    2
  );

  const pedidos = [];
  const pedidoItens = [];
  const pedidoMap = {};

  pedidosRows.forEach(function(r) {
    const antigo = migNormalize_(r[0]);
    const clienteAntigo = migNormalize_(r[1]);
    const clienteId = clienteMap[clienteAntigo];

    if (!antigo || !clienteId) return;

    const id = migUuid_('pedido|' + antigo);
    pedidoMap[antigo] = id;

    const itens = migItensPedido_(r[4]);

    pedidos.push({
      id: id,
      cliente_id: clienteId,
      status: migStatus_(r[7]),
      total: migNumber_(r[6]),
      observacao: 'Migração da planilha'
    });

    itens.forEach(function(item, index) {
      const produtoId =
        produtoMap[item.recheio.toUpperCase()];

      if (!produtoId) return;

      pedidoItens.push({
        id: migUuid_(
          'pedido_item|' + antigo + '|' + index + '|' +
          item.recheio + '|' + item.quantidade
        ),
        pedido_id: id,
        produto_id: produtoId,
        quantidade: item.quantidade,
        preco_unitario: item.valorUnitario
      });
    });
  });

  if (pedidos.length) {
    supabaseInsertBatch_('pedidos', pedidos, 'id');
  }

  if (pedidoItens.length) {
    supabaseInsertBatch_('pedido_itens', pedidoItens, 'id');
  }

  // 4) Vendas
  // A aba Vendas começa na linha 5.
  const vendasRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.vendas,
    12,
    5
  );

  const vendas = [];
  const pagamentos = [];
  const vendaMap = [];

  vendasRows.forEach(function(r, i) {
    const data = migDate_(r[0]);
    const clienteNome = migNormalize_(r[1]);
    const total = migNumber_(r[5]);
    const valorPago = Math.max(
      0,
      Math.min(total, migNumber_(r[9]))
    );
    const pedidoAntigo = migNormalize_(r[11]);

    // A V1 pode conter linha de total ou linhas vazias no fim.
    if (!data || !clienteNome || total <= 0) return;

    let clienteId = null;

    if (pedidoAntigo && pedidoMap[pedidoAntigo]) {
      const pedidoOrigem = pedidosRows.find(function(pr) {
        return migNormalize_(pr[0]) === pedidoAntigo;
      });
      if (pedidoOrigem) {
        clienteId =
          clienteMap[migNormalize_(pedidoOrigem[1])] || null;
      }
    }

    if (!clienteId) {
      clienteId =
        clientePorNome[clienteNome.toUpperCase()] || null;
    }

    // Usa a linha física como parte da chave porque a V1 permite
    // mais de uma venda para o mesmo pedido/cliente.
    const id = migUuid_(
      'venda|' + (i + 5) + '|' +
      data + '|' + clienteNome + '|' + total + '|' +
      valorPago + '|' + pedidoAntigo
    );

    vendas.push({
      id: id,
      cliente_id: clienteId,
      pedido_id: pedidoMap[pedidoAntigo] || null,
      data: data,
      total: total,
      valor_pago: valorPago,
      observacao: 'Migração da planilha'
    });

    vendaMap[i] = id;

    if (valorPago > 0) {
      pagamentos.push({
        id: migUuid_(
          'pagamento|' + id + '|' +
          migDate_(r[6] || r[0]) + '|' + valorPago
        ),
        venda_id: id,
        valor: valorPago,
        data_pagamento:
          migDate_(r[6]) ||
          data,
        forma_pagamento: null,
        observacao: 'Pagamento acumulado importado da planilha'
      });
    }
  });

  if (vendas.length) {
    supabaseInsertBatch_('vendas', vendas, 'id');
  }

  if (pagamentos.length) {
    supabaseInsertBatch_('pagamentos', pagamentos, 'id');
  }

  // 5) Custos
  const custosRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.custos,
    3,
    2
  );

  const custos = [];

  custosRows.forEach(function(r, i) {
    const data = migDate_(r[0]);
    const descricao = migNormalize_(r[1]);
    const valor = migNumber_(r[2]);

    if (!data || !descricao || valor <= 0) return;

    custos.push({
      id: migUuid_(
        'custo|' + (i + 2) + '|' +
        data + '|' + descricao + '|' + valor
      ),
      descricao: descricao,
      categoria: null,
      valor: valor,
      data: data,
      observacao: 'Migração da planilha'
    });
  });

  if (custos.length) {
    supabaseInsertBatch_('custos', custos, 'id');
  }

  // 6) Produção
  const producaoRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.producao,
    4,
    2
  );

  const producao = [];
  const producaoPorProduto = {};

  producaoRows.forEach(function(r, i) {
    const data = migDate_(r[0]);
    const nomeProduto = migNormalize_(r[1]);
    const produtoId = produtoMap[nomeProduto.toUpperCase()];
    const quantidade = Math.max(
      0,
      Math.floor(migNumber_(r[2]))
    );

    if (!data || !produtoId || quantidade <= 0) return;

    producao.push({
      id: migUuid_(
        'producao|' + (i + 2) + '|' +
        data + '|' + nomeProduto + '|' + quantidade
      ),
      produto_id: produtoId,
      quantidade: quantidade,
      data: data,
      observacao: 'Migração da planilha'
    });

    producaoPorProduto[produtoId] =
      (producaoPorProduto[produtoId] || 0) + quantidade;
  });

  if (producao.length) {
    supabaseInsertBatch_('producao', producao, 'id');
  }

  // 7) Estoque — mesma fórmula da V1:
  // produzido + correções legadas - reservado - vendido - descartado.
  const estoquePorProduto = {};

  Object.keys(producaoPorProduto).forEach(function(id) {
    estoquePorProduto[id] = producaoPorProduto[id];
  });

  pedidosRows.forEach(function(r) {
    const status = migNormalize_(r[7]).toUpperCase();
    const consome =
      status === 'CONFIRMADO' ||
      status === 'ENTREGUE';

    const reserva =
      status === 'RESERVADO' ||
      status === 'AGUARDANDO' ||
      status === 'CONFIRMANDO';

    if (!consome && !reserva) return;

    migItensPedido_(r[4]).forEach(function(item) {
      const produtoId =
        produtoMap[item.recheio.toUpperCase()];

      if (!produtoId) return;

      const quantidade = Math.max(
        0,
        Math.floor(item.quantidade)
      );

      estoquePorProduto[produtoId] =
        (estoquePorProduto[produtoId] || 0) - quantidade;
    });
  });

  const ajustesRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.ajustes,
    7,
    2
  );

  const movimentos = [];

  ajustesRows.forEach(function(r, i) {
    const data = migDate_(r[0]);
    const nomeProduto = migNormalize_(r[1]);
    const produtoId =
      produtoMap[nomeProduto.toUpperCase()];
    const valor = migNumber_(r[2]);
    const tipo = migNormalize_(r[6]).toUpperCase();

    if (!data || !produtoId || !valor) return;

    if (tipo === 'DESCARTE') {
      const quantidade = Math.abs(Math.floor(valor));

      estoquePorProduto[produtoId] =
        (estoquePorProduto[produtoId] || 0) - quantidade;

      movimentos.push({
        id: migUuid_(
          'movimento|descarte|' + (i + 2) + '|' +
          data + '|' + nomeProduto + '|' + quantidade
        ),
        produto_id: produtoId,
        tipo: 'descarte',
        quantidade: quantidade,
        referencia_id: null,
        observacao:
          migNormalize_(r[5]) ||
          'Descarte importado da planilha'
      });

    } else {
      // Na V1, uma linha que não é DESCARTE representa a correção
      // legada = valor novo - valor anterior, e calculateStock soma
      // essa correção ao estoque.
      const correcao = migNumber_(valor);

      estoquePorProduto[produtoId] =
        (estoquePorProduto[produtoId] || 0) + correcao;

      movimentos.push({
        id: migUuid_(
          'movimento|ajuste|' + (i + 2) + '|' +
          data + '|' + nomeProduto + '|' + correcao
        ),
        produto_id: produtoId,
        tipo: 'ajuste',
        quantidade: correcao,
        referencia_id: null,
        observacao:
          migNormalize_(r[5]) ||
          'Correção legada importada da planilha'
      });
    }
  });

  if (movimentos.length) {
    supabaseInsertBatch_(
      'movimentacoes_estoque',
      movimentos,
      'id'
    );
  }

  const estoque = [];

  Object.keys(produtoMap).forEach(function(nome) {
    const produtoId = produtoMap[nome];
    estoque.push({
      produto_id: produtoId,
      quantidade: Math.max(
        0,
        Math.floor(estoquePorProduto[produtoId] || 0)
      ),
      estoque_minimo: 0
    });
  });

  if (estoque.length) {
    supabaseInsertBatch_(
      'estoque',
      estoque,
      'produto_id'
    );
  }

  const resultado = {
    ok: true,
    clientes: clientesUnicos.length,
    pedidos: pedidos.length,
    pedidoItens: pedidoItens.length,
    vendas: vendas.length,
    pagamentos: pagamentos.length,
    custos: custos.length,
    producao: producao.length,
    movimentosEstoque: movimentos.length,
    estoque: estoque.length
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * Gera um espelho dos números da V1 para conferência.
 */
function gerarResumoOrigemSupabase_() {
  const ss = SpreadsheetApp.openById(
    MIGRACAO_SUPABASE_SPREADSHEET_ID
  );

  const clientesRows = migRead_(
    ss, MIGRACAO_SUPABASE_SHEETS.clientes, 9, 2
  );

  const pedidosRows = migRead_(
    ss, MIGRACAO_SUPABASE_SHEETS.pedidos, 15, 2
  );

  const vendasRows = migRead_(
    ss, MIGRACAO_SUPABASE_SHEETS.vendas, 12, 5
  );

  const custosRows = migRead_(
    ss, MIGRACAO_SUPABASE_SHEETS.custos, 3, 2
  );

  const producaoRows = migRead_(
    ss, MIGRACAO_SUPABASE_SHEETS.producao, 4, 2
  );

  const vendasValidas = vendasRows.filter(function(r) {
    return migDate_(r[0]) && migNormalize_(r[1]) && migNumber_(r[5]) > 0;
  });

  const custosValidos = custosRows.filter(function(r) {
    return migDate_(r[0]) && migNormalize_(r[1]) && migNumber_(r[2]) > 0;
  });

  const producaoValida = producaoRows.filter(function(r) {
    return migDate_(r[0]) &&
      migNormalize_(r[1]) &&
      migNumber_(r[2]) > 0;
  });

  return {
    clientes: clientesRows.filter(function(r) {
      return migNormalize_(r[0]) && migNormalize_(r[1]);
    }).length,
    pedidos: pedidosRows.filter(function(r) {
      return migNormalize_(r[0]);
    }).length,
    vendas: vendasValidas.length,
    faturamento: vendasValidas.reduce(function(a, r) {
      return a + migNumber_(r[5]);
    }, 0),
    recebido: vendasValidas.reduce(function(a, r) {
      return a + migNumber_(r[9]);
    }, 0),
    aReceber: vendasValidas.reduce(function(a, r) {
      return a + Math.max(
        0,
        migNumber_(r[5]) - migNumber_(r[9])
      );
    }, 0),
    custos: custosValidos.length,
    totalCustos: custosValidos.reduce(function(a, r) {
      return a + migNumber_(r[2]);
    }, 0),
    producao: producaoValida.length,
    quantidadeProduzida: producaoValida.reduce(function(a, r) {
      return a + Math.max(0, Math.floor(migNumber_(r[2])));
    }, 0)
  };
}

/**
 * Confere contagens e totais do novo banco contra a origem.
 * Não altera dados.
 */
function verificarSupabaseMigracao() {
  const origem = gerarResumoOrigemSupabase_();

  const tabelas = [
    'clientes',
    'pedidos',
    'pedido_itens',
    'vendas',
    'pagamentos',
    'custos',
    'producao',
    'estoque',
    'movimentacoes_estoque'
  ];

  const contagens = {};

  tabelas.forEach(function(t) {
    contagens[t] = supabaseSelectAll_(t, 'id').length;
  });

  const vendasBanco = supabaseSelectAll_(
    'vendas',
    'id,total,valor_pago'
  );

  const custosBanco = supabaseSelectAll_(
    'custos',
    'id,valor'
  );

  const producaoBanco = supabaseSelectAll_(
    'producao',
    'id,quantidade'
  );

  const comparacao = {
    faturamentoBanco: vendasBanco.reduce(function(a, r) {
      return a + migNumber_(r.total);
    }, 0),
    recebidoBanco: vendasBanco.reduce(function(a, r) {
      return a + migNumber_(r.valor_pago);
    }, 0),
    totalCustosBanco: custosBanco.reduce(function(a, r) {
      return a + migNumber_(r.valor);
    }, 0),
    quantidadeProduzidaBanco: producaoBanco.reduce(function(a, r) {
      return a + Math.max(
        0,
        Math.floor(migNumber_(r.quantidade))
      );
    }, 0)
  };

  const diferencas = {
    vendas:
      contagens.vendas - origem.vendas,
    faturamento:
      comparacao.faturamentoBanco - origem.faturamento,
    recebido:
      comparacao.recebidoBanco - origem.recebido,
    custos:
      comparacao.totalCustosBanco - origem.totalCustos,
    producao:
      comparacao.quantidadeProduzidaBanco -
      origem.quantidadeProduzida
  };

  const ok =
    diferencas.vendas === 0 &&
    Math.abs(diferencas.faturamento) < 0.01 &&
    Math.abs(diferencas.recebido) < 0.01 &&
    Math.abs(diferencas.custos) < 0.01 &&
    diferencas.producao === 0;

  const resultado = {
    ok: ok,
    origem: origem,
    banco: {
      contagens: contagens,
      totais: comparacao
    },
    diferencas: diferencas
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
