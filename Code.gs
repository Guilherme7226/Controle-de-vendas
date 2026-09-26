const SPREADSHEET_ID = ''; // opcional: deixe vazio se o script estiver vinculado à planilha
const API_KEY = ''; // opcional
const SHEET_VENDAS = 'Vendas';
const SHEET_CUSTOS = 'Custos';

const VENDAS_HEADERS = [
  'Data','Cliente','Contato/Empresa','Quantidade','Valor Unit. (R$)',
  'Valor Total (R$)','Data Pagamento','Pago?','Pagamento Parcial?',
  'Valor Pago (R$)','Saldo Devedor (R$)'
];

function setup() {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) {
    const created = ss.insertSheet(SHEET_VENDAS);
    created.getRange(1,1,1,VENDAS_HEADERS.length).setValues([VENDAS_HEADERS]);
    created.setFrozenRows(1);
  }
  ensureSheet(ss, SHEET_CUSTOS, ['ID','Data','Descrição','Categoria','Valor']);
}

function doGet(e) {
  try {
    if ((e && e.parameter && e.parameter.apiKey && API_KEY && e.parameter.apiKey !== API_KEY)) {
      throw new Error('Chave inválida');
    }
    return json({ok:true, service:'Controle de Vendas', data:readAll()});
  } catch(err) {
    return json({ok:false,error:String(err.message||err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (API_KEY && body.apiKey !== API_KEY) throw new Error('Chave inválida');
    const d = body.data || {};
    const ss = getSS();

    if (body.action === 'venda') {
      appendSale(ss, d);
    } else if (body.action === 'custo') {
      const sh = ss.getSheetByName(SHEET_CUSTOS) || ensureSheet(ss,SHEET_CUSTOS,['ID','Data','Descrição','Categoria','Valor']);
      sh.appendRow([d.id||new Date().getTime(),d.data||'',d.descricao||'',d.categoria||'',Number(d.valor)||0]);
    } else if (body.action === 'pagamento') {
      updatePayment(ss,d);
    } else {
      throw new Error('Ação desconhecida');
    }
    return json({ok:true, data:readAll()});
  } catch(err) {
    return json({ok:false,error:String(err.message||err)});
  }
}

function appendSale(ss,d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');

  const quantidade = Number(d.quantidade)||0;
  const unit = Number(d.valorUnitario)||0;
  const total = quantidade * unit;
  const pago = Math.min(Math.max(Number(d.pago)||0,total), total);
  const saldo = Math.max(0,total-pago);
  const pagoSim = saldo <= 0 && total > 0;
  const parcial = pago > 0 && saldo > 0 ? 'Sim' : 'Não';
  const dataPagamento = pago > 0 ? (d.dataPagamento || d.data || '') : '';

  sh.appendRow([
    d.data || '',
    d.cliente || '',
    d.contatoEmpresa || '',
    quantidade,
    unit,
    total,
    dataPagamento,
    pagoSim,
    parcial,
    pago,
    saldo
  ]);
}

function updatePayment(ss,d) {
  const sh = ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');

  const row = Number(d.row);
  if (!row || row < 2) throw new Error('Linha da venda inválida');

  const total = Number(sh.getRange(row,6).getValue()) || 0;
  const atualPago = Number(sh.getRange(row,10).getValue()) || 0;
  const novoPago = Math.min(Math.max(Number(d.pago)||0,total), total);
  const saldo = Math.max(0,total-novoPago);
  const quitada = saldo <= 0 && total > 0;
  const parcial = novoPago > 0 && saldo > 0 ? 'Sim' : 'Não';

  sh.getRange(row,7,1,5).setValues([[
    novoPago > 0 ? (d.dataPagamento || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')) : '',
    quitada,
    parcial,
    novoPago,
    saldo
  ]]);
}

function readAll() {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_VENDAS);
  const sales = [];

  if (sh && sh.getLastRow() >= 2) {
    const values = sh.getRange(2,1,sh.getLastRow()-1,11).getValues();
    values.forEach(function(r,i) {
      if (!r[0] && !r[1] && !r[3] && !r[5]) return;
      const total = Number(r[5])||0;
      const pago = Number(r[9])||0;
      const deve = Number(r[10]) || Math.max(0,total-pago);
      sales.push({
        row:i+2,
        data:dateValue(r[0]),
        cliente:String(r[1]||''),
        contatoEmpresa:String(r[2]||''),
        quantidade:Number(r[3])||0,
        valorUnitario:Number(r[4])||0,
        total:total,
        dataPagamento:dateValue(r[6]),
        pago:!!r[7],
        parcial:String(r[8]||'Não'),
        valorPago:pago,
        deve:deve,
        status:deve<=0?'Pago':(pago>0?'Parcial':'Pendente')
      });
    });
  }

  const costs = [];
  const cs = ss.getSheetByName(SHEET_CUSTOS);
  if (cs && cs.getLastRow() >= 2) {
    cs.getRange(2,1,cs.getLastRow()-1,5).getValues().forEach(function(r) {
      if (!r[0] && !r[1] && !r[2]) return;
      costs.push({id:String(r[0]||''),data:dateValue(r[1]),descricao:String(r[2]||''),categoria:String(r[3]||''),valor:Number(r[4])||0});
    });
  }
  return {sales:sales,costs:costs};
}

function dateValue(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function getSS(){ return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function ensureSheet(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}return sh;}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
