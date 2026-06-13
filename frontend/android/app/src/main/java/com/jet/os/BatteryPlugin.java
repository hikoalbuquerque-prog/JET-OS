package com.jet.os;

import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryPlugin extends Plugin {

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
