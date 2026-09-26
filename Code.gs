const SPREADSHEET_ID = '1SGbTg4xfsSsXb0SA3Z8v-mj_5xHV2jexhuZ6vuc9eas';
const API_KEY = '';
const SHEET_VENDAS = 'Vendas';
const SHEET_CUSTOS = 'Custos';
const SHEET_RESUMO = 'Resumo';
const SHEET_RESUMO_PESSOA = 'Resumo por pessoa';

const VENDAS_HEADERS = ['Data','Cliente','Contato/Empresa','Quantidade','Valor Unit. (R$)','Valor Total (R$)','Data Pagamento','Pago?','Pagamento Parcial?','Valor Pago (R$)','Saldo Devedor (R$)'];

function doGet(e) {
  try {
    if (e?.parameter?.apiKey && API_KEY && e.parameter.apiKey !== API_KEY) throw new Error('Chave inválida');
    return json({ok:true, service:'Controle de Vendas', data:readAll()});
  } catch (err) { return json({ok:false,error:String(err.message||err)}); }
}

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    if (API_KEY && body.apiKey !== API_KEY) throw new Error('Chave inválida');
    const ss = getSS(), d = body.data || {};
    if (body.action === 'venda') appendSale(ss,d);
    else if (body.action === 'custo') appendCost(ss,d);
    else if (body.action === 'pagamento') updatePayment(ss,d);
    else throw new Error('Ação desconhecida');
    SpreadsheetApp.flush();
    return json({ok:true,data:readAll()});
  } catch (err) { return json({ok:false,error:String(err.message||err)}); }
}

function setup() {
  const ss=getSS(), sh=ss.getSheetByName(SHEET_VENDAS);
  if (!sh) {
    const created=ss.insertSheet(SHEET_VENDAS);
    created.getRange(1,1,1,VENDAS_HEADERS.length).setValues([VENDAS_HEADERS]);
    created.setFrozenRows(1);
  }
}

function appendSale(ss,d) {
  const sh=ss.getSheetByName(SHEET_VENDAS);
  if (!sh) throw new Error('Aba Vendas não encontrada');
  const quantidade=Math.max(0,Number(d.quantidade)||0);
  const unit=Math.max(0,Number(d.valorUnitario)||0);
  const total=quantidade*unit;
  const pago=Math.min(Math.max(Number(d.pago)||0,0),total);
  const saldo=Math.max(0,total-pago);
  sh.appendRow([d.data||'',d.cliente||'',d.contatoEmpresa||'',quantidade,unit,total,pago>0?(d.dataPagamento||d.data||''):'',saldo<=0&&total>0,pago>0&&saldo>0?'Sim':'Não',pago,saldo]);
}

function appendCost(ss,d) {
  const sh=ss.getSheetByName(SHEET_CUSTOS);
  if (!sh) throw new Error('Aba Custos não encontrada');
  const row=[d.data||'',d.descricao||'',Number(d.valor)||0];
  const last=sh.getLastRow();
  let totalRow=0;
  if(last){
    const values=sh.getRange(1,1,last,3).getDisplayValues();
    for(let i=0;i<values.length;i++){
      const a=String(values[i][0]||'').trim().toUpperCase(), b=String(values[i][1]||'').trim().toUpperCase();
      if(a==='TOTAL'||a==='TOTAL GERAL'||b==='TOTAL'||b==='TOTAL GERAL'){totalRow=i+1;break;}
    }
  }
  if(totalRow){sh.insertRowsBefore(totalRow,1);sh.getRange(totalRow,1,1,3).setValues([row]);}
  else sh.appendRow(row);
}

