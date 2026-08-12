package com.twstore.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 2001;
    private static final long SESSION_POLL_MS = 4_000L;

    private WebView webView;
    private String allowedHost;
    private final Handler sessionPollHandler = new Handler(Looper.getMainLooper());
    private boolean sessionPollRunning;

    private final Runnable sessionPoll = new Runnable() {
        @Override
        public void run() {
            if (!sessionPollRunning || webView == null) return;
            webView.evaluateJavascript(
                    "(function(){try{var raw=localStorage.getItem('tw-store.session.v3');" +
                            "var s=raw?JSON.parse(raw):null;" +
                            "if(s&&String(s.role).toLowerCase()==='admin'&&s.token&&window.TwStoreNative){" +
                            "window.TwStoreNative.registerAdminPush(String(s.token));}}catch(e){}})();",
                    null
            );
            sessionPollHandler.postDelayed(this, SESSION_POLL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(7, 20, 27));
        getWindow().setNavigationBarColor(Color.rgb(7, 20, 27));
        getWindow().getDecorView().setSystemUiVisibility(0);

        TwStoreFirebaseMessagingService.ensurePaymentChannel(this);
        requestNotificationPermission();
        setupFirebaseToken();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 20, 27));
        webView.addJavascriptInterface(new NativeBridge(), "TwStoreNative");
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        String serverUrl = BuildConfig.TW_STORE_SERVER_URL == null ? "" : BuildConfig.TW_STORE_SERVER_URL.trim();
        if (serverUrl.startsWith("https://")) {
            allowedHost = Uri.parse(serverUrl).getHost();
        }

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme()) || ("https".equals(uri.getScheme()) && uri.getHost() != null && uri.getHost().equals(allowedHost))) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // O sistema não encontrou um aplicativo compatível para o link.
                }
                return true;
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else if (!serverUrl.isEmpty()) {
            webView.loadUrl(serverUrl);
        } else {
            webView.loadUrl("file:///android_asset/index.html");
        }
    }

    private void setupFirebaseToken() {
        try {
            FirebaseApp firebaseApp = FirebaseApp.initializeApp(this);
            if (firebaseApp == null) return;
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    PushRegistration.saveFcmToken(MainActivity.this, task.getResult());
                }
            });
        } catch (Exception ignored) {
            // Sem google-services.json o aplicativo continua funcionando, apenas sem push.
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void registerAdminPush(String adminSessionToken) {
            PushRegistration.saveAdminSession(MainActivity.this, adminSessionToken);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!sessionPollRunning) {
            sessionPollRunning = true;
            sessionPollHandler.postDelayed(sessionPoll, 1_000L);
        }
        PushRegistration.maybeRegister(this);
    }

    @Override
    protected void onPause() {
        sessionPollRunning = false;
        sessionPollHandler.removeCallbacks(sessionPoll);
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        sessionPollRunning = false;
        sessionPollHandler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.removeJavascriptInterface("TwStoreNative");
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
