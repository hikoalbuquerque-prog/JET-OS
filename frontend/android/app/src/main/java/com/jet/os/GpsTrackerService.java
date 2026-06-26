package com.jet.os;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

// Foreground Service que coleta GPS nativamente e faz POST direto p/ a Cloud Function
// (ingestGps), SEM depender do JavaScript do WebView. É o que permite rastrear ao vivo
// com o app minimizado OU fechado:
//   • coleta via FusedLocationProvider e enfileira em SQLite (durável);
//   • um uploader em thread própria drena a fila, renova o ID token e faz POST;
//   • START_STICKY + config persistida + onTaskRemoved sem parar → sobrevive ao
//     fechamento do app; GpsBootReceiver reinicia após reboot.
public class GpsTrackerService extends Service {
    static final String PREFS = "jet_gps_cfg";
    private static final int NOTIF_ID = 77231;
    private static final String CHANNEL = "jet_gps_tracking";
    private static final int MAX_BATCH = 200;   // alinhado ao limite do endpoint
    private static final int MAX_QUEUE = 5000;  // teto da fila local

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private GpsQueueDb queue;
    private GpsTokenManager tokens;
    private ScheduledExecutorService uploader;
    private PowerManager.WakeLock wakeLock;

    // Config (persistida para sobreviver a restart pelo SO / boot)
    private String functionUrl, tokenUrl, provider, apiKey, refreshToken, uid, slotId, deviceId, deviceModel;
    private long intervalMs = 30000;

    @Override
    public void onCreate() {
        super.onCreate();
        queue = new GpsQueueDb(this);
        tokens = new GpsTokenManager(this);
        fused = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);

        if (intent != null && intent.hasExtra("functionUrl")) {
            // Início novo: persiste config completa
            functionUrl  = intent.getStringExtra("functionUrl");
            tokenUrl     = intent.getStringExtra("tokenUrl");
            provider     = intent.getStringExtra("provider");
            apiKey       = intent.getStringExtra("apiKey");
            refreshToken = intent.getStringExtra("refreshToken");
            uid          = intent.getStringExtra("uid");
            slotId       = intent.getStringExtra("slotId");
            deviceId     = intent.getStringExtra("deviceId");
            deviceModel  = intent.getStringExtra("deviceModel");
            intervalMs   = intent.getLongExtra("intervalMs", 30000);
            p.edit()
                    .putString("functionUrl", functionUrl).putString("tokenUrl", tokenUrl)
                    .putString("provider", provider).putString("apiKey", apiKey)
                    .putString("refreshToken", refreshToken).putString("uid", uid)
                    .putString("slotId", slotId).putLong("intervalMs", intervalMs)
                    .putString("deviceId", deviceId).putString("deviceModel", deviceModel)
                    .putBoolean("ativo", true).apply();
            // Define o refresh token base no gerenciador de token (zera cache antigo)
            tokens.seed(refreshToken);
        } else {
            // Restart pelo SO/boot OU update de slot: recarrega config persistida
            functionUrl  = p.getString("functionUrl", null);
            tokenUrl     = p.getString("tokenUrl", null);
            provider     = p.getString("provider", "firebase");
            apiKey       = p.getString("apiKey", null);
            refreshToken = p.getString("refreshToken", null);
            uid          = p.getString("uid", null);
            slotId       = p.getString("slotId", null);
            deviceId     = p.getString("deviceId", null);
            deviceModel  = p.getString("deviceModel", null);
            intervalMs   = p.getLong("intervalMs", 30000);
            if (intent != null && intent.hasExtra("slotId")) {
                slotId = intent.getStringExtra("slotId");
                p.edit().putString("slotId", slotId).apply();
            }
        }

        // Compat: instalação Firebase anterior a esta versão não tinha tokenUrl/provider salvos.
        if (provider == null) provider = "firebase";
        if (tokenUrl == null && apiKey != null) {
            tokenUrl = "https://securetoken.googleapis.com/v1/token?key=" + apiKey;
        }

        if (functionUrl == null || refreshToken == null || tokenUrl == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundSafe();
        acquireWakeLock();   // mantém a CPU acordada → GPS e uploader não param na Doze (Samsung deep sleep)
        startLocationUpdates();
        startUploader();
        return START_STICKY;
    }

