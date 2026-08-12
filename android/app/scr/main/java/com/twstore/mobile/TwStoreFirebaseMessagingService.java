package com.twstore.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public final class TwStoreFirebaseMessagingService extends FirebaseMessagingService {
    public static final String PAYMENT_CHANNEL_ID = "tw_store_payments";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        PushRegistration.saveFcmToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        RemoteMessage.Notification remoteNotification = remoteMessage.getNotification();
        Map<String, String> data = remoteMessage.getData();
        String title = remoteNotification != null && remoteNotification.getTitle() != null
                ? remoteNotification.getTitle()
                : data.getOrDefault("title", "Tw Store • Pagamento recebido");
        String body = remoteNotification != null && remoteNotification.getBody() != null
                ? remoteNotification.getBody()
                : data.getOrDefault("body", "Um novo pagamento foi aprovado.");

        showNotification(title, body);
    }

    static void ensurePaymentChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                PAYMENT_CHANNEL_ID,
                "Pagamentos recebidos",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Avisos de pagamentos aprovados pelo Mercado Pago");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    private void showNotification(String title, String body) {
        ensurePaymentChannel(this);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                1001,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, PAYMENT_CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE)
                .setPriority(Notification.PRIORITY_HIGH);

        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }
}
