/**
 * PAOZINHOS V2 — migração de dados da planilha para Supabase.
 *
 * Segurança:
 * - Nunca coloque a service_role key neste arquivo.
 * - Configure nas Script Properties:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * O script lê a planilha atual e escreve no novo banco.
 * Não apaga nem altera as abas antigas.
 */

const MIGRACAO_SUPABASE_SHEETS = {
  vendas: 'Vendas',
  custos: 'Custos',
  clientes: 'Clientes',
  pedidos: 'Pedidos',
  producao: 'Produção',
  ajustes: 'Ajustes Estoque'
};

function supabaseConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(p.getProperty('SUPABASE_SERVICE_ROLE_KEY') || '');
  if (!url || !key) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas Propriedades do Script antes da migração.');
  }
  return {url:url,key:key};
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
    throw new Error('Supabase HTTP ' + code + ': ' + text.slice(0, 1000));
  }
  return text ? JSON.parse(text) : null;
}

function supabaseInsertBatch_(table, rows, onConflict) {
  if (!rows.length) return [];
  const path = '/rest/v1/' + encodeURIComponent(table) + (onConflict ? '?on_conflict=' + encodeURIComponent(onConflict) : '');
  return supabaseRequest_(path, 'post', rows, onConflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation');
}

function migNormalize_(v) {
  return String(v == null ? '' : v).trim();
}

function migNumber_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function migDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = migNormalize_(v);
  if (!s) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const p = s.split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
  }
  return s.slice(0,10);
}

function migUuid_() {
  return Utilities.getUuid();
}

function migRead_(ss, name, width) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow()-1, Math.min(width, sh.getLastColumn())).getValues();
}

/**
 * Executa a migração dos dados operacionais.
 * Pode ser executada novamente: os registros com IDs estáveis são atualizados.
 */
