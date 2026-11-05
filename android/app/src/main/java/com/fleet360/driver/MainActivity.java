package com.fleet360.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

/**
 * MainActivity for the Fleet360 Driver app.
 *
 * Includes:
 * 1. Full HTTP disk cache wipe on cold start so WebView always loads fresh assets.
 * 2. High-importance Android NotificationChannel ("fleet360_dispatch_alerts_v2")
 *    + runtime POST_NOTIFICATIONS permission grant for Android 13+ (API 33+).
 * 3. Native @JavascriptInterface ("Fleet360Android") + automatic WebView localStorage
 *    session sync into SharedPreferences to power Fleet360DispatchService
 *    24/7 in the background (even when minimized, locked, or swiped closed).
 */
public class MainActivity extends BridgeActivity {
    private static final String CHANNEL_ID = Fleet360DispatchService.ALERT_CHANNEL_ID;
    private static final String CHANNEL_NAME = Fleet360DispatchService.ALERT_CHANNEL_NAME;
    private static final int REQ_POST_NOTIFICATIONS = 4360;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createDispatchNotificationChannel();
        requestNotificationPermissionIfNeeded();
        startDispatchServiceIfAuthenticated();

        Bridge b = getBridge();
        if (b == null) {
            return;
        }
        WebView webView = b.getWebView();
        if (webView == null) {
            return;
        }
        webView.clearCache(true);
        webView.clearHistory();
        webView.clearFormData();
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new Fleet360NotificationBridge(this), "Fleet360Android");
    }

    @Override
    public void onResume() {
        super.onResume();
        syncWebViewTokenToNativeService();
    }

    @Override
    public void onPause() {
        syncWebViewTokenToNativeService();
        super.onPause();
        // Keep WebView JS timers running when the driver switches to Google Maps
        // or locks the screen so new job assignment notifications fire immediately.
        Bridge b = getBridge();
        if (b != null && b.getWebView() != null) {
            b.getWebView().onResume();
            b.getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Prevent Capacitor's BridgeActivity.onStop() from freezing WebView network/timers
        // when the app is minimized to the background.
        Bridge b = getBridge();
        if (b != null && b.getWebView() != null) {
            b.getWebView().onResume();
            b.getWebView().resumeTimers();
        }
        startDispatchServiceIfAuthenticated();
    }

    private void syncWebViewTokenToNativeService() {
        try {
            Bridge b = getBridge();
            if (b == null || b.getWebView() == null) return;
            String script = "(function(){"
                + "try {"
                + "  return JSON.stringify({"
                + "    token: localStorage.getItem('fleet360_session_token') || '',"
                + "    apiHost: localStorage.getItem('fleet360_api_host') || '',"
                + "    driverName: localStorage.getItem('fleet360_driver_name') || ''"
                + "  });"
                + "} catch(e) { return ''; }"
                + "})()";
            b.getWebView().evaluateJavascript(script, value -> {
                try {
                    if (value == null || value.isEmpty() || "null".equals(value) || "\"\"".equals(value)) {
                        return;
                    }
                    String unquoted = value;
                    if (unquoted.startsWith("\"") && unquoted.endsWith("\"")) {
                        unquoted = unquoted.substring(1, unquoted.length() - 1)
                            .replace("\\\"", "\"")
                            .replace("\\\\", "\\");
                    }
                    if (!unquoted.startsWith("{")) return;
                    JSONObject obj = new JSONObject(unquoted);
                    String token = obj.optString("token", "").trim();
                    String apiHost = obj.optString("apiHost", "").trim();
                    String driverName = obj.optString("driverName", "").trim();
                    if (!token.isEmpty()) {
                        saveAuthAndStartService(token, apiHost, driverName);
                    }
                } catch (Exception ignored) {
                }
            });
        } catch (Exception ignored) {
        }
    }

    private void saveAuthAndStartService(String token, String apiHost, String driverName) {
        try {
            SharedPreferences prefs = getSharedPreferences(Fleet360DispatchService.PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(Fleet360DispatchService.KEY_SESSION_TOKEN, token != null ? token.trim() : "");
            if (apiHost != null && !apiHost.trim().isEmpty()) {
                editor.putString(Fleet360DispatchService.KEY_API_HOST, apiHost.trim());
            }
            if (driverName != null && !driverName.trim().isEmpty()) {
                editor.putString(Fleet360DispatchService.KEY_DRIVER_NAME, driverName.trim());
            }
            editor.apply();

            if (token != null && !token.trim().isEmpty()) {
                startDispatchServiceIfAuthenticated();
            }
        } catch (Exception ignored) {
        }
    }

    private void startDispatchServiceIfAuthenticated() {
        try {
            SharedPreferences prefs = getSharedPreferences(Fleet360DispatchService.PREFS_NAME, Context.MODE_PRIVATE);
            String token = prefs.getString(Fleet360DispatchService.KEY_SESSION_TOKEN, null);
            if (token != null && !token.trim().isEmpty()) {
                Intent serviceIntent = new Intent(this, Fleet360DispatchService.class);
                ContextCompat.startForegroundService(this, serviceIntent);
            }
        } catch (Exception ignored) {
        }
    }

    private void createDispatchNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Immediate alerts when a new container job is assigned or Port Operations sends a message");
            channel.enableLights(true);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 350, 150, 350});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (soundUri != null) {
                channel.setSound(soundUri, audioAttrs);
            }
            nm.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        List<String> permsToRequest = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                permsToRequest.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            permsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            permsToRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (!permsToRequest.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permsToRequest.toArray(new String[0]),
                REQ_POST_NOTIFICATIONS
            );
        }
    }

    public class Fleet360NotificationBridge {
        private final Context context;

        public Fleet360NotificationBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void syncAuthSession(String token, String apiHost, String driverName) {
            saveAuthAndStartService(token, apiHost, driverName);
        }

        @JavascriptInterface
        public void stopBackgroundService() {
            try {
                SharedPreferences prefs = context.getSharedPreferences(
                    Fleet360DispatchService.PREFS_NAME,
                    Context.MODE_PRIVATE
                );
                prefs.edit()
                    .remove(Fleet360DispatchService.KEY_SESSION_TOKEN)
                    .putBoolean(Fleet360DispatchService.KEY_INITIAL_JOB_SYNC, false)
                    .putBoolean(Fleet360DispatchService.KEY_INITIAL_MSG_SYNC, false)
                    .apply();
                Intent serviceIntent = new Intent(context, Fleet360DispatchService.class);
                context.stopService(serviceIntent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean isJobKeyNotified(String jobKey) {
            if (jobKey == null || jobKey.isEmpty()) return false;
            try {
                SharedPreferences prefs = context.getSharedPreferences(
                    Fleet360DispatchService.PREFS_NAME,
                    Context.MODE_PRIVATE
                );
                Set<String> set = prefs.getStringSet(Fleet360DispatchService.KEY_NOTIFIED_JOBS, new HashSet<>());
                return set != null && set.contains(jobKey);
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public void markJobKeyNotified(String jobKey) {
            if (jobKey == null || jobKey.isEmpty()) return;
            try {
                SharedPreferences prefs = context.getSharedPreferences(
                    Fleet360DispatchService.PREFS_NAME,
                    Context.MODE_PRIVATE
                );
                Set<String> copy = new HashSet<>(
                    prefs.getStringSet(Fleet360DispatchService.KEY_NOTIFIED_JOBS, new HashSet<>())
                );
                copy.add(jobKey);
                prefs.edit().putStringSet(Fleet360DispatchService.KEY_NOTIFIED_JOBS, copy).apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean isMsgIdNotified(String msgId) {
            if (msgId == null || msgId.isEmpty()) return false;
            try {
                SharedPreferences prefs = context.getSharedPreferences(
                    Fleet360DispatchService.PREFS_NAME,
                    Context.MODE_PRIVATE
                );
                Set<String> set = prefs.getStringSet(Fleet360DispatchService.KEY_NOTIFIED_MSGS, new HashSet<>());
                return set != null && set.contains(msgId);
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public void markMsgIdNotified(String msgId) {
            if (msgId == null || msgId.isEmpty()) return;
            try {
                SharedPreferences prefs = context.getSharedPreferences(
                    Fleet360DispatchService.PREFS_NAME,
                    Context.MODE_PRIVATE
                );
                Set<String> copy = new HashSet<>(
                    prefs.getStringSet(Fleet360DispatchService.KEY_NOTIFIED_MSGS, new HashSet<>())
                );
                copy.add(msgId);
                prefs.edit().putStringSet(Fleet360DispatchService.KEY_NOTIFIED_MSGS, copy).apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void postNotification(String title, String body, int notificationId) {
            try {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                Intent intent = new Intent(context, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pendingIntent = PendingIntent.getActivity(context, notificationId, intent, flags);

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

                NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(context.getApplicationInfo().icon)
                    .setContentTitle(title != null ? title : "Fleet360 Dispatch Alert")
                    .setContentText(body != null ? body : "New job assignment or dispatch update")
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""))
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setSound(soundUri)
                    .setVibrate(new long[]{0, 350, 150, 350})
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent);

                nm.notify(notificationId, builder.build());
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(MainActivity.this::requestNotificationPermissionIfNeeded);
        }

        @JavascriptInterface
        public String getLastKnownLocationJson() {
            return Fleet360DispatchService.getLatestLocationJson(context);
        }
    }
}
