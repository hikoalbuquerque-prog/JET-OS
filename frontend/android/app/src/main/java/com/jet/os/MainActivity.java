package com.jet.os;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BatteryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
