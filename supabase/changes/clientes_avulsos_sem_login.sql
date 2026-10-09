-- Avulso ganha cadastro administrativo, mas não uma conta de acesso.
create or replace function public.v2_cliente_avulso_sem_login(p_nome text)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare
  nome_v text:=nullif(regexp_replace(btrim(p_nome),'\s+',' ','g'),'');
  cliente_v uuid; encontrados integer;
begin
  if not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo necessário';
  end if;
  if nome_v is null or length(nome_v)>200 then
    raise exception 'Informe o nome do cliente avulso';
  end if;
  perform pg_advisory_xact_lock(hashtext('v2_guest:'||lower(nome_v)));
  select count(*) into encontrados from public.v2_clientes
    where ativo and usuario_id is null
      and lower(regexp_replace(btrim(nome),'\s+',' ','g'))=lower(nome_v);
  if encontrados>1 then
    raise exception 'Há mais de um cliente sem login com esse nome. Selecione o cadastro correto';
  end if;
  select id into cliente_v from public.v2_clientes
    where ativo and usuario_id is null
      and lower(regexp_replace(btrim(nome),'\s+',' ','g'))=lower(nome_v);
  if cliente_v is null then
    insert into public.v2_clientes(nome,ativo) values(nome_v,true)
      returning id into cliente_v;
  end if;
  return cliente_v;
end;
$function$;
revoke all on function public.v2_cliente_avulso_sem_login(text) from public,anon;
grant execute on function public.v2_cliente_avulso_sem_login(text) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.v2_registrar_venda_cardapio(p_itens jsonb, p_cliente_id uuid DEFAULT NULL::uuid, p_cliente_nome text DEFAULT NULL::text, p_valor_pago numeric DEFAULT 0, p_data date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare linhas jsonb; qtd_v integer; total_v numeric; pedido_v uuid; venda_v uuid;
  nome_v text:=nullif(btrim(p_cliente_nome),''); pago_v numeric; cliente_v uuid:=p_cliente_id;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Acesso administrativo necessário'; end if;
  perform pg_advisory_xact_lock(hashtext('v2_stock_reserva'));
  if p_data is null or p_valor_pago is null or p_valor_pago<0 then raise exception 'Data ou pagamento inválidos'; end if;
  if p_cliente_id is null then
    if nome_v is null or length(nome_v)>200 then raise exception 'Informe o nome do cliente avulso'; end if;
  elsif not exists(select 1 from public.v2_clientes where id=p_cliente_id and ativo) then
    raise exception 'Cliente inválido';
  else nome_v:=null;
  end if;
  select jsonb_agg(to_jsonb(i)),sum(i.quantidade)::int,sum(i.quantidade*i.valor_unitario)
    into linhas,qtd_v,total_v from public.v2_calcular_itens_cardapio(p_itens) i;
  if exists(select 1 from (
    select i.produto_id,sum(i.quantidade) qtd from jsonb_to_recordset(linhas)
      as i(produto_id uuid,quantidade integer) group by i.produto_id) e
    left join public.v2_estoque_cliente() s on s.produto_id=e.produto_id
    where e.qtd>coalesce(s.disponivel,0)) then raise exception 'Estoque insuficiente'; end if;
  if cliente_v is null then
    cliente_v:=public.v2_cliente_avulso_sem_login(nome_v);
  end if;
  pago_v:=least(p_valor_pago,total_v);
  insert into public.v2_pedidos(cliente_id,cliente_nome,data,status,quantidade_total,total,origem,observacao)
    values(cliente_v,nome_v,p_data,'confirmado',qtd_v,total_v,'ADM','Venda do cardápio') returning id into pedido_v;
  insert into public.v2_pedido_itens(pedido_id,produto_id,descricao,quantidade,valor_unitario)
    select pedido_v,i.produto_id,i.descricao,i.quantidade,i.valor_unitario
    from jsonb_to_recordset(linhas) as i(produto_id uuid,descricao text,quantidade integer,valor_unitario numeric);
  insert into public.v2_vendas(pedido_id,cliente_id,cliente_nome,data,quantidade,valor_unitario,total,valor_pago,data_pagamento,observacao)
    values(pedido_v,cliente_v,nome_v,p_data,qtd_v,total_v/qtd_v,total_v,pago_v,
      case when pago_v>0 then p_data else null end,'Venda do cardápio') returning id into venda_v;
  if pago_v>0 then
    insert into public.v2_pagamentos(venda_id,valor,data_pagamento,observacao)
      values(venda_v,pago_v,p_data,'Pagamento na venda direta');
  end if;
  return venda_v;
end;
$function$;


-- Corrige somente o cliente citado; preserva valores, pagamentos e estoque.
do $backfill$
declare
  nome_v text:='JEFFERSON PROGRAMADOR'; cliente_v uuid; encontrados integer;
  vendas_antes jsonb; pedidos_antes jsonb; estoque_antes jsonb;
begin
  select jsonb_agg(to_jsonb(v)-'cliente_id' order by id) into vendas_antes from public.v2_vendas v;
  select jsonb_agg(to_jsonb(p)-'cliente_id' order by id) into pedidos_antes from public.v2_pedidos p;
  select jsonb_agg(to_jsonb(e) order by produto_id) into estoque_antes from public.v2_estoque_atual e;
  perform pg_advisory_xact_lock(hashtext('v2_guest:'||lower(nome_v)));
  select count(*) into encontrados from public.v2_clientes
    where ativo and usuario_id is null and lower(regexp_replace(btrim(nome),'\s+',' ','g'))=lower(nome_v);
  if encontrados>1 then raise exception 'Cadastro ambíguo de Jefferson'; end if;
  select id into cliente_v from public.v2_clientes
    where ativo and usuario_id is null and lower(regexp_replace(btrim(nome),'\s+',' ','g'))=lower(nome_v);
  if cliente_v is null and exists(select 1 from public.v2_vendas
      where cliente_id is null and lower(regexp_replace(btrim(cliente_nome),'\s+',' ','g'))=lower(nome_v)) then
    insert into public.v2_clientes(nome,ativo) values(nome_v,true) returning id into cliente_v;
  end if;
  if cliente_v is not null then
    update public.v2_vendas set cliente_id=cliente_v
      where cliente_id is null and lower(regexp_replace(btrim(cliente_nome),'\s+',' ','g'))=lower(nome_v);
    update public.v2_pedidos set cliente_id=cliente_v
      where cliente_id is null and lower(regexp_replace(btrim(cliente_nome),'\s+',' ','g'))=lower(nome_v);
  end if;
  if vendas_antes is distinct from (select jsonb_agg(to_jsonb(v)-'cliente_id' order by id) from public.v2_vendas v)
    or pedidos_antes is distinct from (select jsonb_agg(to_jsonb(p)-'cliente_id' order by id) from public.v2_pedidos p)
    or estoque_antes is distinct from (select jsonb_agg(to_jsonb(e) order by produto_id) from public.v2_estoque_atual e) then
      raise exception 'A vinculação alterou dados além do cliente; operação revertida';
  end if;
end;
$backfill$;

