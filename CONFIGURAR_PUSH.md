# Tw Store — ativar notificações de pagamento

Este pacote já está padronizado para **Tw Store** desde o início.

## Identidade Android

- Nome exibido: `Tw Store`
- `applicationId`: `com.twstore.mobile`
- `namespace`: `com.twstore.mobile`
- Projeto Gradle: `TwStore`
- Classe de push: `TwStoreFirebaseMessagingService`
- Canal: `tw_store_payments`

O endereço atual do backend continua sendo `https://tw-store-application.up.railway.app`. Isso é apenas infraestrutura do servidor e não muda a identidade do aplicativo.

## 1. Arquivos para enviar/substituir no GitHub

Mantenha os caminhos exatamente como aparecem neste pacote:

- `src/launcher.js` — substituir
- `src/config.js` — substituir (URL oficial nova)
- `src/payment-push-features.js` — adicionar
- `.github/workflows/android.yml` — substituir
- `android/build.gradle` — substituir
- `android/settings.gradle` — substituir
- `android/README.md` — substituir
- `android/app/build.gradle` — substituir
- `android/app/src/main/AndroidManifest.xml` — substituir
- `android/app/src/main/res/values/strings.xml` — substituir
- `android/app/src/main/res/values/themes.xml` — substituir
- `android/app/src/main/res/values/colors.xml` — substituir
- `android/app/src/main/java/com/twstore/mobile/MainActivity.java` — adicionar/substituir
- `android/app/src/main/java/com/twstore/mobile/PushRegistration.java` — adicionar
- `android/app/src/main/java/com/twstore/mobile/TwStoreFirebaseMessagingService.java` — adicionar

Depois de subir os novos arquivos, apague a pasta antiga:

`android/app/src/main/java/com/hypeequipe/`

Ela não faz mais parte do aplicativo Tw Store.

## 2. Firebase

No Firebase Console:

1. Crie um projeto chamado, por exemplo, `Tw Store`.
2. Adicione um aplicativo Android.
3. Use exatamente o package name: `com.twstore.mobile`.
4. Baixe o `google-services.json`.
5. Coloque o arquivo no GitHub em `android/app/google-services.json`.

Não cadastre `com.hypeequipe.mobile`; o identificador oficial novo é `com.twstore.mobile`.

## 3. Railway

Domínio oficial configurado neste pacote:

`https://tw-store-application.up.railway.app`

No Railway, defina também `PUBLIC_BASE_URL=https://tw-store-application.up.railway.app` se essa variável já existir ou se quiser fixá-la explicitamente.


No Firebase Console, em Configurações do projeto > Contas de serviço, gere uma chave privada.

No Railway, no serviço que já hospeda o backend, crie:

`FIREBASE_SERVICE_ACCOUNT_JSON`

Cole como valor o conteúdo completo do JSON da conta de serviço.

Nunca envie essa chave privada ao GitHub.

## 4. APK

Ao enviar as alterações, o workflow `Tw Store Android APK` gera um artefato chamado:

`Tw-Store-APK`

Instale esse APK. Como o `applicationId` agora é `com.twstore.mobile`, o Android o considera um aplicativo diferente do APK antigo `com.hypeequipe.mobile`.

## 5. Registro das notificações

Abra o Tw Store e entre pelo acesso administrativo. O aplicativo obtém o token FCM e registra o celular no endpoint protegido:

`POST /admin/push/register`

Somente uma sessão administrativa válida pode registrar um aparelho para receber os avisos.

## 6. Resultado

Quando um depósito do Mercado Pago for aprovado e creditado pela primeira vez:

**Tw Store • Pagamento recebido**

`💰 R$ 52,50 recebido e aprovado.`

Se o Firebase falhar, o pagamento continua sendo creditado normalmente. Reenvios do mesmo webhook não criam um novo alerta quando o depósito já estava creditado.
