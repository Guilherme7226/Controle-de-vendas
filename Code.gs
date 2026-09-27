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
const APP_VERSION = '2026-09-27-estoque-editavel-v1';
const SUPPORTED_ACTIONS = ['venda','custo','pagamento','editar_venda','excluir_venda','admin_login','admin_validar','cliente_cadastro','cliente_login','cliente_pedido','cliente_dados','cliente_confirmar_pedido','cliente_editar_pedido','cliente_excluir_pedido','cliente_alterar_senha','admin_listar_clientes','admin_bootstrap','admin_migrar_vendas_pedidos','admin_criar_cliente','admin_editar_cliente','admin_excluir_cliente','admin_editar_pedido','admin_excluir_pedido','admin_confirmar_pedido','admin_confirmar_pedidos_lote','admin_pagar_cliente','admin_editar_estoque','producao'];

const VENDAS_HEADERS = ['Data','Cliente','Contato/Empresa','Quantidade','Valor Unit. (R$)','Valor Total (R$)','Data Pagamento','Pago?','Pagamento Parcial?','Valor Pago (R$)','Saldo Devedor (R$)'];

function doGet(e) {
  try { if (API_KEY && e?.parameter?.apiKey !== API_KEY) throw new Error('Chave inválida'); return json({ok:true, service:'Controle de Vendas', version:APP_VERSION, data:readAll()}); }
  catch (err) { return json({ok:false, error:String(err.message || err)}); }
}

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    if (API_KEY && body.apiKey !== API_KEY) throw new Error('Chave inválida');
    const ss = getSS(); const d = body.data || body || {};
    const clientActions = ['cliente_cadastro','cliente_login','cliente_pedido','cliente_dados','cliente_confirmar_pedido','cliente_editar_pedido','cliente_excluir_pedido','cliente_alterar_senha','admin_login','admin_validar'];
    if (!clientActions.includes(body.action)) adminValidate({token: body.adminToken});
    if (!SUPPORTED_ACTIONS.includes(body.action)) throw new Error('Ação desconhecida: '+String(body.action||'')+'. Esta implantação precisa da versão '+APP_VERSION+'.');
    switch (body.action) {
      case 'venda': appendSale(ss, d); break;
      case 'custo': appendCost(ss, d); break;
      case 'pagamento': updatePayment(ss, d); break;
      case 'editar_venda': updateSale(ss, d); break;
      case 'excluir_venda': deleteSale(ss, d); break;
      case 'admin_login': return json({ok:true,data:adminLogin(d)});
      case 'admin_validar': return json({ok:true,data:adminValidate(d)});
      case 'cliente_cadastro': return json({ok:true,data:registerClient(ss,d)});
      case 'cliente_login': return json({ok:true,data:loginClient(ss,d)});
      case 'cliente_pedido': return json({ok:true,data:createClientOrder(ss,d)});
      case 'cliente_dados': return json({ok:true,data:getClientData(ss,d)});
      case 'cliente_confirmar_pedido': return json({ok:true,data:confirmClientOrder(ss,d)});
      case 'cliente_editar_pedido': return json({ok:true,data:editClientOrder(ss,d)});
      case 'cliente_excluir_pedido': return json({ok:true,data:deleteClientOrder(ss,d)});
      case 'cliente_alterar_senha': return json({ok:true,data:changeClientPassword(ss,d)});
      case 'admin_listar_clientes': return json({ok:true,data:adminListClients(ss)});
      case 'admin_bootstrap': { const painel=readAll(); painel.clients=adminListClients(ss,painel.orders,painel.sales); return json({ok:true,data:painel}); }
      case 'admin_migrar_vendas_pedidos': return json({ok:true,data:migrarVendasParaPedidos(ss)});
      case 'admin_criar_cliente': return json({ok:true,data:adminCreateClient(ss,d)});
      case 'admin_editar_cliente': return json({ok:true,data:adminEditClient(ss,d)});
      case 'admin_excluir_cliente': return json({ok:true,data:adminDeleteClient(ss,d)});
      case 'admin_editar_pedido': return json({ok:true,data:adminEditOrder(ss,d)});
      case 'admin_excluir_pedido': return json({ok:true,data:adminDeleteOrder(ss,d)});
      case 'admin_confirmar_pedido': return json({ok:true,data:adminConfirmOrder(ss,d)});
      case 'admin_confirmar_pedidos_lote': return json({ok:true,data:adminConfirmOrdersBatch(ss,d)});
      case 'admin_pagar_cliente': return json({ok:true,data:adminRegistrarPagamentoCliente(ss,d)});
      case 'admin_editar_estoque': return json({ok:true,data:adminEditStock(ss,d)});
      case 'producao': addProduction(ss,d); break;
      default: throw new Error('Ação desconhecida');
    }
    return json({ok:true});
  } catch (err) { console.error(err); return json({ok:false, error:String(err.message || err)}); }
}

