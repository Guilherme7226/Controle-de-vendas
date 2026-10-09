-- Teste real transacional: nada permanece após rollback.
begin;
select set_config('request.jwt.claim.sub',(select usuario_id::text from public.perfis where role='admin' limit 1),true);
set local role authenticated;
do $test$
declare
  produto uuid; venda_a uuid; venda_b uuid; cliente_a uuid; cliente_b uuid;
  nome_t text:='Teste avulso '||gen_random_uuid()::text;
  nome_erro text:='Teste estoque insuficiente '||gen_random_uuid()::text;
  stock_before integer; summary record;
begin
  select id into produto from public.v2_produtos where categoria='pao' and ativo order by nome limit 1;
  insert into public.v2_producao(produto_id,quantidade,data,observacao) values(produto,2,current_date,'Teste transacional');
  select disponivel into stock_before from public.v2_estoque_atual where produto_id=produto;
  venda_a:=public.v2_registrar_venda_cardapio(jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',1)),null,nome_t,0,current_date);
  venda_b:=public.v2_registrar_venda_cardapio(jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',1)),null,'  '||upper(nome_t)||'  ',8,current_date);
  select cliente_id into cliente_a from public.v2_vendas where id=venda_a;
  select cliente_id into cliente_b from public.v2_vendas where id=venda_b;
  if cliente_a is null or cliente_a is distinct from cliente_b then raise exception 'Avulso não foi vinculado/reutilizado'; end if;
  if (select count(*) from public.v2_clientes where lower(nome)=lower(nome_t))<>1 then raise exception 'Cadastro duplicado'; end if;
  if exists(select 1 from public.v2_clientes where id=cliente_a and (usuario_id is not null or telefone is not null or email is not null)) then raise exception 'Criou acesso indevidamente'; end if;
  if exists(select 1 from public.v2_vendas v join public.v2_pedidos p on p.id=v.pedido_id where v.id in (venda_a,venda_b) and p.cliente_id is distinct from v.cliente_id) then raise exception 'Pedido/venda não coincidem'; end if;
  select * into summary from public.v2_dashboard_clientes where id=cliente_a;
  if summary.vendas<>2 or summary.paes<>2 or summary.total_comprado<>16 or summary.total_pago<>8 or summary.divida<>8 then raise exception 'Resumo incorreto: %',row_to_json(summary); end if;
  if (select disponivel from public.v2_estoque_atual where produto_id=produto)<>stock_before-2 then raise exception 'Estoque alterado incorretamente'; end if;
  begin
    perform public.v2_registrar_venda_cardapio(jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',100000)),null,nome_erro,0,current_date);
    raise exception 'Deveria rejeitar estoque insuficiente';
  exception when others then
    if sqlerrm<>'Estoque insuficiente' then raise; end if;
  end;
  if exists(select 1 from public.v2_clientes where nome=nome_erro) then raise exception 'Venda inválida criou cliente'; end if;
end;
$test$;
reset role;
select set_config('request.jwt.claim.sub',(select usuario_id::text from public.v2_clientes where usuario_id is not null and not exists(select 1 from public.perfis where perfis.usuario_id=v2_clientes.usuario_id and role='admin') limit 1),true);
set local role authenticated;
do $auth$
begin
  begin
    perform public.v2_cliente_avulso_sem_login('Teste não autorizado');
    raise exception 'Deveria rejeitar cliente comum';
  exception when others then
    if sqlerrm<>'Acesso administrativo necessário' then raise; end if;
  end;
end;
$auth$;
reset role;
select 'PASS: cadastro sem login, reutilização, histórico, valores, estoque e proteção de acesso' as result;
rollback;
