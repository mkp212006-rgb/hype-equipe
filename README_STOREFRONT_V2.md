# Tw Store 2.8 — Layout LMT em vermelho

A página inicial do cliente segue a mesma sequência visual da referência LMT Store: faixa promocional, cabeçalho com busca, hero de boas-vindas, três destaques, catálogos, bloco de funcionamento, informações de confiança e rodapé. Toda a identidade azul foi convertida para o vermelho da Tw Store.

## Experiência do cliente

- busca instantânea por nome, categoria, descrição ou selo;
- até quatro itens por catálogo com expansão em **Ver mais**;
- destaques e oferta principal definidos pelos produtos marcados pelo administrador;
- atalhos para carteira, pedidos, suporte, SMM, VPN e assinaturas;
- layout responsivo para celular, tablet e desktop;
- conteúdo real vindo do PostgreSQL, sem produtos ou preços fixos no frontend.

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
