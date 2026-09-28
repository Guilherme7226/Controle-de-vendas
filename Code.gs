const SPREADSHEET_ID = '1SGbTg4xfsSsXb0SA3Z8v-mj_5xHV2jexhuZ6vuc9eas';
const API_KEY = '';
const ADMIN_SESSION_PROPERTY = 'ADMIN_SESSIONS';

const SHEET_VENDAS = 'Vendas';
const SHEET_CUSTOS = 'Custos';
const SHEET_RESUMO = 'Resumo';
const SHEET_RESUMO_PESSOA = 'Resumo por pessoa';
const SHEET_CLIENTES = 'Clientes';
const SHEET_PEDIDOS = 'Pedidos';
const SHEET_PRODUCAO = 'Produção';
const SHEET_AJUSTES_ESTOQUE = 'Ajustes Estoque';
const RECHEIOS = ['Frango','Frango com milho','Frango com milho e salada','Frango sem milho com salada'];
const PRECO_PAODEFINIDO = 8;
const APP_VERSION = '2026-09-27-contabilidade-v10';
const SUPPORTED_ACTIONS = ['venda','custo','pagamento','editar_venda','excluir_venda','admin_login','admin_validar','cliente_cadastro','cliente_login','cliente_pedido','cliente_dados','cliente_confirmar_pedido','cliente_editar_pedido','cliente_excluir_pedido','cliente_alterar_senha','admin_listar_clientes','admin_bootstrap','admin_full_data','admin_migrar_vendas_pedidos','admin_criar_cliente','admin_editar_cliente','admin_excluir_cliente','admin_editar_pedido','admin_excluir_pedido','admin_confirmar_pedido','admin_confirmar_pedidos_lote','admin_pagar_cliente','admin_editar_estoque','estoque_atual','producao'];

const VENDAS_HEADERS = [
  'Data','Cliente','Contato/Empresa','Quantidade','Valor Unit. (R$)',
  'Valor Total (R$)','Data Pagamento','Pago?','Pagamento Parcial?',
  'Valor Pago (R$)','Saldo Devedor (R$)'
];

function doGet(e) {
  try {
    if (API_KEY && e?.parameter?.apiKey !== API_KEY) {
      throw new Error('Chave inválida');
    }
    return json({ok:true, service:'Controle de Vendas', version:APP_VERSION, data:readAll()});
  } catch (err) {
    return json({ok:false, error:String(err.message || err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');

    if (API_KEY && body.apiKey !== API_KEY) {
      throw new Error('Chave inválida');
    }

    const ss = getSS();
    const d = body.data || body || {};

    // Somente ações de cliente podem ser chamadas sem sessão administrativa.
    const clientActions = ['cliente_cadastro','cliente_login','cliente_pedido','cliente_dados','cliente_confirmar_pedido','cliente_editar_pedido','cliente_excluir_pedido','cliente_alterar_senha','admin_login','admin_validar'];
    if (!clientActions.includes(body.action)) {
      adminValidate({token: body.adminToken});
    }

    if (!SUPPORTED_ACTIONS.includes(body.action)) {
      throw new Error('Ação desconhecida: '+String(body.action||'')+'. Esta implantação precisa da versão '+APP_VERSION+'.');
    }

    switch (body.action) {
      case 'venda':
        registrarVendaDiretaProtegida(ss, d);
        break;
      case 'custo':
        appendCost(ss, d);
        break;
      case 'pagamento':
        updatePayment(ss, d);
        break;
      case 'editar_venda':
        updateSale(ss, d);
        break;
      case 'excluir_venda':
        deleteSale(ss, d);
        break;
      case 'admin_login':
        return json({ok:true,data:adminLogin(d)});
      case 'admin_validar':
        return json({ok:true,data:adminValidate(d)});
      case 'cliente_cadastro':
        return json({ok:true,data:registerClient(ss,d)});
      case 'cliente_login':
        return json({ok:true,data:loginClient(ss,d)});
      case 'cliente_pedido':
        return json({ok:true,data:createClientOrder(ss,d)});
      case 'estoque_atual':
        return json({ok:true,data:readStock(ss)});
      case 'cliente_dados':
        return json({ok:true,data:getClientData(ss,d)});
      case 'cliente_confirmar_pedido':
        return json({ok:true,data:confirmClientOrder(ss,d)});
      case 'cliente_editar_pedido':
        return json({ok:true,data:editClientOrder(ss,d)});
      case 'cliente_excluir_pedido':
        return json({ok:true,data:deleteClientOrder(ss,d)});
      case 'cliente_alterar_senha':
        return json({ok:true,data:changeClientPassword(ss,d)});
      case 'admin_listar_clientes':
        return json({ok:true,data:adminListClients(ss)});
      case 'admin_bootstrap':
        // Carregamento inicial ultraleve: o Dashboard precisa apenas
        // dos indicadores e das vendas para o ranking.
        return json({ok:true,data:readDashboardData(ss)});
      case 'admin_full_data':
        // Dados completos só são carregados quando alguma aba realmente precisa deles.
        return json({ok:true,data:readAll()});
      case 'admin_migrar_vendas_pedidos':
        return json({ok:true,data:migrarVendasParaPedidos(ss)});
      case 'admin_criar_cliente':
        return json({ok:true,data:adminCreateClient(ss,d)});
      case 'admin_editar_cliente':
        return json({ok:true,data:adminEditClient(ss,d)});
      case 'admin_excluir_cliente':
        return json({ok:true,data:adminDeleteClient(ss,d)});
      case 'admin_editar_pedido':
        return json({ok:true,data:adminEditOrder(ss,d)});
      case 'admin_excluir_pedido':
        return json({ok:true,data:adminDeleteOrder(ss,d)});
      case 'admin_confirmar_pedido':
        return json({ok:true,data:adminConfirmOrder(ss,d)});
      case 'admin_confirmar_pedidos_lote':
        return json({ok:true,data:adminConfirmOrdersBatch(ss,d)});
      case 'admin_pagar_cliente':
        return json({ok:true,data:adminRegistrarPagamentoCliente(ss,d)});
      case 'admin_editar_estoque':
        return json({ok:true,data:adminEditStock(ss,d)});
      case 'producao':
        addProduction(ss,d);
        break;
      default:
        throw new Error('Ação desconhecida');
    }

    SpreadsheetApp.flush();

    // Não recarrega toda a planilha depois de cada gravação.
    // Isso deixa o POST muito mais rápido; o site atualiza os dados
    // em segundo plano através do GET.
    return json({ok:true});
  } catch (err) {
    console.error(err);
    return json({ok:false, error:String(err.message || err)});
  }
}


function removerVendasSemNome(ss){
  const sh=ss.getSheetByName(SHEET_VENDAS);
  if(!sh || sh.getLastRow()<2)return 0;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,VENDAS_HEADERS.length).getValues();
  let removidas=0;
  for(let i=rows.length-1;i>=0;i--){
    const nome=String(rows[i][1]||'').trim();
    if(!nome || nome.toLowerCase()==='sem nome'){
      sh.deleteRow(i+2);
      removidas++;
    }
  }
  if(removidas)SpreadsheetApp.flush();
  return removidas;
}

function getAdminPassword() {
  const value = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!value) throw new Error('Senha administrativa não configurada no servidor.');
  return String(value);
}

function getAdminSessions() {
  const raw = PropertiesService.getScriptProperties().getProperty(ADMIN_SESSION_PROPERTY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

function saveAdminSessions(sessions) {
  const now=Date.now();
  const clean={};
  Object.keys(sessions||{}).forEach(token=>{
    const expires=Number(sessions[token]||0);
    if(expires>now)clean[token]=expires;
  });
  // Evita crescimento indefinido da propriedade de sessões.
  const tokens=Object.keys(clean);
  if(tokens.length>20){
    tokens.sort((a,b)=>clean[b]-clean[a]);
    tokens.slice(20).forEach(token=>delete clean[token]);
  }
  PropertiesService.getScriptProperties().setProperty(ADMIN_SESSION_PROPERTY, JSON.stringify(clean));
}

function adminLogin(d) {
  const senha=String(d.senha||'');
  if(!senha || senha!==getAdminPassword())throw new Error('Senha incorreta.');

  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
    const sessions=getAdminSessions();
    sessions[token]=Date.now()+8*60*60*1000;
    saveAdminSessions(sessions);
    return {token:token};
  }finally{
    lock.releaseLock();
  }
}

function adminValidate(d) {
  const token=String(d.token||'').trim();
  if(!token)throw new Error('Sessão administrativa inválida ou expirada.');

  const sessions=getAdminSessions();
  const expires=Number(sessions[token]||0);
  if(!expires || expires<Date.now()){
    delete sessions[token];
    saveAdminSessions(sessions);
    throw new Error('Sessão administrativa inválida ou expirada.');
  }
  return {valid:true};
}

function setup() {
  const ss = getSS();
  let sh = ss.getSheetByName(SHEET_VENDAS);

  if (!sh) {
    sh = ss.insertSheet(SHEET_VENDAS);
    sh.getRange(1,1,1,VENDAS_HEADERS.length).setValues([VENDAS_HEADERS]);
    sh.setFrozenRows(1);
  }
}


/*
 * PADRONIZA SOMENTE A FORMATAÇÃO DAS VENDAS
 *
 * A linha 4 é o MODELO visual.
 * Esta função copia SOMENTE a formatação da linha 4 para as
 * demais linhas de vendas. Nenhum valor, fórmula ou conteúdo é copiado.
 */
function padronizarPlanilha() {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_VENDAS);

  if (!sh) throw new Error('Aba Vendas não encontrada');
  if (sh.getLastRow() < 4) return 'Não há linhas suficientes para padronizar.';

  const modelo = 4;
  const lastRow = sh.getLastRow();

  for (let row = 5; row <= lastRow; row++) {
    // Nunca altera a linha TOTAL/TOTAL GERAL.
    if (isTotalRow(sh, row)) continue;

    // Só copia FORMATAÇÃO. Valores, fórmulas e conteúdo permanecem intactos.
    sh.getRange(modelo, 1, 1, 11).copyTo(
      sh.getRange(row, 1, 1, 11),
      SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
      false
    );
  }

  SpreadsheetApp.flush();
  return 'Formatação das vendas padronizada usando a linha 4 como modelo.';
}

/*
 * Remove APENAS as vendas de teste:
 * - Cliente GUILHERME ou TESTE
 * - Data 26/09/2026
 *
 * Funciona mesmo quando a data da planilha é um objeto Date.
 */
function limparTestes() {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_VENDAS);

  if (!sh) throw new Error('Aba Vendas não encontrada');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 'Nenhuma venda de teste encontrada.';

  const lastCol = Math.max(sh.getLastColumn(), 11);
  const rows = sh.getRange(1,1,lastRow,lastCol).getValues();
  let apagadas = 0;

  for (let i = rows.length - 1; i >= 1; i--) {
    const cliente = normalize(rows[i][1]);
    const data = dateValue(rows[i][0]);

    if (
      data === '2026-09-26' &&
      (cliente === 'GUILHERME' || cliente === 'TESTE')
    ) {
      sh.deleteRow(i + 1);
      apagadas++;
    }
  }

  SpreadsheetApp.flush();
  return 'Vendas de teste apagadas: ' + apagadas;
}

