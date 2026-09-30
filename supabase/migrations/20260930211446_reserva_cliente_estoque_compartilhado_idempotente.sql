CREATE OR REPLACE FUNCTION public.v2_criar_pedido_cliente(p_itens jsonb, p_observacao text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  cliente_v uuid;
  pedido_v uuid;
  item jsonb;
  produto_v public.v2_produtos%rowtype;
  qtd integer;
  total_v numeric := 0;
  qtd_total integer := 0;
  disponivel_v integer;
begin
  perform pg_advisory_xact_lock(hashtext('v2_stock_reserva'));

  select id into cliente_v
  from public.v2_clientes
  where usuario_id=auth.uid() and ativo
  limit 1;

  if cliente_v is null then
    raise exception 'Cliente não encontrado para esta conta';
  end if;

  -- O mesmo envio só pode gerar uma reserva, inclusive após timeout no navegador.
  if p_observacao like 'requestId:%' then
    select id into pedido_v from public.v2_pedidos
    where cliente_id=cliente_v and observacao=p_observacao
    order by created_at limit 1;
    if pedido_v is not null then return pedido_v; end if;
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens)=0 then
    raise exception 'Selecione pelo menos um produto';
  end if;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    qtd := greatest(0,coalesce((item->>'quantidade')::integer,0));
    if qtd <= 0 then continue; end if;

    select * into produto_v
    from public.v2_produtos
    where id=(item->>'produto_id')::uuid and ativo;

    if produto_v.id is null then
      raise exception 'Produto inválido';
    end if;

    select disponivel into disponivel_v
    from public.v2_estoque_cliente()
    where produto_id=produto_v.id;

    if coalesce(disponivel_v,0) < qtd then
      raise exception 'Estoque insuficiente para %', produto_v.nome;
    end if;

    total_v := total_v + (qtd * produto_v.preco);
    qtd_total := qtd_total + qtd;
  end loop;

  if qtd_total <= 0 then
    raise exception 'Quantidade inválida';
  end if;

  insert into public.v2_pedidos(cliente_id,data,status,quantidade_total,total,origem,observacao)
  values(cliente_v,current_date,'reservado',qtd_total,total_v,'CLIENTE',p_observacao)
  returning id into pedido_v;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    qtd := greatest(0,coalesce((item->>'quantidade')::integer,0));
    if qtd <= 0 then continue; end if;

    select * into produto_v
    from public.v2_produtos
    where id=(item->>'produto_id')::uuid and ativo;

    insert into public.v2_pedido_itens(pedido_id,produto_id,descricao,quantidade,valor_unitario)
    values(pedido_v,produto_v.id,produto_v.nome,qtd,produto_v.preco);
  end loop;

  return pedido_v;
end;
$function$
