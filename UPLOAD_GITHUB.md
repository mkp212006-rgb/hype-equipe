# Como enviar esta versão ao GitHub

1. Extraia o ZIP.
2. Abra o repositório `mkp212006-rgb/hype-equipe` no GitHub.
3. Envie **todo o conteúdo da pasta extraída para a raiz do repositório**, preservando as pastas `src`, `public`, `test` e `android`.
4. Confirme a substituição dos arquivos existentes e faça o commit na branch `main`.
5. Aguarde o deploy automático do Railway.
6. Abra `https://tw-store-application.up.railway.app/health` e confirme que a resposta contém `"status":"ok"`.
7. Abra `https://tw-store-application.up.railway.app` em uma janela anônima e teste login, catálogo e navegação.

Não envie `.env`, senhas ou chaves para o GitHub. As credenciais devem continuar somente nas variáveis privadas do Railway.

No Railway, mantenha:

```env
PUBLIC_BASE_URL=https://tw-store-application.up.railway.app
```

O comando de início já está configurado como `npm start`, e o healthcheck como `/health`.