function updatePayment(ss,d) {
  const sh=ss.getSheetByName(SHEET_VENDAS), row=Number(d.row);
  if(!sh) throw new Error('Aba Vendas não encontrada');
  if(!row||row<2) throw new Error('Linha da venda inválida');
  const total=Number(sh.getRange(row,6).getValue())||0;
  const pago=Math.min(Math.max(Number(d.pago)||0,0),total), saldo=Math.max(0,total-pago);
  sh.getRange(row,7,1,5).setValues([[pago>0?(d.dataPagamento||Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd')):'',saldo<=0&&total>0,pago>0&&saldo>0?'Sim':'Não',pago,saldo]]);
}

function readAll() {
  const ss=getSS(), sales=[], sh=ss.getSheetByName(SHEET_VENDAS);
  if(sh&&sh.getLastRow()>=2){
    sh.getRange(2,1,sh.getLastRow()-1,11).getValues().forEach((r,i)=>{
      if(!r[0]&&!r[1]&&!r[3]&&!r[5])return;
      const total=Number(r[5])||0,pago=Number(r[9])||0,saldo=Number(r[10])||Math.max(0,total-pago);
      sales.push({row:i+2,data:dateValue(r[0]),cliente:String(r[1]||''),contatoEmpresa:String(r[2]||''),quantidade:Number(r[3])||0,valorUnitario:Number(r[4])||0,total,dataPagamento:dateValue(r[6]),pago:!!r[7],parcial:String(r[8]||'Não'),valorPago:pago,deve:saldo,status:saldo<=0?'Pago':pago>0?'Parcial':'Pendente'});
    });
  }
  const costs=[], cs=ss.getSheetByName(SHEET_CUSTOS);
  if(cs&&cs.getLastRow()>=1){
    cs.getRange(1,1,cs.getLastRow(),3).getValues().forEach((r,i)=>{
      const a=String(r[0]||'').trim().toUpperCase(),b=String(r[1]||'').trim().toUpperCase();
      if(a==='DATA'||b==='DESCRIÇÃO'||a==='TOTAL'||a==='TOTAL GERAL'||b==='TOTAL'||b==='TOTAL GERAL')return;
      if(!r[0]&&!r[1]&&!r[2])return;
      costs.push({row:i+1,data:dateValue(r[0]),descricao:String(r[1]||''),valor:Number(r[2])||0});
    });
  }
  return {sales,costs,summary:readSummary(ss),clientSummary:readClientSummary(ss)};
}

function readSummary(ss){
  const out={totalVendido:0,totalRecebido:0,totalAReceber:0,qtdPaes:0,qtdVendas:0,ticketMedio:0,custoTotal:0,saldoDisponivel:0,lucro:0};
  const sh=ss.getSheetByName(SHEET_RESUMO);
  if(!sh)return out;
  sh.getRange(1,1,Math.min(sh.getLastRow(),50),Math.min(sh.getLastColumn(),4)).getDisplayValues().forEach(r=>{
    const label=normalize(r[0]), value=parseMoney(r[1]);
    if(label.includes('TOTAL VENDIDO'))out.totalVendido=value;
    else if(label.includes('TOTAL RECEBIDO'))out.totalRecebido=value;
    else if(label.includes('TOTAL A RECEBER'))out.totalAReceber=value;
    else if(label.includes('QUANTIDADE DE PAES VENDIDOS'))out.qtdPaes=parseNumber(r[1]);
    else if(label.includes('QUANTIDADE DE VENDAS'))out.qtdVendas=parseNumber(r[1]);
    else if(label.includes('TICKET MEDIO'))out.ticketMedio=value;
    else if(label.includes('CUSTO TOTAL'))out.custoTotal=value;
    else if(label.includes('SALDO DISPONIVEL'))out.saldoDisponivel=value;
    else if(label==='LUCRO'||label.startsWith('LUCRO '))out.lucro=value;
  });
  return out;
}

function readClientSummary(ss){
  const sh=ss.getSheetByName(SHEET_RESUMO_PESSOA), result=[];
  if(!sh)return result;
  const rows=sh.getRange(1,1,Math.min(sh.getLastRow(),500),Math.min(sh.getLastColumn(),6)).getDisplayValues();
  let header=-1;
  for(let i=0;i<Math.min(rows.length,20);i++) if(normalize(rows[i][0])==='CLIENTE'&&normalize(rows[i][1]).includes('QTD. PAES')){header=i;break;}
  if(header<0)return result;
  for(let i=header+1;i<rows.length;i++){
    const r=rows[i],cliente=String(r[0]||'').trim();
    if(!cliente)continue;
    if(['TOTAL GERAL','TOTAL'].includes(normalize(cliente)))break;
    result.push({cliente,qtdPaes:parseNumber(r[1]),qtdVendas:parseNumber(r[2]),totalVendido:parseMoney(r[3]),totalPago:parseMoney(r[4]),saldoDevedor:parseMoney(r[5])});
  }
  return result;
}

function normalize(v){return String(v||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();}
function parseNumber(v){if(typeof v==='number')return v;const s=String(v||'').replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');const n=Number(s);return isNaN(n)?0:n;}
function parseMoney(v){return parseNumber(v);}
function dateValue(v){if(!v)return '';if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v))return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');return String(v);}
function getSS(){return SpreadsheetApp.openById(SPREADSHEET_ID);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
