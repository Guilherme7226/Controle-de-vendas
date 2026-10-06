-- Cadastro sem entrada de estoque e sem lançamento de custo/despesa.
alter table public.v2_produtos
  add column if not exists categoria text not null default 'pao' check (categoria in ('pao','bebida')),
  add column if not exists custo_unitario numeric(10,2) check (custo_unitario >= 0),
  add column if not exists preco_combo numeric(10,2) check (preco_combo >= 0 and preco_combo <= preco);

insert into public.v2_produtos(nome,preco,ativo,categoria,custo_unitario,preco_combo)
values ('Coca-Cola 220 ml',4.50,true,'bebida',2.20,4.00),
       ('Coca-Cola Zero 220 ml',4.50,true,'bebida',2.20,4.00)
on conflict(nome) do update set preco=excluded.preco,categoria=excluded.categoria,
  custo_unitario=excluded.custo_unitario,preco_combo=excluded.preco_combo;

-- Preço autorizado no servidor. Uma bebida promocional por pão; excedentes avulsos.
-- Se um produto tiver unidades a dois preços, são persistidas duas linhas exatas.
create or replace function public.v2_calcular_itens_cardapio(p_itens jsonb)
returns table(produto_id uuid,descricao text,quantidade integer,valor_unitario numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_itens is null or jsonb_typeof(p_itens)<>'array' then
    raise exception 'Selecione pelo menos um produto';
  end if;
  if jsonb_array_length(p_itens)=0 then raise exception 'Selecione pelo menos um produto'; end if;
  if exists(select 1 from jsonb_array_elements(p_itens) e
    where (e->>'produto_id') is null or (e->>'quantidade') is null
      or (e->>'quantidade') !~ '^[0-9]+$') then
    raise exception 'Quantidade inválida';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_itens) as e(produto_id uuid,quantidade integer)
    left join public.v2_produtos p on p.id=e.produto_id and p.ativo
    where e.quantidade<=0 or p.id is null) then
    raise exception 'Produto ou quantidade inválidos';
  end if;
  return query
  with entrada as (
    select e.produto_id,sum(e.quantidade)::integer qtd
    from jsonb_to_recordset(p_itens) as e(produto_id uuid,quantidade integer) group by e.produto_id
  ), dados as (
    select p.*,e.qtd from entrada e join public.v2_produtos p on p.id=e.produto_id
  ), pares as (
    select coalesce(sum(d.qtd) filter(where d.categoria='pao'),0)::integer paes from dados d
  ), bebidas as (
    select d.*,greatest(0,least(d.qtd,pa.paes-coalesce(sum(d.qtd) over
      (order by d.nome,d.id rows between unbounded preceding and 1 preceding),0)))::integer promo
    from dados d cross join pares pa where d.categoria='bebida' and d.preco_combo is not null
  )
  select d.id,d.nome,d.qtd,d.preco from dados d where d.categoria<>'bebida' or d.preco_combo is null
  union all select b.id,b.nome,b.promo,b.preco_combo from bebidas b where b.promo>0
  union all select b.id,b.nome,b.qtd-b.promo,b.preco from bebidas b where b.qtd>b.promo;
end;
$$;