/*
 * Insere a venda ANTES da linha TOTAL GERAL.
 * Se não existir TOTAL GERAL, insere depois da última venda.
 */
function registrarVendaDiretaProtegida(ss,d){
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const itens=Array.isArray(d.itens)?d.itens.filter(x=>Number(x.quantidade)>0):[];
    if(!itens.length) throw new Error('Informe os sabores da venda.');
    const stock=readStock(ss);
    const disponivel={};
    stock.forEach(x=>disponivel[normalize(x.recheio)]=Math.max(0,Number(x.disponivel)||0));
    const solicitado={};
    itens.forEach(item=>{
      const recheio=String(item.recheio||'').trim();
      const qtd=Math.max(0,Math.floor(Number(item.quantidade)||0));
      const canonical=RECHEIOS.find(r=>normalize(r)===normalize(recheio));
      if(!canonical) throw new Error('Recheio inválido: '+recheio);
      solicitado[normalize(canonical)]=(solicitado[normalize(canonical)]||0)+qtd;
    });
    for(const recheio of RECHEIOS){
      const key=normalize(recheio);
      const qtd=Number(solicitado[key]||0);
      if(qtd>Number(disponivel[key]||0)) throw new Error('Estoque insuficiente de '+recheio+'. Disponível: '+(disponivel[key]||0)+'.');
    }
    return appendSale(ss,d);
  } finally { lock.releaseLock(); }
}

function appendSale(ss, d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');
  if (sh.getMaxColumns() < 12) sh.insertColumnAfter(sh.getMaxColumns());
  const pedidoIdVinculado = String(d.pedidoId || '').trim();
  const naoCriarPedido = d.naoCriarPedido === true;

  const quantidade = Math.max(0, parseNumber(d.quantidade));
  const unit = Math.max(0, parseMoney(d.valorUnitario));
  const total = quantidade * unit;
  const pago = Math.min(Math.max(parseMoney(d.pago), 0), total);
  const saldo = Math.max(0, total - pago);

  const row = [
    d.data || '', d.cliente || '', d.contatoEmpresa || '', quantidade, unit, total,
    pago > 0 ? (d.dataPagamento || d.data || '') : '',
    saldo <= 0 && total > 0,
    pago > 0 && saldo > 0 ? 'Sim' : 'Não', pago, saldo
  ];

  let novaLinha = 4;
  for (let rowNumber = 4; rowNumber <= sh.getLastRow(); rowNumber++) {
    if (isTotalRow(sh, rowNumber)) { novaLinha = rowNumber; break; }
    const values = sh.getRange(rowNumber, 1, 1, 2).getDisplayValues()[0];
    const data = String(values[0] || '').trim();
    const cliente = String(values[1] || '').trim();
    if (!data && !cliente) { novaLinha = rowNumber; break; }
    novaLinha = rowNumber + 1;
  }

  sh.insertRowsBefore(novaLinha, 1);
  sh.getRange(novaLinha, 1, 1, 11).setValues([row]);
  if (sh.getLastRow() >= 4 && novaLinha !== 4) {
    sh.getRange(4, 1, 1, 11).copyTo(sh.getRange(novaLinha, 1, 1, 11), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  aplicarFormatoVenda(sh, novaLinha);

  let pedidoId = pedidoIdVinculado;
  if(!pedidoId && !naoCriarPedido){
    const pedido=criarPedidoDaVendaDireta(ss,{
      row:novaLinha,
      data:dateValue(row[0]),
      cliente:String(row[1]||''),
      quantidade:quantidade,
      valorUnitario:unit,
      total:total,
      valorPago:pago,
      dataPagamento:pago?(d.dataPagamento||d.data||''):'',
      itens:Array.isArray(d.itens)?d.itens:[]
    });
    pedidoId=pedido.id;
  }
  if(pedidoId) sh.getRange(novaLinha,12).setValue(pedidoId);
  return {row:novaLinha,pedidoId:pedidoId};
}

/*
 * Insere custos antes da linha TOTAL/TOTAL GERAL.
 */

/*
 * Aplica somente a formatação numérica/data de uma linha de venda.
 * Não altera valores, fórmulas ou conteúdo.
 */
function aplicarFormatoVenda(sh, rowNumber) {
  if (!sh || !rowNumber || rowNumber < 1) return;

  sh.getRange(rowNumber, 1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(rowNumber, 4).setNumberFormat('0');
  sh.getRange(rowNumber, 5, 1, 2).setNumberFormat('R$ #,##0.00');
  sh.getRange(rowNumber, 10, 1, 2).setNumberFormat('R$ #,##0.00');

  if (sh.getLastColumn() >= 11) {
    sh.getRange(rowNumber, 7).setNumberFormat('dd/MM/yyyy');
  }
}


function appendCost(ss, d) {
  const sh = ss.getSheetByName(SHEET_CUSTOS);
  if (!sh) throw new Error('Aba Custos não encontrada');

  const row = [
    d.data || '',
    d.descricao || '',
    parseMoney(d.valor) || 0
  ];

  const totalRow = findTotalRow(sh, 1, 2);

  if (totalRow > 0) {
    sh.insertRowsBefore(totalRow, 1);
    sh.getRange(totalRow,1,1,3).setValues([row]);

    if (totalRow > 1) {
      sh.getRange(totalRow - 1,1,1,3)
        .copyTo(sh.getRange(totalRow,1,1,3), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
  } else {
    sh.appendRow(row);
  }

  const targetRow = totalRow > 0 ? totalRow : sh.getLastRow();
  aplicarFormatoCusto(sh,targetRow);
}

function updatePayment(ss, d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');

  const row = Number(d.row);
  if (!row || row < 2 || row > sh.getLastRow()) {
    throw new Error('Linha da venda inválida');
  }

  // Nunca permite alterar a linha TOTAL.
  if (isTotalRow(sh, row)) {
    throw new Error('A linha TOTAL não é uma venda');
  }

  const total = Number(sh.getRange(row,6).getValue()) || 0;
  const pago = Math.min(Math.max(parseMoney(d.pago) || 0, 0), total);
  const saldo = Math.max(0, total - pago);

  sh.getRange(row,7,1,5).setValues([[
    pago > 0
      ? (d.dataPagamento || formatToday())
      : '',
    saldo <= 0 && total > 0,
    pago > 0 && saldo > 0 ? 'Sim' : 'Não',
    pago,
    saldo
  ]]);

  aplicarFormatoVenda(sh, row);

  const pedidoId=sh.getMaxColumns()>=12?String(sh.getRange(row,12).getValue()||'').trim():'';
  if(pedidoId){
    atualizarPedidoHistorico(ss,pedidoId,{
      row:row,
      data:dateValue(sh.getRange(row,1).getValue()),
      cliente:String(sh.getRange(row,2).getValue()||''),
      quantidade:Number(sh.getRange(row,4).getValue())||0,
      valorUnitario:Number(sh.getRange(row,5).getValue())||0,
      total:total,
      valorPago:pago,
      dataPagamento:pago?(d.dataPagamento||formatToday()):''
    });
  }
}

/*
 * EDITAR VENDA
 */
function updateSale(ss, d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');

  const rowNumber = Number(d.row);

  if (!rowNumber || rowNumber < 2 || rowNumber > sh.getLastRow()) {
    throw new Error('Linha da venda inválida');
  }

  if (isTotalRow(sh, rowNumber)) {
    throw new Error('A linha TOTAL não é uma venda');
  }

  const quantidade = Math.max(0, Number(d.quantidade) || 0);
  const unit = Math.max(0, Number(d.valorUnitario) || 0);
  const total = quantidade * unit;

  const pago = Math.min(
    Math.max(parseMoney(d.pago), 0),
    total
  );

  const saldo = Math.max(0, total - pago);

  sh.getRange(rowNumber, 1, 1, 11).setValues([[
    d.data || '',
    d.cliente || '',
    d.contatoEmpresa || '',
    quantidade,
    unit,
    total,
    pago > 0 ? (d.dataPagamento || d.data || '') : '',
    saldo <= 0 && total > 0,
    pago > 0 && saldo > 0 ? 'Sim' : 'Não',
    pago,
    saldo
  ]]);

  aplicarFormatoVenda(sh, rowNumber);

  const pedidoId=sh.getMaxColumns()>=12?String(sh.getRange(rowNumber,12).getValue()||'').trim():'';
  if(pedidoId){
    atualizarPedidoHistorico(ss,pedidoId,{
      row:rowNumber,
      data:dateValue(d.data||''),
      cliente:d.cliente||'',
      quantidade:quantidade,
      valorUnitario:unit,
      total:total,
      valorPago:pago,
      dataPagamento:pago?(d.dataPagamento||d.data||''):''
    });
  }

  return true;
}

/*
 * EXCLUIR VENDA
 */
function deleteSale(ss, d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');

  const rowNumber = Number(d.row);

  if (!rowNumber || rowNumber < 2 || rowNumber > sh.getLastRow()) {
    throw new Error('Linha da venda inválida');
  }

  if (isTotalRow(sh, rowNumber)) {
    throw new Error('A linha TOTAL não pode ser excluída');
  }

  const cliente = String(sh.getRange(rowNumber, 2).getDisplayValue() || '').trim();
  const pedidoId = sh.getMaxColumns()>=12 ? String(sh.getRange(rowNumber,12).getValue() || '').trim() : '';

  sh.deleteRow(rowNumber);

  if(pedidoId)excluirPedidoHistorico(ss,pedidoId);

  SpreadsheetApp.flush();

  return 'Venda de ' + cliente + ' excluída com sucesso.';
}

/*
 * Lê SOMENTE as vendas que estão acima do TOTAL.
 * Assim nenhuma fórmula/linha abaixo do TOTAL vira venda.
 */
function readDashboardData(ss) {
  const sales = [];
  const sh = ss.getSheetByName(SHEET_VENDAS);

  if (sh && sh.getLastRow() >= 2) {
    const lastRow = sh.getLastRow();
    const rows = sh.getRange(2,1,lastRow - 1,Math.min(12,sh.getMaxColumns())).getValues();
    const pedidoIdsVistos = new Set();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (isTotalValues(r)) break;
      if (!r[0] && !r[1] && !r[3] && !r[5]) continue;

      const pedidoId = String(r[11] || '').trim();
      if (pedidoId) {
        if (pedidoIdsVistos.has(pedidoId)) continue;
        pedidoIdsVistos.add(pedidoId);
      }

      const total = Number(r[5]) || 0;
      const valorPago = parseMoney(r[9]) || 0;
      const saldo = Number(r[10]) || Math.max(0,total-valorPago);

      sales.push({
        row: i + 2,
        data: dateValue(r[0]),
        cliente: String(r[1] || ''),
        contatoEmpresa: String(r[2] || ''),
        quantidade: Number(r[3]) || 0,
        valorUnitario: Number(r[4]) || 0,
        total: total,
        dataPagamento: dateValue(r[6]),
        pago: !!r[7],
        parcial: String(r[8] || 'Não'),
        valorPago: valorPago,
        deve: saldo,
        status: saldo <= 0 ? 'Pago' : valorPago > 0 ? 'Parcial' : 'Pendente',
        pedidoId: pedidoId
      });
    }
  }

  return {
    sales: sales,
    summary: readSummary(ss)
  };
}

function readAll() {
  const ss = getSS();
  const sales = [];
  const pedidoIdsVistos = new Set();
  const sh = ss.getSheetByName(SHEET_VENDAS);

  if (sh && sh.getLastRow() >= 2) {
    const lastRow = sh.getLastRow();
    const rows = sh.getRange(2,1,lastRow - 1,Math.min(12,sh.getMaxColumns())).getValues();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const actualRow = i + 2;

      if (isTotalValues(r)) break;
      if (!r[0] && !r[1] && !r[3] && !r[5]) continue;

      const total = Number(r[5]) || 0;
      const pago = parseMoney(r[9]) || 0;
      const saldo = Number(r[10]) || Math.max(0,total-pago);

      const pedidoIdAtual=String(r[11] || '').trim();
      // Um pedido pode ter somente uma venda. Se houver registros duplicados
      // com o mesmo pedidoId (legado ou clique repetido), a primeira venda
      // continua sendo a venda oficial e as demais não entram na contabilidade.
      if(pedidoIdAtual){
        if(pedidoIdsVistos.has(pedidoIdAtual)) continue;
        pedidoIdsVistos.add(pedidoIdAtual);
      }

      sales.push({
        row: actualRow,
        data: dateValue(r[0]),
        cliente: String(r[1] || ''),
        contatoEmpresa: String(r[2] || ''),
        quantidade: Number(r[3]) || 0,
        valorUnitario: Number(r[4]) || 0,
        total: total,
        dataPagamento: dateValue(r[6]),
        pago: !!r[7],
        parcial: String(r[8] || 'Não'),
        valorPago: pago,
        deve: saldo,
        status: saldo <= 0 ? 'Pago' : pago > 0 ? 'Parcial' : 'Pendente',
        pedidoId: pedidoIdAtual
      });
    }
  }

  const costs = [];
  const cs = ss.getSheetByName(SHEET_CUSTOS);

  if (cs && cs.getLastRow() >= 1) {
    const rows = cs.getRange(1,1,cs.getLastRow(),3).getValues();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const a = normalize(r[0]);
      const b = normalize(r[1]);

      if (
        a === 'DATA' ||
        b === 'DESCRICAO' ||
        a === 'TOTAL' ||
        a === 'TOTAL GERAL' ||
        a === 'TOTAL DE CUSTOS' ||
        a === 'CUSTOS DE PRODUCAO' ||
        b === 'TOTAL' ||
        b === 'TOTAL GERAL' ||
        b === 'TOTAL DE CUSTOS' ||
        b === 'CUSTOS DE PRODUCAO' ||
        a.includes('REGISTRE AQUI OS GASTOS') ||
        b.includes('REGISTRE AQUI OS GASTOS')
      ) continue;

      if (!r[0] && !r[1] && !r[2]) continue;

      costs.push({
        row: i + 1,
        data: dateValue(r[0]),
        descricao: String(r[1] || ''),
        valor: Number(r[2]) || 0
      });
    }
  }

  const production = readProduction(ss);
  const orders = readOrders(ss);
  const adjustments = readStockAdjustments(ss);

  return {
    sales: sales,
    costs: costs,
    summary: readSummary(ss),
    clientSummary: readClientSummary(ss),
    production: production,
    stock: calculateStock(production,orders,adjustments),
    orders: orders
  };
}

function readSummary(ss) {
  const out = {
    totalVendido: 0,
    totalRecebido: 0,
    totalAReceber: 0,
    qtdPaes: 0,
    qtdVendas: 0,
    ticketMedio: 0,
    custoTotal: 0,
    saldoDisponivel: 0,
    lucro: 0
  };

  const sh = ss.getSheetByName(SHEET_RESUMO);
  if (!sh || sh.getLastRow() < 1) return out;

  const rows = sh.getRange(
    1,1,
    Math.min(sh.getLastRow(),50),
    Math.min(Math.max(sh.getLastColumn(),2),4)
  ).getDisplayValues();

  rows.forEach(r => {
    const label = normalize(r[0]);
    const value = parseMoney(r[1]);

    if (label.includes('TOTAL VENDIDO')) out.totalVendido = value;
    else if (label.includes('TOTAL RECEBIDO')) out.totalRecebido = value;
    else if (label.includes('TOTAL A RECEBER')) out.totalAReceber = value;
    else if (label.includes('QUANTIDADE DE PAES VENDIDOS')) out.qtdPaes = parseNumber(r[1]);
    else if (label.includes('QUANTIDADE DE VENDAS')) out.qtdVendas = parseNumber(r[1]);
    else if (label.includes('TICKET MEDIO')) out.ticketMedio = value;
    else if (label.includes('CUSTO TOTAL')) out.custoTotal = value;
    else if (label.includes('SALDO DISPONIVEL')) out.saldoDisponivel = value;
    else if (label === 'LUCRO' || label.startsWith('LUCRO ')) out.lucro = value;
  });

  return out;
}

function readClientSummary(ss) {
  const sh = ss.getSheetByName(SHEET_RESUMO_PESSOA);
  const result = [];

  if (!sh || sh.getLastRow() < 1) return result;

  const rows = sh.getRange(
    1,1,
    Math.min(sh.getLastRow(),500),
    Math.min(Math.max(sh.getLastColumn(),6),6)
  ).getDisplayValues();

  let header = -1;

  for (let i = 0; i < Math.min(rows.length,20); i++) {
    if (
      normalize(rows[i][0]) === 'CLIENTE' &&
      normalize(rows[i][1]).includes('QTD')
    ) {
      header = i;
      break;
    }
  }

  if (header < 0) return result;

  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i];
    const cliente = String(r[0] || '').trim();

    if (!cliente) continue;
    if (['TOTAL GERAL','TOTAL'].includes(normalize(cliente))) break;

    result.push({
      cliente: cliente,
      qtdPaes: parseNumber(r[1]),
      qtdVendas: parseNumber(r[2]),
      totalVendido: parseMoney(r[3]),
      totalPago: parseMoney(r[4]),
      saldoDevedor: parseMoney(r[5])
    });
  }

  return result;
}

