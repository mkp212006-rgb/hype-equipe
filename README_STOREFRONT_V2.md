# Tw Store 2.9 — Layout AMOLED do vídeo

A página inicial foi refeita usando o vídeo enviado como referência visual principal. A composição é mobile-first e mantém o preto AMOLED: faixa promocional, cabeçalho compacto, avaliação, boas-vindas, botões, mosaico de banners, três destaques grandes e catálogos em cartões duplos. O nome, o ícone e toda a cor de destaque pertencem à Tw Store; os detalhes azuis da interface foram substituídos por vermelho.

## Experiência do cliente

- busca instantânea por nome, categoria, descrição ou selo;
- dois itens iniciais por catálogo com expansão em **Ver mais**;
- destaques e oferta principal definidos pelos produtos marcados pelo administrador;
- busca em tela própria e atalho para pedidos de assinatura;
- layout responsivo para celular, tablet e desktop;
- conteúdo real vindo do PostgreSQL, sem produtos ou preços fixos no frontend.

## Compra e entrega de assinaturas

1. O cliente toca em uma assinatura e informa o e-mail de entrega.
2. O servidor valida produto, preço e saldo diretamente no PostgreSQL.
3. O valor é debitado da carteira e o pedido entra como **Pendente**.
4. A nova aba **Entregas** mostra o pedido e o e-mail no painel administrativo.
5. O administrador preenche login, senha, link e instruções, abre o e-mail e confirma o envio.
6. O cliente acompanha o status e os dados entregues em **Minhas assinaturas**.

Se a entrega não puder ser realizada, o administrador pode cancelar o pedido e estornar o valor para a carteira. Os dados fornecidos pelo administrador são criptografados antes de serem armazenados.

## O que o administrador controla

- foto, selo, destaque e ordem de cada produto SMM ou VPN;
- nome, descrição, imagem, visibilidade e ordem de cada categoria;
- produtos de assinatura manuais, com foto, preço fixo e periodicidade;
- quais itens aparecem em **Produtos em destaque**.

As imagens são reduzidas no próprio navegador e salvas no PostgreSQL. Não é necessário configurar outro serviço de arquivos.

## Novos endpoints

- `GET /api/storefront`
- `GET /api/subscription-orders`
- `POST /api/subscription-orders`
- `GET /admin/storefront`
- `GET /admin/subscription-orders`
- `PATCH /admin/subscription-orders/:id/fulfill`
- `PATCH /admin/subscription-orders/:id/refund`
- `PATCH /admin/categories/:id/presentation`
- `PATCH /admin/services/:id/presentation`
- `PATCH /admin/vpn/products/:id/presentation`
- `POST /admin/catalog-products`
- `PATCH /admin/catalog-products/:id`
- `DELETE /admin/catalog-products/:id`

As migrations são executadas automaticamente durante a inicialização no Railway e preservam categorias, serviços, produtos VPN, usuários, carteira e pedidos existentes.
