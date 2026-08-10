# Tw Store — VPN integrado às categorias existentes

Esta atualização mantém **uma única área de categorias** no painel administrativo.

## Como cadastrar

Na seção já existente **Categorias**, crie ou use qualquer categoria (por exemplo: Internet, VPN, Premium).
Depois, em **Adicionar produto**, escolha:

- `Serviço SMM / redes sociais` para o comportamento antigo; ou
- `Acesso VPN automático` para criar um produto VPN.

No modo VPN o mesmo formulário permite definir:

- Nome do produto;
- Descrição;
- Categoria existente;
- Preço fixo em BRL;
- Validade em dias (padrão 30);
- Limite de conexões (padrão 1);
- Protocolo SSH, V2Ray ou XRay.

Os produtos VPN aparecem junto da lista **Produtos cadastrados**, com um selo `VPN`, e não em uma aba/categoria administrativa separada.

## API Jardel Net

Configure no Railway, sem colocar a credencial no APK ou no GitHub:

```env
JARDEL_API_URL=https://jardelnet.vpnconfig.xyz
JARDEL_API_ACCOUNT=SEU_TOKEN_PRIVADO
JARDEL_API_CREATE_PATH=/api/usuario/criar.php
```

A criação envia `login`, `senha`, `dias`, `limite`, `nome` e `tipo` com autenticação Bearer.

## Segurança e carteira

- A chave da API permanece apenas no backend.
- O valor é debitado da carteira antes da criação.
- Se a API VPN falhar, o backend faz estorno automático.
- A senha do acesso VPN é armazenada criptografada no PostgreSQL.

## Banco de dados

A migration adiciona `category_id` em `vpn_products` e cria uma chave estrangeira para `service_categories`. Se uma categoria for removida, o produto VPN fica sem categoria em vez de ser apagado.
