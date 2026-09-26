const SPREADSHEET_ID = ''; // opcional: deixe vazio se o script estiver vinculado à planilha
const API_KEY = ''; // opcional: coloque uma chave e repita a mesma no index.html
const SHEET_VENDAS = 'Vendas';
const SHEET_CUSTOS = 'Custos';

function setup() {
  const ss = getSS();
  ensureSheet(ss, SHEET_VENDAS, ['ID','Data','Cliente','Quantidade','Valor Unitário','Total','Status','Pago','Deve','Vencimento','Observação']);
  ensureSheet(ss, SHEET_CUSTOS, ['ID','Data','Descrição','Categoria','Valor']);
}

function doGet() { return json({ok:true,service:'Controle de Vendas'}); }

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (API_KEY && body.apiKey !== API_KEY) throw new Error('Chave inválida');
    const d = body.data || {};
    const ss = getSS();
    if (body.action === 'venda') {
      const sh = ss.getSheetByName(SHEET_VENDAS) || ensureSheet(ss,SHEET_VENDAS,['ID','Data','Cliente','Quantidade','Valor Unitário','Total','Status','Pago','Deve','Vencimento','Observação']);
      sh.appendRow([d.id||new Date().getTime(),d.data||'',d.cliente||'',Number(d.quantidade)||0,Number(d.valorUnitario)||0,Number(d.total)||0,d.status||'Pendente',Number(d.pago)||0,Number(d.deve)||0,d.vencimento||'',d.obs||'']);
    } else if (body.action === 'custo') {
      const sh = ss.getSheetByName(SHEET_CUSTOS) || ensureSheet(ss,SHEET_CUSTOS,['ID','Data','Descrição','Categoria','Valor']);
      sh.appendRow([d.id||new Date().getTime(),d.data||'',d.descricao||'',d.categoria||'',Number(d.valor)||0]);
    } else if (body.action === 'pagamento') {
      updatePayment(ss,d);
    } else throw new Error('Ação desconhecida');
    return json({ok:true});
  } catch(err) { return json({ok:false,error:String(err.message||err)}); }
}

function updatePayment(ss,d) {
  const sh=ss.getSheetByName(SHEET_VENDAS);
  if(!sh) throw new Error('Aba Vendas não encontrada');
  const values=sh.getDataRange().getValues();
  for(let r=1;r<values.length;r++){
    if(String(values[r][0])===String(d.id)){
      sh.getRange(r+1,7,1,3).setValues([[d.status||'Parcial',Number(d.pago)||0,Number(d.deve)||0]]);
      return;
    }
  }
  throw new Error('Venda não encontrada');
}

function getSS(){ return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function ensureSheet(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}return sh;}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
