# Tw Store 2.5.1 — correção do congelamento no painel Admin

Correção aplicada em `public/admin-layout-v1.js`.

O `MutationObserver` da navegação administrativa reagia à própria inserção da barra inferior. Nas telas especiais (Relatórios, Suporte e Ajustes), isso fazia `appendNav()` remover e inserir a mesma navegação repetidamente, gerando um loop de mutações e congelando o WebView.

A navegação agora:
- identifica a aba ativa em `data-admin-active`;
- não recria a barra quando ela já está correta;
- protege alterações internas com a flag `applying`;
- mantém Início, Catálogo, Relatórios, Suporte e Ajustes.

Nenhuma regra de pedidos, carteira, VPN, SMM ou tickets foi removida.