function findTotalRow(sh, startCol, endCol) {
  const lastRow = sh.getLastRow();
  if (!lastRow) return 0;

  const width = endCol - startCol + 1;
  const values = sh.getRange(1,startCol,lastRow,width).getDisplayValues();

  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values[i].length; j++) {
      const value = normalize(values[i][j]);
      if (value === 'TOTAL' || value === 'TOTAL GERAL' || value === 'TOTAL DE CUSTOS' || value === 'CUSTOS DE PRODUCAO') {
        return i + 1;
      }
    }
  }

  return 0;
}

function isTotalRow(sh, row) {
  if (row < 1 || row > sh.getLastRow()) return false;

  const values = sh.getRange(row,1,1,2).getDisplayValues()[0];
  return isTotalValues(values);
}

function isTotalValues(r) {
  const a = normalize(r[0]);
  const b = normalize(r[1]);

  return (
    a === 'TOTAL' ||
    a === 'TOTAL GERAL' ||
    a === 'TOTAL DE CUSTOS' ||
    a === 'CUSTOS DE PRODUCAO' ||
    b === 'TOTAL' ||
    b === 'TOTAL GERAL' ||
    b === 'TOTAL DE CUSTOS' ||
    b === 'CUSTOS DE PRODUCAO' ||
    a.includes('REGISTRE AQUI OS GASTOS') ||
    b.includes('REGISTRE AQUI OS GASTOS')
  );
}

