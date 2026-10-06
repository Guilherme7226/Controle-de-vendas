const fs=require('fs'),vm=require('vm'),assert=require('assert');
const read=n=>fs.readFileSync(n,'utf8');
const slice=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));
const catalog=[
  {id:'bread',produtoId:'bread',nome:'Frango',recheio:'Frango',categoria:'pao',preco:8,disponivel:5},
  {id:'coke',produtoId:'coke',nome:'Coca-Cola 220 ml',recheio:'Coca-Cola 220 ml',categoria:'bebida',preco:4.5,preco_combo:4,precoCombo:4,custo_unitario:2.2,disponivel:0},
  {id:'zero',produtoId:'zero',nome:'Coca-Cola Zero 220 ml',recheio:'Coca-Cola Zero 220 ml',categoria:'bebida',preco:4.5,preco_combo:4,precoCombo:4,custo_unitario:2.2,disponivel:0}
];
const nodes={};const $=id=>nodes[id]??=( {textContent:'',innerHTML:''});
const ctx=vm.createContext({console,stock:catalog,products:catalog,editingOrderId:null,currentPedidos:[],quantities:{},recheios:[],PRECO:8,$,brl:v=>'R$ '+Number(v).toFixed(2),escapeHtml:v=>v});
const client=read('cliente.html');
vm.runInContext(slice(client,'function stockLimit(','function renderOrders('),ctx);
const scenarios=[[[1,1,0],12,0.5],[[0,1,1],9,0],[[1,1,1],16.5,0.5],[[2,1,1],24,1],[[2,0,3],28.5,1],[[1,0,0],8,0]];
for(const [qty,total,discount] of scenarios){
  ctx.items=catalog.map((p,i)=>({recheio:p.recheio,quantidade:qty[i]}));
  const r=vm.runInContext('calculateCart(items)',ctx);
  assert.equal(r.total,total);assert.equal(r.desconto,discount);
}
vm.runInContext('renderStock(stock)',ctx);
assert(nodes.stockGrid.innerHTML.includes('🥤 Bebidas'));
assert(nodes.stockGrid.innerHTML.includes('Com pão: R$ 4.00'));
assert.equal((nodes.stockGrid.innerHTML.match(/disabled/g)||[]).length,6);
ctx.editingOrderId='edit';ctx.currentPedidos=[{id:'edit',itens:[{recheio:'Coca-Cola Zero 220 ml',quantidade:2},{recheio:'Coca-Cola Zero 220 ml',quantidade:1}]}];
assert.equal(vm.runInContext('stockLimit(stock[2])',ctx),3);
const admin=read('sistema.html');
let fields=[];ctx.document={querySelectorAll:()=>fields};
vm.runInContext(slice(admin,'function directSaleItems(','async function saveDirectSale('),ctx);
for(const [qty,total,discount] of scenarios){
  fields=catalog.map((p,i)=>({dataset:{product:p.id},value:qty[i]}));
  vm.runInContext('updateSaleTotal()',ctx);
  assert.equal(nodes.saleTotal.textContent,'Total: R$ '+total.toFixed(2));
  assert.equal(Boolean(nodes.saleDiscount.textContent),discount>0);
}
for(const [name,html] of [['cliente',client],['sistema',admin]]){
  const markup=html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'');
  const ids=[...markup.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length,name+' tem IDs duplicados');
  const js=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
  new vm.Script(js,{filename:name+'.html'});
}
console.log('PASS: totais cliente/ADM, promoção mista, excedentes, bloqueio de estoque zero, edição de linhas a dois preços e sintaxe HTML/JS.');
