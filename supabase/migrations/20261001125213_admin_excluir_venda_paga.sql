create or replace function public.v2_excluir_venda(p_venda_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare v public.v2_vendas%rowtype; pedido_id_v uuid;
begin
  if not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo necessário';
  end if;
  perform pg_advisory_xact_lock(hashtext('v2_stock_reserva'));
  select pedido_id into pedido_id_v from public.v2_vendas where id=p_venda_id;
  if not found then raise exception 'Venda não encontrada'; end if;
  if pedido_id_v is not null then
    perform 1 from public.v2_pedidos where id=pedido_id_v for update;
  end if;
  select * into v from public.v2_vendas where id=p_venda_id for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if v.pedido_id is distinct from pedido_id_v then
    raise exception 'A venda foi alterada. Atualize a lista e tente novamente';
  end if;
  -- Os pagamentos desta venda são removidos pela FK ON DELETE CASCADE.
  delete from public.v2_vendas where id=v.id;
  -- Mantém o estoque consumido caso exista outra venda para o mesmo pedido.
  if pedido_id_v is not null and not exists(
    select 1 from public.v2_vendas where pedido_id=pedido_id_v
  ) then
    update public.v2_pedidos set status='cancelado',updated_at=now() where id=pedido_id_v;
  end if;
end;
$$;
revoke all on function public.v2_excluir_venda(uuid) from public,anon;
grant execute on function public.v2_excluir_venda(uuid) to authenticated;
notify pgrst,'reload schema';
