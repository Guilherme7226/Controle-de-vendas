const SPREADSHEET_ID = '1SGbTg4xfsSsXb0SA3Z8v-mj_5xHV2jexhuZ6vuc9eas';
const API_KEY = '';

const SHEET_VENDAS = 'Vendas';
const SHEET_CUSTOS = 'Custos';
const SHEET_RESUMO = 'Resumo';
const SHEET_RESUMO_PESSOA = 'Resumo por pessoa';
const SHEET_CLIENTES = 'Clientes';
const SHEET_PEDIDOS = 'Pedidos';
const SHEET_PRODUCAO = 'Produção';
const RECHEIOS = ['Queijo','Frango','Carne','Calabresa'];
const PRECO_PAODEFINIDO = 8;

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
    return json({ok:true, service:'Controle de Vendas', data:readAll()});
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

    switch (body.action) {
      case 'venda':
        appendSale(ss, d);
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
      case 'cliente_cadastro':
        return json({ok:true,data:registerClient(ss,d)});
      case 'cliente_login':
        return json({ok:true,data:loginClient(ss,d)});
      case 'cliente_pedido':
        return json({ok:true,data:createClientOrder(ss,d)});
      case 'cliente_dados':
        return json({ok:true,data:getClientData(ss,d)});
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
function appendSale(ss, d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');

  const quantidade = Math.max(0, Number(d.quantidade) || 0);
  const unit = Math.max(0, Number(d.valorUnitario) || 0);
  const total = quantidade * unit;

  const pago = Math.min(
    Math.max(Number(d.pago) || 0, 0),
    total
  );

  const saldo = Math.max(0, total - pago);

  const row = [
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
  ];

  /*
   * A venda nova entra logo abaixo da ÚLTIMA VENDA REAL.
   * Não usamos a linha TOTAL GERAL como ponto de inserção,
   * porque podem existir linhas vazias entre a última venda
   * e o TOTAL.
   */
  /*
   * As vendas ocupam um bloco contínuo a partir da linha 4.
   * As linhas seguintes ao último registro podem conter fórmulas,
   * mas não são vendas. Portanto, paramos na PRIMEIRA linha
   * sem Data e sem Cliente.
   *
   * Exemplo:
   * linha 69 = última venda real
   * linha 70 = primeira linha livre
   * nova venda -> linha 70
   */
  let novaLinha = 4;

  for (let rowNumber = 4; rowNumber <= sh.getLastRow(); rowNumber++) {
    if (isTotalRow(sh, rowNumber)) {
      novaLinha = rowNumber;
      break;
    }

    const values = sh.getRange(rowNumber, 1, 1, 2).getDisplayValues()[0];
    const data = String(values[0] || '').trim();
    const cliente = String(values[1] || '').trim();

    if (!data && !cliente) {
      novaLinha = rowNumber;
      break;
    }

    novaLinha = rowNumber + 1;
  }

  /*
   * Insere uma linha exatamente após a última venda.
   * Isso faz a próxima venda ficar, por exemplo, na linha 70,
   * em vez de ser enviada para a linha 151.
   */
  sh.insertRowsBefore(novaLinha, 1);

  sh.getRange(novaLinha, 1, 1, 11).setValues([row]);

  /*
   * A linha 4 é o modelo visual.
   * Copiamos SOMENTE a formatação.
   */
  if (sh.getLastRow() >= 4 && novaLinha !== 4) {
    sh.getRange(4, 1, 1, 11).copyTo(
      sh.getRange(novaLinha, 1, 1, 11),
      SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
      false
    );
  }

  aplicarFormatoVenda(sh, novaLinha);
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
    Number(d.valor) || 0
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
  sh.getRange(targetRow, 1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(targetRow, 3).setNumberFormat('R$ #,##0.00');
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
  const pago = Math.min(Math.max(Number(d.pago) || 0, 0), total);
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
    Math.max(Number(d.pago) || 0, 0),
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

  sh.deleteRow(rowNumber);

  SpreadsheetApp.flush();

  return 'Venda de ' + cliente + ' excluída com sucesso.';
}

/*
 * Lê SOMENTE as vendas que estão acima do TOTAL.
 * Assim nenhuma fórmula/linha abaixo do TOTAL vira venda.
 */
function readAll() {
  const ss = getSS();
  const sales = [];
  const sh = ss.getSheetByName(SHEET_VENDAS);

  if (sh && sh.getLastRow() >= 2) {
    const lastRow = sh.getLastRow();
    const rows = sh.getRange(2,1,lastRow - 1,11).getValues();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const actualRow = i + 2;

      // TOTAL GERAL marca o fim das vendas.
      if (isTotalValues(r)) {
        break;
      }

      // Ignora linhas completamente vazias.
      if (!r[0] && !r[1] && !r[3] && !r[5]) {
        continue;
      }

      const total = Number(r[5]) || 0;
      const pago = Number(r[9]) || 0;
      const saldo = Number(r[10]) || Math.max(0, total - pago);

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
        status: saldo <= 0 ? 'Pago' : pago > 0 ? 'Parcial' : 'Pendente'
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
        b === 'TOTAL' ||
        b === 'TOTAL GERAL'
      ) {
        continue;
      }

      if (!r[0] && !r[1] && !r[2]) {
        continue;
      }

      costs.push({
        row: i + 1,
        data: dateValue(r[0]),
        descricao: String(r[1] || ''),
        valor: Number(r[2]) || 0
      });
    }
  }

  return {
    sales: sales,
    costs: costs,
    summary: readSummary(ss),
    clientSummary: readClientSummary(ss),
    production: readProduction(ss),
    stock: readStock(ss),
    orders: readOrders(ss)
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
      if (value === 'TOTAL' || value === 'TOTAL GERAL') {
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
    b === 'TOTAL' ||
    b === 'TOTAL GERAL'
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
    sh.getRange(1,1,1,8).setValues([[
      'ID','Nome','Telefone','Email','Senha Hash','Token','Criado em','Ativo'
    ]]);
    sh.setFrozenRows(1);
  }

  let ph = ss.getSheetByName(SHEET_PEDIDOS);
  if (!ph) {
    ph = ss.insertSheet(SHEET_PEDIDOS);
    ph.getRange(1,1,1,9).setValues([[
      'ID Pedido','Cliente ID','Cliente','Data','Itens','Quantidade Total','Valor Total','Status','Criado em'
    ]]);
    ph.setFrozenRows(1);
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
  if (!email) throw new Error('Informe seu e-mail.');
  if (senha.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');

  const sh = ss.getSheetByName(SHEET_CLIENTES);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,8).getValues() : [];
  if (rows.some(r => String(r[3] || '').trim().toLowerCase() === email)) {
    throw new Error('Este e-mail já está cadastrado.');
  }

  const id = newId('CLI');
  const token = newToken();
  sh.appendRow([id,nome,telefone,email,hashPassword(senha),token,new Date(),true]);

  return {token:token, cliente:{id:id,nome:nome,telefone:telefone,email:email}};
}

function loginClient(ss, d) {
  ensureClientSheets(ss);
  const login = String(d.login || '').trim().toLowerCase();
  const senha = String(d.senha || '');
  if (!login || !senha) throw new Error('Informe login e senha.');

  const sh = ss.getSheetByName(SHEET_CLIENTES);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,8).getValues() : [];

  for (let i=0;i<rows.length;i++) {
    const r=rows[i];
    const email=String(r[3]||'').trim().toLowerCase();
    const telefone=String(r[2]||'').replace(/\D/g,'');
    const ativo=r[7] !== false;
    if (ativo && (login===email || login.replace(/\D/g,'')===telefone) && hashPassword(senha)===String(r[4]||'')) {
      const token=newToken();
      sh.getRange(i+2,6).setValue(token);
      return {token:token,cliente:{id:String(r[0]),nome:String(r[1]),telefone:String(r[2]),email:String(r[3])}};
    }
  }
  throw new Error('Login ou senha inválidos.');
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
  ph.appendRow([id,client.id,client.nome,data,JSON.stringify(clean),totalQtd,total,'Reservado',new Date()]);
  return {id:id,data:data,cliente:client.nome,itens:clean,quantidadeTotal:totalQtd,total:total,status:'Reservado'};
}

function getClientData(ss,d) {
  const client=findClientByToken(ss,d.token);
  const pedidos=readOrders(ss).filter(x=>x.clienteId===client.id);
  const totalComprado=pedidos.reduce((a,x)=>a+Number(x.total||0),0);
  return {cliente:{id:client.id,nome:client.nome,telefone:client.telefone,email:client.email},pedidos:pedidos,totalComprado:totalComprado};
}

function readOrders(ss) {
  ensureClientSheets(ss);
  const sh=ss.getSheetByName(SHEET_PEDIDOS);
  const out=[];
  if(sh.getLastRow()<2) return out;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,9).getValues();
  rows.forEach(r=>{
    if(!r[0]) return;
    let itens=[];
    try{itens=JSON.parse(String(r[4]||'[]'))}catch(_){}
    out.push({
      id:String(r[0]),
      clienteId:String(r[1]||''),
      cliente:String(r[2]||''),
      data:dateValue(r[3]),
      itens:itens,
      quantidadeTotal:Number(r[5])||0,
      total:Number(r[6])||0,
      status:String(r[7]||'Reservado'),
      criadoEm:r[8] instanceof Date?Utilities.formatDate(r[8],Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss'):String(r[8]||'')
    });
  });
  return out;
}

function addProduction(ss,d) {
  ensureClientSheets(ss);
  const data=String(d.data||formatToday()).slice(0,10);
  const itens=Array.isArray(d.itens)?d.itens:[];
  const sh=ss.getSheetByName(SHEET_PRODUCAO);
  itens.forEach(item=>{
    const recheio=String(item.recheio||'').trim();
    const quantidade=Math.max(0,Math.floor(Number(item.quantidade)||0));
    if(!quantidade) return;
    if(!RECHEIOS.some(r=>normalize(r)===normalize(recheio))) throw new Error('Recheio inválido: '+recheio);
    sh.appendRow([data,RECHEIOS.find(r=>normalize(r)===normalize(recheio)),quantidade,new Date()]);
  });
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

function readStock(ss) {
  const production=readProduction(ss);
  const orders=readOrders(ss);
  const prod={}; const reserved={};
  RECHEIOS.forEach(r=>{prod[r]=0;reserved[r]=0});
  production.forEach(x=>{const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));if(k)prod[k]+=Number(x.quantidade)||0});
  orders.forEach(o=>o.itens.forEach(x=>{const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));if(k) && ['Reservado','Entregue'].includes(o.status))reserved[k]+=Number(x.quantidade)||0}));
  return RECHEIOS.map(r=>({recheio:r,produzido:prod[r],reservado:reserved[r],disponivel:Math.max(0,prod[r]-reserved[r])}));
}
