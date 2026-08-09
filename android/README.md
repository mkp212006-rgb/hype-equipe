# Aplicativo Android

Este projeto recompõe o WebView do APK recebido e mantém o mesmo `applicationId` (`com.hypeequipe.mobile`).

1. Abra esta pasta no Android Studio.
2. Use JDK 17 e instale o Android SDK 35 quando solicitado.
3. Defina a URL HTTPS antes de compilar:

   ```properties
   # arquivo android/local.properties (não enviar ao GitHub)
   HYPE_SERVER_URL=https://seu-dominio.up.railway.app
   ```

4. Gere uma chave de assinatura própria e use **Build > Generate Signed App Bundle or APK**.

O APK original não contém a chave privada usada na assinatura. Por isso, uma compilação nova só atualiza o aplicativo já instalado se você possuir o keystore original; sem ele, desinstale a versão anterior ou use outro `applicationId`.
