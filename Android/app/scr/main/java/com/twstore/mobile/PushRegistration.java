package com.twstore.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class PushRegistration {
    private static final String TAG = "TwStorePush";
    private static final String PREFS = "tw_store_payment_push";
    private static final String KEY_ADMIN_TOKEN = "admin_session_token";
    private static final String KEY_FCM_TOKEN = "fcm_token";
    private static final String KEY_REGISTERED_FCM_TOKEN = "registered_fcm_token";
    private static final String KEY_REGISTERED_AT = "registered_at";
    private static final long REFRESH_INTERVAL_MS = 24L * 60L * 60L * 1000L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean IN_FLIGHT = new AtomicBoolean(false);

    private PushRegistration() {}

    static void saveAdminSession(Context context, String token) {
        String clean = token == null ? "" : token.trim();
        if (clean.isEmpty()) return;
        prefs(context).edit().putString(KEY_ADMIN_TOKEN, clean).apply();
        maybeRegister(context);
    }

    static void saveFcmToken(Context context, String token) {
        String clean = token == null ? "" : token.trim();
        if (clean.isEmpty()) return;
        prefs(context).edit().putString(KEY_FCM_TOKEN, clean).apply();
        maybeRegister(context);
    }

    static void maybeRegister(Context context) {
        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = prefs(appContext);
        String adminToken = prefs.getString(KEY_ADMIN_TOKEN, "");
        String fcmToken = prefs.getString(KEY_FCM_TOKEN, "");
        if (adminToken == null || adminToken.isEmpty() || fcmToken == null || fcmToken.isEmpty()) return;

        String registeredToken = prefs.getString(KEY_REGISTERED_FCM_TOKEN, "");
        long registeredAt = prefs.getLong(KEY_REGISTERED_AT, 0L);
        boolean fresh = fcmToken.equals(registeredToken)
                && System.currentTimeMillis() - registeredAt < REFRESH_INTERVAL_MS;
        if (fresh || !IN_FLIGHT.compareAndSet(false, true)) return;

        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                String baseUrl = BuildConfig.TW_STORE_SERVER_URL == null ? "" : BuildConfig.TW_STORE_SERVER_URL.trim();
                if (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
                URL url = new URL(baseUrl + "/admin/push/register");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Authorization", "Bearer " + adminToken);

                byte[] body = new JSONObject()
                        .put("token", fcmToken)
                        .put("platform", "android")
                        .toString()
                        .getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }

                int status = connection.getResponseCode();
                if (status >= 200 && status < 300) {
                    prefs.edit()
                            .putString(KEY_REGISTERED_FCM_TOKEN, fcmToken)
                            .putLong(KEY_REGISTERED_AT, System.currentTimeMillis())
                            .apply();
                    Log.i(TAG, "Celular registrado para notificações de pagamento.");
                } else {
                    Log.w(TAG, "Servidor recusou registro de push. HTTP " + status);
                }
            } catch (Exception error) {
                Log.w(TAG, "Não foi possível registrar o push agora.", error);
            } finally {
                if (connection != null) connection.disconnect();
                IN_FLIGHT.set(false);
            }
        });
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
