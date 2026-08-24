# Tw Store 2.8.0 — vitrine vermelha e Railway estável

Site e backend do aplicativo Tw Store, preparados para rodar juntos no endereço público do próprio Railway.

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
- Frontend usando a mesma origem do Railway, sem domínio antigo gravado nos módulos.
- Carregamentos paralelos com limite de 15 segundos e opção de tentar novamente.
- Inicialização direta, sem gerar ou reescrever o servidor durante o deploy.

## Cálculo de pedidos

`valor = quantidade / 1000 * preço_por_1000`

O APK pode exibir uma estimativa, mas o backend ignora qualquer preço enviado pelo cliente e recalcula pelo valor salvo no banco.

## Variáveis obrigatórias no Railway

```env
DATABASE_URL=...
JWT_SECRET=...
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
SMM_API_URL=https://smmhype.com/api/v2
SMM_API_KEY=...
MP_ACCESS_TOKEN=...
MP_WEBHOOK_SECRET=...
PUBLIC_BASE_URL=https://tw-store-application.up.railway.app
```

O Railway também fornece `RAILWAY_PUBLIC_DOMAIN` automaticamente. `PUBLIC_BASE_URL` pode ser mantida explicitamente com o endereço acima para os retornos e webhooks do Mercado Pago.

## PostgreSQL

O serviço exige PostgreSQL e executa as migrations automaticamente no início. No Railway, adicione um serviço PostgreSQL e disponibilize `DATABASE_URL` para este backend.

## Mercado Pago

A recarga usa Checkout Pro. O backend cria uma preferência cobrando `valor_do_crédito + 5%`, salva a referência da recarga e devolve `checkoutUrl` ao aplicativo.

A URL de webhook é:

`https://tw-store-application.up.railway.app/webhooks/mercado-pago`

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
- `POST /webhooks/mercado-pago`
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

Depois do deploy, confirme `https://tw-store-application.up.railway.app/health`. A resposta deve conter `"status":"ok"`.


## Atualização 2.1 — Categorias e personalização

Ao iniciar, a migration cria `service_categories` e adiciona `custom_name`, `description` e `category_id` à tabela `services` sem apagar os dados existentes. A sincronização do fornecedor atualiza apenas os dados técnicos/originais e preserva nome personalizado, descrição e categoria definida pelo administrador.

## Atualização 2.6 — estabilidade

O servidor agora importa todos os módulos diretamente em `src/server.js`. O frontend usa `window.location.origin` quando aberto pelo Railway, evita cache antigo de JavaScript/CSS e agrupa os observadores visuais para executar no máximo uma vez por quadro.

## Atualização 2.8 — nova vitrine

A página inicial do cliente ganhou a sequência visual da referência LMT Store adaptada à identidade vermelha da Tw Store: faixa promocional, cabeçalho com busca, hero, três produtos em destaque, catálogos expansíveis, explicação de compra, provas de confiança e rodapé. Produtos, preços, categorias e destaques continuam sendo carregados do PostgreSQL e administrados pelo painel existente.
