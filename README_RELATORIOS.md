# Tw Store — Relatórios semanais/mensais (v2.4.1)

Envie os arquivos deste ZIP para o repositório mantendo exatamente as pastas indicadas.

Arquivos desta atualização:
- `package.json`
- `src/launcher.js`
- `src/report-features.js`
- `public/index.html`
- `public/reports-v1.js`
- `public/reports-v1.css`
- `public/tw-store-icon.png`

O restante do repositório deve permanecer como está.

## Relatório em Ajustes

Usuário comum:
- em **Ajustes**, o botão **Relatório Semanal / Mensal** aparece logo abaixo do WhatsApp;
- endpoint `GET /api/reports/spending`;
- mostra somente os gastos da própria conta;
- exibe semana, mês, divisão SMM/VPN e quantidade de compras.

Administrador:
- o painel administrativo recebe um botão **Ajustes**;
- dentro de Ajustes, o relatório aparece logo abaixo do WhatsApp;
- endpoint `GET /admin/reports/spending`;
- mostra os gastos gerais e o Top 3 de usuários em cada período.

O cálculo considera pedidos SMM debitados e não estornados e acessos VPN que permanecem cobrados (`submitting` ou `active`). Pedidos estornados não entram nos totais.

## Privacidade

Usuários comuns nunca recebem o ranking geral nem os gastos de outras contas. O Top 3 fica exclusivo para a sessão administrativa.
