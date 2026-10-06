-- Estoque de demonstração por cliente. Não participa de estoque, vendas ou cobranças reais.
create table public.v2_testes_cardapio (
  cliente_id uuid primary key references public.v2_clientes(id) on delete cascade,
  ativo boolean not null default true,
  estoque jsonb not null check(jsonb_typeof(estoque)='array'),
  pedido_id uuid,
  pedido_itens jsonb not null default '[]'::jsonb check(jsonb_typeof(pedido_itens)='array'),
  pedido_total numeric(12,2) not null default 0 check(pedido_total>=0),
  request_id text,
  updated_at timestamptz not null default now()
);
alter table public.v2_testes_cardapio enable row level security;
create policy teste_cardapio_select on public.v2_testes_cardapio for select to authenticated
using (cliente_id in (select c.id from public.v2_clientes c where c.usuario_id=(select auth.uid())));
create policy teste_cardapio_update on public.v2_testes_cardapio for update to authenticated
using (ativo and cliente_id in (select c.id from public.v2_clientes c where c.usuario_id=(select auth.uid())))
with check (ativo and cliente_id in (select c.id from public.v2_clientes c where c.usuario_id=(select auth.uid())));
revoke all on public.v2_testes_cardapio from public,anon,authenticated;
grant select on public.v2_testes_cardapio to authenticated;
grant update(pedido_id,pedido_itens,pedido_total,request_id,updated_at) on public.v2_testes_cardapio to authenticated;
grant all on public.v2_testes_cardapio to service_role;

create function public.v2_reservar_teste_cardapio(p_itens jsonb,p_pedido_id uuid default null,p_request_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.v2_testes_cardapio%rowtype; linhas jsonb; total_v numeric;
begin
  select tc.* into t from public.v2_testes_cardapio tc join public.v2_clientes c on c.id=tc.cliente_id
    where c.usuario_id=auth.uid() and c.ativo and tc.ativo for update of tc;
  if not found then raise exception 'Teste não habilitado para esta conta'; end if;
  if t.pedido_id is not null and p_pedido_id is null then
    if p_request_id is not null and p_request_id=t.request_id then return to_jsonb(t); end if;
    raise exception 'Você já possui uma reserva de teste. Edite ou exclua a reserva para testar novamente';
  end if;
  if p_pedido_id is not null and p_pedido_id is distinct from t.pedido_id then
    raise exception 'Reserva de teste não encontrada';
  end if;
  select jsonb_agg(to_jsonb(i)),sum(i.quantidade*i.valor_unitario) into linhas,total_v
    from public.v2_calcular_itens_cardapio(p_itens) i;
  if exists(with entrada as (
    select i.produto_id,sum(i.quantidade) qtd from jsonb_to_recordset(linhas)
      as i(produto_id uuid,quantidade int) group by i.produto_id
  ), limite as (
    select i.produto_id,sum(i.quantidade) qtd from jsonb_to_recordset(t.estoque)
      as i(produto_id uuid,quantidade int) group by i.produto_id
  ) select 1 from entrada e left join limite l on l.produto_id=e.produto_id
    where e.qtd>coalesce(l.qtd,0)) then raise exception 'Quantidade acima do estoque de teste'; end if;
  update public.v2_testes_cardapio set pedido_id=coalesce(t.pedido_id,gen_random_uuid()),
    pedido_itens=linhas,pedido_total=total_v,request_id=coalesce(p_request_id,t.request_id),updated_at=now()
    where cliente_id=t.cliente_id returning * into t;
  return to_jsonb(t);
end;
$$;

create function public.v2_excluir_teste_cardapio(p_pedido_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.v2_testes_cardapio tc set pedido_id=null,pedido_itens='[]'::jsonb,pedido_total=0,request_id=null,updated_at=now()
    where tc.pedido_id=p_pedido_id and tc.ativo and tc.cliente_id in
      (select c.id from public.v2_clientes c where c.usuario_id=auth.uid() and c.ativo);
  if not found then raise exception 'Reserva de teste não encontrada'; end if;
  return true;
end;
$$;
revoke all on function public.v2_reservar_teste_cardapio(jsonb,uuid,text) from public,anon;
revoke all on function public.v2_excluir_teste_cardapio(uuid) from public,anon;
grant execute on function public.v2_reservar_teste_cardapio(jsonb,uuid,text) to authenticated,service_role;
grant execute on function public.v2_excluir_teste_cardapio(uuid) to authenticated,service_role;

-- Ativa somente para o cadastro Guilherme, sem produção/estoque real.
insert into public.v2_testes_cardapio(cliente_id,estoque)
select c.id,jsonb_agg(jsonb_build_object('produto_id',p.id,'quantidade',1) order by p.nome)
from public.v2_clientes c cross join public.v2_produtos p
where c.nome='Guilherme' and c.ativo and c.usuario_id is not null
  and p.nome in ('Frango','Coca-Cola 220 ml') group by c.id;
