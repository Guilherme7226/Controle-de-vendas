begin;
do $$
declare owner_id uuid; other_id uuid; bread uuid; coke uuid; payload jsonb; result jsonb; saved_id uuid;
  totals_before jsonb; totals_after jsonb;
begin
  select usuario_id into owner_id from public.v2_clientes where nome='Guilherme' and ativo;
  select usuario_id into other_id from public.v2_clientes where ativo and usuario_id is not null and usuario_id<>owner_id limit 1;
  select id into bread from public.v2_produtos where nome='Frango';
  select id into coke from public.v2_produtos where nome='Coca-Cola 220 ml';
  select jsonb_build_object('vendas',count(*),'total',sum(total),'pago',sum(valor_pago)) into totals_before from public.v2_vendas;
  payload:=jsonb_build_array(jsonb_build_object('produto_id',bread,'quantidade',1),jsonb_build_object('produto_id',coke,'quantidade',1));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.v2_testes_cardapio) then raise exception 'Outro cliente vê o teste'; end if;
  begin
    perform public.v2_reservar_teste_cardapio(payload);
    raise exception 'Outro cliente reservou teste';
  exception when others then if sqlerrm<>'Teste não habilitado para esta conta' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  if (select count(*) from public.v2_testes_cardapio)<>1 then raise exception 'Teste ausente para Guilherme'; end if;
  result:=public.v2_reservar_teste_cardapio(payload,null,'teste-rollback');
  saved_id:=(result->>'pedido_id')::uuid;
  if (result->>'pedido_total')::numeric<>12 then raise exception 'Combo teste incorreto'; end if;
  if (public.v2_reservar_teste_cardapio(payload,null,'teste-rollback')->>'pedido_id')::uuid<>saved_id then raise exception 'Reserva duplicada'; end if;
  result:=public.v2_reservar_teste_cardapio(jsonb_build_array(jsonb_build_object('produto_id',coke,'quantidade',1)),saved_id);
  if (result->>'pedido_total')::numeric<>4.5 then raise exception 'Avulsa teste incorreta'; end if;
  begin
    perform public.v2_reservar_teste_cardapio(jsonb_build_array(jsonb_build_object('produto_id',coke,'quantidade',2)),saved_id);
    raise exception 'Limite privado ignorado';
  exception when others then if sqlerrm<>'Quantidade acima do estoque de teste' then raise; end if;
  end;
  perform public.v2_excluir_teste_cardapio(saved_id);
  if exists(select 1 from public.v2_testes_cardapio where pedido_id is not null or pedido_total<>0) then raise exception 'Exclusão incompleta'; end if;
  execute 'reset role';
  select jsonb_build_object('vendas',count(*),'total',sum(total),'pago',sum(valor_pago)) into totals_after from public.v2_vendas;
  if totals_before<>totals_after then raise exception 'Teste afetou vendas reais'; end if;
  if exists(select 1 from public.v2_estoque_atual where produto_id in(bread,coke) and disponivel<>0) then raise exception 'Teste liberou estoque público'; end if;
end;
$$;
select 'PASS: teste exclusivo de Guilherme; combo 12; avulsa 4,50; limites, idempotência, edição/exclusão; estoque público e financeiro preservados' result;
rollback;