function normalize(v) {
  return String(v || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toUpperCase();
}

function parseNumber(v) {
  if (typeof v === 'number') return v;

  const s = String(v || '')
    .replace(/[^0-9,.-]/g,'')
    .replace(/\./g,'')
    .replace(',','.');

  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function parseMoney(v) {
  return parseNumber(v);
}

function dateValue(v) {
  if (!v) return '';

  if (
    Object.prototype.toString.call(v) === '[object Date]' &&
    !isNaN(v.getTime())
  ) {
    return Utilities.formatDate(
      v,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  return String(v).trim();
}

function formatToday() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function json(o) {
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}


/* =========================
 * CLIENTES / PEDIDOS / ESTOQUE
 * ========================= */

function ensureClientSheets(ss) {
  let sh = ss.getSheetByName(SHEET_CLIENTES);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CLIENTES);
    sh.getRange(1,1,1,9).setValues([[
      'ID','Nome','Telefone','Email','Senha Hash','Token','Criado em','Ativo','Senha Temporária'
    ]]);
    sh.setFrozenRows(1);
  } else {
    if (sh.getLastColumn() < 9) sh.getRange(1,9).setValue('Senha Temporária');
  }

  let ph = ss.getSheetByName(SHEET_PEDIDOS);
  if (!ph) {
    ph = ss.insertSheet(SHEET_PEDIDOS);
    ph.getRange(1,1,1,14).setValues([[
      'ID Pedido','Cliente ID','Cliente','Data','Itens','Quantidade Total','Valor Total','Status','Criado em',
      'Valor Pago','Data Pagamento','Saldo','Origem','Referência'
    ]]);
    ph.setFrozenRows(1);
  } else {
    if (ph.getLastColumn() < 14) {
      const headers = [
        'Valor Pago','Data Pagamento','Saldo','Origem','Referência'
      ];
      ph.getRange(1,10,1,headers.length).setValues([headers]);
    }
  }

  let pr = ss.getSheetByName(SHEET_PRODUCAO);
  if (!pr) {
    pr = ss.insertSheet(SHEET_PRODUCAO);
    pr.getRange(1,1,1,4).setValues([[
      'Data','Recheio','Quantidade','Criado em'
    ]]);
    pr.setFrozenRows(1);
  }
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function newToken() {
  return Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
}

function newId(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();
}

function registerClient(ss, d) {
  ensureClientSheets(ss);
  const nome = String(d.nome || '').trim();
  const telefone = String(d.telefone || '').trim();
  const email = String(d.email || '').trim().toLowerCase();
  const senha = String(d.senha || '');

  if (!nome) throw new Error('Informe seu nome.');
  if (!telefone.replace(/\D/g,'')) throw new Error('Informe seu telefone.');
  if (senha.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');

  const sh = ss.getSheetByName(SHEET_CLIENTES);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,8).getValues() : [];
  const telNorm = telefone.replace(/\D/g,'');
  if (rows.some(r => String(r[2] || '').replace(/\D/g,'') === telNorm)) {
    throw new Error('Este telefone já está cadastrado.');
  }

  const id = newId('CLI');
  const token = newToken();
  sh.appendRow([id,nome,telefone,email,hashPassword(senha),token,new Date(),true,false]);

  return {token:token,mustChangePassword:false,cliente:{id:id,nome:nome,telefone:telefone,email:email}};
}

function loginClient(ss, d) {
  ensureClientSheets(ss);
  const login = String(d.login || '').trim();
  const senha = String(d.senha || '');
  if (!login || !senha) throw new Error('Informe login e senha.');

  const sh = ss.getSheetByName(SHEET_CLIENTES);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,9).getValues() : [];

  for (let i=0;i<rows.length;i++) {
    const r=rows[i];
    const telefone=String(r[2]||'').replace(/\D/g,'');
    const ativo=r[7] !== false;
    if (ativo && login.replace(/\D/g,'')===telefone && telefone && hashPassword(senha)===String(r[4]||'')) {
      const token=newToken();
      sh.getRange(i+2,6).setValue(token);
      const cliente={id:String(r[0]),nome:String(r[1]),telefone:String(r[2]),email:String(r[3]),mustChangePassword:r[8] === true};
      // Login retorna somente a sessão. Os dados do cliente são carregados em
      // uma única chamada separada, evitando duas leituras completas seguidas.
      return {token:token,mustChangePassword:r[8] === true,cliente:cliente};
    }
  }
  throw new Error('Login ou senha inválidos.');
}

function changeClientPassword(ss,d) {
  ensureClientSheets(ss);
  const client=findClientByToken(ss,d.token);
  const senha=String(d.novaSenha||'');
  if(senha.length<6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  const sh=ss.getSheetByName(SHEET_CLIENTES);
  const rows=sh.getRange(2,1,sh.getLastRow()-1,9).getValues();
  for(let i=0;i<rows.length;i++) if(String(rows[i][0])===client.id){
    const token=newToken();
    sh.getRange(i+2,5,1,2).setValues([[hashPassword(senha),token]]);
    sh.getRange(i+2,9).setValue(false);
    SpreadsheetApp.flush();
    return {token:token,mustChangePassword:false,cliente:{id:String(rows[i][0]),nome:String(rows[i][1]),telefone:String(rows[i][2]),email:String(rows[i][3])}};
  }
  throw new Error('Cliente não encontrado.');
}

function adminListClients(ss,ordersData,salesData) {
  // Uma leitura da aba Clientes + dados já carregados do painel.
  // Evita reler Pedidos/Vendas e evita filter() dentro do loop de clientes.
  ensureClientSheets(ss);
  const sh=ss.getSheetByName(SHEET_CLIENTES);
  const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,9).getValues():[];
  const orders=ordersData || readOrders(ss);
  const sales=salesData || readAll().sales || [];
  const result=[];
  const known={};
  const pedidoCountByClient={};
  const pedidoCountByName={};

  // VENDA_DIRETA é apenas o registro operacional usado para manter os sabores
  // do estoque. Ela já possui uma venda correspondente e NÃO é um pedido do cliente.
  orders.forEach(o=>{
    const id=String(o.clienteId||'');
    const key=normalize(o.cliente);
    if(id) pedidoCountByClient[id]=(pedidoCountByClient[id]||0)+1;
    if(key) pedidoCountByName[key]=(pedidoCountByName[key]||0)+1;
  });

  rows.forEach(r=>{
    const nome=String(r[1]||'').trim();
    if(!nome)return;
    const id=String(r[0]||'');
    const key=normalize(nome);
    known[key]=true;
    result.push({
      id:id,nome:nome,telefone:String(r[2]||''),email:String(r[3]||''),
      ativo:r[7]!==false,mustChangePassword:r[8]===true,
      pedidos:Math.max(pedidoCountByClient[id]||0,pedidoCountByName[key]||0)
    });
  });

  const historicos={};
  const vendasPorPedido={};
  sales.forEach(v=>{
    const nome=String(v.cliente||'').trim();
    if(!nome)return;
    const key=normalize(nome);
    const pedidoId=String(v.pedidoId||'').trim();
    if(pedidoId && vendasPorPedido[pedidoId])return;
    if(pedidoId)vendasPorPedido[pedidoId]=true;
    if(!historicos[key])historicos[key]={nome:nome,pedidos:0,paes:0};
    historicos[key].pedidos++;
    historicos[key].paes+=Number(v.quantidade)||0;
  });
  orders.forEach(o=>{
    const nome=String(o.cliente||'').trim();
    if(!nome)return;
    const id=String(o.id||'').trim();
    if(id && vendasPorPedido[id])return;
    const key=normalize(nome);
    if(!historicos[key])historicos[key]={nome:nome,pedidos:0,paes:0};
    historicos[key].pedidos++;
  });

  Object.keys(historicos).forEach(key=>{
    if(known[key])return;
    result.push({id:'legacy:'+key,nome:historicos[key].nome,telefone:'',email:'',
      ativo:false,mustChangePassword:false,pedidos:historicos[key].pedidos,
      paes:historicos[key].paes,legacy:true});
  });
  return result;
}
function adminCreateClient(ss,d) {
  ensureClientSheets(ss);
  const nome=String(d.nome||'').trim(),telefone=String(d.telefone||'').trim(),email=String(d.email||'').trim().toLowerCase(),senha=String(d.senha||'');
  if(!nome) throw new Error('Informe o nome do cliente.');
  if(!telefone.replace(/\D/g,'')) throw new Error('Informe o telefone do cliente.');
  if(senha.length<6) throw new Error('A senha inicial deve ter pelo menos 6 caracteres.');
  const sh=ss.getSheetByName(SHEET_CLIENTES),rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,9).getValues():[];
  const telNorm=telefone.replace(/\D/g,'');
  if(telNorm&&rows.some(r=>String(r[2]||'').replace(/\D/g,'')===telNorm)) throw new Error('Este telefone já está cadastrado.');
  const id=newId('CLI');
  sh.appendRow([id,nome,telefone,email,hashPassword(senha),'',new Date(),true,true]);
  const legacyName=String(d.vincularNome||'').trim();let vinculados=0;
  if(legacyName){
    const ph=ss.getSheetByName(SHEET_PEDIDOS);
    if(ph&&ph.getLastRow()>1){
      const pr=ph.getRange(2,1,ph.getLastRow()-1,9).getValues();
      pr.forEach((r,i)=>{if(normalize(r[2])===normalize(legacyName)){ph.getRange(i+2,2).setValue(id);ph.getRange(i+2,3).setValue(nome);vinculados++}});
    }
  }
  SpreadsheetApp.flush();
  return {id:id,nome:nome,email:email,vinculados:vinculados,senhaInicial:senha,mustChangePassword:true};
}
function adminEditClient(ss,d) {
  ensureClientSheets(ss);
  const id=String(d.id||'');if(!id)throw new Error('Cliente não informado.');
  const sh=ss.getSheetByName(SHEET_CLIENTES),rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,9).getValues():[];
  let row=-1,old=null;for(let i=0;i<rows.length;i++)if(String(rows[i][0])===id){row=i+2;old=rows[i];break}
  if(row<0)throw new Error('Cliente não encontrado.');
  const nome=String(d.nome||old[1]||'').trim(),telefone=String(d.telefone||old[2]||'').trim(),email=String(d.email||old[3]||'').trim().toLowerCase(),senha=String(d.senha||'');
  if(!nome)throw new Error('Nome é obrigatório.');
  const telNorm=telefone.replace(/\D/g,'');
  if(!telNorm)throw new Error('Telefone é obrigatório.');
  if(rows.some((r,i)=>i!==row-2&&String(r[2]||'').replace(/\D/g,'')===telNorm))throw new Error('Este telefone já está cadastrado.');
  if(senha&&senha.length<6)throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  sh.getRange(row,2,1,3).setValues([[nome,telefone,email]]);
  if(senha){sh.getRange(row,5).setValue(hashPassword(senha));sh.getRange(row,6).setValue('');sh.getRange(row,9).setValue(true)}
  SpreadsheetApp.flush();
  return {id:id,nome:nome,telefone:telefone,email:email,senhaRedefinida:!!senha,senhaInicial:senha||'',mustChangePassword:senha?true:old[8]===true};
}

function adminDeleteClient(ss,d) {
  ensureClientSheets(ss);
  const id=String(d.id||'').trim();
  if(!id) throw new Error('Cliente não informado.');

  const sh=ss.getSheetByName(SHEET_CLIENTES);
  const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,9).getValues():[];
  let row=-1, nome='';

  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]||'')===id){
      row=i+2;
      nome=String(rows[i][1]||'').trim();
      break;
    }
  }

  if(row<0) throw new Error('Cliente não encontrado.');

  // Remove o acesso ao sistema sem apagar o histórico financeiro.
  sh.getRange(row,5).setValue('');
  sh.getRange(row,6).setValue('');
  sh.getRange(row,8).setValue(false);
  sh.getRange(row,9).setValue(false);

  SpreadsheetApp.flush();
  return {id:id,nome:nome,excluido:true};
}

function findClientByToken(ss, token) {
  ensureClientSheets(ss);
  const t=String(token||'').trim();
  if (!t) throw new Error('Sessão inválida. Faça login novamente.');
  const sh=ss.getSheetByName(SHEET_CLIENTES);
  const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,8).getValues():[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(String(r[5]||'')===t && r[7]!==false){
      return {row:i+2,id:String(r[0]),nome:String(r[1]),telefone:String(r[2]),email:String(r[3])};
    }
  }
  throw new Error('Sessão expirada. Faça login novamente.');
}

