# Tw Store — Catálogo/Pedidos organizados — v2.5.2

## Alteração
- Novo seletor visual de Categoria e Serviço no pedido do usuário.
- O campo normal permanece compacto; ao tocar, a lista abre abaixo do campo.
- A lista de serviços mostra ID, nome, descrição, mínimo/máximo, tempo médio, recarga quando disponível e preço por 1.000.
- O seletor nativo continua por trás da interface para preservar toda a lógica existente do app.
- O bloco **Cobrar** e o botão de envio não foram alterados.
- No painel Admin > Catálogo foi adicionado um localizador organizado por busca, categoria e serviço; o botão **Editar este serviço** leva ao formulário original do produto.

## Upload
Faça upload mantendo as pastas `public/` e `src/`. Os arquivos novos desta versão são:
- `public/catalog-layout-v1.js`
- `public/catalog-layout-v1.css`

Também substitua `public/index.html` e `package.json` pelos arquivos deste pacote. Os demais arquivos do ZIP mantêm cumulativamente Relatórios e a navegação Admin corrigida.