    // PARTIAL_WAKE_LOCK: impede a CPU de dormir enquanto o turno está ativo. Sem isto, em
    // Doze/aparelhos agressivos (Samsung) as amostras de GPS e o uploader congelam por
    // 15-20 min entre janelas de manutenção do SO — causando "buracos" no rastreamento.
    // Liberado no onDestroy (fim do turno / stop). Foreground service controla o ciclo.
    @SuppressLint("WakelockTimeout")
    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "JetOS::GpsTracker");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire();
        } catch (Exception ignore) {}
    }

    private void startForegroundSafe() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, "Rastreamento de turno", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        Notification n = b
                .setContentTitle("JET OS — turno ativo")
                .setContentText("Rastreando sua localização durante o turno.")
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates() {
        if (callback != null) return;
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(Math.max(5000, intervalMs / 2))
                .setMinUpdateDistanceMeters(0f)   // heartbeat por TEMPO: posta mesmo parado (antes 10f bloqueava fixes <10m → sem pontos parado/indoor)
                .build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location loc : result.getLocations()) enqueue(loc);
            }
        };
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException ignore) {
            // Permissão revogada em tempo de execução — o ponto simplesmente não é coletado.
        }
    }

    private void enqueue(Location loc) {
        try {
            boolean isMock = (Build.VERSION.SDK_INT >= 31) ? loc.isMock() : loc.isFromMockProvider();
            float speed = loc.hasSpeed() ? loc.getSpeed() : -1f;
            if (!isMock && speed > 60f) isMock = true;                       // > 216 km/h: impossível
            if (!isMock && loc.hasAccuracy() && loc.getAccuracy() < 2f) isMock = true; // preciso demais

            JSONObject p = new JSONObject();
            p.put("lat", loc.getLatitude());
            p.put("lng", loc.getLongitude());
            p.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : JSONObject.NULL);
            p.put("speed", loc.hasSpeed() ? loc.getSpeed() : JSONObject.NULL);
            p.put("heading", loc.hasBearing() ? loc.getBearing() : JSONObject.NULL);
            p.put("altitude", loc.hasAltitude() ? loc.getAltitude() : JSONObject.NULL);
            p.put("bateria", batteryLevel());
            p.put("capturedAt", iso8601(loc.getTime()));
            p.put("slotId", slotId == null ? JSONObject.NULL : slotId);
            p.put("isMock", isMock);
            p.put("estrategia", "background_android_native");
            p.put("deviceId", deviceId == null ? JSONObject.NULL : deviceId);
            p.put("deviceModel", deviceModel == null ? JSONObject.NULL : deviceModel);
            queue.enqueue(p);
            queue.trim(MAX_QUEUE);
        } catch (Exception ignore) {}
    }

    private void startUploader() {
        if (uploader != null) return;
        uploader = Executors.newSingleThreadScheduledExecutor();
        // Primeiro envio em 3s, depois a cada 20s. Mantém a posição quase ao vivo.
        uploader.scheduleWithFixedDelay(this::drain, 3, 20, TimeUnit.SECONDS);
    }

    private void drain() {
        try {
            GpsQueueDb.Batch batch = queue.peek(MAX_BATCH);
            if (batch.points.length() == 0) return;
            String token = tokens.getToken(provider, tokenUrl, apiKey, refreshToken);
            if (token == null) return; // sem token agora; tenta no próximo ciclo (pontos ficam na fila)
            if (postBatch(token, batch.points)) queue.delete(batch.ids);
        } catch (Exception ignore) {}
    }

    private boolean postBatch(String token, JSONArray points) {
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("points", points);
            c = (HttpURLConnection) new URL(functionUrl).openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + token);
            // Supabase exige o header apikey no gateway das Edge Functions.
            if ("supabase".equals(provider)) c.setRequestProperty("apikey", apiKey);
            c.setDoOutput(true);
            c.setConnectTimeout(20000);
            c.setReadTimeout(20000);
            OutputStream os = c.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private int batteryLevel() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        } catch (Exception e) { return -1; }
    }

    private String iso8601(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    @Override
    public void onDestroy() {
        if (callback != null) { fused.removeLocationUpdates(callback); callback = null; }
        if (uploader != null) { uploader.shutdownNow(); uploader = null; }
        if (wakeLock != null && wakeLock.isHeld()) { try { wakeLock.release(); } catch (Exception ignore) {} }
        super.onDestroy();
    }

    // NÃO para o rastreamento quando o app é removido dos recentes — o serviço segue
    // coletando e enviando. Só para via stop() explícito (fim do turno) ou stopSelf.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // intencionalmente vazio: mantém o serviço vivo
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── Controle estático (usado pelo plugin e pelo BootReceiver) ──
    static void start(Context ctx, Intent cfg) {
        cfg.setClass(ctx, GpsTrackerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(cfg);
        else ctx.startService(cfg);
    }

    static void stop(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("ativo", false).apply();
        ctx.stopService(new Intent(ctx, GpsTrackerService.class));
    }
}