function getAdminPassword() { const value=PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD'); if(!value) throw new Error('Senha administrativa não configurada no servidor.'); return String(value); }
function getAdminSessions() { const raw=PropertiesService.getScriptProperties().getProperty(ADMIN_SESSION_PROPERTY); if(!raw)return {}; try{return JSON.parse(raw)||{}}catch(_){return {}} }
function saveAdminSessions(sessions) { PropertiesService.getScriptProperties().setProperty(ADMIN_SESSION_PROPERTY,JSON.stringify(sessions)); }
function adminLogin(d) { const senha=String(d.senha||''); if(!senha||senha!==getAdminPassword())throw new Error('Senha incorreta.'); const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''); const sessions=getAdminSessions(); sessions[token]=Date.now()+8*60*60*1000; saveAdminSessions(sessions); return {token:token}; }
function adminValidate(d) { const token=String(d.token||''); const sessions=getAdminSessions(); const expires=Number(sessions[token]||0); if(!token||!expires||expires<Date.now()){if(token)delete sessions[token];saveAdminSessions(sessions);throw new Error('Sessão administrativa inválida ou expirada.');} return {valid:true}; }
function setup() { const ss=getSS(); let sh=ss.getSheetByName(SHEET_VENDAS); if(!sh){sh=ss.insertSheet(SHEET_VENDAS);sh.getRange(1,1,1,VENDAS_HEADERS.length).setValues([VENDAS_HEADERS]);sh.setFrozenRows(1);} }

