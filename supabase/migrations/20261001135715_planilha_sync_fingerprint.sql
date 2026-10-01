create or replace function public.v2_planilha_sync_fingerprint()
returns text language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object(
 'clientes',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_clientes t),
 'vendas',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_vendas t),
 'pedidos',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_pedidos t),
 'itens',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_pedido_itens t),
 'pagamentos',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_pagamentos t),
 'custos',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_custos t),
 'producao',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_producao t),
 'estoque',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_movimentacoes_estoque t),
 'produtos',(select jsonb_agg(to_jsonb(t) order by t.id) from public.v2_produtos t)
 )::text);
$$;
revoke all on function public.v2_planilha_sync_fingerprint() from public,anon,authenticated;
grant execute on function public.v2_planilha_sync_fingerprint() to service_role;
notify pgrst,'reload schema';
