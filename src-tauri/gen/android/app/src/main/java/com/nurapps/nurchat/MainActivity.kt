package com.nurapps.nurchat

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Android WebView отдаёт env(safe-area-inset-*) = 0, поэтому веб-часть не
    // знает про статус-бар и панель навигации и рисуется под ними. Сдвигаем
    // корневой вид нативно: WebView оказывается внутри безопасной области, и
    // CSS-отступы (если WebView их когда-нибудь начнёт отдавать) не удвоятся.
    // IME намеренно не учитываем — клавиатуру обрабатывает фронтенд
    // (--keyboard-height).
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
  }
}
