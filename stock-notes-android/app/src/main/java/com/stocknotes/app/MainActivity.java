package com.stocknotes.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.CookieManager;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    static final String HOME = "https://stock-report.stocknotes.workers.dev/";
    private static final String HOST = "stock-report.stocknotes.workers.dev";

    private WebView webView;
    private boolean showingError;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new RetryBridge(), "AndroidRetry");
        webView.setWebViewClient(new NotesWebViewClient());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::goBackOrFinish);
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            goBackOrFinish();
        } else {
            super.onBackPressed();
        }
    }

    private void goBackOrFinish() {
        if (webView != null && webView.canGoBack()) {
            showingError = false;
            webView.goBack();
        } else {
            finish();
        }
    }

    private boolean isAllowed(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && HOST.equalsIgnoreCase(uri.getHost());
    }

    private void showError(WebView view) {
        if (showingError) {
            return;
        }
        showingError = true;
        String html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>加载失败</title></head>"
                + "<body style=\"margin:0;background:#111;color:#eee;font-family:sans-serif;\">"
                + "<div style=\"padding:48px 24px;text-align:center;\">"
                + "<p style=\"font-size:18px;line-height:1.5;\">页面加载失败，请检查网络后重试。</p>"
                + "<p><button onclick=\"AndroidRetry.retry()\" "
                + "style=\"font-size:18px;padding:12px 28px;border:0;border-radius:8px;"
                + "background:#2f6fed;color:#fff;\">重试</button></p>"
                + "</div></body></html>";
        view.loadDataWithBaseURL(HOME, html, "text/html", "UTF-8", null);
    }

    private final class NotesWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // false: WebView follows same-host HTTPS, including redirects.
            return !isAllowed(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url != null && url.startsWith(HOME) && !url.startsWith("data:")) {
                showingError = false;
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request != null && request.isForMainFrame()) {
                showError(view);
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (failingUrl != null && failingUrl.startsWith("https://" + HOST)) {
                showError(view);
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request != null
                    && request.isForMainFrame()
                    && errorResponse != null
                    && errorResponse.getStatusCode() >= 400) {
                showError(view);
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            showError(view);
        }
    }

    private final class RetryBridge {
        @android.webkit.JavascriptInterface
        public void retry() {
            webView.post(() -> {
                showingError = false;
                webView.loadUrl(HOME);
            });
        }
    }
}
