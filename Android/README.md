# Tw Store — Aplicativo Android

Aplicativo Android oficial da Tw Store.

- Nome visível: `Tw Store`
- applicationId / namespace: `com.twstore.mobile`
- Servidor de produção atual: `https://tw-store-application.up.railway.app`

## Compilação

1. Abra a pasta `android` no Android Studio.
2. Use JDK 17 e Android SDK 35.
3. Se quiser sobrescrever a URL do servidor, use no arquivo `android/local.properties`:

```properties
TW_STORE_SERVER_URL=https://seu-dominio.up.railway.app
```

4. Gere o APK normalmente.

Como o identificador agora é `com.twstore.mobile`, esta versão é tratada pelo Android como o aplicativo Tw Store desde o início. Cadastre exatamente esse package name no Firebase.