create or replace function public.v2_criar_pedido_cliente(p_itens jsonb,p_observacao text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare cliente_v uuid; pedido_v uuid; linhas jsonb; total_v numeric; qtd_v integer;
begin
  perform pg_advisory_xact_lock(hashtext('v2_stock_reserva'));
  select id into cliente_v from public.v2_clientes where usuario_id=auth.uid() and ativo limit 1;
  if cliente_v is null then raise exception 'Cliente não encontrado para esta conta'; end if;
  if p_observacao like 'requestId:%' then
    select id into pedido_v from public.v2_pedidos where cliente_id=cliente_v and observacao=p_observacao
    order by created_at limit 1;
    if pedido_v is not null then return pedido_v; end if;
  end if;
  select jsonb_agg(to_jsonb(i)),sum(i.quantidade)::int,sum(i.quantidade*i.valor_unitario)
    into linhas,qtd_v,total_v from public.v2_calcular_itens_cardapio(p_itens) i;
  if exists(select 1 from (
    select i.produto_id,sum(i.quantidade) qtd from jsonb_to_recordset(linhas)
      as i(produto_id uuid,quantidade integer) group by i.produto_id) e
    left join public.v2_estoque_cliente() s on s.produto_id=e.produto_id
    where e.qtd>coalesce(s.disponivel,0)) then raise exception 'Estoque insuficiente'; end if;
  insert into public.v2_pedidos(cliente_id,data,status,quantidade_total,total,origem,observacao)
    values(cliente_v,(now() at time zone 'America/Sao_Paulo')::date,'reservado',qtd_v,total_v,'CLIENTE',p_observacao)
    returning id into pedido_v;
  insert into public.v2_pedido_itens(pedido_id,produto_id,descricao,quantidade,valor_unitario)
    select pedido_v,i.produto_id,i.descricao,i.quantidade,i.valor_unitario
    from jsonb_to_recordset(linhas) as i(produto_id uuid,descricao text,quantidade integer,valor_unitario numeric);
  return pedido_v;
end;
$$;

-- Edição atômica compartilhada pelo cliente e ADM, com verificação de propriedade.
create or replace function public.v2_editar_itens_cardapio(p_pedido_id uuid,p_itens jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare p public.v2_pedidos%rowtype; v public.v2_vendas%rowtype;
  linhas jsonb; qtd_v integer; total_v numeric; admin_v boolean;
begin
  perform pg_advisory_xact_lock(hashtext('v2_stock_reserva'));
  admin_v:=coalesce(public.is_admin(),false);
  select * into p from public.v2_pedidos where id=p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if not admin_v and not exists(select 1 from public.v2_clientes c
    where c.id=p.cliente_id and c.usuario_id=auth.uid() and c.ativo) then
    raise exception 'Pedido não pertence a esta conta';
  end if;
  if p.status not in ('reservado','confirmado') or (not admin_v and p.status<>'reservado') then
    raise exception 'Este pedido não pode ser editado';
  end if;
  select * into v from public.v2_vendas where pedido_id=p.id limit 1;
  if coalesce(v.valor_pago,0)>0 then raise exception 'Pedido já possui pagamento e não pode ser editado'; end if;
  select jsonb_agg(to_jsonb(i)),sum(i.quantidade)::int,sum(i.quantidade*i.valor_unitario)
    into linhas,qtd_v,total_v from public.v2_calcular_itens_cardapio(p_itens) i;
  if exists(with entrada as (
    select i.produto_id,sum(i.quantidade) qtd from jsonb_to_recordset(linhas)
      as i(produto_id uuid,quantidade integer) group by i.produto_id
  ), atuais as (
    select i.produto_id,sum(i.quantidade) qtd from public.v2_pedido_itens i where i.pedido_id=p.id group by i.produto_id
  ) select 1 from entrada e left join public.v2_estoque_cliente() s on s.produto_id=e.produto_id
    left join atuais a on a.produto_id=e.produto_id
    where e.qtd>coalesce(s.disponivel,0)+coalesce(a.qtd,0)) then raise exception 'Estoque insuficiente'; end if;
  delete from public.v2_pedido_itens where pedido_id=p.id;
  insert into public.v2_pedido_itens(pedido_id,produto_id,descricao,quantidade,valor_unitario)
    select p.id,i.produto_id,i.descricao,i.quantidade,i.valor_unitario
    from jsonb_to_recordset(linhas) as i(produto_id uuid,descricao text,quantidade integer,valor_unitario numeric);
  update public.v2_pedidos set quantidade_total=qtd_v,total=total_v,updated_at=now() where id=p.id;
  if v.id is not null then
    update public.v2_vendas set quantidade=qtd_v,valor_unitario=total_v/qtd_v,total=total_v where id=v.id;
  end if;
end;
$$;

create or replace function public.v2_admin_editar_pedido(p_pedido_id uuid,p_itens jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Acesso administrativo necessário'; end if;
  perform public.v2_editar_itens_cardapio(p_pedido_id,p_itens);
end;
$$;

-- Venda ADM com vários produtos, incluindo cliente avulso e pagamento imediato.
create or replace function public.v2_registrar_venda_cardapio(p_itens jsonb,
  p_cliente_id uuid default null,p_cliente_nome text default null,
  p_valor_pago numeric default 0,p_data date default current_date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare linhas jsonb; qtd_v integer; total_v numeric; pedido_v uuid; venda_v uuid;
  nome_v text:=nullif(btrim(p_cliente_nome),''); pago_v numeric;
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
  pago_v:=least(p_valor_pago,total_v);
  insert into public.v2_pedidos(cliente_id,cliente_nome,data,status,quantidade_total,total,origem,observacao)
    values(p_cliente_id,nome_v,p_data,'confirmado',qtd_v,total_v,'ADM','Venda do cardápio') returning id into pedido_v;
  insert into public.v2_pedido_itens(pedido_id,produto_id,descricao,quantidade,valor_unitario)
    select pedido_v,i.produto_id,i.descricao,i.quantidade,i.valor_unitario
    from jsonb_to_recordset(linhas) as i(produto_id uuid,descricao text,quantidade integer,valor_unitario numeric);
  insert into public.v2_vendas(pedido_id,cliente_id,cliente_nome,data,quantidade,valor_unitario,total,valor_pago,data_pagamento,observacao)
    values(pedido_v,p_cliente_id,nome_v,p_data,qtd_v,total_v/qtd_v,total_v,pago_v,
      case when pago_v>0 then p_data else null end,'Venda do cardápio') returning id into venda_v;
  if pago_v>0 then
    insert into public.v2_pagamentos(venda_id,valor,data_pagamento,observacao)
      values(venda_v,pago_v,p_data,'Pagamento na venda direta');
  end if;
  return venda_v;
end;
$$;

revoke all on function public.v2_calcular_itens_cardapio(jsonb) from public,anon;
revoke all on function public.v2_editar_itens_cardapio(uuid,jsonb) from public,anon;
revoke all on function public.v2_registrar_venda_cardapio(jsonb,uuid,text,numeric,date) from public,anon;
grant execute on function public.v2_calcular_itens_cardapio(jsonb) to authenticated,service_role;
grant execute on function public.v2_editar_itens_cardapio(uuid,jsonb) to authenticated,service_role;
grant execute on function public.v2_registrar_venda_cardapio(jsonb,uuid,text,numeric,date) to authenticated,service_role;

-- Preserva quantidade total; indicadores de pães passam a contar apenas pães.
create or replace view public.v2_vendas_detalhadas with (security_invoker=true) as
select v.id,v.source_row,v.pedido_id,v.cliente_id,coalesce(c.nome,v.cliente_nome) cliente,c.telefone,
  v.data,v.empresa,v.quantidade,v.valor_unitario,v.total,v.valor_pago,(v.total-v.valor_pago) saldo,
  v.data_pagamento,case when v.valor_pago>=v.total then 'pago' when v.valor_pago>0 then 'parcial' else 'pendente' end status_pagamento,
  v.observacao,v.created_at,
  coalesce(i.paes,v.quantidade)::integer quantidade_paes,coalesce(i.bebidas,0)::integer quantidade_bebidas
from public.v2_vendas v left join public.v2_clientes c on c.id=v.cliente_id
left join lateral (
  select coalesce(sum(it.quantidade) filter(where coalesce(pr.categoria,'pao')='pao'),0) paes,
    coalesce(sum(it.quantidade) filter(where pr.categoria='bebida'),0) bebidas
  from public.v2_pedido_itens it left join public.v2_produtos pr on pr.id=it.produto_id
  where it.pedido_id=v.pedido_id having count(*)>0
) i on true;
