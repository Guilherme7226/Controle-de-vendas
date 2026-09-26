# Controle de Vendas

Sistema web para registrar vendas e custos e acompanhar faturamento, lucro, quantidade vendida e contas a receber por cliente.

## Arquivos
- `index.html`: painel web.
- `Code.gs`: backend para Google Apps Script/Google Sheets.

Preço padrão configurado: **R$ 8,00 por pão**.

## Google Sheets
1. Abra o projeto do Google Apps Script ligado à sua planilha.
2. Cole o conteúdo de `Code.gs`.
3. Execute `setup()` uma vez para criar as abas **Vendas** e **Custos**.
4. Publique o projeto como **Web app** e copie a URL terminada em `/exec`.
5. No site, clique em **⚙️ Configurar** e informe essa URL.

Enquanto a URL do Apps Script não estiver configurada, o site funciona em modo local no navegador.
