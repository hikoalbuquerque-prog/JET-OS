package com.jet.os;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Bridge entre o JS e o GpsTrackerService nativo.
//   start      — inicia o rastreamento nativo (passa config + refresh token)
//   updateSlot — atualiza o slot atual sem reiniciar o serviço
//   stop       — encerra o rastreamento (fim do turno)
//
// MIGRAÇÃO: plugável por provedor ('firebase' | 'supabase') — ver gps-native.ts.
@CapacitorPlugin(name = "GpsTracker")
public class GpsTrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String functionUrl  = call.getString("functionUrl");
        String apiKey       = call.getString("apiKey");
        String refreshToken = call.getString("refreshToken");
        String tokenUrl     = call.getString("tokenUrl");
        String provider     = call.getString("provider", "firebase");
        if (functionUrl == null || apiKey == null || refreshToken == null || tokenUrl == null) {
            call.reject("functionUrl, tokenUrl, apiKey e refreshToken são obrigatórios");
            return;
        }
        Intent cfg = new Intent();
        cfg.putExtra("functionUrl", functionUrl);
        cfg.putExtra("tokenUrl", tokenUrl);
        cfg.putExtra("provider", provider);
        cfg.putExtra("apiKey", apiKey);
        cfg.putExtra("refreshToken", refreshToken);
        cfg.putExtra("uid", call.getString("uid"));
        cfg.putExtra("slotId", call.getString("slotId"));
        cfg.putExtra("deviceId", call.getString("deviceId"));
        cfg.putExtra("deviceModel", call.getString("deviceModel"));
        Long interval = call.getLong("intervalMs");
        cfg.putExtra("intervalMs", interval == null ? 30000L : interval);
        try {
            GpsTrackerService.start(getContext(), cfg);
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao iniciar o serviço de GPS: " + e.getMessage());
        }
    }

    @PluginMethod
    public void updateSlot(PluginCall call) {
        Intent cfg = new Intent();
        // Sem functionUrl → o serviço trata como atualização (recarrega config persistida)
        cfg.putExtra("slotId", call.getString("slotId"));
        try {
            GpsTrackerService.start(getContext(), cfg);
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao atualizar o slot: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        GpsTrackerService.stop(getContext());
        call.resolve();
    }
}
