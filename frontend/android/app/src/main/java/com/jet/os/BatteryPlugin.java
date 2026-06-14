package com.jet.os;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryPlugin extends Plugin {

    // Verifica ACCESS_BACKGROUND_LOCATION ("Permitir o tempo todo"). Sem ele, quando o
    // Foreground Service é reiniciado pelo SO com o app minimizado, a localização não
    // volta. Em Android < 10 (API 29) o background é implícito junto do foreground.
    // Em Android 11+ só pode ser concedido via tela de Configurações do app.
    @PluginMethod
    public void checkBackgroundLocation(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            granted = true;
        } else {
            granted = getContext().checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
        }
        JSObject ret = new JSObject();
        ret.put("value", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void isIgnoring(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("value", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoring(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir as configurações de bateria: " + e.getMessage());
        }
    }
}
