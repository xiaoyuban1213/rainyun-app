package com.rainyun.appweb;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Keep content inside system bars for both gesture navigation and 3-button keys.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
