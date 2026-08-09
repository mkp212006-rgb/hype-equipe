# Hype Equipe — configuração manual GitHub + Railway

## Arquivos que devem ser substituídos/adicionados no repositório `hype-equipe`

Substitua:
- `src/app.js`
- `src/db.js`
- `src/config.js`
- `src/server.js`
- `public/app.js`
- `public/styles.css`
- `.env.example`

Adicione:
- `src/mercado-pago-client.js`

O `package.json` atual pode permanecer como está. A integração do Mercado Pago usa `fetch` nativo do Node, portanto não precisa instalar dependência nova.

## Variáveis do Railway

No serviço `hype-equipe-production`, abra **Variables** e mantenha as variáveis já existentes (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SMM_API_URL`, `SMM_API_KEY`). Adicione:

- `MP_ACCESS_TOKEN` = Access Token de produção do Mercado Pago.
- `MP_WEBHOOK_SECRET` = assinatura secreta gerada em Mercado Pago Developers > sua aplicação > Webhooks.
- `PUBLIC_BASE_URL` = `https://hype-equipe-production.up.railway.app`
- `MP_TIMEOUT_MS` = `20000` (opcional).

Não coloque `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` ou `SMM_API_KEY` no GitHub.

## Webhook do Mercado Pago

Na aplicação do Mercado Pago, configure o evento **Pagamentos** (`payment`) com a URL de produção:

`https://hype-equipe-production.up.railway.app/webhooks/mercado-pago`

Depois copie a assinatura secreta gerada e coloque em `MP_WEBHOOK_SECRET` no Railway.

## Funcionamento implementado

- Cadastro: `POST /auth/register` com `name`, `username`, `password`.
- Login: `POST /auth/login` com `username`, `password`.
- Toda nova carteira começa em **R$ 0,00**, sem bônus.
- `GET /api/wallet` retorna saldo e movimentações em BRL.
- `POST /api/wallet/deposits`: valor solicitado + 5% de taxa; cria Checkout Pro do Mercado Pago.
- O saldo é creditado apenas quando o webhook é autenticado e a API do Mercado Pago confirma `approved`, valor exato e moeda BRL.
- Webhook e crédito são idempotentes: o mesmo pagamento não credita duas vezes.
- Cada serviço possui `pricePerThousandBRL` definido pelo admin.
- O custo da SMMHype (`rate`) permanece separado do preço cobrado do usuário.
- Pedidos são calculados no servidor por `(quantidade / 1000) * pricePerThousandBRL`.
- O valor é debitado da carteira de forma transacional antes de enviar à SMMHype.
- Se a SMMHype rejeitar/falhar ao criar o pedido, o valor é estornado automaticamente para a carteira.
- Usuários só visualizam os próprios pedidos.

## Deploy

Se o Railway já estiver conectado ao repositório `mkp212006-rgb/hype-equipe`, um commit na branch `main` deve acionar um novo deploy automaticamente.

Após o deploy, abra:

`https://hype-equipe-production.up.railway.app/health`

A resposta deve ter `status: "ok"`, `currency: "BRL"` e os campos de configuração do Mercado Pago. Para depósitos reais, `mercadoPagoConfigured` e `mercadoPagoWebhookConfigured` precisam estar `true`.