function createClientOrder(ss,d) {
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const client=findClientByToken(ss,d.token);
    const itens=Array.isArray(d.itens)?d.itens:[];
    if(!itens.length) throw new Error('Escolha pelo menos um recheio.');

    const stock=readStock(ss);
    const map={};
    stock.forEach(x=>map[normalize(x.recheio)]=x.disponivel);

    const clean=[];
    let totalQtd=0;
    let total=0;

    itens.forEach(item=>{
      const recheio=String(item.recheio||'').trim();
      const qtd=Math.max(0,Math.floor(Number(item.quantidade)||0));
      if(!recheio || !qtd) return;
      const key=normalize(recheio);
      if(!RECHEIOS.some(r=>normalize(r)===key)) throw new Error('Recheio inválido: '+recheio);
      const disponivel=Number(map[key]||0);
      if(qtd>disponivel) throw new Error('Não há estoque suficiente de '+recheio+'. Disponível: '+disponivel+'.');
      clean.push({recheio:RECHEIOS.find(r=>normalize(r)===key),quantidade:qtd,valorUnitario:PRECO_PAODEFINIDO});
      totalQtd+=qtd;
      total+=qtd*PRECO_PAODEFINIDO;
      map[key]=disponivel-qtd;
    });

    if(!clean.length) throw new Error('Informe quantidades válidas.');
    const ph=ss.getSheetByName(SHEET_PEDIDOS);
    const id=newId('PED');
    const data=String(d.data||formatToday()).slice(0,10);
    ph.appendRow([id,client.id,client.nome,data,JSON.stringify(clean),totalQtd,total,'Reservado',new Date(),0,'',total,'CLIENTE',id]);
    const pedidoRow=ph.getLastRow();
    aplicarFormatoPedido(ph,pedidoRow);

    // O pedido fica apenas como "Reservado" até o administrador confirmar.
    // A venda financeira será criada no momento da confirmação.
    const stockAtualizado=stock.map(x=>{const add=Number(clean.find(i=>normalize(i.recheio)===normalize(x.recheio))?.quantidade||0);return {recheio:x.recheio,produzido:x.produzido,reservado:x.reservado+add,vendido:x.vendido,descartado:x.descartado,disponivel:Math.max(0,Number(x.disponivel||0)-add)}});
    return {id:id,data:data,cliente:client.nome,itens:clean,quantidadeTotal:totalQtd,total:total,status:'Reservado',valorPago:0,dataPagamento:'',saldo:total,origem:'CLIENTE',referencia:id,stock:stockAtualizado};
  } finally {
    lock.releaseLock();
  }
}
function findClientOrder(ss, token, orderId) {
  const client=findClientByToken(ss,token);
  const pedidos=readOrders(ss);
  const pedido=pedidos.find(x=>x.id===String(orderId) && x.clienteId===client.id);
  if(!pedido) throw new Error('Pedido não encontrado.');
  return {client:client,pedido:pedido};
}

function confirmClientOrder(ss,d) {
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found=findClientOrder(ss,d.token,d.id);
    const sh=ss.getSheetByName(SHEET_PEDIDOS);
    const row=readOrders(ss).findIndex(x=>x.id===found.pedido.id)+2;
    if(found.pedido.status==='Confirmado'){
      registrarVendaDoPedido(ss,found.pedido);
      SpreadsheetApp.flush();
      return found.pedido;
    }
    if(!isPedidoAguardando(found.pedido.status)) throw new Error('Este pedido não pode ser confirmado.');

    // Cria a venda primeiro. Se falhar, o pedido continua aguardando.
    registrarVendaDoPedido(ss,found.pedido);
    sh.getRange(row,8).setValue('Confirmado');
    SpreadsheetApp.flush();
    found.pedido.status='Confirmado';
    return found.pedido;
  } finally { lock.releaseLock(); }
}

function registrarVendaDoPedido(ss,pedido){
  const id=String(pedido.id||'').trim();
  if(!id) throw new Error('Pedido sem ID.');
  const itens=Array.isArray(pedido.itens)?pedido.itens:[];
  const quantidade=Math.max(0,Math.floor(Number(pedido.quantidadeTotal)||itens.reduce((a,x)=>a+(Number(x.quantidade)||0),0)));
  const total=Math.max(0,Number(pedido.total)||0);
  if(!quantidade||!total) throw new Error('Pedido sem quantidade ou valor.');

  const existing=localizarVendaPorPedidoId(ss,id);
  if(existing) return existing.row;

  const result=appendSale(ss,{
    data:pedido.data||formatToday(),
    cliente:pedido.cliente||'',
    contatoEmpresa:'',
    quantidade:quantidade,
    valorUnitario:PRECO_PAODEFINIDO,
    pago:Number(pedido.valorPago)||0,
    dataPagamento:pedido.dataPagamento||'',
    pedidoId:id,
    naoCriarPedido:true
  });
  return result.row;
}

function criarPedidoDaVendaDireta(ss,venda){
  const ph=ss.getSheetByName(SHEET_PEDIDOS);
  if(!ph) throw new Error('Aba Pedidos não encontrada.');
  const quantidade=Math.max(0,Math.floor(Number(venda.quantidade)||0));
  const total=Math.max(0,Number(venda.total)||0);
  if(!quantidade||!total) throw new Error('Venda sem quantidade ou valor.');

  const id=newId('PEDV');
  const itens=Array.isArray(venda.itens)&&venda.itens.length
    ? venda.itens.filter(x=>Number(x.quantidade)>0).map(x=>({
        recheio:String(x.recheio||'Venda direta'),
        quantidade:Math.max(0,Math.floor(Number(x.quantidade)||0)),
        valorUnitario:Number(x.valorUnitario)||PRECO_PAODEFINIDO
      }))
    : [{recheio:'Venda direta',quantidade:quantidade,valorUnitario:PRECO_PAODEFINIDO}];

  ph.appendRow([
    id,
    clienteIdPorNome(ss,venda.cliente),
    venda.cliente||'',
    venda.data||'',
    JSON.stringify(itens),
    quantidade,
    total,
    'Confirmado',
    new Date(),
    Math.min(Math.max(Number(venda.valorPago)||0,0),total),
    Number(venda.valorPago)>0?(venda.dataPagamento||venda.data||''):'',
    Math.max(0,total-Math.min(Math.max(Number(venda.valorPago)||0,0),total)),
    'ADM',
    String(venda.row||'')
  ]);
  const row=ph.getLastRow();
  aplicarFormatoPedido(ph,row);
  return {id:id,row:row};
}

function localizarVendaPorPedidoId(ss,pedidoId){
  const sh=ss.getSheetByName(SHEET_VENDAS);
  if(!sh||sh.getLastRow()<2||sh.getMaxColumns()<12)return null;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,12).getValues();
  for(let i=0;i<rows.length;i++){
    if(String(rows[i][11]||'')===String(pedidoId||'')){
      return {row:i+2,values:rows[i]};
    }
  }
  return null;
}

function sincronizarVendaDoPedido(ss,pedidoId,pedido){
  const found=localizarVendaPorPedidoId(ss,pedidoId);
  if(!found){
    return registrarVendaDoPedido(ss,Object.assign({},pedido,{id:pedidoId}));
  }
  const sh=ss.getSheetByName(SHEET_VENDAS);
  const row=found.row;
  const quantidade=Math.max(0,Math.floor(Number(pedido.quantidadeTotal)||0));
  const total=Math.max(0,Number(pedido.total)||0);
  const pagoInformado = Object.prototype.hasOwnProperty.call(pedido,'valorPago')
    ? Number(pedido.valorPago)||0
    : Number(found.values[9])||0;
  const pago=Math.min(Math.max(pagoInformado,0),total);
  const saldo=Math.max(0,total-pago);

  sh.getRange(row,1,1,11).setValues([[
    pedido.data||found.values[0],
    pedido.cliente||found.values[1],
    found.values[2]||'',
    quantidade,
    PRECO_PAODEFINIDO,
    total,
    pago>0?(pedido.dataPagamento||found.values[6]||pedido.data||''):'',
    saldo<=0&&total>0,
    pago>0&&saldo>0?'Sim':'Não',
    pago,
    saldo
  ]]);
  sh.getRange(row,12).setValue(String(pedidoId));
  aplicarFormatoVenda(sh,row);
  return row;
}

function excluirVendaDoPedido(ss,pedidoId){
  const found=localizarVendaPorPedidoId(ss,pedidoId);
  if(!found)return false;
  ss.getSheetByName(SHEET_VENDAS).deleteRow(found.row);
  return true;
}

function editClientOrder(ss,d) {
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found=findClientOrder(ss,d.token,d.id);
    if(!isPedidoAguardando(found.pedido.status)) throw new Error('Este pedido já foi confirmado e não pode mais ser editado pelo cliente.');
    const itens=Array.isArray(d.itens)?d.itens:[];
    if(!itens.length) throw new Error('Escolha pelo menos um recheio ou exclua o pedido.');
    const current={};
    found.pedido.itens.forEach(x=>current[normalize(x.recheio)]=(current[normalize(x.recheio)]||0)+(Number(x.quantidade)||0));
    const stock=readStock(ss);
    const available={};
    stock.forEach(x=>available[normalize(x.recheio)]=Number(x.disponivel)||0);
    const clean=[]; const requested={}; let totalQtd=0; let total=0;
    itens.forEach(item=>{
      const recheio=String(item.recheio||'').trim();
      const qtd=Math.max(0,Math.floor(Number(item.quantidade)||0));
      if(!recheio||!qtd) return;
      const key=normalize(recheio);
      if(!RECHEIOS.some(r=>normalize(r)===key)) throw new Error('Recheio inválido: '+recheio);
      requested[key]=(requested[key]||0)+qtd;
    });
    RECHEIOS.forEach(r=>{
      const key=normalize(r);
      const qtd=Number(requested[key]||0);
      if(!qtd) return;
      const disponivelParaEdicao=(available[key]||0)+(current[key]||0);
      if(qtd>disponivelParaEdicao) throw new Error('Não há estoque suficiente de '+r+'. Disponível para este pedido: '+disponivelParaEdicao+'.');
      clean.push({recheio:r,quantidade:qtd,valorUnitario:PRECO_PAODEFINIDO});
      totalQtd+=qtd; total+=qtd*PRECO_PAODEFINIDO;
    });
    if(!clean.length) throw new Error('Informe quantidades válidas.');
    const ordersSh=ss.getSheetByName(SHEET_PEDIDOS);
    const rows=ordersSh.getRange(2,1,ordersSh.getLastRow()-1,9).getValues();
    let row=-1;
    for(let i=0;i<rows.length;i++) if(String(rows[i][0])===found.pedido.id){row=i+2;break;}
    if(row<0) throw new Error('Pedido não encontrado.');
    ordersSh.getRange(row,5,1,3).setValues([[JSON.stringify(clean),totalQtd,total]]);
    ordersSh.getRange(row,12).setValue(Math.max(0,total-(Number(found.pedido.valorPago)||0)));
    aplicarFormatoPedido(ordersSh,row);
    sincronizarVendaDoPedido(ss,found.pedido.id,{
      data:found.pedido.data,
      cliente:found.client.nome,
      quantidadeTotal:totalQtd,
      total:total,
      dataPagamento:found.pedido.dataPagamento||''
    });
    SpreadsheetApp.flush();
    return {id:found.pedido.id,data:found.pedido.data,cliente:found.client.nome,itens:clean,quantidadeTotal:totalQtd,total:total,status:found.pedido.status};
  } finally { lock.releaseLock(); }
}

