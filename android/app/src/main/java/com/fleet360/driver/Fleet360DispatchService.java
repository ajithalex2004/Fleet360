package com.fleet360.driver;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native Android Foreground Service that polls Fleet360 Dispatch assignments
 * and Port Operations messages in the background every 5 seconds.
 *
 * Ensures the driver receives immediate WhatsApp/SMS-style heads-up notifications
 * with sound and vibration even when the Fleet360 Driver app is minimized,
 * the screen is locked, Google Maps is in the foreground, or the app is swiped closed.
 */
public class Fleet360DispatchService extends Service {
    public static final String PREFS_NAME = "fleet360_driver_prefs";
    public static final String KEY_SESSION_TOKEN = "session_token";
    public static final String KEY_API_HOST = "api_host";
    public static final String KEY_DRIVER_NAME = "driver_name";
    public static final String KEY_NOTIFIED_JOBS = "notified_job_keys";
    public static final String KEY_NOTIFIED_MSGS = "notified_msg_ids";
    public static final String KEY_INITIAL_MSG_SYNC = "initial_msg_sync_done";
    public static final String KEY_INITIAL_JOB_SYNC = "initial_job_sync_done";

    public static final String DEFAULT_API_HOST = "https://fleet360-app-production.up.railway.app";
    public static final String ALERT_CHANNEL_ID = "fleet360_dispatch_alerts_v2";
    public static final String ALERT_CHANNEL_NAME = "Fleet360 Job Assignments & Dispatch Alerts";
    private static final String BG_CHANNEL_ID = "fleet360_bg_service_v1";
    private static final String BG_CHANNEL_NAME = "Fleet360 Live Dispatch Connection";
    private static final int BG_NOTIFICATION_ID = 3601;

    private static final Set<String> HISTORY_STATUSES = new HashSet<>(Arrays.asList(
        "TRAILER_DETACHED",
        "CONTAINER_DETACHED",
        "REASSIGN_TRAILER_DETACHED",
        "READY_FOR_PICKUP",
        "CONTAINER_DROPPED",
        "COMPLETED",
        "EMPTY_DEPOSITED",
        "DELIVERED",
        "CANCELLED",
        "FCL_REASSIGN",
        "MT_REASSIGN",
        "MT_REASSIGN TO YARD",
        "FCL_REASSIGN TO YARD",
        "FCL_REASSIGN TO RAMP",
        "MT_REASSIGN TO RAMP",
        "MT_REASSIGN_TO_YARD",
        "FCL_REASSIGN_TO_YARD",
        "FCL_REASSIGN_TO_RAMP",
        "MT_REASSIGN_TO_RAMP"
    ));

    private static final Set<String> ASSIGNMENT_STATUSES = new HashSet<>(Arrays.asList(
        "ASSIGNED",
        "PENDING",
        "UNASSIGNED",
        "RE-ASSIGNED"
    ));

    private static volatile Location latestLocation = null;

    private ScheduledExecutorService scheduler;
    private PowerManager.WakeLock wakeLock;
    private LocationManager locationManager;
    private boolean locationUpdatesRegistered = false;
    private long lastLocationPingEpochMs = 0L;

    private final LocationListener nativeLocationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            if (location != null && (location.getLatitude() != 0.0 || location.getLongitude() != 0.0)) {
                latestLocation = location;
                if (lastLocationPingEpochMs == 0L && scheduler != null && !scheduler.isShutdown()) {
                    scheduler.execute(Fleet360DispatchService.this::pollAssignmentsAndMessages);
                }
            }
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {}

        @Override
        public void onProviderEnabled(String provider) {}

