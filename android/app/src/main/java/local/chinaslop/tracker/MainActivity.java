package local.chinaslop.tracker;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import android.view.View;
import android.widget.TextView;
import java.io.*;
import java.net.URL;
import java.net.HttpURLConnection;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
  static { System.loadLibrary("node");System.loadLibrary("tracker"); }
  private static native int startNode(String root,String data,int port,String key);
  private static final AtomicBoolean started=new AtomicBoolean(false);
  private static final int port=4319;
  private static final String accessKey=java.util.UUID.randomUUID().toString()+java.util.UUID.randomUUID().toString();
  private final Handler ui=new Handler(Looper.getMainLooper());
  private WebView web;
  private ValueCallback<Uri[]> upload;
  private boolean destroyed=false;
  private String origin;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().getDecorView().setOnApplyWindowInsetsListener((view,insets)->{
      if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}
      else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
      return insets;
    });
    TextView loading=new TextView(this);loading.setText("Starting Chinaslop Tracker…");loading.setPadding(32,64,32,32);setContentView(loading);
    new Thread(()->{
      try {
        File root=new File(getFilesDir(),"app-v1");
        if(started.compareAndSet(false,true)) {
          copyAssets("tracker",root);
          File data=new File(getFilesDir(),"tracker-data");data.mkdirs();
          new Thread(()->{int code=startNode(root.getAbsolutePath(),data.getAbsolutePath(),port,accessKey);ui.post(()->{if(!destroyed)new AlertDialog.Builder(this).setMessage("The tracker stopped. Close and reopen the app.").setPositiveButton("Close",(d,w)->finish()).show();});},"Tracker server").start();
        }
        origin="http://127.0.0.1:"+port;
        boolean ready=false;
        for(int i=0;i<150&&!destroyed;i++) {
          try {HttpURLConnection connection=(HttpURLConnection)new URL(origin+"/api/health").openConnection();connection.setRequestProperty("X-Tracker-Key",accessKey);connection.setConnectTimeout(400);connection.setReadTimeout(400);int code=connection.getResponseCode();connection.disconnect();if(code==200){ready=true;break;}}
          catch(IOException ignored){}
          Thread.sleep(200);
        }
        if(!ready)throw new IOException("The local server did not start.");
        ui.post(()->{if(!destroyed)showTracker();});
      }catch(Exception error){ui.post(()->{if(!destroyed)new AlertDialog.Builder(this).setTitle("Could not start tracker").setMessage("Close and reopen the app. Your encrypted account data is kept in app storage.").setPositiveButton("Close",(d,w)->finish()).show();});}
    },"Tracker startup").start();
  }
  private void copyAssets(String source,File target)throws IOException {
    String[] children=getAssets().list(source);
    if(children.length>0){target.mkdirs();for(String child:children)copyAssets(source+"/"+child,new File(target,child));}
    else {target.getParentFile().mkdirs();try(InputStream input=getAssets().open(source);OutputStream output=new FileOutputStream(target)){byte[] buffer=new byte[32768];int length;while((length=input.read(buffer))!=-1)output.write(buffer,0,length);}}
  }
  private boolean local(Uri uri){return "http".equals(uri.getScheme())&&"127.0.0.1".equals(uri.getHost())&&uri.getPort()==port;}
  private void showTracker(){
    web=new WebView(this);web.setBackgroundColor(0xff0c101b);
    WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setDatabaseEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
    web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){Uri uri=request.getUrl();if(local(uri))return false;if("https".equals(uri.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}return true;}});
    web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(upload!=null)upload.onReceiveValue(null);upload=callback;Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.setType("image/*");intent.addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(Intent.createChooser(intent,"Select background image"),40);return true;}catch(Exception e){upload=null;callback.onReceiveValue(null);return false;}}});
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setCookie(origin,"tracker_session="+accessKey+"; HttpOnly; SameSite=Strict; Path=/",accepted->{if(!destroyed){setContentView(web);web.loadUrl(origin);}});
  }
  @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==40&&upload!=null){upload.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);upload=null;}}
  @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override protected void onDestroy(){destroyed=true;if(upload!=null)upload.onReceiveValue(null);if(web!=null)web.destroy();super.onDestroy();}
}