function deleteClientOrder(ss,d) {
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found=findClientOrder(ss,d.token,d.id);
    if(!isPedidoAguardando(found.pedido.status)) throw new Error('Este pedido já foi confirmado e não pode mais ser excluído pelo cliente.');
    const sh=ss.getSheetByName(SHEET_PEDIDOS);
    const rows=sh.getRange(2,1,sh.getLastRow()-1,9).getValues();
    let row=-1;
    for(let i=0;i<rows.length;i++) if(String(rows[i][0])===found.pedido.id){row=i+2;break;}
    if(row<0) throw new Error('Pedido não encontrado.');
    sh.deleteRow(row);
    excluirVendaDoPedido(ss,found.pedido.id);
    SpreadsheetApp.flush();
    return {id:found.pedido.id};
  } finally { lock.releaseLock(); }
}

function adminConfirmOrder(ss,d) {
  const id=String(d.id||'').trim();
  if(!id) throw new Error('Pedido não informado.');

  const sh=ss.getSheetByName(SHEET_PEDIDOS);
  if(!sh||sh.getLastRow()<2) throw new Error('Pedido não encontrado.');

  const rows=sh.getRange(2,1,sh.getLastRow()-1,14).getValues();
  let row=-1, old=null;
  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]||'')===id){
      row=i+2;
      old={
        id:id,
        clienteId:String(rows[i][1]||''),
        cliente:String(rows[i][2]||''),
        data:dateValue(rows[i][3]),
        itens:(()=>{try{return JSON.parse(String(rows[i][4]||'[]'))}catch(_){return []}})(),
        quantidadeTotal:Number(rows[i][5])||0,
        total:Number(rows[i][6])||0,
        status:String(rows[i][7]||'Reservado'),
        criadoEm:rows[i][8],
        valorPago:Number(rows[i][9])||0,
        dataPagamento:dateValue(rows[i][10]),
        saldo:Number(rows[i][11])||Math.max(0,(Number(rows[i][6])||0)-(Number(rows[i][9])||0)),
        origem:String(rows[i][12]||''),
        referencia:String(rows[i][13]||'')
      };
      break;
    }
  }

  if(row<0) throw new Error('Pedido não encontrado.');

  // Já confirmado: garante somente que a venda vinculada exista.
  if(old.status==='Confirmado'){
    registrarVendaDoPedido(ss,old);
    SpreadsheetApp.flush();
    return old;
  }

  // Reservado/Aguardando ou uma confirmação que ficou interrompida.
  if(!isPedidoAguardando(old.status) && old.status!=='Confirmando'){
    throw new Error('Este pedido não está aguardando confirmação.');
  }

  // Marca primeiro como "Confirmando". Assim um segundo clique não inicia
  // outra confirmação do mesmo pedido enquanto esta estiver em andamento.
  if(old.status!=='Confirmando'){
    sh.getRange(row,8).setValue('Confirmando');
    SpreadsheetApp.flush();
  }

  // A operação é idempotente: registrarVendaDoPedido procura pelo pedidoId
  // antes de criar uma nova venda.
  registrarVendaDoPedido(ss,old);

  sh.getRange(row,8).setValue('Confirmado');
  old.status='Confirmado';
  SpreadsheetApp.flush();
  return old;
}
function adminConfirmOrdersBatch(ss,d) {
  const ids=Array.isArray(d.ids) ? [...new Set(d.ids.map(x=>String(x||'').trim()).filter(Boolean))] : [];
  if(!ids.length) throw new Error('Nenhum pedido selecionado.');
  if(ids.length>100) throw new Error('Selecione no máximo 100 pedidos por vez.');

  const sh=ss.getSheetByName(SHEET_PEDIDOS);
  if(!sh||sh.getLastRow()<2) throw new Error('Nenhum pedido encontrado.');

  const rows=sh.getRange(2,1,sh.getLastRow()-1,14).getValues();
  const selected=new Set(ids);
  let confirmados=0,jaConfirmados=0,ignorados=0,naoEncontrados=0;
  const vendasCriadas=[];

  for(let i=0;i<rows.length;i++){
    const id=String(rows[i][0]||'').trim();
    if(!selected.has(id)) continue;

    const status=String(rows[i][7]||'Reservado').trim();

    if(isPedidoAguardando(status) || status==='Confirmando'){
      const itens=(()=>{try{return JSON.parse(String(rows[i][4]||'[]'))}catch(_){return []}})();
      const pedido={
        id:id,
        clienteId:String(rows[i][1]||''),
        cliente:String(rows[i][2]||''),
        data:dateValue(rows[i][3]),
        itens:itens,
        quantidadeTotal:Number(rows[i][5])||0,
        total:Number(rows[i][6])||0,
        status:'Confirmando',
        criadoEm:rows[i][8],
        valorPago:Number(rows[i][9])||0,
        dataPagamento:dateValue(rows[i][10]),
        saldo:Number(rows[i][11])||Math.max(0,(Number(rows[i][6])||0)-(Number(rows[i][9])||0)),
        origem:String(rows[i][12]||''),
        referencia:String(rows[i][13]||'')
      };

      // Reserva logicamente o pedido antes de criar a venda.
      sh.getRange(i+2,8).setValue('Confirmando');
      SpreadsheetApp.flush();

      registrarVendaDoPedido(ss,pedido);

      sh.getRange(i+2,8).setValue('Confirmado');
      vendasCriadas.push(id);
      confirmados++;
    }else if(status==='Confirmado'){
      jaConfirmados++;
      const itens=(()=>{try{return JSON.parse(String(rows[i][4]||'[]'))}catch(_){return []}})();
      registrarVendaDoPedido(ss,{
        id:id,clienteId:String(rows[i][1]||''),cliente:String(rows[i][2]||''),data:dateValue(rows[i][3]),
        itens:itens,quantidadeTotal:Number(rows[i][5])||0,total:Number(rows[i][6])||0,status:'Confirmado',
        valorPago:Number(rows[i][9])||0,dataPagamento:dateValue(rows[i][10]),saldo:Number(rows[i][11])||0,
        origem:String(rows[i][12]||''),referencia:String(rows[i][13]||'')
      });
    }else{
      ignorados++;
    }
  }

  const foundIds=new Set(rows.map(r=>String(r[0]||'').trim()).filter(Boolean));
  naoEncontrados=ids.filter(id=>!foundIds.has(id)).length;
  SpreadsheetApp.flush();
  return {selecionados:ids.length,confirmados:confirmados,jaConfirmados:jaConfirmados,ignorados:ignorados,naoEncontrados:naoEncontrados,vendasCriadas:vendasCriadas};
}
function adminRegistrarPagamentoCliente(ss,d){
  const nome=String(d.cliente||'').trim();
  if(!nome) throw new Error('Cliente não informado.');

  const valorInformado=parseMoney(d.valor);
  if(!Number.isFinite(valorInformado)||valorInformado<=0){
    throw new Error('Informe um valor de pagamento maior que zero.');
  }

  const sh=ss.getSheetByName(SHEET_VENDAS);
  if(!sh||sh.getLastRow()<2) throw new Error('Nenhuma venda encontrada.');

  const lastColumn=Math.min(12,sh.getMaxColumns());
  const rows=sh.getRange(2,1,sh.getLastRow()-1,lastColumn).getValues();
  const alvo=[];
  const nomeNorm=normalize(nome);

  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(normalize(String(r[1]||''))!==nomeNorm) continue;
    if(isTotalValues(r)) continue;

    const total=Math.max(0,Number(r[5])||0);
    const pago=Math.max(0,parseMoney(r[9]));
    const saldo=Math.max(0,total-pago);
    if(saldo<=0) continue;

    alvo.push({
      row:i+2,
      total:total,
      pago:pago,
      saldo:saldo,
      pedidoId:lastColumn>=12?String(r[11]||'').trim():'',
      data:r[0],
      cliente:String(r[1]||''),
      contato:String(r[2]||'')
    });
  }

  // FIFO: a dívida com a data mais antiga é quitada primeiro.
  // Em caso de mesma data, usa a linha mais antiga da planilha como desempate.
  alvo.sort((a,b)=>{
    const da=dateValue(a.data)||'9999-12-31';
    const db=dateValue(b.data)||'9999-12-31';
    return da.localeCompare(db)||a.row-b.row;
  });

  if(!alvo.length) throw new Error('Este cliente não possui saldo pendente.');

  const saldoTotal=alvo.reduce((s,x)=>s+x.saldo,0);
  const valor=Math.min(valorInformado,saldoTotal);

  // Aplica o pagamento sequencialmente:
  // 1) quita a dívida mais antiga;
  // 2) somente o restante passa para a próxima;
  // 3) nunca divide o valor proporcionalmente entre todas as vendas.
  let restante=valor;
  const alteracoes=[];
  for(const x of alvo){
    if(restante<=0)break;

    const pagar=Math.min(restante,x.saldo);
    restante-=pagar;

    const novoPago=x.pago+pagar;
    alteracoes.push({
      row:x.row,
      total:x.total,
      pago:novoPago,
      saldo:Math.max(0,x.total-novoPago),
      pedidoId:x.pedidoId,
      dataPagamento:novoPago>0?formatToday():''
    });
  }

  alteracoes.forEach(x=>{
    sh.getRange(x.row,7,1,5).setValues([[
      x.dataPagamento,
      x.saldo<=0&&x.total>0,
      x.pago>0&&x.saldo>0?'Sim':'Não',
      x.pago,
      x.saldo
    ]]);
    aplicarFormatoVenda(sh,x.row);
  });

  // Mantém os pedidos novos com seus sabores/status originais.
  alteracoes.forEach(x=>{
    if(x.pedidoId){
      atualizarPedidoHistorico(ss,x.pedidoId,{
        row:x.row,
        data:sh.getRange(x.row,1).getValue(),
        cliente:String(sh.getRange(x.row,2).getValue()||''),
        quantidade:Number(sh.getRange(x.row,4).getValue())||0,
        valorUnitario:Number(sh.getRange(x.row,5).getValue())||0,
        total:x.total,
        valorPago:x.pago,
        dataPagamento:x.dataPagamento
      });
    }
  });

  SpreadsheetApp.flush();

  return {
    cliente:nome,
    valorSolicitado:valorInformado,
    valorRegistrado:valor,
    saldoAnterior:saldoTotal,
    saldoRestante:Math.max(0,saldoTotal-valor),
    vendasAtualizadas:alteracoes.length
  };
}

