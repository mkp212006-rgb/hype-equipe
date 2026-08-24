# Tw Store 2.7 — Vitrine administrável

A página inicial do cliente agora usa uma vitrine inspirada na organização de grandes lojas digitais, mantendo integralmente a identidade vermelha e escura da Tw Store.

## O que o administrador controla

- foto, selo, destaque e ordem de cada produto SMM ou VPN;
- nome, descrição, imagem, visibilidade e ordem de cada categoria;
- produtos de assinatura manuais, com foto, preço fixo, periodicidade e link de compra;
- quais itens aparecem em **Produtos em destaque**.

As imagens são reduzidas no próprio navegador e salvas no PostgreSQL. Não é necessário configurar outro serviço de arquivos.

## Novos endpoints

- `GET /api/storefront`
- `GET /admin/storefront`
- `PATCH /admin/categories/:id/presentation`
- `PATCH /admin/services/:id/presentation`
- `PATCH /admin/vpn/products/:id/presentation`
- `POST /admin/catalog-products`
- `PATCH /admin/catalog-products/:id`
- `DELETE /admin/catalog-products/:id`

As migrations são executadas automaticamente durante a inicialização no Railway e preservam categorias, serviços, produtos VPN, usuários, carteira e pedidos existentes.