        @Override
        public void onProviderDisabled(String provider) {}
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        acquireWakeLock();
        startNativeLocationUpdates();
        startBackgroundPoller();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createNotificationChannels();
        startNativeLocationUpdates();
        try {
            Notification ongoing = buildOngoingForegroundNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int fgType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                if (hasLocationPermission(this)) {
                    fgType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
                }
                try {
                    startForeground(BG_NOTIFICATION_ID, ongoing, fgType);
                } catch (Exception secEx) {
                    startForeground(
                        BG_NOTIFICATION_ID,
                        ongoing,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                    );
                }
            } else {
                startForeground(BG_NOTIFICATION_ID, ongoing);
            }
        } catch (Exception ignored) {
            try {
                startForeground(BG_NOTIFICATION_ID, buildOngoingForegroundNotification());
            } catch (Exception ignoredFallback) {
            }
        }

        if (scheduler == null || scheduler.isShutdown()) {
            startBackgroundPoller();
        } else {
            scheduler.execute(this::pollAssignmentsAndMessages);
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // If driver is still logged in, keep the background dispatch service alive
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(KEY_SESSION_TOKEN, null);
        if (token != null && !token.trim().isEmpty()) {
            try {
                Intent restartIntent = new Intent(getApplicationContext(), Fleet360DispatchService.class);
                restartIntent.setPackage(getPackageName());
                int flags = PendingIntent.FLAG_ONE_SHOT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent restartPi = PendingIntent.getService(
                    getApplicationContext(),
                    3602,
                    restartIntent,
                    flags
                );
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    am.set(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 2000L,
                        restartPi
                    );
                }
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onDestroy() {
        stopNativeLocationUpdates();
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
        releaseWakeLock();
        super.onDestroy();
    }

    private static boolean hasLocationPermission(Context context) {
        if (context == null) return false;
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void startNativeLocationUpdates() {
        if (!hasLocationPermission(this)) {
            return;
        }
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (locationManager == null) {
                    locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                }
                if (locationManager == null) return;

                Location best = getBestAvailableLocation(Fleet360DispatchService.this);
                if (best != null) {
                    latestLocation = best;
                }

                if (!locationUpdatesRegistered) {
                    try {
                        if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                            locationManager.requestLocationUpdates(
                                LocationManager.GPS_PROVIDER,
                                15000L,
                                10.0f,
                                nativeLocationListener,
                                Looper.getMainLooper()
                            );
                            locationUpdatesRegistered = true;
                        }
                    } catch (Exception ignoredGps) {}

                    try {
                        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                            locationManager.requestLocationUpdates(
                                LocationManager.NETWORK_PROVIDER,
                                20000L,
                                15.0f,
                                nativeLocationListener,
                                Looper.getMainLooper()
                            );
                            locationUpdatesRegistered = true;
                        }
                    } catch (Exception ignoredNet) {}
                }
            } catch (Exception ignored) {
            }
        });
    }

    private void stopNativeLocationUpdates() {
        try {
            if (locationManager != null && locationUpdatesRegistered) {
                locationManager.removeUpdates(nativeLocationListener);
                locationUpdatesRegistered = false;
            }
        } catch (Exception ignored) {
        }
    }

    public static Location getBestAvailableLocation(Context context) {
        Location candidate = latestLocation;
        if (context == null || !hasLocationPermission(context)) {
            return candidate;
        }
        try {
            LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return candidate;
            String[] providers = new String[]{
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            };
            for (String p : providers) {
                try {
                    Location loc = lm.getLastKnownLocation(p);
                    if (loc == null || (loc.getLatitude() == 0.0 && loc.getLongitude() == 0.0)) {
                        continue;
                    }
                    if (candidate == null || loc.getTime() > candidate.getTime()) {
                        candidate = loc;
                    }
                } catch (Exception ignoredProvider) {}
            }
            if (candidate != null) {
                latestLocation = candidate;
            }
        } catch (Exception ignored) {
        }
        return candidate;
    }

    public static String getLatestLocationJson(Context context) {
        try {
            Location loc = getBestAvailableLocation(context);
            if (loc == null) return "";
            JSONObject obj = new JSONObject();
            obj.put("lat", loc.getLatitude());
            obj.put("lng", loc.getLongitude());
            if (loc.hasSpeed() && loc.getSpeed() >= 0) {
                obj.put("speedKmh", Math.round(loc.getSpeed() * 3.6f));
            }
            if (loc.hasBearing()) {
                obj.put("heading", Math.round(loc.getBearing()));
            }
            obj.put("updatedAt", loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis());
            return obj.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Fleet360::DispatchBackgroundWakeLock"
                );
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    private void startBackgroundPoller() {
        if (scheduler != null && !scheduler.isShutdown()) {
            return;
        }
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(
            this::pollAssignmentsAndMessages,
            1L,
            5L,
            TimeUnit.SECONDS
        );
    }

    private void pollAssignmentsAndMessages() {
        HttpURLConnection conn = null;
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String token = prefs.getString(KEY_SESSION_TOKEN, null);
            if (token == null || token.trim().isEmpty()) {
                return;
            }

            String apiHost = prefs.getString(KEY_API_HOST, DEFAULT_API_HOST);
            if (apiHost == null || apiHost.trim().isEmpty()) {
                apiHost = DEFAULT_API_HOST;
            }
            apiHost = apiHost.trim().replaceAll("/+$", "");

            URL url = new URL(apiHost + "/api/driver-app/today/assignments");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setUseCaches(false);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Cache-Control", "no-cache");
            conn.setRequestProperty("Authorization", "Bearer " + token.trim());

            int code = conn.getResponseCode();
            if (code != 200) {
                return;
            }

            InputStream in = conn.getInputStream();
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
            }

            JSONObject data = new JSONObject(sb.toString());
            JSONArray jobs = data.optJSONArray("drayageJobs");
            JSONArray broadcasts = data.optJSONArray("broadcastMessages");

            processJobsAndMessages(prefs, jobs, broadcasts);
            transmitNativeLocationPingsIfDue(prefs, apiHost, token.trim(), jobs);
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /**
     * Transmits immediate on-login + 1-minute (60,000 ms) native background GPS breadcrumb pings
     * for the logged-in driver and any active/assigned jobs (ASSIGNED -> COMPLETED), even when
     * no job is assigned yet (via DRIVER_TELEMETRY), when the driver is in Google Maps, or when
     * the device screen is locked.
     */
    private void transmitNativeLocationPingsIfDue(
        SharedPreferences prefs,
        String apiHost,
        String token,
        JSONArray jobs
    ) {
        long now = System.currentTimeMillis();
        if (lastLocationPingEpochMs > 0L && (now - lastLocationPingEpochMs < 60000L)) {
            return;
        }

        List<String> targetJobIds = new ArrayList<>();
        if (jobs != null) {
            for (int i = 0; i < jobs.length(); i++) {
                JSONObject j = jobs.optJSONObject(i);
                if (j == null) continue;
                String id = j.optString("id", "").trim();
                if (id.isEmpty()) continue;
                String st = j.optString("status", "").toUpperCase().trim();
                if (
                    st.isEmpty() ||
                    HISTORY_STATUSES.contains(st) ||
                    "PENDING".equals(st) ||
                    "UNASSIGNED".equals(st) ||
                    "CANCELLED".equals(st)
                ) {
                    continue;
                }
                targetJobIds.add(id);
            }
        }

        if (targetJobIds.isEmpty()) {
            targetJobIds.add("DRIVER_TELEMETRY");
        }

        Location loc = getBestAvailableLocation(this);
        if (loc == null || (loc.getLatitude() == 0.0 && loc.getLongitude() == 0.0)) {
            startNativeLocationUpdates();
            return;
        }

        lastLocationPingEpochMs = now;
        String driverName = prefs.getString(KEY_DRIVER_NAME, "Assigned Driver");

        for (String jobId : targetJobIds) {
            HttpURLConnection pingConn = null;
            try {
                URL pingUrl = new URL(apiHost + "/api/driver/jobs/" + jobId + "/status");
                pingConn = (HttpURLConnection) pingUrl.openConnection();
                pingConn.setRequestMethod("POST");
                pingConn.setConnectTimeout(8000);
                pingConn.setReadTimeout(8000);
                pingConn.setDoOutput(true);
                pingConn.setUseCaches(false);
                pingConn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                pingConn.setRequestProperty("Accept", "application/json");
                pingConn.setRequestProperty("Authorization", "Bearer " + token);

                JSONObject payload = new JSONObject();
                payload.put("action", "LOCATION_PING");
                payload.put("latitude", loc.getLatitude());
                payload.put("longitude", loc.getLongitude());
                if (loc.hasSpeed() && loc.getSpeed() >= 0) {
                    payload.put("speedKmh", Math.round(loc.getSpeed() * 3.6f));
                }
                if (loc.hasBearing()) {
                    payload.put("heading", Math.round(loc.getBearing()));
                }
                if (driverName != null && !driverName.trim().isEmpty()) {
                    payload.put("driverName", driverName.trim());
                }

                byte[] bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = pingConn.getOutputStream()) {
                    os.write(bodyBytes);
                    os.flush();
                }
                pingConn.getResponseCode();
            } catch (Exception ignoredPing) {
            } finally {
                if (pingConn != null) {
                    try {
                        pingConn.disconnect();
                    } catch (Exception ignoredDisc) {}
                }
            }
        }
    }

    private synchronized void processJobsAndMessages(
        SharedPreferences prefs,
        JSONArray jobs,
        JSONArray broadcasts
    ) {
        Set<String> notifiedJobs = new HashSet<>(
            prefs.getStringSet(KEY_NOTIFIED_JOBS, new HashSet<>())
        );
        Set<String> notifiedMsgs = new HashSet<>(
            prefs.getStringSet(KEY_NOTIFIED_MSGS, new HashSet<>())
        );
        boolean initialJobSyncDone = prefs.getBoolean(KEY_INITIAL_JOB_SYNC, false);
        boolean initialMsgSyncDone = prefs.getBoolean(KEY_INITIAL_MSG_SYNC, false);

        boolean jobsChanged = false;
        boolean msgsChanged = false;

        // 1. Check Drayage Job Assignments & Re-assignments
        if (jobs != null) {
            boolean hasActiveUncompletedL2 = false;
            for (int i = 0; i < jobs.length(); i++) {
                JSONObject item = jobs.optJSONObject(i);
                if (item == null) continue;
                String itemStatus = item.optString("status", "ASSIGNED").toUpperCase();
                if (HISTORY_STATUSES.contains(itemStatus)) continue;
                String itemPhase = item.optString("jobPhase", "");
                String itemCode = item.optString("jobCode", "");
                if ("L2".equalsIgnoreCase(itemPhase) || itemCode.contains("-L2")) {
                    hasActiveUncompletedL2 = true;
                    break;
                }
            }

            for (int i = 0; i < jobs.length(); i++) {
                JSONObject j = jobs.optJSONObject(i);
                if (j == null) continue;

                String id = j.optString("id", "");
                if (id.isEmpty()) continue;

                String status = j.optString("status", "ASSIGNED").toUpperCase();
                if (HISTORY_STATUSES.contains(status)) {
                    continue;
                }

                String jobCode = j.optString("jobCode", "Job");
                String jobPhase = j.optString("jobPhase", "");
                boolean isL2 = "L2".equalsIgnoreCase(jobPhase) || jobCode.contains("-L2");
                boolean isReassigned = "RE-ASSIGNED".equals(status);
                boolean isReassignWorkflow =
                    isReassigned ||
                    "TRAILER_ATTACHED".equals(status) ||
                    "REASSIGN_PLACED_AT_RAMP".equals(status) ||
                    "REASSIGN_PLACED_AT_YARD".equals(status);

                // Keep queued L1 job INACTIVE (and suppress notification) while an L2 job is still active
                if (!isL2 && !isReassignWorkflow && hasActiveUncompletedL2) {
                    continue;
                }

                String vehiclePlate = j.optString("assignedVehiclePlate", "");
                String trailerPlate = j.optString("assignedTrailerPlate", "");
                String assignPhase = isReassigned ? "REASSIGN" : "ASSIGN";
                String assignKey = id + ":" + assignPhase + ":" + vehiclePlate + ":" + trailerPlate;
                String legacyAssignKey = id + ":" + status + ":" + vehiclePlate + ":" + trailerPlate;

                if (notifiedJobs.contains(legacyAssignKey) && !notifiedJobs.contains(assignKey)) {
                    notifiedJobs.add(assignKey);
                    jobsChanged = true;
                    continue;
                }

                if (!notifiedJobs.contains(assignKey)) {
                    notifiedJobs.add(assignKey);
                    jobsChanged = true;

                    // ONLY push notification on initial assignment or re-assignment statuses,
                    // NEVER on intermediate status updates (ACCEPTED, CONTAINER_PICKED, EN_ROUTE_TERMINAL, etc.)
                    if (ASSIGNMENT_STATUSES.contains(status)) {
                        String containerNumber = j.optString("containerNumber", "Container");
                        String containerSize = j.optString("containerSize", "40HC");
                        String terminalName = j.optString("terminalName", "Port Terminal");
                        String warehouseName = j.optString("warehouseName", "Customer Warehouse");

                        String pickupName;
                        String dropoffName;
                        if (isReassigned) {
                            String placementLoc = j.optString("placementLocation", "").toUpperCase();
                            if ("RAMP".equals(placementLoc)) {
                                pickupName = (warehouseName.isEmpty() ? "Client Warehouse" : warehouseName) + " (Ramp)";
                                dropoffName = (warehouseName.isEmpty() ? "Client Yard" : warehouseName) + " (Yard)";
                            } else {
                                pickupName = (warehouseName.isEmpty() ? "Client Yard" : warehouseName) + " (Yard)";
                                dropoffName = (warehouseName.isEmpty() ? "Client Warehouse" : warehouseName) + " (Ramp)";
                            }
                        } else if (isL2) {
                            pickupName = warehouseName.isEmpty() ? "Customer Warehouse" : warehouseName;
                            dropoffName = terminalName.isEmpty() ? "Port Terminal" : terminalName;
                        } else {
                            pickupName = terminalName.isEmpty() ? "Port Terminal" : terminalName;
                            dropoffName = warehouseName.isEmpty() ? "Customer Warehouse" : warehouseName;
                        }

                        String title = isReassigned
                            ? "🔄 Job Re-Assigned: " + jobCode
                            : "🚛 New Job Assigned: " + jobCode;
                        String trailerLabel = trailerPlate.isEmpty() ? "Assigned" : trailerPlate;
                        String body = "Container " + containerNumber + " (" + containerSize + ") · Trailer: "
                            + trailerLabel + " · " + pickupName + " → " + dropoffName;

                        int notifId = computeNotificationId("job-assign-" + id + "-" + assignPhase);
                        postAlertNotification(title, body, notifId);
                    }
                }
            }
        }

        // 2. Check Dispatcher Broadcasts & Per-Job Messages
        String latestNewMsgTitle = null;
        String latestNewMsgBody = null;
        String latestNewMsgId = null;

        if (broadcasts != null) {
            for (int i = 0; i < broadcasts.length(); i++) {
                JSONObject b = broadcasts.optJSONObject(i);
                if (b == null) continue;
                String senderRole = b.optString("senderRole", "").toUpperCase();
                if ("DRIVER".equals(senderRole)) continue;

                String msgId = b.optString("id", "");
                String msgText = b.optString("message", "");
                if (msgId.isEmpty() || msgText.isEmpty()) continue;

                if (!notifiedMsgs.contains(msgId)) {
                    notifiedMsgs.add(msgId);
                    msgsChanged = true;
                    if (initialMsgSyncDone) {
                        latestNewMsgTitle = "📢 Port Operations Broadcast";
                        latestNewMsgBody = msgText;
                        latestNewMsgId = msgId;
                    }
                }
            }
        }

        if (jobs != null) {
            for (int i = 0; i < jobs.length(); i++) {
                JSONObject j = jobs.optJSONObject(i);
                if (j == null) continue;
                String jobCode = j.optString("jobCode", "Dispatcher");
                JSONArray messages = j.optJSONArray("messages");
                if (messages == null) continue;

                for (int m = 0; m < messages.length(); m++) {
                    JSONObject msg = messages.optJSONObject(m);
                    if (msg == null) continue;
                    String senderRole = msg.optString("senderRole", "").toUpperCase();
                    boolean isBroadcast = msg.optBoolean("isBroadcast", false);
                    if ("DRIVER".equals(senderRole) || isBroadcast) continue;

                    String msgId = msg.optString("id", "");
                    String msgText = msg.optString("message", "");
                    if (msgId.isEmpty() || msgText.isEmpty()) continue;

                    if (!notifiedMsgs.contains(msgId)) {
                        notifiedMsgs.add(msgId);
                        msgsChanged = true;
                        if (initialMsgSyncDone) {
                            latestNewMsgTitle = "💬 Dispatcher (" + jobCode + ")";
                            latestNewMsgBody = msgText;
                            latestNewMsgId = msgId;
                        }
                    }
                }
            }
        }

        SharedPreferences.Editor editor = prefs.edit();
        if (!initialJobSyncDone) {
            editor.putBoolean(KEY_INITIAL_JOB_SYNC, true);
        }
        if (!initialMsgSyncDone) {
            editor.putBoolean(KEY_INITIAL_MSG_SYNC, true);
        }
        if (jobsChanged) {
            editor.putStringSet(KEY_NOTIFIED_JOBS, notifiedJobs);
        }
        if (msgsChanged) {
            editor.putStringSet(KEY_NOTIFIED_MSGS, notifiedMsgs);
        }
        editor.apply();

        if (latestNewMsgTitle != null && latestNewMsgBody != null && latestNewMsgId != null) {
            int notifId = computeNotificationId("msg-" + latestNewMsgId);
            postAlertNotification(latestNewMsgTitle, latestNewMsgBody, notifId);
        }
    }

    public static int computeNotificationId(String tagKey) {
        int hash = 0;
        for (int i = 0; i < tagKey.length(); i++) {
            hash = (hash * 31 + tagKey.charAt(i));
        }
        return Math.abs(hash % 900000) + 10000;
    }

    private void postAlertNotification(String title, String body, int notificationId) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(this, notificationId, intent, flags);

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
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

    private Notification buildOngoingForegroundNotification() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, BG_NOTIFICATION_ID, intent, flags);

        return new NotificationCompat.Builder(this, BG_CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Fleet360 Dispatch Connected")
            .setContentText("Listening for new container job assignments & dispatcher alerts")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pendingIntent)
            .build();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel bgChannel = new NotificationChannel(
                BG_CHANNEL_ID,
                BG_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            );
            bgChannel.setDescription("Keeps Fleet360 Driver connected to Port Operations for instant background job alerts");
            bgChannel.setShowBadge(false);
            nm.createNotificationChannel(bgChannel);

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

            NotificationChannel alertChannel = new NotificationChannel(
                ALERT_CHANNEL_ID,
                ALERT_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Immediate alerts when a new container job is assigned or Port Operations sends a message");
            alertChannel.enableLights(true);
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 350, 150, 350});
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (soundUri != null) {
                alertChannel.setSound(soundUri, audioAttrs);
            }
            nm.createNotificationChannel(alertChannel);
        }
    }
}