function ensureClientSheets(ss) {
  let sh=ss.getSheetByName(SHEET_CLIENTES); if(!sh){sh=ss.insertSheet(SHEET_CLIENTES);sh.getRange(1,1,1,9).setValues([['ID','Nome','Telefone','Email','Senha Hash','Token','Criado em','Ativo','Senha Temporária']]);sh.setFrozenRows(1)} else if(sh.getLastColumn()<9)sh.getRange(1,9).setValue('Senha Temporária');
  let ph=ss.getSheetByName(SHEET_PEDIDOS); if(!ph){ph=ss.insertSheet(SHEET_PEDIDOS);ph.getRange(1,1,1,14).setValues([['ID Pedido','Cliente ID','Cliente','Data','Itens','Quantidade Total','Valor Total','Status','Criado em','Valor Pago','Data Pagamento','Saldo','Origem','Referência']]);ph.setFrozenRows(1)} else if(ph.getLastColumn()<14)ph.getRange(1,10,1,5).setValues([['Valor Pago','Data Pagamento','Saldo','Origem','Referência']]);
  let pr=ss.getSheetByName(SHEET_PRODUCAO); if(!pr){pr=ss.insertSheet(SHEET_PRODUCAO);pr.getRange(1,1,1,4).setValues([['Data','Recheio','Quantidade','Criado em']]);pr.setFrozenRows(1)}
  let aj=ss.getSheetByName(SHEET_AJUSTES_ESTOQUE); if(!aj){aj=ss.insertSheet(SHEET_AJUSTES_ESTOQUE);aj.getRange(1,1,1,5).setValues([['Data','Recheio','Ajuste','Estoque anterior','Novo estoque','Observação']);aj.setFrozenRows(1)}
}

function readAll() {
  const ss=getSS(), sales=[], sh=ss.getSheetByName(SHEET_VENDAS);
  if(sh&&sh.getLastRow()>=2){const rows=sh.getRange(2,1,sh.getLastRow()-1,Math.min(12,sh.getMaxColumns())).getValues();for(let i=0;i<rows.length;i++){const r=rows[i],actualRow=i+2;if(isTotalValues(r))break;if(!r[0]&&!r[1]&&!r[3]&&!r[5])continue;const total=Number(r[5])||0,pago=parseMoney(r[9])||0,saldo=Number(r[10])||Math.max(0,total-pago);sales.push({row:actualRow,data:dateValue(r[0]),cliente:String(r[1]||''),contatoEmpresa:String(r[2]||''),quantidade:Number(r[3])||0,valorUnitario:Number(r[4])||0,total:total,dataPagamento:dateValue(r[6]),pago:!!r[7],parcial:String(r[8]||'Não'),valorPago:pago,deve:saldo,status:saldo<=0?'Pago':pago>0?'Parcial':'Pendente',pedidoId:String(r[11]||'')})}}
  const costs=[],cs=ss.getSheetByName(SHEET_CUSTOS); if(cs&&cs.getLastRow()>=1){const rows=cs.getRange(1,1,cs.getLastRow(),3).getValues();for(let i=0;i<rows.length;i++){const r=rows[i],a=normalize(r[0]),b=normalize(r[1]);if(a==='DATA'||b==='DESCRICAO'||a==='TOTAL'||a==='TOTAL GERAL'||b==='TOTAL'||b==='TOTAL GERAL')continue;if(!r[0]&&!r[1]&&!r[2])continue;costs.push({row:i+1,data:dateValue(r[0]),descricao:String(r[1]||''),valor:Number(r[2])||0})}}
  const production=readProduction(ss), orders=readOrders(ss), adjustments=readStockAdjustments(ss);
  return {sales:sales,costs:costs,summary:readSummary(ss),clientSummary:readClientSummary(ss),production:production,stock:calculateStock(production,orders,adjustments),orders:orders};
}

function readStockAdjustments(ss){
  ensureClientSheets(ss); const sh=ss.getSheetByName(SHEET_AJUSTES_ESTOQUE),out=[]; if(!sh||sh.getLastRow()<2)return out;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,5).getValues(); rows.forEach(r=>{if(!r[1])return;out.push({data:dateValue(r[0]),recheio:String(r[1]),ajuste:Number(r[2])||0,anterior:Number(r[3])||0,novo:Number(r[4])||0,observacao:String(r[5]||'')})}); return out;
}

function adminEditStock(ss,d){
  ensureClientSheets(ss); const recheio=String(d.recheio||'').trim(); const key=normalize(recheio); const canonical=RECHEIOS.find(r=>normalize(r)===key); if(!canonical)throw new Error('Recheio inválido.');
  const novo=Math.max(0,Math.floor(Number(d.novo)||0)); const stock=calculateStock(readProduction(ss),readOrders(ss),readStockAdjustments(ss)); const atual=stock.find(x=>normalize(x.recheio)===key); if(!atual)throw new Error('Estoque não encontrado.');
  const ajuste=novo-Number(atual.disponivel||0); if(!ajuste)return {recheio:canonical,anterior:novo,novo:novo,ajuste:0};
  const sh=ss.getSheetByName(SHEET_AJUSTES_ESTOQUE); sh.appendRow([String(d.data||formatToday()).slice(0,10),canonical,ajuste,Number(atual.disponivel)||0,novo,String(d.observacao||'Ajuste manual')]); sh.getRange(sh.getLastRow(),1).setNumberFormat('dd/MM/yyyy'); sh.getRange(sh.getLastRow(),3,1,3).setNumberFormat('0');
  return {recheio:canonical,anterior:atual.disponivel,novo:novo,ajuste:ajuste};
}