function adminEditOrder(ss,d) {
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id=String(d.id||'');
    if(!id) throw new Error('Pedido não informado.');
    const ordersSh=ss.getSheetByName(SHEET_PEDIDOS);
    const rows=ordersSh.getLastRow()>1?ordersSh.getRange(2,1,ordersSh.getLastRow()-1,9).getValues():[];
    let row=-1, old=null;
    for(let i=0;i<rows.length;i++) if(String(rows[i][0])===id){row=i+2;old={id:String(rows[i][0]),clienteId:String(rows[i][1]),cliente:String(rows[i][2]),data:String(rows[i][3]),itens:JSON.parse(String(rows[i][4]||'[]')),status:String(rows[i][7]||'Reservado')};break}
    if(row<0) throw new Error('Pedido não encontrado.');
    if(!['Reservado','Confirmado'].includes(old.status)) throw new Error('Este pedido não pode ser editado.');
    const itens=Array.isArray(d.itens)?d.itens:[];
    if(!itens.length) throw new Error('Informe os itens do pedido.');
    const stock=readStock(ss), available={};
    stock.forEach(x=>available[normalize(x.recheio)]=Number(x.disponivel)||0);
    const current={}; old.itens.forEach(x=>current[normalize(x.recheio)]=(current[normalize(x.recheio)]||0)+(Number(x.quantidade)||0));
    const requested={};
    itens.forEach(item=>{const r=String(item.recheio||'').trim(),q=Math.max(0,Math.floor(Number(item.quantidade)||0));if(!q)return;const k=normalize(r);if(!RECHEIOS.some(x=>normalize(x)===k))throw new Error('Recheio inválido: '+r);requested[k]=(requested[k]||0)+q});
    const clean=[];let totalQtd=0,total=0;
    RECHEIOS.forEach(r=>{const k=normalize(r),q=Number(requested[k]||0);if(!q)return;const disponivel=(available[k]||0)+(current[k]||0);if(q>disponivel)throw new Error('Estoque insuficiente de '+r+'. Disponível para edição: '+disponivel+'.');clean.push({recheio:r,quantidade:q,valorUnitario:PRECO_PAODEFINIDO});totalQtd+=q;total+=q*PRECO_PAODEFINIDO});
    if(!clean.length)throw new Error('Informe quantidades válidas.');
    ordersSh.getRange(row,5,1,3).setValues([[JSON.stringify(clean),totalQtd,total]]);
    ordersSh.getRange(row,12).setValue(Math.max(0,total-(Number(rows[row-2][9])||0)));
    aplicarFormatoPedido(ordersSh,row);
    sincronizarVendaDoPedido(ss,id,{
      data:old.data,
      cliente:old.cliente,
      quantidadeTotal:totalQtd,
      total:total,
      dataPagamento:dateValue(rows[row-2][10]||'')
    });
    SpreadsheetApp.flush();
    return {id:id,cliente:old.cliente,data:old.data,itens:clean,quantidadeTotal:totalQtd,total:total,status:old.status};
  } finally { lock.releaseLock(); }
}
function adminDeleteOrder(ss,d) {
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id=String(d.id||''); if(!id)throw new Error('Pedido não informado.');
    const sh=ss.getSheetByName(SHEET_PEDIDOS), rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,9).getValues():[];
    let row=-1; for(let i=0;i<rows.length;i++)if(String(rows[i][0])===id){row=i+2;break}
    if(row<0)throw new Error('Pedido não encontrado.');
    sh.deleteRow(row);
    excluirVendaDoPedido(ss,id);
    SpreadsheetApp.flush();
    return {id:id};
  } finally { lock.releaseLock(); }
}
function readClientSales(ss,nomeCliente){
  const sh=ss.getSheetByName(SHEET_VENDAS);
  const out=[];
  if(!sh||sh.getLastRow()<2)return out;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,Math.min(12,sh.getMaxColumns())).getValues();
  const alvo=normalize(nomeCliente);
  const pedidosVistos={};
  for(let i=0;i<rows.length;i++){
    const r=rows[i],actualRow=i+2;
    if(isTotalValues(r))break;
    if(!r[0]&&!r[1]&&!r[3]&&!r[5])continue;
    if(normalize(r[1])!==alvo)continue;
    const total=Number(r[5])||0;
    const pago=parseMoney(r[9])||0;
    const saldo=Number(r[10])||Math.max(0,total-pago);
    const pedidoId=String(r[11]||'').trim();
    if(pedidoId&&pedidosVistos[pedidoId])continue;
    if(pedidoId)pedidosVistos[pedidoId]=true;
    out.push({
      row:actualRow,data:dateValue(r[0]),cliente:String(r[1]||''),
      contatoEmpresa:String(r[2]||''),quantidade:Number(r[3])||0,
      valorUnitario:Number(r[4])||0,total:total,dataPagamento:dateValue(r[6]),
      pago:!!r[7],parcial:String(r[8]||'Não'),valorPago:pago,deve:saldo,
      status:saldo<=0?'Pago':pago>0?'Parcial':'Pendente',pedidoId:pedidoId
    });
  }
  return out;
}

function getClientDataForClient(ss,client){
  const pedidosTodos=readOrders(ss);
  const nomeCliente=normalize(client.nome);
  const pedidos=pedidosTodos.filter(x=>String(x.clienteId||'')===client.id||normalize(x.cliente)===nomeCliente);
  const vendas=readClientSales(ss,client.nome);
  // Não chama readAll(): login e atualização do cliente não precisam ler
  // custos, resumos, ranking e demais dados administrativos.
  const production=readProduction(ss);
  const adjustments=readStockAdjustments(ss);
  const stock=calculateStock(production,pedidosTodos,adjustments);
  const totalComprado=vendas.reduce((a,x)=>a+Number(x.total||0),0);
  const totalPago=vendas.reduce((a,x)=>a+Number(x.valorPago||0),0);
  const totalAberto=vendas.reduce((a,x)=>a+Number(x.deve||0),0);
  return {cliente:client,pedidos:pedidos,vendas:vendas,totalComprado:totalComprado,totalPago:totalPago,totalAberto:totalAberto,stock:stock,mustChangePassword:!!client.mustChangePassword};
}
function getClientData(ss,d){
  const client=findClientByToken(ss,d.token);
  return getClientDataForClient(ss,client);
}

function isPedidoAguardando(status){
  const s=normalize(status);
  return s==='RESERVADO' || s==='AGUARDANDO';
}

function readOrders(ss) {
  ensureClientSheets(ss);
  const sh=ss.getSheetByName(SHEET_PEDIDOS);
  const out=[];
  if(sh.getLastRow()<2) return out;

  const cols=Math.max(14,sh.getLastColumn());
  const rows=sh.getRange(2,1,sh.getLastRow()-1,Math.min(cols,14)).getValues();

  rows.forEach(r=>{
    if(!r[0]) return;
    let itens=[];
    try{itens=JSON.parse(String(r[4]||'[]'))}catch(_){}
    const total=Number(r[6])||0;
    const valorPago=parseMoney(r[9])||0;
    const saldo=Number(r[11])||Math.max(0,total-valorPago);

    out.push({
      id:String(r[0]),
      clienteId:String(r[1]||''),
      cliente:String(r[2]||''),
      data:dateValue(r[3]),
      itens:itens,
      quantidadeTotal:Number(r[5])||0,
      total:total,
      status:String(r[7]||'Reservado'),
      criadoEm:r[8] instanceof Date?Utilities.formatDate(r[8],Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss'):String(r[8]||''),
      valorPago:valorPago,
      dataPagamento:dateValue(r[10]),
      saldo:saldo,
      origem:String(r[12]||''),
      referencia:String(r[13]||'')
    });
  });
  return out;
}

function aplicarFormatoCusto(sh,rowNumber){
  if(!sh||!rowNumber||rowNumber<1)return;
  sh.getRange(rowNumber,1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(rowNumber,3).setNumberFormat('R$ #,##0.00');
}

function aplicarFormatoPedido(sh,rowNumber){
  if(!sh||!rowNumber||rowNumber<1)return;
  sh.getRange(rowNumber,4).setNumberFormat('dd/MM/yyyy');
  sh.getRange(rowNumber,6).setNumberFormat('0');
  sh.getRange(rowNumber,7).setNumberFormat('R$ #,##0.00');
  sh.getRange(rowNumber,10).setNumberFormat('R$ #,##0.00');
  sh.getRange(rowNumber,11).setNumberFormat('dd/MM/yyyy');
  sh.getRange(rowNumber,12).setNumberFormat('R$ #,##0.00');
}

function aplicarFormatoProducao(sh,rowNumber){
  if(!sh||!rowNumber||rowNumber<1)return;
  sh.getRange(rowNumber,1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(rowNumber,3).setNumberFormat('0');
}

function clienteIdPorNome(ss,nome){
  const sh=ss.getSheetByName(SHEET_CLIENTES);
  if(!sh||sh.getLastRow()<2)return '';
  const rows=sh.getRange(2,1,sh.getLastRow()-1,9).getValues();
  const alvo=normalize(nome);
  for(const r of rows){
    if(normalize(r[1])===alvo)return String(r[0]||'');
  }
  return '';
}

function excluirPedidoHistorico(ss,pedidoId){
  if(!pedidoId)return false;
  const sh=ss.getSheetByName(SHEET_PEDIDOS);
  if(!sh||sh.getLastRow()<2)return false;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,14).getValues();
  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]||'')===String(pedidoId)){
      sh.deleteRow(i+2);
      return true;
    }
  }
  return false;
}

function atualizarPedidoHistorico(ss,pedidoId,venda){
  if(!pedidoId)return false;
  const sh=ss.getSheetByName(SHEET_PEDIDOS);
  if(!sh||sh.getLastRow()<2)return false;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,14).getValues();

  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]||'')!==String(pedidoId))continue;

    const row=i+2;
    const total=Math.max(0,Number(venda.total)||0);
    const pago=Math.min(Math.max(Number(venda.valorPago)||0,0),total);
    const saldo=Math.max(0,total-pago);
    const origem=String(rows[i][12]||'').trim();

    // Vendas antigas importadas/migradas não possuem os sabores originais.
    // Mantemos o registro genérico e alteramos somente os dados financeiros.
    if(origem==='VENDA_HISTORICA'){
      sh.getRange(row,10,1,3).setValues([[
        pago,
        pago>0?(venda.dataPagamento||venda.data||''):'',
        saldo
      ]]);
      aplicarFormatoPedido(sh,row);
      return true;
    }

    // Pedidos novos preservam os sabores e o status originais.
    // Quando a venda é editada, sincronizamos apenas os campos que realmente
    // pertencem à venda e os dados financeiros, sem substituir os itens por
    // "Venda histórica".
    sh.getRange(row,2).setValue(clienteIdPorNome(ss,venda.cliente));
    sh.getRange(row,3,1,2).setValues([[
      venda.cliente,
      venda.data
    ]]);
    sh.getRange(row,6,1,2).setValues([[
      Math.max(0,Math.floor(Number(venda.quantidade)||0)),
      total
    ]]);
    sh.getRange(row,10,1,3).setValues([[
      pago,
      pago>0?(venda.dataPagamento||venda.data||''):'',
      saldo
    ]]);
    aplicarFormatoPedido(sh,row);
    return true;
  }
  return false;
}

