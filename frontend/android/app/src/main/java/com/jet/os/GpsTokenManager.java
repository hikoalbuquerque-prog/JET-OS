package com.jet.os;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

// Troca o refresh token por um access token válido — SEM SDK — para os dois provedores:
//   - firebase: POST securetoken.googleapis.com (form-urlencoded) → campo "id_token".
//               Refresh token NÃO rotaciona (longa duração).
//   - supabase: POST <url>/auth/v1/token?grant_type=refresh_token (JSON + header apikey)
//               → campo "access_token". O refresh token ROTACIONA: a resposta traz um novo
//               refresh_token que DEVE ser persistido (senão o serviço perde o acesso).
// O token é cacheado e só renovado quando perto de expirar — funciona com o app fechado.
class GpsTokenManager {
    private final SharedPreferences prefs;
    private String cachedToken;
    private long expiresAtMs;

    GpsTokenManager(Context ctx) {
        prefs = ctx.getSharedPreferences("jet_gps_token", Context.MODE_PRIVATE);
        cachedToken = prefs.getString("access_token", null);
        expiresAtMs = prefs.getLong("expires_at", 0);
    }

    // Início novo de turno: define o refresh token base e zera o cache de access token.
    synchronized void seed(String refreshToken) {
        cachedToken = null;
        expiresAtMs = 0;
        prefs.edit()
                .remove("access_token")
                .remove("expires_at")
                .putString("refresh_token", refreshToken)
                .apply();
    }

    // Retorna um access token válido (renovando se necessário) ou null em caso de falha.
    synchronized String getToken(String provider, String tokenUrl, String apiKey, String seedRefresh) {
        long now = System.currentTimeMillis();
        if (cachedToken != null && now < expiresAtMs - 60000) return cachedToken;

        boolean supa = "supabase".equals(provider);
        String refresh = prefs.getString("refresh_token", null);
        if (refresh == null) refresh = seedRefresh;
        if (refresh == null) return null;

        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(tokenUrl).openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);

            byte[] payload;
            if (supa) {
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("apikey", apiKey);
                payload = ("{\"refresh_token\":\"" + refresh + "\"}").getBytes("UTF-8");
            } else {
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                payload = ("grant_type=refresh_token&refresh_token="
                        + URLEncoder.encode(refresh, "UTF-8")).getBytes("UTF-8");
            }
            OutputStream os = c.getOutputStream();
            os.write(payload);
            os.close();

            if (c.getResponseCode() != 200) return null;

            JSONObject j = new JSONObject(readAll(c));
            cachedToken = supa ? j.getString("access_token") : j.getString("id_token");
            long ttlSec = j.optLong("expires_in", 3600);
            expiresAtMs = System.currentTimeMillis() + ttlSec * 1000;

            SharedPreferences.Editor e = prefs.edit()
                    .putString("access_token", cachedToken)
                    .putLong("expires_at", expiresAtMs);
            // Supabase rotaciona o refresh token — persistir o novo é OBRIGATÓRIO.
            if (supa && j.has("refresh_token")) e.putString("refresh_token", j.getString("refresh_token"));
            e.apply();
            return cachedToken;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private String readAll(HttpURLConnection c) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return sb.toString();
    }
}
