# Tw Store Backend

Backend do aplicativo Tw Store.

## Recursos

- Cadastro e login individual por usuário e senha.
- Carteira individual em BRL, iniciando em R$ 0,00.
- Recargas via Mercado Pago Checkout Pro.
- Taxa fixa de 5% sobre o valor que será creditado na carteira.
- Crédito somente após webhook do Mercado Pago confirmar pagamento `approved`.
- Webhook com validação HMAC e idempotência para impedir crédito duplicado.
- Pedidos debitados da carteira com cálculo no servidor.
- Preço de venda por 1.000 configurável pelo administrador por serviço.
- Tarifa da SMMHype mantida separada do preço de venda.
- Categorias administrativas compartilhadas entre todos os celulares.
- Nome personalizado e descrição por serviço, preservados ao sincronizar com o fornecedor.
- Histórico de pedidos exibindo o nome personalizado atual do serviço.
- Compatibilidade com os endpoints usados pelo APK Tw Store.

## Cálculo de pedidos

`valor = quantidade / 1000 * preço_por_1000`

O APK pode exibir uma estimativa, mas o backend ignora qualquer preço enviado pelo cliente e recalcula pelo valor salvo no banco.

## Variáveis obrigatórias no Railway

```env
DATABASE_URL=...
JWT_SECRET=...
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
SMMHYPE_API_URL=...
SMMHYPE_API_KEY=...
MERCADO_PAGO_ACCESS_TOKEN=...
MERCADO_PAGO_WEBHOOK_SECRET=...
PUBLIC_BASE_URL=https://hype-equipe-production.up.railway.app
```

Variáveis opcionais:

```env
SMMHYPE_PROVIDER_CURRENCY=USD
SMMHYPE_RATE_TO_BRL=1
```

Se a tarifa retornada pela SMMHype estiver em USD, configure `SMMHYPE_RATE_TO_BRL` com o multiplicador usado apenas para exibir o custo do fornecedor em BRL no painel. O preço cobrado do cliente é sempre `pricePerThousandBRL` definido pelo admin e não depende desse multiplicador.

## PostgreSQL

O serviço exige PostgreSQL e executa as migrations automaticamente no início. No Railway, adicione um serviço PostgreSQL e disponibilize `DATABASE_URL` para este backend.

## Mercado Pago

A recarga usa Checkout Pro. O backend cria uma preferência cobrando `valor_do_crédito + 5%`, salva a referência da recarga e devolve `checkoutUrl` ao aplicativo.

A URL de webhook é:

`https://hype-equipe-production.up.railway.app/webhooks/mercadopago`

Cadastre o evento de pagamentos no painel do Mercado Pago e salve a assinatura secreta em `MERCADO_PAGO_WEBHOOK_SECRET`.

## Endpoints principais

- `POST /auth/register`
- `POST /auth/login`
- `POST /admin/login`
- `GET /api/services`
- `GET /api/orders`
- `POST /api/orders`
- `GET /api/wallet`
- `POST /api/wallet/deposits`
- `POST /webhooks/mercadopago`
- `GET /admin/categories`
- `POST /admin/categories`
- `PATCH /admin/categories/:categoryId`
- `DELETE /admin/categories/:categoryId`
- `GET /admin/services`
- `POST /admin/services`
- `PATCH /admin/services/:serviceId`
- `POST /admin/services/:serviceId/sync`
- `DELETE /admin/services/:serviceId`
- `GET /admin/summary`

## Deploy Railway

Railway detecta `package.json` via Railpack e executa `npm start`. O arquivo `railway.toml` configura healthcheck em `/health`.


## Atualização 2.1 — Categorias e personalização

Ao iniciar, a migration cria `service_categories` e adiciona `custom_name`, `description` e `category_id` à tabela `services` sem apagar os dados existentes. A sincronização do fornecedor atualiza apenas os dados técnicos/originais e preserva nome personalizado, descrição e categoria definida pelo administrador.
