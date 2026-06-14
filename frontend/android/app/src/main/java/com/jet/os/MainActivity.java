package com.jet.os;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BatteryPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // O Foreground Service do background-geolocation COLETA o GPS nativamente, mas
    // entrega cada posição ao JS (que faz o upload p/ Firestore) através da bridge do
    // WebView. Quando o app é minimizado (Home / troca de app → onStop) ou a tela é
    // bloqueada (onPause), o Android suspende a execução de JS do WebView: os callbacks
    // param e NENHUM ponto é gravado, mesmo com o serviço vivo e a notificação visível.
    //
    // Forçar onResume() + resumeTimers() mantém o motor de JS rodando em segundo plano.
    // É preciso cobrir onPause (tela bloqueada) E onStop (app minimizado) — só onPause
    // não basta, pois o onStop subsequente volta a suspender o renderer em vários OEMs.
    private void keepWebViewAlive() {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().onResume();
            this.bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewAlive();
    }
}
