# Hype Equipe

Projeto recuperado do APK `Hype-Equipe.apk` e preparado para GitHub, Railway e Android Studio. O repositório reúne:

- interface web/mobile original, com o endereço do servidor configurável;
- API Node.js/Express;
- banco PostgreSQL;
- usuário administrador criado na primeira inicialização;
- código compartilhado da equipe com invalidação de sessões;
- catálogo sincronizado pela API da SMMHype;
- pedidos reais com chave de idempotência, histórico, atualização, reposição e cancelamento;
- healthcheck, Dockerfile, configuração Railway e testes automatizados;
- fonte Android WebView recomposto.

## Segurança importante

As variáveis `ADMIN_PASSWORD`, `JWT_SECRET` e `SMM_API_KEY` são segredos. Defina-as somente no Railway ou em um arquivo `.env` local, que já está bloqueado pelo `.gitignore`. Nunca coloque essas informações em commits, capturas de tela ou arquivos públicos.

O administrador inicial é criado somente quando o banco ainda não possui esse usuário. A primeira senha fica armazenada no PostgreSQL como hash `scrypt`, nunca em texto puro. No primeiro acesso, o painel solicita a troca da senha.

## Rodar localmente

Requisitos: Node.js 22+, npm e PostgreSQL 15+ (ou Docker).

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm start
```

Antes de iniciar, edite o `.env` e defina pelo menos:

```dotenv
DATABASE_URL=postgresql://hype:hype_dev@localhost:5432/hype_equipe
DATABASE_SSL=false
JWT_SECRET=gere-com-npm-run-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=uma-senha-privada-com-12-ou-mais-caracteres
SMM_API_URL=https://smmhype.com/api/v2
SMM_API_KEY=sua-chave-privada
```

Gere um segredo forte com:

```bash
npm run secret
```

Acesse `http://localhost:3000`. Se `INITIAL_TEAM_CODE` ficar vazio, entre como administrador e crie o código da equipe no próprio painel.

## Implantar no Railway

1. Envie este projeto para um repositório privado no GitHub.
2. No Railway, crie um projeto a partir desse repositório.
3. Adicione um serviço PostgreSQL ao mesmo projeto.
4. No serviço do aplicativo, crie estas variáveis privadas:

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | referência à `DATABASE_URL` do PostgreSQL |
   | `DATABASE_SSL` | `false` para a conexão privada interna |
   | `JWT_SECRET` | resultado de `npm run secret` |
   | `ADMIN_USERNAME` | usuário administrativo desejado |
   | `ADMIN_PASSWORD` | senha administrativa inicial |
   | `SMM_API_URL` | URL informada na página de API da conta SMMHype |
   | `SMM_API_KEY` | chave privada da conta SMMHype |
   | `NODE_ENV` | `production` |

5. Gere um domínio público HTTPS em **Settings > Networking > Generate Domain**.
6. Confirme `https://seu-dominio.up.railway.app/health`. A resposta deve conter `"status":"ok"`.

O `railway.toml` já configura `/health`, e o servidor escuta automaticamente a variável `PORT` fornecida pelo Railway.

## Compilar o Android

Abra a pasta `android/` no Android Studio. Em `android/local.properties`, mantenha o `sdk.dir` criado pelo Android Studio e acrescente:

```properties
HYPE_SERVER_URL=https://seu-dominio.up.railway.app
```

Depois use **Build > Generate Signed App Bundle or APK**. Guarde o keystore e sua senha em local seguro: ele é indispensável para publicar futuras atualizações do mesmo aplicativo.

O APK recebido estava assinado, mas não contém a chave privada original. Sem o keystore original, o Android não aceita a nova compilação como atualização por cima da instalação antiga. Nesse caso, desinstale o APK anterior antes de instalar o novo ou altere o `applicationId`.

## Testes

```bash
npm run check
npm test
npm audit --omit=dev
```

## Rotas principais

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/health` | saúde do servidor e banco |
| `POST` | `/admin/login` | login administrativo |
| `POST` | `/admin/password` | troca segura da senha admin |
| `POST` | `/admin/team-code` | define o código da equipe |
| `GET/POST` | `/admin/services` | catálogo da operação |
| `POST` | `/auth/login` | login dos membros |
| `GET/POST` | `/api/orders` | histórico e novo pedido |
| `POST` | `/api/orders/:id/refresh` | atualização do pedido |
| `POST` | `/api/orders/:id/refill` | solicitação de reposição |
| `POST` | `/api/orders/:id/cancel` | solicitação de cancelamento |

## Observação sobre a SMMHype

O conector usa o formato padrão de API SMM (`services`, `balance`, `add`, `status`, `refill` e `cancel`). Antes de enviar um pedido real, confirme no painel da sua conta a URL da API e se cancelamento/reposição estão habilitados para o serviço escolhido. A interface mantém uma confirmação explícita antes de qualquer pedido que possa descontar saldo.