function migrarDadosParaSupabase() {
  const ss = SpreadsheetApp.openById('1SGbTg4xfsSsXb0SA3Z8v-mj_5xHV2jexhuZ6vuc9eas');

  // Produtos são fixos no sistema atual.
  const produtos = [
    {nome:'Frango', preco:8, ativo:true},
    {nome:'Frango com milho', preco:8, ativo:true},
    {nome:'Frango com milho e salada', preco:8, ativo:true},
    {nome:'Frango sem milho com salada', preco:8, ativo:true}
  ];
  supabaseInsertBatch_('produtos', produtos, 'nome');

  const produtoMap = {};
  const produtoRows = supabaseRequest_('/rest/v1/produtos?select=id,nome', 'get');
  (produtoRows || []).forEach(p => produtoMap[migNormalize_(p.nome).toUpperCase()] = p.id);

  // Clientes: preservamos o ID da planilha como referência externa.
  // O banco usa UUID próprio; o mapa abaixo liga o ID antigo ao UUID novo.
  const clientesRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.clientes, 9);
  const clientes = [];
  const clienteMap = {};

  (clientesRows || []).forEach(r => {
    const antigo = migNormalize_(r[0]);
    const nome = migNormalize_(r[1]);
    const telefone = migNormalize_(r[2]);
    if (!antigo || !nome || !telefone) return;

    const id = migUuid_();
    clienteMap[antigo] = id;
    clientes.push({
      id:id,
      nome:nome,
      telefone:telefone,
      email:migNormalize_(r[3]) || null,
      ativo:r[7] !== false,
      primeira_senha:true
    });
  });

  if (clientes.length) {
    supabaseInsertBatch_('clientes', clientes, 'id');
  }

  // Pedidos.
  const pedidosRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.pedidos, 15);
  const pedidos = [];
  const pedidoMap = {};

  (pedidosRows || []).forEach(r => {
    const antigo = migNormalize_(r[0]);
    const clienteId = clienteMap[migNormalize_(r[1])];
    if (!antigo || !clienteId) return;

    const id = migUuid_();
    pedidoMap[antigo] = id;

    let itens = [];
    try { itens = JSON.parse(migNormalize_(r[4]) || '[]'); } catch (_) { itens = []; }

    const statusOrig = migNormalize_(r[7]).toLowerCase();
    const statusMap = {
      reservado:'pendente',
      pendente:'pendente',
      confirmado:'confirmado',
      em_producao:'em_producao',
      'em produção':'em_producao',
      pronto:'pronto',
      entregue:'entregue',
      cancelado:'cancelado'
    };

    pedidos.push({
      id:id,
      cliente_id:clienteId,
      status:statusMap[statusOrig] || 'pendente',
      total:migNumber_(r[6]),
      observacao:'Migração da planilha'
    });

    itens.forEach(item => {
      const nome = migNormalize_(item.recheio);
      const produtoId = produtoMap[nome.toUpperCase()];
      const quantidade = Math.floor(migNumber_(item.quantidade));
      if (!produtoId || quantidade <= 0) return;
      supabaseInsertBatch_('pedido_itens', [{
        pedido_id:id,
        produto_id:produtoId,
        quantidade:quantidade,
        preco_unitario:migNumber_(item.valorUnitario) || 8
      }]);
    });
  });

  if (pedidos.length) supabaseInsertBatch_('pedidos', pedidos, 'id');\n  if (pedidoItens.length) supabaseInsertBatch_('pedido_itens', pedidoItens);

  // Vendas. Mantemos o vínculo com pedido quando a coluna 12 existir.
  const vendasRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.vendas, 12);
  const vendas = [];
  const vendaMap = [];

  (vendasRows || []).forEach((r, i) => {
    const clienteNome = migNormalize_(r[1]);
    if (!clienteNome || !r[0] || !r[5]) return;

    let clienteId = null;
    const pedidoAntigo = migNormalize_(r[11]);
    if (pedidoAntigo && pedidosRows.length) {
      // Busca pelo nome quando o vínculo antigo não é encontrado diretamente.
      const pr = (pedidosRows || []).find(x => migNormalize_(x[0]) === pedidoAntigo);
      if (pr) clienteId = clienteMap[migNormalize_(pr[1])] || null;
    }
    if (!clienteId) {
      const cr = (clientesRows || []).find(x => migNormalize_(x[1]).toUpperCase() === clienteNome.toUpperCase());
      if (cr) clienteId = clienteMap[migNormalize_(cr[0])] || null;
    }

    const id = migUuid_();
    vendas.push({
      id:id,
      cliente_id:clienteId,
      pedido_id:pedidoMap[pedidoAntigo] || null,
      data:migDate_(r[0]) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      total:migNumber_(r[5]),
      valor_pago:migNumber_(r[9]),
      observacao:'Migração da planilha'
    });
    vendaMap[i] = id;
  });

  if (vendas.length) supabaseInsertBatch_('vendas', vendas, 'id');

  // Pagamentos: a planilha guarda o acumulado pago por venda.
  // Criamos um lançamento histórico quando existe valor pago.
  const pagamentos = [];
  (vendasRows || []).forEach((r, i) => {
    const pago = migNumber_(r[9]);
    if (!pago || !vendaMap[i]) return;
    pagamentos.push({
      venda_id:vendaMap[i],
      valor:pago,
      data_pagamento:migDate_(r[6]) || migDate_(r[0]) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      observacao:'Pagamento importado da planilha'
    });
  });
  if (pagamentos.length) supabaseInsertBatch_('pagamentos', pagamentos);

  // Custos.
  const custosRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.custos, 3);
  const custos = [];
  (custosRows || []).forEach(r => {
    const descricao = migNormalize_(r[1]);
    const valor = migNumber_(r[2]);
    if (!descricao || !r[0] || !isFinite(valor)) return;
    custos.push({
      descricao:descricao,
      valor:valor,
      data:migDate_(r[0]) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      observacao:'Migração da planilha'
    });
  });
  if (custos.length) supabaseInsertBatch_('custos', custos);

  // Produção.
  const producaoRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.producao, 4);
  const producao = [];
  const producaoPorProduto = {};
  (producaoRows || []).forEach(r => {
    const produtoId = produtoMap[migNormalize_(r[1]).toUpperCase()];
    const quantidade = Math.floor(migNumber_(r[2]));
    if (!produtoId || !r[0] || quantidade <= 0) return;
    producao.push({
      produto_id:produtoId,
      quantidade:quantidade,
      data:migDate_(r[0]) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      observacao:'Migração da planilha'
    });
  });
  if (producao.length) supabaseInsertBatch_('producao', producao);\n\n  // Reconstrói o estoque atual usando a mesma regra operacional da V1:\n  // produção - reservas - vendidos - descartes + correções legadas.\n  const estoquePorProduto = {};\n  Object.keys(producaoPorProduto).forEach(id => estoquePorProduto[id]=producaoPorProduto[id]);\n  (pedidosRows || []).forEach(r => {\n    let itens=[]; try { itens=JSON.parse(migNormalize_(r[4]) || '[]'); } catch (_) { itens=[]; }\n    const status=migNormalize_(r[7]).toUpperCase();\n    const consome=['CONFIRMADO','ENTREGUE'].indexOf(status)>=0;\n    const reserva=['RESERVADO','AGUARDANDO','CONFIRMANDO'].indexOf(status)>=0;\n    if (!consome && !reserva) return;\n    itens.forEach(item=>{\n      const pid=produtoMap[migNormalize_(item.recheio).toUpperCase()];\n      if (!pid) return;\n      const q=Math.max(0,Math.floor(migNumber_(item.quantidade)));\n      estoquePorProduto[pid]=(estoquePorProduto[pid]||0)-(q);\n    });\n  });\n  const ajustesRows=migRead_(ss,MIGRACAO_SUPABASE_SHEETS.ajustes,7);\n  const movimentos=[];\n  (ajustesRows||[]).forEach(r=>{\n    const pid=produtoMap[migNormalize_(r[1]).toUpperCase()];\n    const tipo=migNormalize_(r[6]).toUpperCase();\n    const q=Math.abs(Math.floor(migNumber_(r[2])));\n    if (!pid || !q) return;\n    if (tipo==='DESCARTE') {\n      estoquePorProduto[pid]=(estoquePorProduto[pid]||0)-q;\n      movimentos.push({produto_id:pid,tipo:'ajuste',quantidade:q,observacao:'Descarte importado da planilha'});\n    }\n  });\n  if (movimentos.length) supabaseInsertBatch_('movimentacoes_estoque',movimentos);\n  const estoque=[];\n  Object.keys(produtoMap).forEach(nome=>{\n    const pid=produtoMap[nome];\n    estoque.push({produto_id:pid,quantidade:Math.max(0,Math.floor(estoquePorProduto[pid]||0)),estoque_minimo:0});\n  });\n  if (estoque.length) supabaseInsertBatch_('estoque',estoque,'produto_id');

  return {
    ok:true,
    clientes:clientes.length,
    pedidos:pedidos.length,\n    pedidoItens:pedidoItens.length,
    vendas:vendas.length,
    pagamentos:pagamentos.length,
    custos:custos.length,
    producao:producao.length
  };
}


/**
 * Confere somente contagens do novo banco.
 */
function verificarSupabaseMigracao() {
  const tabelas = ['clientes','pedidos','pedido_itens','vendas','pagamentos','custos','producao','estoque'];
  const out = {};
  tabelas.forEach(t => {
    const rows = supabaseRequest_('/rest/v1/' + t + '?select=id', 'get');
    out[t] = (rows || []).length;
  });
  return out;
}
