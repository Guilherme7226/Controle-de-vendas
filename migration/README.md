# Migração V1 → Supabase

A branch `v2-supabase` já contém os scripts necessários para migrar os dados sem alterar a planilha V1.

## O que já foi feito

- Banco Supabase criado e tabelas/RLS configurados.
- Script de migração corrigido para:
  - respeitar a linha inicial real da aba `Vendas`;
  - inserir pedidos antes de `pedido_itens`;
  - usar IDs determinísticos;
  - processar lotes de até 250 registros;
  - reconstruir estoque com a mesma fórmula da V1;
  - importar correções legadas e descartes;
  - conferir totais de faturamento, recebido, custos e produção.
- Bootstrap de autenticação preparado para usar telefone + senha no Supabase Auth.
- Bootstrap de administrador preparado.

## ÚNICA PARTE QUE VOCÊ PRECISA FAZER MANUALMENTE

A chave secreta do Supabase não pode ficar no GitHub nem ser enviada pelo chat. O Supabase recomenda manter a secret key somente em ambiente confiável/server-side.

No projeto do Apps Script que tem acesso à planilha, abra:

**Configurações do projeto → Propriedades do script**

Adicione:

- `SUPABASE_URL` = `https://lsevhjjklsnqegrpkiku.supabase.co`
- `SUPABASE_SECRET_KEY` = sua chave secreta do Supabase

O código também aceita a chave legada `SUPABASE_SERVICE_ROLE_KEY`, mas a chave nova `sb_secret_...` é a opção recomendada atualmente.

Depois copie os dois arquivos abaixo para o projeto Apps Script de migração:

- `migration/supabase_migration.gs`
- `migration/supabase_auth_bootstrap.gs`

Não coloque esses arquivos no frontend.

## Primeira execução

1. Execute `migrarDadosParaSupabase`.
2. Depois execute `verificarSupabaseMigracao`.
3. Se os totais baterem, execute `migrarUsuariosAuthSupabase`.
4. Para criar o administrador V2, configure também:
   - `SUPABASE_ADMIN_EMAIL`
   - `SUPABASE_ADMIN_PASSWORD`
   e execute `criarAdminSupabase`.

O Supabase suporta autenticação por telefone + senha e criação administrativa de usuários, desde que o fluxo de Phone Auth esteja habilitado.

## Importante

A migração não apaga vendas, clientes, custos ou qualquer outra informação da planilha.

A V1 continua intacta no branch `main`. Só depois da conferência dos números e dos testes do novo site faremos a troca.
