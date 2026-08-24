# Tw Store 2.6.0 — correções de congelamento e carregamento

Correções aplicadas no servidor e em todos os módulos do frontend.

O `MutationObserver` da navegação administrativa reagia à própria inserção da barra inferior. Nas telas especiais (Relatórios, Suporte e Ajustes), isso fazia `appendNav()` remover e inserir a mesma navegação repetidamente, gerando um loop de mutações e congelando o WebView.

A versão 2.6 mantém essa proteção e também:
- identifica a aba ativa em `data-admin-active`;
- não recria a barra quando ela já está correta;
- protege alterações internas com a flag `applying`;
- agrupa os `MutationObserver` em uma execução por quadro;
- observa somente a área do aplicativo, e não a página inteira;
- elimina o recarregamento automático que podia entrar em ciclo no catálogo;
- usa a origem atual do Railway em todas as chamadas;
- executa consultas independentes em paralelo;
- encerra chamadas sem resposta após 15 segundos e mostra **Tentar novamente** sem apagar a sessão;
- impede o cache de HTML, JavaScript e CSS antigos depois do deploy;
- inicia `src/server.js` diretamente, sem gerar um servidor temporário em runtime;
- mantém Início, Catálogo, Relatórios, Suporte e Ajustes.

Nenhuma regra de pedidos, carteira, VPN, SMM ou tickets foi removida.