function calculateStock(production,orders,adjustments) {
  const prod={},reserved={},sold={},adjusted={}; RECHEIOS.forEach(r=>{prod[r]=0;reserved[r]=0;sold[r]=0;adjusted[r]=0});
  (production||[]).forEach(x=>{const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));if(k)prod[k]+=Number(x.quantidade)||0});
  (adjustments||[]).forEach(x=>{const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));if(k)adjusted[k]+=Number(x.ajuste)||0});
  (orders||[]).forEach(o=>{const status=normalize(o.status),isPending=status==='RESERVADO'||status==='AGUARDANDO'||status==='CONFIRMANDO',isSold=status==='CONFIRMADO'||status==='ENTREGUE';(o.itens||[]).forEach(x=>{const k=RECHEIOS.find(r=>normalize(r)===normalize(x.recheio));if(!k)return;const qtd=Math.max(0,Number(x.quantidade)||0);if(isPending)reserved[k]+=qtd;else if(isSold)sold[k]+=qtd})});
  return RECHEIOS.map(r=>({recheio:r,produzido:prod[r],ajuste:adjusted[r],estoqueBase:prod[r]+adjusted[r],reservado:reserved[r],vendido:sold[r],disponivel:Math.max(0,prod[r]+adjusted[r]-reserved[r]-sold[r])}));
}
function readStock(ss){return calculateStock(readProduction(ss),readOrders(ss),readStockAdjustments(ss));}

function addProduction(ss,d){ensureClientSheets(ss);const data=String(d.data||formatToday()).slice(0,10),itens=Array.isArray(d.itens)?d.itens:[],sh=ss.getSheetByName(SHEET_PRODUCAO);itens.forEach(item=>{const recheio=String(item.recheio||'').trim(),quantidade=Math.max(0,Math.floor(Number(item.quantidade)||0));if(!quantidade)return;if(!RECHEIOS.some(r=>normalize(r)===normalize(recheio)))throw new Error('Recheio inválido: '+recheio);sh.appendRow([data,RECHEIOS.find(r=>normalize(r)===normalize(recheio)),quantidade,new Date()]);aplicarFormatoProducao(sh,sh.getLastRow())})}
function readProduction(ss){ensureClientSheets(ss);const sh=ss.getSheetByName(SHEET_PRODUCAO),out=[];if(sh.getLastRow()<2)return out;const rows=sh.getRange(2,1,sh.getLastRow()-1,4).getValues();rows.forEach(r=>{if(!r[0]||!r[1])return;out.push({data:dateValue(r[0]),recheio:String(r[1]),quantidade:Number(r[2])||0})});return out}
function aplicarFormatoProducao(sh,rowNumber){if(!sh||!rowNumber||rowNumber<1)return;sh.getRange(rowNumber,1).setNumberFormat('dd/MM/yyyy');sh.getRange(rowNumber,3).setNumberFormat('0')}

function normalize(v){return String(v||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function parseNumber(v){if(typeof v==='number')return v;const s=String(v||'').replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');const n=Number(s);return isNaN(n)?0:n}
function parseMoney(v){return parseNumber(v)}
function dateValue(v){if(!v)return '';if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime()))return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');return String(v).trim()}
function formatToday(){return Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd')}
function getSS(){return SpreadsheetApp.openById(SPREADSHEET_ID)}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function isTotalValues(r){const a=normalize(r[0]),b=normalize(r[1]);return a==='TOTAL'||a==='TOTAL GERAL'||b==='TOTAL'||b==='TOTAL GERAL'}
