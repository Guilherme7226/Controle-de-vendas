# Paozinhos V2 — Supabase

Branch de desenvolvimento: `v2-supabase`.

Objetivo: substituir o fluxo operacional Google Sheets + Apps Script por Supabase/PostgreSQL, mantendo a V1 intacta durante a migração.

## Arquitetura
- Frontend: Cloudflare Pages/Worker
- API: acesso ao Supabase com RLS
- Banco: PostgreSQL/Supabase
- Auth: Supabase Auth
- V1: preservada no branch main

## Migração
1. Mapear dados atuais da planilha.
2. Validar modelo relacional.
3. Importar clientes, produtos, pedidos, vendas, pagamentos, custos, estoque e produção.
4. Conferir totais contra a V1.
5. Migrar as telas administrativas e de cliente.
6. Testar em produção sem desligar a V1.
7. Fazer a troca somente após validação.

Nenhum dado da planilha é alterado por este branch.
