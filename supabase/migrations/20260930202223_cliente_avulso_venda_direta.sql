alter table public.v2_pedidos alter column cliente_id drop not null;
alter table public.v2_vendas alter column cliente_id drop not null;
alter table public.v2_pedidos add column if not exists cliente_nome text;
alter table public.v2_vendas add column if not exists cliente_nome text;

create or replace view public.v2_vendas_detalhadas with (security_invoker=true) as
select v.id,v.source_row,v.pedido_id,v.cliente_id,
coalesce(c.nome,v.cliente_nome) as cliente,c.telefone,v.data,v.empresa,v.quantidade,
v.valor_unitario,v.total,v.valor_pago,v.total-v.valor_pago as saldo,v.data_pagamento,
case when v.valor_pago>=v.total then 'pago' when v.valor_pago>0 then 'parcial' else 'pendente' end as status_pagamento,
v.observacao,v.created_at
from public.v2_vendas v left join public.v2_clientes c on c.id=v.cliente_id;

create or replace view public.v2_pedidos_completos with (security_invoker=true) as
select p.id,p.legacy_id,p.cliente_id,coalesce(c.nome,p.cliente_nome) as cliente,c.telefone,
p.data,p.status,p.quantidade_total,p.total,p.origem,p.referencia,p.observacao,p.created_at,p.updated_at,
coalesce(jsonb_agg(jsonb_build_object('id',i.id,'produto_id',i.produto_id,'produto',coalesce(pr.nome,i.descricao),
'quantidade',i.quantidade,'valor_unitario',i.valor_unitario,'subtotal',i.subtotal)
order by coalesce(pr.nome,i.descricao)) filter (where i.id is not null),'[]'::jsonb) as itens,p.numero_pedido
from public.v2_pedidos p left join public.v2_clientes c on c.id=p.cliente_id
left join public.v2_pedido_itens i on i.pedido_id=p.id
left join public.v2_produtos pr on pr.id=i.produto_id
group by p.id,c.nome,c.telefone;

create or replace function public.v2_registrar_venda_avulsa(
p_cliente_nome text,p_produto_id uuid,p_quantidade integer,
p_valor_pago numeric default 0,p_data date default current_date)
returns uuid language plpgsql security invoker set search_path=public as $$
declare venda_id uuid; nome text:=btrim(p_cliente_nome);
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Acesso administrativo necessário'; end if;
  if nome is null or nome='' or length(nome)>200 then raise exception 'Informe o nome do cliente avulso (até 200 caracteres)'; end if;
  if p_quantidade is null or p_quantidade<1 or p_data is null or p_produto_id is null then raise exception 'Preencha produto, quantidade e data'; end if;
  if p_valor_pago is null or p_valor_pago<0 then raise exception 'Valor pago inválido'; end if;
  venda_id:=public.v2_registrar_venda_direta(null,p_produto_id,p_quantidade,p_valor_pago,p_data);
  update public.v2_vendas set cliente_nome=nome where id=venda_id;
  update public.v2_pedidos set cliente_nome=nome where id=(select pedido_id from public.v2_vendas where id=venda_id);
  return venda_id;
end;
$$;
revoke all on function public.v2_registrar_venda_avulsa(text,uuid,integer,numeric,date) from public,anon;
grant execute on function public.v2_registrar_venda_avulsa(text,uuid,integer,numeric,date) to authenticated;
notify pgrst,'reload schema';
