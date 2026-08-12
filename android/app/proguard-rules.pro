# Mantém a ponte JavaScript usada pela WebView do Tw Store.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Mantém as classes nativas do aplicativo e o serviço de push.
-keep class com.twstore.mobile.** { *; }
