package com.jet.os;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "BatteryOptimization",
    permissions = {
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        )
    }
)
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

    // Solicita ACCESS_BACKGROUND_LOCATION ("Permitir o tempo todo") pela API de
    // permissão do sistema — a MESMA mecânica das demais permissões.
    //   • Android < 10: background é implícito junto do foreground → já concedido.
    //   • Android 10  : mostra o diálogo com "Permitir o tempo todo" inline (um toque).
    //   • Android 11+ : o Google não permite conceder por diálogo no app; o sistema
    //                   leva direto à tela de seleção de localização do app (escolher
    //                   "Permitir o tempo todo"). Ainda assim é bem melhor que abrir a
    //                   tela genérica de info do app.
    // Pré-requisito: o foreground (fine/coarse) já precisa estar concedido — garantido
    // pelo gate, que só mostra esta etapa após o foreground ser concedido.
    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("value", true);
            call.resolve(ret);
            return;
        }
        if (getPermissionState("backgroundLocation") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("value", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "bgLocationCallback");
    }

    @PermissionCallback
    private void bgLocationCallback(PluginCall call) {
        boolean granted = getPermissionState("backgroundLocation") == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("value", granted);
        call.resolve(ret);
    }

    // Abre a tela de detalhes do app (Configurações → Apps → JET OS), onde o usuário
    // concede "Permitir o tempo todo" (ACCESS_BACKGROUND_LOCATION), que no Android 11+
    // não pode ser pedido por diálogo. Precisa ser via Intent nativo — abrir a string
    // "android.settings.APPLICATION_DETAILS_SETTINGS" como URL no WebView falha com
    // ERR_INVALID_RESPONSE (vira https://localhost/android.settings...).
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir as configurações do app: " + e.getMessage());
        }
    }
}