function criarPedidoHistoricoDaVenda(ss,venda){
  const ph=ss.getSheetByName(SHEET_PEDIDOS);
  if(!ph)throw new Error('Aba Pedidos não encontrada.');

  const quantidade=Math.max(0,Math.floor(Number(venda.quantidade)||0));
  const total=Math.max(0,Number(venda.total)||0);
  if(!quantidade||!total)return '';

  const id=newId('PEDH');
  const pago=Math.min(Math.max(Number(venda.valorPago)||0,0),total);
  const saldo=Math.max(0,total-pago);
  const itens=[{
    recheio:'Venda histórica',
    quantidade:quantidade,
    valorUnitario:Number(venda.valorUnitario)||0
  }];

  ph.appendRow([
    id,
    clienteIdPorNome(ss,venda.cliente),
    venda.cliente||'',
    venda.data||'',
    JSON.stringify(itens),
    quantidade,
    total,
    'Histórico',
    new Date(),
    pago,
    pago>0?(venda.dataPagamento||venda.data||''):'',
    saldo,
    'VENDA_HISTORICA',
    String(venda.row||'')
  ]);

  const row=ph.getLastRow();
  aplicarFormatoPedido(ph,row);
  return id;
}

function migrarVendasParaPedidos(ss){
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    ensureClientSheets(ss);

    const vsh=ss.getSheetByName(SHEET_VENDAS);
    const psh=ss.getSheetByName(SHEET_PEDIDOS);
    if(!vsh||vsh.getLastRow()<5)return {importadas:0,vinculadas:0};

    const pedidoMetaCol=12;
    if(vsh.getMaxColumns()<pedidoMetaCol){
      vsh.insertColumnAfter(vsh.getMaxColumns());
    }

    const salesRows=vsh.getRange(5,1,vsh.getLastRow()-4,12).getValues();
    const pedidosRows=psh.getLastRow()>1?psh.getRange(2,1,psh.getLastRow()-1,14).getValues():[];
    const pedidosPorReferencia={};

    pedidosRows.forEach(r=>{
      const ref=String(r[13]||'').trim();
      if(ref)pedidosPorReferencia[ref]=String(r[0]||'');
    });

    let importadas=0,vinculadas=0;

    for(let i=0;i<salesRows.length;i++){
      const r=salesRows[i];
      const actualRow=i+5;

      if(isTotalValues(r))break;

      const cliente=String(r[1]||'').trim();
      const quantidade=Math.max(0,Math.floor(Number(r[3])||0));
      const total=Number(r[5])||0;
      if(!cliente||!quantidade||!total)continue;

      let pedidoId=String(r[11]||'').trim();

      if(pedidoId && pedidosPorReferencia[String(actualRow)]===pedidoId){
        atualizarPedidoHistorico(ss,pedidoId,{
          row:actualRow,
          data:dateValue(r[0]),
          cliente:cliente,
          quantidade:quantidade,
          valorUnitario:Number(r[4])||0,
          total:total,
          valorPago:parseMoney(r[9])||0,
          dataPagamento:dateValue(r[6])
        });
        continue;
      }
      if(pedidoId && !pedidosPorReferencia[String(actualRow)]){
        atualizarPedidoHistorico(ss,pedidoId,{
          row:actualRow,data:dateValue(r[0]),cliente:cliente,
          quantidade:quantidade,valorUnitario:Number(r[4])||0,total:total,
          valorPago:parseMoney(r[9])||0,dataPagamento:dateValue(r[6])
        });
        continue;
      }

      if(pedidosPorReferencia[String(actualRow)]){
        pedidoId=pedidosPorReferencia[String(actualRow)];
        vsh.getRange(actualRow,12).setValue(pedidoId);
        vinculadas++;
        continue;
      }

      const venda={
        row:actualRow,
        data:dateValue(r[0]),
        cliente:cliente,
        quantidade:quantidade,
        valorUnitario:Number(r[4])||0,
        total:total,
        valorPago:parseMoney(r[9])||0,
        dataPagamento:dateValue(r[6])
      };

      pedidoId=criarPedidoHistoricoDaVenda(ss,venda);
      vsh.getRange(actualRow,12).setValue(pedidoId);
      pedidosPorReferencia[String(actualRow)]=pedidoId;
      importadas++;
    }

    vsh.hideColumns(pedidoMetaCol);
    SpreadsheetApp.flush();
    return {importadas:importadas,vinculadas:vinculadas};
  } finally {
    lock.releaseLock();
  }
}

function addProduction(ss,d) {
  ensureClientSheets(ss);
  const data=String(d.data||formatToday()).slice(0,10);
  const itens=Array.isArray(d.itens)?d.itens:[];
  const sh=ss.getSheetByName(SHEET_PRODUCAO);
  const rows=[];
  itens.forEach(item=>{
    const recheio=String(item.recheio||'').trim();
    const quantidade=Math.max(0,Math.floor(Number(item.quantidade)||0));
    if(!quantidade)return;
    const canonical=RECHEIOS.find(r=>normalize(r)===normalize(recheio));
    if(!canonical)throw new Error('Recheio inválido: '+recheio);
    rows.push([data,canonical,quantidade,new Date()]);
  });
  if(!rows.length)return;
  const startRow=sh.getLastRow()+1;
  sh.getRange(startRow,1,rows.length,4).setValues(rows);
  sh.getRange(startRow,1,rows.length,1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(startRow,3,rows.length,1).setNumberFormat('0');
}

function readProduction(ss) {
  ensureClientSheets(ss);
  const sh=ss.getSheetByName(SHEET_PRODUCAO);
  const out=[];
  if(sh.getLastRow()<2) return out;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,4).getValues();
  rows.forEach(r=>{
    if(!r[0]||!r[1]) return;
    out.push({data:dateValue(r[0]),recheio:String(r[1]),quantidade:Number(r[2])||0});
  });
  return out;
}

function readStockAdjustments(ss){
  ensureClientSheets(ss);
  const sh=ss.getSheetByName(SHEET_AJUSTES_ESTOQUE),out=[];
  if(!sh||sh.getLastRow()<2)return out;
  const lastCol=Math.max(6,Math.min(7,sh.getLastColumn()));
  const rows=sh.getRange(2,1,sh.getLastRow()-1,lastCol).getValues();
  rows.forEach(r=>{
    if(!r[1])return;
    const tipo=normalize(r[6]||'');
    const valor=Math.max(0,Number(r[2])||0);
    out.push({
      data:dateValue(r[0]),
      recheio:String(r[1]),
      descarte:tipo==='DESCARTE'?valor:0,
      correcaoLegada:tipo==='DESCARTE'?0:(Number(r[2])||0),
      anterior:Number(r[3])||0,
      novo:Number(r[4])||0,
      observacao:String(r[5]||'')
    });
  });
  return out;
}

function adminEditStock(ss,d){
  ensureClientSheets(ss);
  const recheio=String(d.recheio||'').trim();
  const key=normalize(recheio);
  const canonical=RECHEIOS.find(r=>normalize(r)===key);
  if(!canonical)throw new Error('Recheio inválido.');

  const novo=Math.max(0,Math.floor(Number(d.novo)||0));
  const production=readProduction(ss);
  const orders=readOrders(ss);
  const adjustments=readStockAdjustments(ss);
  const stock=calculateStock(production,orders,adjustments);
  const atual=stock.find(x=>normalize(x.recheio)===key);
  if(!atual)throw new Error('Estoque não encontrado.');

  const estoqueAtual=Math.max(0,Math.floor(Number(atual.disponivel)||0));
  if(novo>estoqueAtual){
    throw new Error('Para aumentar o estoque, registre uma nova produção. O botão Editar estoque registra somente descarte.');
  }

  const descarte=estoqueAtual-novo;
  if(!descarte)return {recheio:canonical,anterior:estoqueAtual,novo:novo,descarte:0};

  const sh=ss.getSheetByName(SHEET_AJUSTES_ESTOQUE);
  sh.appendRow([
    String(d.data||formatToday()).slice(0,10),
    canonical,
    descarte,
    estoqueAtual,
    novo,
    String(d.observacao||'Descarte manual'),
    'DESCARTE'
  ]);
  const row=sh.getLastRow();
  sh.getRange(row,1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(row,3,1,3).setNumberFormat('0');
  return {recheio:canonical,anterior:estoqueAtual,novo:novo,descarte:descarte};
}

function calculateStock(production,orders,adjustments) {
  const prod={},reserved={},sold={},discarded={},legacyCorrection={};
  RECHEIOS.forEach(r=>{prod[r]=0;reserved[r]=0;sold[r]=0;discarded[r]=0;legacyCorrection[r]=0});

  (production||[]).forEach(x=>{
    const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));
    if(k)prod[k]+=Math.max(0,Number(x.quantidade)||0);
  });

  (adjustments||[]).forEach(x=>{
    const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));
    if(!k)return;
    discarded[k]+=Math.max(0,Number(x.descarte)||0);
    legacyCorrection[k]+=Number(x.correcaoLegada)||0;
  });

  (orders||[]).forEach(o=>{
    const status=normalize(o.status);
    const isPending=status==='RESERVADO'||status==='AGUARDANDO'||status==='CONFIRMANDO';
    const isSold=status==='CONFIRMADO'||status==='ENTREGUE';
    (o.itens||[]).forEach(x=>{
      const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));
      if(!k)return;
      const qtd=Math.max(0,Number(x.quantidade)||0);
      if(isPending)reserved[k]+=qtd;
      else if(isSold)sold[k]+=qtd;
    });
  });

  return RECHEIOS.map(r=>({
    recheio:r,
    produzido:prod[r],
    reservado:reserved[r],
    vendido:sold[r],
    descartado:discarded[r],
    disponivel:prod[r]+legacyCorrection[r]-reserved[r]-sold[r]-discarded[r]
  }));
}

function readStock(ss) {
  return calculateStock(readProduction(ss),readOrders(ss),readStockAdjustments(ss));
}