-- Testes transacionais: dados simulados são removidos pelo ROLLBACK final.
begin;
do $$
declare bread uuid; coke uuid; zero_coke uuid; admin_id uuid; customer_id uuid; customer_user uuid;
  order_id uuid; sale_id uuid; data_itens jsonb; total_v numeric; before_v numeric; qty_v integer;
begin
  select id into bread from public.v2_produtos where nome='Frango';
  select id into coke from public.v2_produtos where nome='Coca-Cola 220 ml';
  select id into zero_coke from public.v2_produtos where nome='Coca-Cola Zero 220 ml';
  select usuario_id into admin_id from public.perfis where role='admin' limit 1;
  select c.id,c.usuario_id into customer_id,customer_user from public.v2_clientes c
    where c.ativo and c.usuario_id is not null and c.usuario_id<>admin_id limit 1;
  if customer_id is null or admin_id is null then raise exception 'Contas de teste ausentes'; end if;
  if exists(select 1 from public.v2_estoque_cliente() where produto_id in(coke,zero_coke) and disponivel<>0) then
    raise exception 'Bebidas foram liberadas antes da hora'; end if;
  select sum(total) into before_v from public.v2_vendas;

  data_itens:=jsonb_build_array(jsonb_build_object('produto_id',bread,'quantidade',1),jsonb_build_object('produto_id',coke,'quantidade',1));
  select sum(quantidade*valor_unitario) into total_v from public.v2_calcular_itens_cardapio(data_itens);
  if total_v<>12 then raise exception 'Combo esperado 12, recebido %',total_v; end if;
  select sum(quantidade*valor_unitario) into total_v from public.v2_calcular_itens_cardapio(
    jsonb_build_array(jsonb_build_object('produto_id',zero_coke,'quantidade',2)));
  if total_v<>9 then raise exception 'Avulsa esperado 9'; end if;
  data_itens:=jsonb_build_array(jsonb_build_object('produto_id',bread,'quantidade',1),jsonb_build_object('produto_id',coke,'quantidade',1),jsonb_build_object('produto_id',zero_coke,'quantidade',1));
  select sum(quantidade*valor_unitario) into total_v from public.v2_calcular_itens_cardapio(data_itens);
  if total_v<>16.50 then raise exception 'Excedente esperado 16.50'; end if;
  select sum(quantidade) into qty_v from public.v2_calcular_itens_cardapio(
    jsonb_build_array(jsonb_build_object('produto_id',coke,'quantidade',1),jsonb_build_object('produto_id',coke,'quantidade',1)));
  if qty_v<>2 then raise exception 'Duplicatas não agregadas'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_user,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin
    perform public.v2_criar_pedido_cliente(jsonb_build_array(jsonb_build_object('produto_id',coke,'quantidade',1)),'TESTE-ZERO');
    raise exception 'Erro: bebida sem estoque foi reservada';
  exception when others then if sqlerrm<>'Estoque insuficiente' then raise; end if;
  end;
  begin
    perform public.v2_registrar_venda_cardapio(data_itens,customer_id);
    raise exception 'Erro: cliente criou venda ADM';
  exception when others then if sqlerrm<>'Acesso administrativo necessário' then raise; end if;
  end;
  execute 'reset role';

  -- Estoque exclusivamente dentro da transação de teste.
  insert into public.v2_producao(produto_id,quantidade,data,observacao)
    values(bread,10,current_date,'Teste rollback'),(coke,10,current_date,'Teste rollback'),(zero_coke,10,current_date,'Teste rollback');
  execute 'set local role authenticated';
  order_id:=public.v2_criar_pedido_cliente(data_itens,'requestId:TESTE-COMBO-ROLLBACK');
  if order_id<>public.v2_criar_pedido_cliente(data_itens,'requestId:TESTE-COMBO-ROLLBACK') then raise exception 'Envio duplicado'; end if;
  select total into total_v from public.v2_pedidos where id=order_id;
  if total_v<>16.50 then raise exception 'Reserva não persistiu promoção'; end if;
  perform public.v2_editar_itens_cardapio(order_id,jsonb_build_array(jsonb_build_object('produto_id',zero_coke,'quantidade',2)));
  select total into total_v from public.v2_pedidos where id=order_id;
  if total_v<>9 then raise exception 'Edição sem pão manteve desconto'; end if;
  data_itens:=jsonb_build_array(jsonb_build_object('produto_id',bread,'quantidade',2),jsonb_build_object('produto_id',zero_coke,'quantidade',3));
  perform public.v2_editar_itens_cardapio(order_id,data_itens);
  select total into total_v from public.v2_pedidos where id=order_id;
  if total_v<>28.50 then raise exception 'Edição com excedente inválida: %',total_v; end if;
  if (select sum(subtotal) from public.v2_pedido_itens where pedido_id=order_id)<>28.50 then raise exception 'Itens divergentes do total'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  sale_id:=public.v2_confirmar_pedido(order_id);
  select total into total_v from public.v2_vendas where id=sale_id;
  if total_v<>28.50 then raise exception 'Confirmação perdeu desconto'; end if;
  perform public.v2_admin_editar_pedido(order_id,jsonb_build_array(jsonb_build_object('produto_id',bread,'quantidade',1),jsonb_build_object('produto_id',zero_coke,'quantidade',1)));
  select total into total_v from public.v2_vendas where id=sale_id;
  if total_v<>12 then raise exception 'Edição ADM não atualizou venda'; end if;
  sale_id:=public.v2_registrar_venda_cardapio(data_itens,null,'TESTE AVULSO ROLLBACK',10,current_date);
  select total into total_v from public.v2_vendas where id=sale_id;
  if total_v<>28.50 then raise exception 'Venda ADM inválida'; end if;
  if (select valor_pago from public.v2_vendas where id=sale_id)<>10 then raise exception 'Pagamento inválido'; end if;
  if (select quantidade_paes from public.v2_vendas_detalhadas where id=sale_id)<>2 then raise exception 'Contagem de pães incorreta'; end if;
  if (select quantidade_bebidas from public.v2_vendas_detalhadas where id=sale_id)<>3 then raise exception 'Contagem de bebidas incorreta'; end if;
  begin
    perform public.v2_admin_editar_pedido((select pedido_id from public.v2_vendas where id=sale_id),data_itens);
    raise exception 'Erro: edição de venda paga permitida';
  exception when others then if sqlerrm<>'Pedido já possui pagamento e não pode ser editado' then raise; end if;
  end;
  execute 'reset role';
end;
$$;
select 'PASS: preços, excedentes, saldo zero, RLS, reserva idempotente, edição cliente/ADM, confirmação, venda avulsa e pagamento' result;
rollback;
