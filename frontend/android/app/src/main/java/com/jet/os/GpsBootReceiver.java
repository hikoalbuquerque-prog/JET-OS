package com.jet.os;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Reinicia o rastreamento após o celular reiniciar, caso um turno estivesse ativo.
// A flag "ativo" e a config ficam em SharedPreferences (GpsTrackerService.PREFS).
public class GpsBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        boolean ativo = ctx.getSharedPreferences(GpsTrackerService.PREFS, Context.MODE_PRIVATE)
                .getBoolean("ativo", false);
        if (!ativo) return;
        try {
            // Sem extras → o serviço recarrega a config persistida.
            GpsTrackerService.start(ctx, new Intent());
        } catch (Exception ignore) {
            // Em algumas versões do Android não é possível iniciar um FGS de localização
            // direto do boot; nesse caso o rastreamento retoma quando o usuário abrir o app.
        }
    }
}
