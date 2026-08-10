# Atualização Tw Store — VPN automático (v2.3)

## Arquivos para enviar ao repositório

Substitua:
- `package.json`
- `src/config.js`
- `src/launcher.js`
- `public/index.html`

Adicione:
- `src/vpn-features.js`
- `public/vpn-v1.js`
- `public/vpn-v1.css`

Não é necessário apagar os arquivos atuais de SMM, carteira, Mercado Pago ou suporte.

## Variáveis no Railway

A URL já possui valor padrão para `https://jardelnet.vpnconfig.xyz`.

Crie no Railway a variável secreta:

```env
JARDEL_API_ACCOUNT=<sua-chave-da-api>
```

Opcionais:

```env
JARDEL_API_URL=https://jardelnet.vpnconfig.xyz
JARDEL_API_CREATE_PATH=/api/usuario/criar.php
JARDEL_API_TIMEOUT_MS=20000
```

**Não coloque a chave no GitHub nem dentro do APK.**

## Fluxo implementado

1. Admin entra no painel da Tw Store.
2. Surge a seção **Categoria VPN**.
3. Admin adiciona um produto (padrão sugerido: VPN 30 dias, 1 conexão, SSH).
4. O cliente vê **Acessos VPN** na tela de novo pedido.
5. Ao comprar, o backend debita o preço da carteira e gera login/senha.
6. O backend chama `POST /api/usuario/criar.php` com Bearer Token.
7. Em sucesso, as credenciais ficam disponíveis no histórico do cliente.
8. Se a API falhar, o backend estorna automaticamente o valor para a carteira.

## Endpoints adicionados

Cliente:
- `GET /api/vpn/products`
- `GET /api/vpn/orders`
- `POST /api/vpn/orders`

Admin:
- `GET /admin/vpn/status`
- `GET /admin/vpn/products`
- `POST /admin/vpn/products`
- `PATCH /admin/vpn/products/:id`
- `DELETE /admin/vpn/products/:id`
- `GET /admin/vpn/orders`

## Segurança

- A chave da API da Jardel Net fica somente no backend.
- Senhas VPN ficam criptografadas no PostgreSQL usando AES-256-GCM com chave derivada de `JWT_SECRET`.
- A senha só é retornada para o próprio cliente autenticado.
- A listagem administrativa não retorna a senha dos acessos.
- Toda compra tem idempotência e estorno automático em caso de falha no provedor.
