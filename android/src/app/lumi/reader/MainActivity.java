package app.lumi.reader;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.*;
import android.provider.MediaStore;
import android.media.ExifInterface;
import java.security.MessageDigest;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.*;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

public class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private static final int PICK=41, EXPORT=42, COVER=43, SAVE_IMAGE=44, LIMIT=30*1024*1024, PDF_LIMIT=100*1024*1024;
    private FrameLayout root, sourceRoot, pdfRoot;
    private PdfReaderView pdfView;
    private boolean pdfModal=false,pdfTransitioning=false;
    private String pdfSession="";
    private long pdfLayoutEpoch=0;
    private final ArrayList<RectF> pdfHitRegions=new ArrayList<>();
    private final java.util.concurrent.atomic.AtomicInteger pdfOpenEpoch=new java.util.concurrent.atomic.AtomicInteger();
    private String pdfBookId,coverPickerId,imageExportId;
    private File imageExportFile;
    private ReaderWebView web;
    private WebView sourceWeb,sourceToolbar;
    private FrameLayout sourceLayout;
    private String sourceInsetScript;
    private FrameLayout sourceHeader;
    private String sourceHapticMode="gentle";
    private int sourcePaper=Color.rgb(244,242,233);
    private String pickerId, exportId, exportText;
    private File exportDataFile;
    private static final int DATA_LIMIT=180*1024*1024;
    private static final int RESOURCE_LIMIT=1024*1024*1024;
    private final ExecutorService io=Executors.newFixedThreadPool(3);
    private final Map<String,File> imports=new ConcurrentHashMap<>();
    private TextToSpeech tts;
    private OfflineSpeech offlineSpeech;
    private volatile String appLanguage="system";
    private JSONObject uiCatalog=new JSONObject();
    private boolean ttsReady=false;
    private int insetLeft,insetTop,insetRight,insetBottom,insetCutoutTop,insetCutoutLeft,insetCutoutRight;
    private boolean systemDark=false,immersiveReading=false;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        loadUiCatalog();
        systemDark=startupDark();int startupPaper=startupColor(systemDark?"dark":"light",systemDark?"#1b211c":"#f4f2e9");getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(startupPaper));
        offlineSpeech=new OfflineSpeech(this);
        configureEdgeToEdge();
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        root=new FrameLayout(this);root.setBackgroundColor(startupPaper);
        web=new ReaderWebView(this);
        configure(web,true);
        web.setBackgroundColor(startupPaper);
        web.addJavascriptInterface(new Bridge(),"LumiNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){return recoverRenderer(v,detail);}
            @Override public void onPageFinished(WebView v,String url){publishInsets();publishSystemLocales();publishSystemAppearance();}
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !isOwned(r.getUrl());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(!isOwned(uri))return request.isForMainFrame()?emptyResponse():null;
                String path=uri.getPath();
                try{
                    if(path.startsWith("/import/")){
                        File file=imports.get(path.substring(8));
                        if(file!=null){WebResourceResponse response=new WebResourceResponse("application/octet-stream",null,new FileInputStream(file));Map<String,String> headers=new HashMap<>();headers.put("Content-Length",Long.toString(file.length()));headers.put("Cache-Control","no-store");response.setResponseHeaders(headers);return response;}
                        return emptyResponse();
                    }
                    if(!path.startsWith("/assets/")||path.contains(".."))return emptyResponse();
                    String asset=path.substring(8);
                    WebResourceResponse response=new WebResourceResponse(mime(asset),"UTF-8",getAssets().open(asset));
                    if(asset.endsWith(".html")||asset.endsWith(".js")||asset.endsWith(".css"))response.setResponseHeaders(Collections.singletonMap("Cache-Control","no-store"));
                    return response;
                }catch(Exception e){return emptyResponse();}
            }
        });
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        // Keep the canvas edge-to-edge; only tappable content receives safe insets in CSS.
        root.setOnApplyWindowInsetsListener((v,insets)->{
            int left,top,right,bottom,keyboard=0;
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                left=bars.left;top=bars.top;right=bars.right;bottom=bars.bottom;
                if(insets.isVisible(WindowInsets.Type.ime()))keyboard=insets.getInsets(WindowInsets.Type.ime()).bottom;
            }else{
                left=insets.getStableInsetLeft();top=insets.getStableInsetTop();right=insets.getStableInsetRight();bottom=insets.getStableInsetBottom();
                if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){DisplayCutout cut=insets.getDisplayCutout();left=Math.max(left,cut.getSafeInsetLeft());top=Math.max(top,cut.getSafeInsetTop());right=Math.max(right,cut.getSafeInsetRight());}
                if(insets.getSystemWindowInsetBottom()>dp(100))keyboard=insets.getSystemWindowInsetBottom();
            }
            insetLeft=left;insetTop=top;insetRight=right;insetBottom=keyboard>0?0:bottom;
            if(pdfRoot!=null)pdfRoot.setPadding(insetLeft,0,insetRight,0);
            DisplayCutout cutout=Build.VERSION.SDK_INT>=28?insets.getDisplayCutout():null;
            insetCutoutTop=cutout==null?0:cutout.getSafeInsetTop();insetCutoutLeft=cutout==null?0:cutout.getSafeInsetLeft();insetCutoutRight=cutout==null?0:cutout.getSafeInsetRight();
            // Resize around the IME, never around the status or navigation bars.
            v.setPadding(0,0,0,keyboard);
            layoutSource();
            publishInsets();return insets;
        });
        root.requestApplyInsets();
        web.loadUrl(ORIGIN+"/assets/index.html?v=0.5.57");
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
        tts=new TextToSpeech(this,status->{ttsReady=status==TextToSpeech.SUCCESS&&tts.setLanguage(Locale.US)>=TextToSpeech.LANG_AVAILABLE;});
        // Clear transient imports left by interrupted pickers, never the persistent reading database.
        File[] stale=getCacheDir().listFiles();if(stale!=null)for(File f:stale)if(f.getName().startsWith("import-")&&System.currentTimeMillis()-f.lastModified()>86400000L)f.delete();
    }
    private boolean startupDark(){String mode=getPreferences(MODE_PRIVATE).getString("startup-appearance","system");return "dark".equals(mode)||"system".equals(mode)&&(getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES;}
    private int startupColor(String name,String fallback){try{return Color.parseColor(getPreferences(MODE_PRIVATE).getString("startup-"+name,fallback));}catch(Exception e){return Color.parseColor(fallback);}}
    private void saveStartupTheme(JSONObject data){SharedPreferences.Editor edit=getPreferences(MODE_PRIVATE).edit();String mode=data.optString("appearance");if(!Arrays.asList("system","light","dark").contains(mode))return;edit.putString("startup-appearance",mode);for(String key:new String[]{"light","dark","accent"}){String color=data.optString(key);if(color.matches("#[a-fA-F0-9]{6}"))edit.putString("startup-"+key,color);}edit.apply();}
    private void loadUiCatalog(){
        appLanguage=getPreferences(MODE_PRIVATE).getString("ui-language","system");
        try(InputStream in=getAssets().open("assets/ui-locales.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
            uiCatalog=new JSONObject(out.toString("UTF-8"));
        }catch(Exception ignored){}
    }
    private void setUiLanguage(String value){
        if(!Arrays.asList("system","zh-CN","zh-TW","en").contains(value))throw new IllegalArgumentException("界面设置无效");
        appLanguage=value;getPreferences(MODE_PRIVATE).edit().putString("ui-language",value).apply();
    }
    private String resolvedUiLanguage(){
        if(Arrays.asList("zh-CN","zh-TW","en").contains(appLanguage))return appLanguage;
        android.os.LocaleList locales=getResources().getConfiguration().getLocales();
        for(int i=0;i<locales.size();i++){Locale l=locales.get(i);if("zh".equals(l.getLanguage()))return "Hant".equals(l.getScript())||Arrays.asList("TW","HK","MO").contains(l.getCountry())?"zh-TW":"zh-CN";if("en".equals(l.getLanguage()))return "en";}
        return "en";
    }
    private String uiText(String text){
        if(text==null)return "";JSONObject entries=uiCatalog.optJSONObject(resolvedUiLanguage());if(entries==null)return text;
        if(entries.has(text))return entries.optString(text,text);
        // The only composed platform error contains a numeric HTTP status.
        String prefix="服务连接失败（";
        if(text.startsWith(prefix))return entries.optString(prefix,prefix)+text.substring(prefix.length()).replace('）',')');
        return text;
    }
    private void publishSystemLocales(){
        if(web==null)return;JSONArray tags=new JSONArray();android.os.LocaleList locales=getResources().getConfiguration().getLocales();for(int i=0;i<locales.size();i++)tags.put(locales.get(i).toLanguageTag());
        web.evaluateJavascript("window.__lumiSystemLocales="+tags.toString()+";if(window.Lumi)window.Lumi.systemLanguages(window.__lumiSystemLocales)",null);
    }
    private void publishSystemAppearance(){
        if(web==null)return;boolean dark=(getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES;
        web.evaluateJavascript("window.__lumiSystemDark="+dark+";if(window.Lumi&&window.Lumi.systemAppearance)window.Lumi.systemAppearance(window.__lumiSystemDark)",null);
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration config){super.onConfigurationChanged(config);publishSystemAppearance();publishSystemLocales();}
    private void openTtsSettings(String id){
        try{startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));reply(id,true,null);}
        catch(Exception first){try{startActivity(new Intent("android.settings.TTS_SETTINGS"));reply(id,true,null);}catch(Exception second){reply(id,null,"系统没有可用的语音安装页面，请在设置中搜索‘文字转语音’");}}
    }
    private void configure(WebView view,boolean owned){
        WebSettings s=view.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);s.setBuiltInZoomControls(false);
        if(Build.VERSION.SDK_INT>=26)s.setSafeBrowsingEnabled(true);
        // Let Android 15+ favor a high refresh mode while WebView content is animating.
        // The system only considers a View's vote while drawing, so static reading can
        // still settle to its power-saving refresh rate.
        if(owned&&Build.VERSION.SDK_INT>=35)view.setRequestedFrameRate(View.REQUESTED_FRAME_RATE_CATEGORY_HIGH);
        if(owned)s.setTextZoom(100);
    }
    private boolean isOwned(Uri uri){return "https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);}
    private WebResourceResponse emptyResponse(){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
    private String mime(String p){if(p.endsWith(".html"))return "text/html";if(p.endsWith(".js"))return "text/javascript";if(p.endsWith(".css"))return "text/css";if(p.endsWith(".wasm"))return "application/wasm";if(p.endsWith(".json"))return "application/json";if(p.endsWith(".jpg"))return "image/jpeg";if(p.endsWith(".png"))return "image/png";if(p.endsWith(".webp"))return "image/webp";if(p.endsWith(".gif"))return "image/gif";if(p.endsWith(".pdf"))return "application/pdf";if(p.endsWith(".epub"))return "application/epub+zip";if(p.endsWith(".woff2"))return "font/woff2";if(p.endsWith(".woff"))return "font/woff";if(p.endsWith(".ttf"))return "font/ttf";return "application/octet-stream";}
    private void reply(String id,Object data,String error){
        try{JSONObject result=new JSONObject();result.put("ok",error==null);if(error==null)result.put("data",data==null?JSONObject.NULL:data);else result.put("error",uiText(error));
            String js="window.nativeReply&&window.nativeReply("+JSONObject.quote(id)+","+result.toString()+")";
            runOnUiThread(()->{if(web!=null)web.evaluateJavascript(js,null);});
        }catch(Exception ignored){}
    }
    private void toast(String text){runOnUiThread(()->Toast.makeText(this,uiText(text),Toast.LENGTH_LONG).show());}

    // A dead renderer cannot be reused. Handle each affected WebView separately.
    private boolean recoverRenderer(WebView failed,RenderProcessGoneDetail detail){
        boolean reader=failed==web,source=failed==sourceWeb;
        android.util.Log.w("TransRead","WebView renderer terminated; crashed="+detail.didCrash());
        if(reader){web=null;closeSource();closePdf();}if(source)sourceWeb=null;
        ViewParent parent=failed.getParent();if(parent instanceof ViewGroup)((ViewGroup)parent).removeView(failed);
        failed.removeJavascriptInterface("LumiNative");failed.destroy();
        if(source)closeSource();
        if(reader&&!isFinishing()&&!isDestroyed()){
            immersiveReading=false;applySystemBars();
            LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setGravity(Gravity.CENTER);panel.setPadding(dp(28),dp(28),dp(28),dp(28));
            TextView message=new TextView(this);message.setText(uiText("阅读页面已中断，已保存的图书和笔记仍在。"));message.setTextSize(17);message.setTextColor(Color.rgb(40,78,46));message.setGravity(Gravity.CENTER);panel.addView(message);
            Button retry=new Button(this);retry.setText(uiText("回到书架"));retry.setOnClickListener(v->recreate());panel.addView(retry,new LinearLayout.LayoutParams(-2,dp(56)));root.addView(panel,new FrameLayout.LayoutParams(-1,-1));
        }
        return true;
    }

    private class ReaderWebView extends WebView {
        ReaderWebView(Context c){super(c);}
        private boolean pdfGesture=false;
        @Override public boolean dispatchTouchEvent(MotionEvent event){
            if(pdfRoot!=null&&pdfTransitioning)return true;
            if(event.getActionMasked()==MotionEvent.ACTION_DOWN){
                pdfGesture=pdfView!=null&&!pdfModal;
                if(pdfGesture)for(RectF region:pdfHitRegions)if(region.contains(event.getX(),event.getY())){pdfGesture=false;break;}
            }
            if(pdfGesture&&pdfView!=null){
                MotionEvent copy=MotionEvent.obtain(event);int[] here=new int[2],there=new int[2];getLocationOnScreen(here);pdfView.getLocationOnScreen(there);copy.offsetLocation(here[0]-there[0],here[1]-there[1]);pdfView.dispatchTouchEvent(copy);copy.recycle();
                if(event.getActionMasked()==MotionEvent.ACTION_UP||event.getActionMasked()==MotionEvent.ACTION_CANCEL)pdfGesture=false;
                return true;
            }
            return super.dispatchTouchEvent(event);
        }
        @Override public ActionMode startActionMode(ActionMode.Callback cb,int type){
            return super.startActionMode(new ActionMode.Callback2(){
                @Override public void onGetContentRect(ActionMode m,View view,android.graphics.Rect rect){
                    if(cb instanceof ActionMode.Callback2)((ActionMode.Callback2)cb).onGetContentRect(m,view,rect);
                    else super.onGetContentRect(m,view,rect);
                }
                @Override public boolean onCreateActionMode(ActionMode m,Menu menu){boolean ok=cb.onCreateActionMode(m,menu);menu.add(0,777,0,uiText("收录句子")).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);return ok;}
                @Override public boolean onPrepareActionMode(ActionMode m,Menu menu){return cb.onPrepareActionMode(m,menu);}
                @Override public boolean onActionItemClicked(ActionMode m,MenuItem item){if(item.getItemId()==777){if(web!=null)web.evaluateJavascript("window.Lumi&&window.Lumi.saveSelection()",null);return true;}return cb.onActionItemClicked(m,item);}
                @Override public void onDestroyActionMode(ActionMode m){cb.onDestroyActionMode(m);}
            },type);
        }
    }
    private static int hapticFeedbackFor(String kind,int sdk){
        switch(kind){
            case "soft":case "selection":case "sheet":return sdk>=34?HapticFeedbackConstants.SEGMENT_FREQUENT_TICK:HapticFeedbackConstants.CLOCK_TICK;
            case "segment":return sdk>=34?HapticFeedbackConstants.SEGMENT_FREQUENT_TICK:-1;
            case "context":return HapticFeedbackConstants.CONTEXT_CLICK;
            case "toggle-on":return sdk>=34?HapticFeedbackConstants.TOGGLE_ON:HapticFeedbackConstants.CLOCK_TICK;
            case "toggle-off":return sdk>=34?HapticFeedbackConstants.TOGGLE_OFF:HapticFeedbackConstants.CLOCK_TICK;
            case "confirm":return sdk>=30?HapticFeedbackConstants.CONFIRM:HapticFeedbackConstants.CONTEXT_CLICK;
            case "gesture":return sdk>=30?HapticFeedbackConstants.GESTURE_END:HapticFeedbackConstants.CLOCK_TICK;
            default:return -1;
        }
    }
    private void playHaptic(JSONObject data){
        // Use system semantic effects and respect system/view feedback settings.
        // Never queue haptics behind network work, bypass settings, or vibrate a background page.
        if(web==null||!web.isShown()||!web.hasWindowFocus())return;
        String kind=data.optString("kind");
        int effect=hapticFeedbackFor(kind,Build.VERSION.SDK_INT);
        if(effect>=0&&data.optBoolean("gentle")&&!"confirm".equals(kind))effect=hapticFeedbackFor("soft",Build.VERSION.SDK_INT);
        if(effect>=0)web.performHapticFeedback(effect);
    }
    public class Bridge {
        @JavascriptInterface public String startupTheme(){try{JSONObject o=new JSONObject();boolean dark=startupDark();o.put("paper",String.format(Locale.ROOT,"#%06x",startupColor(dark?"dark":"light",dark?"#1b211c":"#f4f2e9")&0xffffff));o.put("ink",dark?"#f3f3f4":"#242426");o.put("accent",String.format(Locale.ROOT,"#%06x",startupColor("accent","#526b50")&0xffffff));return o.toString();}catch(Exception e){return "{}";}}

        @JavascriptInterface public void request(String op,String payload,String id){
            if(id==null||id.length()>80||payload==null||payload.length()>("saveImage".equals(op)?5000000:2000000)){return;}
            // Preserve UI request order; theme updates must not override a newer immersive request.
            if("theme".equals(op)||"immersive".equals(op)||"locale".equals(op)||"startupTheme".equals(op)){
                try{JSONObject data=new JSONObject(payload);runOnUiThread(()->{
                    if("startupTheme".equals(op))saveStartupTheme(data);
                    else if("locale".equals(op))setUiLanguage(data.optString("choice"));
                    else if("immersive".equals(op)){immersiveReading=data.optBoolean("enabled");applySystemBars();}
                    else setSystemTheme(data.optBoolean("dark"));
                    reply(id,true,null);
                });}catch(Exception e){reply(id,null,"界面设置无效");}return;
            }
            // User interface commands must not wait behind slow network/download jobs.
            if(Arrays.asList("pickFile","pickCover","export","openSource","ttsSettings","speak","stopSpeak","haptic").contains(op)){
                try{JSONObject data=new JSONObject(payload);runOnUiThread(()->{
                    try{switch(op){
                        case "haptic":playHaptic(data);reply(id,true,null);break;
                        case "pickFile":pick(id);break;
                        case "pickCover":pickCover(id);break;
                        case "export":export(id,data);break;
                        case "openSource":showSource(validURL(data.getString("url")).toString(),data);reply(id,true,null);break;
                        case "ttsSettings":openTtsSettings(id);break;
                        case "speak":{String text=data.optString("text");if(text.length()>20000)throw new Exception("朗读文本过长");if(data.has("accent")){String actual=speakSystem(text,data.optString("accent"),data.optBoolean("allowGeneric"));JSONObject result=new JSONObject();result.put("actualAccent",actual);reply(id,result,null);break;}else if(!offlineSpeech.active().isEmpty()){tts.stop();offlineSpeech.speak(text,null,(value,error)->runOnUiThread(()->{if(error!=null&&web!=null&&web.hasWindowFocus())try{speakSystem(text);toast(error);}catch(Exception e){toast(error);}}));}else speakSystem(text);reply(id,true,null);break;}
                        case "stopSpeak":offlineSpeech.cancel();if(tts!=null)tts.stop();reply(id,true,null);break;
                    }}catch(Exception e){reply(id,null,e.getMessage()==null?"操作未完成，请重试":e.getMessage());}
                });}catch(Exception e){reply(id,null,"操作参数无效");}return;
            }
            if(Arrays.asList("ttsModels","importTts","ttsManage","ttsPreview").contains(op)){try{JSONObject data=new JSONObject(payload);if("ttsPreview".equals(op)){if(tts!=null)runOnUiThread(()->tts.stop());offlineSpeech.speak("A new voice, a new world. Every page begins a journey.",data.getString("id"),(value,error)->reply(id,value,error));}else offlineSpeech.request(op,data,"importTts".equals(op)?selectedImport(data.getString("url")):null,(value,error)->reply(id,value,error));}catch(Exception e){reply(id,null,"模型文件不可用，请重新选择");}return;}
            // Cancel a preparation immediately, even when file inspection is still
            // queued on an I/O worker. A stale session cannot cancel a newer book.
            if("pdfControl".equals(op)){try{JSONObject control=new JSONObject(payload);if("cancelOpen".equals(control.optString("command"))){String session=control.optString("session");if(session.equals(pdfRequestedSession)){pdfRequestedSession=null;pdfOpenEpoch.incrementAndGet();runOnUiThread(()->{if(session.equals(pdfSession))closePdf(false);reply(id,true,null);});}else reply(id,jsonCancelled(),null);return;}}catch(Exception e){reply(id,null,"PDF 操作未完成");return;}}
            if("openPdf".equals(op)){try{pdfRequestedSession=new JSONObject(payload).optString("session");}catch(Exception e){reply(id,null,"PDF 操作未完成");return;}}
            final int pdfEpoch="openPdf".equals(op)?pdfOpenEpoch.incrementAndGet():0;
            io.execute(()->{
                try{
                    JSONObject data=new JSONObject(payload);
                    switch(op){
                        case "beginData":{String token=UUID.randomUUID().toString();File f=new File(getCacheDir(),"import-"+token);if(!f.createNewFile())throw new IOException("无法准备导入文件");imports.put(token,f);JSONObject o=new JSONObject();o.put("url",ORIGIN+"/import/"+token);reply(id,o,null);break;}
                        case "appendData":appendData(data);reply(id,true,null);break;
                        case "backupPdf":{File f=pdfFile(data.getString("id"),".pdf");try(InputStream in=new FileInputStream(f)){reply(id,stash(in,"backup.pdf"),null);}break;}
                        case "importPdf":reply(id,pdfSummary(importPdf(data)),null);break;
                        case "openPdf":openPdf(data,id,pdfEpoch);break;
                        case "pdfControl":pdfControl(data,id);break;
                        case "deletePdf":deletePdf(data.getString("id"));reply(id,true,null);break;
                        case "saveImage":saveImage(data,id);break;
                        case "net":reply(id,network(data),null);break;
                        case "download":reply(id,download(data.getString("url"),data.optString("name","book.epub"),false),null);break;
                        case "releaseImport":{String u=data.optString("url");String token=Uri.parse(u).getLastPathSegment();File f=imports.remove(token);if(f!=null)f.delete();reply(id,true,null);break;}
                        case "saveApiKey":saveKey(data.getString("key"));reply(id,true,null);break;
                        default:reply(id,null,"不支持的操作");
                    }
                }catch(OutOfMemoryError e){reply(id,null,"文件处理内存不足，请选择较小的文件");}catch(Exception e){String message=e.getMessage();if(e instanceof SocketTimeoutException)message="连接超时，请检查网络";else if(e instanceof UnknownHostException)message="无法连接到服务，请检查网络";reply(id,null,message==null?"操作未完成，请重试":message);}
            });
        }
    }
    private void configureEdgeToEdge(){
        Window w=getWindow();
        if(Build.VERSION.SDK_INT>=30)w.setDecorFitsSystemWindows(false);
        else w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        w.setStatusBarColor(Color.TRANSPARENT);w.setNavigationBarColor(Color.TRANSPARENT);
        if(Build.VERSION.SDK_INT>=28){WindowManager.LayoutParams a=w.getAttributes();a.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;w.setAttributes(a);w.setNavigationBarDividerColor(Color.TRANSPARENT);}
        if(Build.VERSION.SDK_INT>=29){w.setStatusBarContrastEnforced(false);w.setNavigationBarContrastEnforced(false);}
    }
    private void publishInsets(){
        if(web==null)return;float density=getResources().getDisplayMetrics().density;
        String value="{left:"+(insetLeft/density)+",top:"+(insetTop/density)+",right:"+(insetRight/density)+",bottom:"+(insetBottom/density)+",cutoutTop:"+(insetCutoutTop/density)+"}";
        web.evaluateJavascript("window.__lumiInsets="+value+";if(window.Lumi)window.Lumi.setInsets(window.__lumiInsets)",null);
    }
    private void speakSystem(String text)throws Exception{speakSystem(text,null,true);}
    private void speakSystem(String text,String accent)throws Exception{speakSystem(text,accent,false);}
    private String speakSystem(String text,String accent,boolean allowGeneric)throws Exception{
        if(!ttsReady)throw new Exception("系统英语语音尚未就绪，请检查语音包");tts.stop();
        Locale locale="en-GB".equals(accent)?Locale.UK:Locale.US;int available=tts.setLanguage(locale);String actual=locale.toLanguageTag();
        if(available<TextToSpeech.LANG_AVAILABLE||(accent!=null&&available<TextToSpeech.LANG_COUNTRY_AVAILABLE)){
            if(allowGeneric&&tts.setLanguage(Locale.ENGLISH)>=TextToSpeech.LANG_AVAILABLE)actual="en";
            else throw new Exception("系统英语语音不可用，请检查语音设置");
        }
        int limit=Math.min(3000,TextToSpeech.getMaxSpeechInputLength()-1);
        for(int start=0;start<text.length();){int end=Math.min(text.length(),start+limit);if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;if(end<text.length()){int space=text.lastIndexOf(' ',end);if(space>start+limit/2)end=space+1;}int result=tts.speak(text.substring(start,end),TextToSpeech.QUEUE_ADD,null,"sentence-"+start);if(result==TextToSpeech.ERROR)throw new Exception("系统暂时无法朗读，请安装英语语音包");start=end;}
        return actual;
    }
    private void setSystemTheme(boolean dark){
        systemDark=dark;int c=dark?Color.rgb(22,31,27):Color.rgb(244,242,233);root.setBackgroundColor(c);
        if(pdfRoot!=null){pdfRoot.setBackgroundColor(c);pdfView.setPaperColor(c);pdfView.setBackgroundColor(dark?Color.rgb(30,38,32):Color.rgb(231,232,223));}
        getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);
        applySystemBars();
    }
    private static boolean shouldHideSystemBars(boolean reading,boolean source){return reading||source;}
    private void applySystemBars(){
        if(root==null)return;boolean hide=shouldHideSystemBars(immersiveReading,sourceRoot!=null),dark=systemDark;
        if(Build.VERSION.SDK_INT>=30){
            WindowInsetsController ctl=getWindow().getInsetsController();if(ctl==null)return;
            int appearance=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            ctl.setSystemBarsAppearance(dark?0:appearance,appearance);
            ctl.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if(hide)ctl.hide(WindowInsets.Type.systemBars());else ctl.show(WindowInsets.Type.systemBars());
        }else{
            int flags=View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if(!dark)flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            if(hide)flags|=View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        root.requestApplyInsets();
    }
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)applySystemBars();}

    private static boolean isResourceFile(String name){return name!=null&&name.toLowerCase(Locale.ROOT).matches(".*\\.(zip|rar|mdx|mdd|css)$");}
    private void pick(String id){
        if(pickerId!=null){reply(id,null,"已有文件选择器打开");return;}
        pickerId=id;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/epub+zip","application/pdf","text/plain","application/json","application/octet-stream","application/zip","application/vnd.rar","application/x-rar-compressed","application/x-mdict","text/css"});
        try{startActivityForResult(i,PICK);}catch(Exception e){pickerId=null;reply(id,null,"未找到系统文件选择器");}
    }
    private void appendData(JSONObject data)throws Exception{
        File f=selectedImport(data.getString("url"));long offset=data.getLong("offset");
        if(offset<0||offset!=f.length())throw new IOException("导入位置不一致");
        byte[] chunk=java.util.Base64.getDecoder().decode(data.getString("data"));
        if(chunk.length>262144||offset+chunk.length>DATA_LIMIT)throw new IOException("文件超过支持大小");
        synchronized(f){if(offset!=f.length())throw new IOException("导入位置不一致");try(OutputStream out=new FileOutputStream(f,true)){out.write(chunk);}}
    }
    private void export(String id,JSONObject d){
        if(exportId!=null){reply(id,null,"已有保存窗口打开");return;}
        try{exportDataFile=d.has("url")?selectedImport(d.getString("url")):null;}catch(Exception e){reply(id,null,"导出文件不可用");return;}
        exportId=id;exportText=d.optString("text");Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(exportDataFile==null?"application/json":"application/zip");i.putExtra(Intent.EXTRA_TITLE,d.optString("name","YiDu-notes.json"));
        try{startActivityForResult(i,EXPORT);}catch(Exception e){exportId=null;exportText=null;reply(id,null,"未找到系统保存窗口");}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==PICK){String id=pickerId;pickerId=null;if(id==null)return;if(result!=RESULT_OK||data==null||data.getData()==null){reply(id,jsonCancelled(),null);return;}
            Uri uri=data.getData();if(!"content".equals(uri.getScheme())){reply(id,null,"请选择系统文件提供器中的文件");return;}
            io.execute(()->{try{String name="book.epub";long size=-1;try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){if(cursor!=null&&cursor.moveToFirst()){name=cursor.getString(0);if(!cursor.isNull(1))size=cursor.getLong(1);}}if(name==null||!name.toLowerCase(Locale.ROOT).matches(".*\\.(epub|txt|pdf|json|zip|rar|mdx|mdd|css)$"))throw new IOException("请选择 EPUB、TXT、PDF、JSON、ZIP、RAR、MDX、MDD 或 CSS 文件");if(size>(isResourceFile(name)?RESOURCE_LIMIT:name.toLowerCase(Locale.ROOT).endsWith(".pdf")?PDF_LIMIT:LIMIT))throw new IOException("文件过大：PDF 上限 100MB，词典资源文件上限 1GB，其他图书上限 30MB");try(InputStream in=getContentResolver().openInputStream(uri)){reply(id,stash(in,name),null);}}catch(Exception e){reply(id,null,e.getMessage()==null?"无法读取此文件":e.getMessage());}});
        }else if(request==COVER){finishCoverPicker(result,data);
        }else if(request==SAVE_IMAGE){finishImageExport(result,data);
        }else if(request==EXPORT){String id=exportId,text=exportText;File exportFile=exportDataFile;exportId=null;exportText=null;exportDataFile=null;if(id==null)return;if(result!=RESULT_OK||data==null||data.getData()==null){reply(id,jsonCancelled(),null);return;}Uri uri=data.getData();if(!"content".equals(uri.getScheme())){reply(id,null,"无效的保存位置");return;}io.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();if(exportFile!=null){try(InputStream in=new FileInputStream(exportFile)){copy(in,out,DATA_LIMIT);}}else out.write(text.getBytes(StandardCharsets.UTF_8));reply(id,true,null);}catch(Exception e){reply(id,null,"保存失败，请检查目标位置");}});}
    }
    private JSONObject jsonCancelled(){JSONObject o=new JSONObject();try{o.put("cancelled",true);}catch(Exception ignored){}return o;}
    private JSONObject stash(InputStream in,String name)throws Exception{
        if(in==null)throw new IOException("无法读取文件");String token=UUID.randomUUID().toString();File f=new File(getCacheDir(),"import-"+token);try(OutputStream out=new FileOutputStream(f)){copy(in,out,isResourceFile(name)?RESOURCE_LIMIT:name.toLowerCase(Locale.ROOT).endsWith(".pdf")?PDF_LIMIT:LIMIT);}catch(Exception e){f.delete();throw e;}imports.put(token,f);JSONObject o=new JSONObject();o.put("url",ORIGIN+"/import/"+token);o.put("name",name);o.put("size",f.length());return o;
    }
    private void copy(InputStream in,OutputStream out,int limit)throws IOException{byte[] b=new byte[16384];int n;long total=0;while((n=in.read(b))!=-1){total+=n;if(total>limit)throw new IOException("文件超过支持大小");out.write(b,0,n);}}
    private URL validURL(String raw)throws Exception{
        URL u=new URL(raw);String host=u.getHost().toLowerCase(Locale.ROOT);if(!u.getProtocol().equals("https")||u.getUserInfo()!=null||host.isEmpty()||host.equals("localhost")||host.equals("appassets.androidplatform.net")||host.matches("^(127\\.|10\\.|192\\.168\\.|169\\.254\\.).*")||host.matches("^172\\.(1[6-9]|2[0-9]|3[01])\\..*")||host.contains(":"))throw new IOException("只支持公开 HTTPS 地址");return u;
    }
    private HttpURLConnection connection(String url,String method,String body,JSONObject headers,boolean apiKey,boolean cookies)throws Exception{
        URL current=validURL(url);
        for(int redirects=0;redirects<6;redirects++){
            HttpURLConnection c=(HttpURLConnection)current.openConnection();c.setConnectTimeout(18000);c.setReadTimeout(25000);c.setInstanceFollowRedirects(false);c.setRequestMethod(method);c.setRequestProperty("User-Agent","YiDuReader/0.3 Android");
            if(cookies){String cookie=android.webkit.CookieManager.getInstance().getCookie(current.toString());if(cookie!=null)c.setRequestProperty("Cookie",cookie);}
            if(headers!=null){Iterator<String> it=headers.keys();while(it.hasNext()){String k=it.next();if(k.equalsIgnoreCase("Content-Type")||k.equalsIgnoreCase("Accept"))c.setRequestProperty(k,headers.optString(k));}}
            if(apiKey){String key=readKey();if(key==null||key.isEmpty())throw new IOException("请先在个人页保存 API Key");c.setRequestProperty("Authorization","Bearer "+key);}
            if(!method.equals("GET")&&!body.isEmpty()){c.setDoOutput(true);try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}
            int code=c.getResponseCode();
            if(code>=300&&code<400){String location=c.getHeaderField("Location");c.disconnect();if(!"GET".equals(method)||apiKey)throw new IOException("翻译接口发生重定向，请填写最终 API 地址");if(location==null)throw new IOException("下载地址已失效");current=validURL(new URL(current,location).toString());continue;}
            if(code<200||code>=300){c.disconnect();throw new IOException(code==429?"服务请求过多或免费额度暂不可用":"服务连接失败（"+code+"）");}return c;
        }throw new IOException("网址重定向次数过多");
    }
    private String network(JSONObject d)throws Exception{
        String url=d.getString("url"),method=d.optString("method","GET");if(!method.equals("GET")&&!method.equals("POST"))throw new IOException("不支持此请求方式");
        boolean apiKey=d.optBoolean("useApiKey");String host=validURL(url).getHost();if(!apiKey&&!Arrays.asList("translate.googleapis.com","api.mymemory.translated.net","api.dictionaryapi.dev").contains(host))throw new IOException("该网络服务不在列表中");
        HttpURLConnection c=connection(url,method,d.optString("body"),d.optJSONObject("headers"),apiKey,false);try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,3*1024*1024);return out.toString("UTF-8");}finally{c.disconnect();}
    }
    private JSONObject download(String url,String requestedName,boolean cookies)throws Exception{
        HttpURLConnection c=connection(url,"GET","",null,false,cookies);try{
            String name=URLUtil.guessFileName(url,c.getHeaderField("Content-Disposition"),c.getContentType());
            if(name==null||!name.toLowerCase(Locale.ROOT).matches(".*\\.(epub|txt|pdf)$"))name=requestedName;
            if(name==null||!name.toLowerCase(Locale.ROOT).matches(".*\\.(epub|txt|pdf)$"))throw new IOException("目前仅接收 EPUB / TXT / PDF 图书");
            if(c.getContentLengthLong()>(isResourceFile(name)?RESOURCE_LIMIT:name.toLowerCase(Locale.ROOT).endsWith(".pdf")?PDF_LIMIT:LIMIT))throw new IOException("图书文件过大");
            try(InputStream in=c.getInputStream()){return stash(in,name);}
        }finally{c.disconnect();}
    }
    private void saveKey(String key)throws Exception{
        if(key.length()>4096)throw new IOException("API Key 格式不正确");KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias("lumi-api")){KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder("lumi-api",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();}
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,ks.getKey("lumi-api",null));String value=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(key.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);getPreferences(MODE_PRIVATE).edit().putString("api-key",value).apply();
    }
    private String readKey()throws Exception{
        String value=getPreferences(MODE_PRIVATE).getString("api-key",null);if(value==null)return null;String[] p=value.split(":");KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,ks.getKey("lumi-api",null),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    private static String sourceColor(JSONObject palette,String name,String fallback){
        String value=palette==null?fallback:palette.optString(name,fallback);
        return value.length()<=80&&value.matches("(?:#[0-9a-fA-F]{3,8}|rgba?\\([0-9., %]+\\))")?value:fallback;
    }
    private void showSource(String url,JSONObject options)throws IOException{
        if(sourceRoot!=null)closeSource();
        JSONObject palette=options==null?null:options.optJSONObject("palette");
        String feedback=options==null?"gentle":options.optString("hapticFeedback","gentle");sourceHapticMode=Arrays.asList("off","gentle","standard").contains(feedback)?feedback:"gentle";
        String paper=sourceColor(palette,"paper",systemDark?"#161f1b":"#f4f2e9");
        sourcePaper=systemDark?Color.rgb(22,31,27):Color.rgb(244,242,233);
        try{sourcePaper=Color.parseColor(paper);}catch(IllegalArgumentException ignored){}
        StringBuilder css=new StringBuilder("--paper:"+paper+";--source-safe-top:"+(insetCutoutTop/getResources().getDisplayMetrics().density)+"px;");
        for(String[] item:new String[][]{{"ink",systemDark?"#e2e7db":"#24362b"},{"accent",systemDark?"#b3ca9e":"#355e46"},{"line","rgba(59,78,61,.11)"},{"tint","rgba(92,132,84,.12)"},{"glass",systemDark?"rgba(45,59,47,.8)":"rgba(255,255,247,.63)"},{"edge",systemDark?"rgba(180,200,170,.2)":"rgba(255,255,255,.92)"}})css.append("--").append(item[0]).append(":").append(sourceColor(palette,item[0],item[1])).append(";");
        String template;try(InputStream in=getAssets().open("source-toolbar.html");ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,64000);template=out.toString("UTF-8");}
        String html=template.replace("%REDUCED%",String.valueOf(options!=null&&options.optBoolean("reducedMotion"))).replace("%PALETTE%",css.toString()).replace("%LANG%",resolvedUiLanguage()).replace("%BACK%",android.text.TextUtils.htmlEncode(uiText("返回"))).replace("%TITLE%",android.text.TextUtils.htmlEncode(uiText("图书网站 · EPUB / TXT / PDF 可导入"))).replace("%DONE%",android.text.TextUtils.htmlEncode(uiText("完成")));
        sourceRoot=new FrameLayout(this);sourceRoot.setBackgroundColor(sourcePaper);
        sourceLayout=new FrameLayout(this);
        try(InputStream in=getAssets().open("source-page-inset.js");ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,16000);sourceInsetScript=out.toString("UTF-8");}
        try(InputStream in=getAssets().open("assets/reader-edge.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,4096);sourceInsetScript=sourceInsetScript.replace("%EDGE_LAYERS%",new JSONObject(out.toString("UTF-8")).getJSONArray("layers").toString());}catch(org.json.JSONException error){throw new IOException("顶部模糊配置无效",error);}
        sourceHeader=new FrameLayout(this);sourceHeader.setBackgroundColor(Color.TRANSPARENT);
        sourceToolbar=new WebView(this);configure(sourceToolbar,true);sourceToolbar.getSettings().setDomStorageEnabled(false);sourceToolbar.setBackgroundColor(Color.TRANSPARENT);sourceToolbar.setHapticFeedbackEnabled(!"off".equals(sourceHapticMode));sourceToolbar.setOnLongClickListener(v->true);
        // Only the bundled press-state script runs here; no native bridge or website navigation.
        sourceToolbar.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String u){if(v==sourceToolbar)updateSourceToolbarInset();}
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return sourceToolbarAction(r.getUrl());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                Uri uri=r.getUrl();String path=uri.getPath();
                if(!isOwned(uri)||path==null||path.contains("..")||!path.startsWith("/assets/"))return emptyResponse();
                String asset=path.substring(8);if(!(asset.equals("source-toolbar.js")||asset.equals("style.css")||asset.equals("assets/icons/style.css")||asset.equals("assets/Literary.ttf")||asset.equals("assets/icons/Phosphor.woff2")))return emptyResponse();
                try{return new WebResourceResponse(mime(asset),"UTF-8",getAssets().open(asset));}catch(IOException e){return emptyResponse();}
            }
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){if(sourceToolbar==v)sourceToolbar=null;ViewParent p=v.getParent();if(p instanceof ViewGroup)((ViewGroup)p).removeView(v);v.destroy();closeSource();return true;}
        });
        sourceHeader.addView(sourceToolbar,new FrameLayout.LayoutParams(-1,dp(64)));
        sourceWeb=new WebView(this);configure(sourceWeb,false);sourceWeb.setWebChromeClient(new WebChromeClient());sourceWeb.setWebViewClient(new WebViewClient(){@Override public void onPageCommitVisible(WebView v,String u){if(v==sourceWeb)updateSourcePageInset();}@Override public void onPageFinished(WebView v,String u){if(v==sourceWeb)updateSourcePageInset();}@Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){return recoverRenderer(v,detail);}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){try{validURL(r.getUrl().toString());return false;}catch(Exception e){toast("此页面仅支持 HTTPS 访问");return true;}}});
        sourceWeb.setDownloadListener((u,agent,disposition,mimetype,length)->{String name=URLUtil.guessFileName(u,disposition,mimetype);if(!name.toLowerCase(Locale.ROOT).matches(".*\\.(epub|txt|pdf)$")){toast("目前支持 EPUB / TXT / PDF 下载，其他格式请使用系统浏览器");return;}toast("正在下载，完成后会加入书架");io.execute(()->{try{JSONObject result=download(u,name,true);runOnUiThread(()->{closeSource();if(web!=null)web.evaluateJavascript("window.Lumi.receiveDownload("+JSONObject.quote(result.optString("url"))+","+JSONObject.quote(result.optString("name"))+")",null);});}catch(Exception e){toast(uiText("下载未完成：")+uiText(e.getMessage()));}});});
        sourceWeb.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{if(r-l!=or-ol||b-t!=ob-ot)updateSourcePageInset();});
        sourceLayout.addView(sourceWeb,new FrameLayout.LayoutParams(-1,-1));sourceLayout.addView(sourceHeader,new FrameLayout.LayoutParams(-1,dp(64)));sourceRoot.addView(sourceLayout,new FrameLayout.LayoutParams(-1,-1));root.addView(sourceRoot,new FrameLayout.LayoutParams(-1,-1));layoutSource();applySystemBars();sourceToolbar.loadDataWithBaseURL(ORIGIN+"/assets/",html,"text/html","UTF-8",null);sourceWeb.loadUrl(url);
    }
    private void sourceButtonHaptic(){
        if(sourceToolbar==null||"off".equals(sourceHapticMode)||!sourceToolbar.isShown()||!sourceToolbar.hasWindowFocus())return;
        int effect=hapticFeedbackFor("soft",Build.VERSION.SDK_INT);
        if(effect>=0)sourceToolbar.performHapticFeedback(effect);
    }
    private boolean sourceToolbarAction(Uri uri){
        if(isOwned(uri)&&uri.getQuery()==null&&uri.getFragment()==null){
            if("/source/back".equals(uri.getPath())){sourceButtonHaptic();if(sourceWeb!=null&&sourceWeb.canGoBack())sourceWeb.goBack();else closeSource();}
            else if("/source/close".equals(uri.getPath())){sourceButtonHaptic();closeSource();}
        }
        return true;
    }
    private void layoutSource(){
        if(sourceRoot==null)return;sourceRoot.setPadding(insetCutoutLeft,0,insetCutoutRight,0);
        if(sourceHeader!=null){FrameLayout.LayoutParams header=(FrameLayout.LayoutParams)sourceHeader.getLayoutParams();int height=dp(64)+insetCutoutTop;if(header.height!=height){header.height=height;sourceHeader.setLayoutParams(header);}}
        updateSourcePageInset();
        if(sourceToolbar!=null){FrameLayout.LayoutParams toolbar=(FrameLayout.LayoutParams)sourceToolbar.getLayoutParams();int height=dp(64)+insetCutoutTop;if(toolbar.height!=height||toolbar.topMargin!=0){toolbar.height=height;toolbar.topMargin=0;sourceToolbar.setLayoutParams(toolbar);updateSourceToolbarInset();}}
    }
    private void updateSourceToolbarInset(){
        if(sourceToolbar!=null)sourceToolbar.evaluateJavascript("document.documentElement.style.setProperty('--source-safe-top','"+(insetCutoutTop/getResources().getDisplayMetrics().density)+"px')",null);
    }
    private void updateSourcePageInset(){
        if(sourceWeb==null||sourceInsetScript==null||sourceWeb.getWidth()<=0)return;
        sourceWeb.evaluateJavascript(sourceInsetScript.replace("%HEADER_PX%",String.valueOf(dp(64)+insetCutoutTop)).replace("%VIEW_WIDTH%",String.valueOf(sourceWeb.getWidth())),null);
    }
    private void pickCover(String id){
        if(coverPickerId!=null){reply(id,null,"已有图片选择器打开");return;}coverPickerId=id;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image/*");
        try{startActivityForResult(intent,COVER);}catch(Exception e){coverPickerId=null;reply(id,null,"未找到系统图片选择器");}
    }
    private void finishCoverPicker(int result,Intent data){
        String id=coverPickerId;coverPickerId=null;if(id==null)return;if(result!=RESULT_OK||data==null||data.getData()==null){reply(id,jsonCancelled(),null);return;}Uri uri=data.getData();if(!"content".equals(uri.getScheme())){reply(id,null,"请选择系统图片");return;}
        io.execute(()->{Bitmap image=null;try{
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;try(InputStream in=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(in,null,bounds);}if(bounds.outWidth<=0||bounds.outHeight<=0)throw new IOException("图片无法打开");
            BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>2000)options.inSampleSize*=2;
            try(InputStream in=getContentResolver().openInputStream(uri)){image=BitmapFactory.decodeStream(in,null,options);}if(image==null)throw new IOException("图片无法打开");
            int orientation=ExifInterface.ORIENTATION_NORMAL;try(InputStream in=getContentResolver().openInputStream(uri)){orientation=new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);}catch(Exception ignored){}
            Matrix matrix=new Matrix();switch(orientation){case 2:matrix.setScale(-1,1);break;case 3:matrix.setRotate(180);break;case 4:matrix.setScale(1,-1);break;case 5:matrix.setRotate(90);matrix.postScale(-1,1);break;case 6:matrix.setRotate(90);break;case 7:matrix.setRotate(270);matrix.postScale(-1,1);break;case 8:matrix.setRotate(270);break;}
            if(!matrix.isIdentity()){Bitmap corrected=Bitmap.createBitmap(image,0,0,image.getWidth(),image.getHeight(),matrix,true);if(corrected!=image){image.recycle();image=corrected;}}
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.JPEG,90,bytes);reply(id,stash(new ByteArrayInputStream(bytes.toByteArray()),"cover.jpg"),null);
        }catch(Exception|OutOfMemoryError e){reply(id,null,"图片无法打开，请选择较小的图片");}finally{if(image!=null&&!image.isRecycled())image.recycle();}});
    }
    private File selectedImport(String url)throws Exception{Uri uri=Uri.parse(url);if(!isOwned(uri)||uri.getPath()==null||!uri.getPath().matches("/import/[a-fA-F0-9-]{36}"))throw new IOException("导入文件无效");File file=imports.get(uri.getLastPathSegment());if(file==null||!file.isFile())throw new IOException("导入文件已失效，请重新选择");return file;}
    private File pdfFile(String id,String extension)throws Exception{if(!id.matches("pdf-[a-f0-9]{64}"))throw new IOException("PDF 标识无效");File dir=new File(getFilesDir(),"pdf");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("无法创建 PDF 存储目录");return new File(dir,id+extension);}
    private JSONObject readPdfInfo(File file)throws Exception{try(InputStream in=new FileInputStream(file);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){copy(in,bytes,4*1024*1024);return new JSONObject(bytes.toString("UTF-8"));}}
    private JSONObject pdfSummary(JSONObject info)throws Exception{return new JSONObject().put("id",info.getString("id")).put("title",info.getString("title")).put("pages",info.getInt("pages")).put("cover",info.optString("cover",null));}
    private synchronized JSONObject importPdf(JSONObject request)throws Exception{
        File source=selectedImport(request.getString("url"));if(source.length()>PDF_LIMIT)throw new IOException("PDF 文件超过 100MB");MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(source)){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}StringBuilder hash=new StringBuilder();for(byte value:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",value&255));String id="pdf-"+hash;
        File pdf=pdfFile(id,".pdf"),meta=pdfFile(id,".json");if(pdf.isFile()&&meta.isFile())return readPdfInfo(meta);
        JSONObject info;try{info=PdfReaderView.inspect(source);}catch(SecurityException e){throw new IOException("此 PDF 已加密，暂不支持打开");}catch(Exception e){throw new IOException("PDF 无法打开，文件可能损坏或格式不受支持");}
        String title=request.optString("name","PDF").replaceFirst("(?i)\\.pdf$","");if(title.length()>200)title=title.substring(0,200);info.put("id",id).put("title",title);
        File staging=pdfFile(id,".part"),metaStage=pdfFile(id,".json.part");boolean copied=false;try{
            try(InputStream in=new FileInputStream(source);OutputStream out=new FileOutputStream(staging)){copy(in,out,PDF_LIMIT);}try(OutputStream out=new FileOutputStream(metaStage)){out.write(info.toString().getBytes(StandardCharsets.UTF_8));}
            if(!staging.renameTo(pdf))throw new IOException("PDF 保存失败");copied=true;if(!metaStage.renameTo(meta))throw new IOException("PDF 页面信息保存失败");return info;
        }catch(Exception e){if(copied)pdf.delete();throw e;}finally{staging.delete();metaStage.delete();}
    }
    private synchronized void deletePdf(String id)throws Exception{File file=pdfFile(id,".pdf"),meta=pdfFile(id,".json");if(file.exists()&&!file.delete())throw new IOException("PDF 文件移除失败");meta.delete();getPreferences(MODE_PRIVATE).edit().remove("pdf-page:"+id).remove("pdf-offset:"+id).remove("pdf-time:"+id).apply();}
    private void notifyPdfPosition(String id,int page,double offset,boolean closed){getPreferences(MODE_PRIVATE).edit().putInt("pdf-page:"+id,page).putFloat("pdf-offset:"+id,(float)offset).putLong("pdf-time:"+id,System.currentTimeMillis()).apply();if(web!=null)web.evaluateJavascript("window.Lumi&&window.Lumi.pdfPosition("+JSONObject.quote(id)+","+page+","+offset+","+closed+")",null);}
    private String pdfOpeningRequest;
    private volatile String pdfRequestedSession;
    private void openPdf(JSONObject request,String requestId,int epoch)throws Exception{
        String id=request.getString("id");File file=pdfFile(id,".pdf"),metadata=pdfFile(id,".json");if(!file.isFile()||!metadata.isFile())throw new IOException("PDF 文件不存在，请重新导入");JSONObject info=readPdfInfo(metadata);JSONArray sizes=info.getJSONArray("sizes");boolean nativeNewer=getPreferences(MODE_PRIVATE).getLong("pdf-time:"+id,0)>request.optLong("positionTime",0);int start=Math.max(0,Math.min(sizes.length()-1,nativeNewer?getPreferences(MODE_PRIVATE).getInt("pdf-page:"+id,0):request.optInt("page",0)));double offset=nativeNewer?getPreferences(MODE_PRIVATE).getFloat("pdf-offset:"+id,0):request.optDouble("offset",0);if(!Double.isFinite(offset))offset=0;final double initialOffset=offset;String title=request.optString("title",info.optString("title","PDF"));
        runOnUiThread(()->{try{
            if(epoch!=pdfOpenEpoch.get()||isFinishing()||isDestroyed()){reply(requestId,jsonCancelled(),null);return;}
            closePdf(false);closeSource();pdfBookId=id;pdfSession=request.optString("session");pdfLayoutEpoch=0;pdfModal=false;pdfTransitioning=true;pdfHitRegions.clear();
            pdfRoot=new FrameLayout(this);pdfRoot.setClickable(true);pdfRoot.setBackgroundColor(systemDark?Color.rgb(22,31,27):Color.rgb(244,242,233));
            pdfView=new PdfReaderView(this,file,sizes,start,initialOffset,new PdfReaderView.Listener(){
                public void position(int page,double progress){if(id.equals(pdfBookId))notifyPdfPosition(id,page,progress,false);}
                public void error(String message){if(id.equals(pdfBookId))toast(message);}
                public void tap(){if(id.equals(pdfBookId)&&web!=null)web.evaluateJavascript("window.Lumi.pdfToggle()",null);}
                public void longPress(int page,double offset){if(id.equals(pdfBookId)&&web!=null){pdfView.pauseReading();pdfModal=true;web.evaluateJavascript("window.Lumi.pdfBookmark("+JSONObject.quote(id)+","+page+","+offset+")",null);}}
            });
            pdfView.setLeadingSpace(Math.max(12,Math.round((float)request.optDouble("leadingSpace",56)*getResources().getDisplayMetrics().density)));pdfView.setPaperColor(systemDark?Color.rgb(22,31,27):Color.rgb(244,242,233));
            pdfView.setBackgroundColor(systemDark?Color.rgb(30,38,32):Color.rgb(231,232,223));
            pdfRoot.addView(pdfView,new FrameLayout.LayoutParams(-1,-1));pdfRoot.setPadding(insetLeft,0,insetRight,0);
            // Prepare beneath the opaque shelf. Alpha zero would skip drawing and
            // cannot be used to wait for a genuinely rendered first page.
            pdfRoot.setAlpha(1f);pdfRoot.setScaleX(request.optBoolean("animate",true)?.94f:1f);pdfRoot.setScaleY(request.optBoolean("animate",true)?.94f:1f);root.addView(pdfRoot,new FrameLayout.LayoutParams(-1,-1));
            pdfOpeningRequest=requestId;final FrameLayout preparing=pdfRoot;
            pdfView.whenFirstFrame(()->{if(pdfRoot!=preparing||epoch!=pdfOpenEpoch.get())return;pdfOpeningRequest=null;reply(requestId,true,null);},()->{if(pdfRoot!=preparing)return;pdfOpeningRequest=null;closePdf(false);reply(requestId,null,"PDF 页面未能显示，请重新导入文件");});
            if(web!=null){web.setBackgroundColor(Color.TRANSPARENT);root.bringChildToFront(web);web.requestFocus();}
            android.view.inputmethod.InputMethodManager keyboard=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);if(keyboard!=null)keyboard.hideSoftInputFromWindow(root.getWindowToken(),0);
        }catch(Exception e){pdfOpeningRequest=null;closePdf(false);reply(requestId,null,"PDF 阅读器未能打开，请重新导入文件");}});
    }
    private void pdfControl(JSONObject data,String requestId){runOnUiThread(()->{try{
        if(pdfView==null||!data.optString("id").equals(pdfBookId)||!data.optString("session").equals(pdfSession)){reply(requestId,jsonCancelled(),null);return;}
        String command=data.optString("command");
        if("close".equals(command)){closePdf();reply(requestId,true,null);return;}
        if("settle".equals(command)){pdfTransitioning=false;reply(requestId,true,null);return;}
        if("leave".equals(command)||"enter".equals(command)){
            boolean entering="enter".equals(command);pdfTransitioning=true;final FrameLayout surface=pdfRoot;surface.animate().cancel();
            float scale=entering?1f:.94f;
            if(data.optBoolean("animate",true))surface.animate().alpha(entering?1f:0f).scaleX(scale).scaleY(scale).translationY(0).setDuration(240).setInterpolator(new android.view.animation.PathInterpolator(.18f,.85f,.25f,1f)).start();
            else{surface.setAlpha(entering?1f:0f);surface.setScaleX(scale);surface.setScaleY(scale);}
            reply(requestId,true,null);return;
        }
        if("layout".equals(command)){
            long sequence=data.optLong("sequence",0);if(sequence<=pdfLayoutEpoch){reply(requestId,true,null);return;}pdfLayoutEpoch=sequence;
            boolean nextModal=data.optBoolean("modal");if(nextModal&&!pdfModal)pdfView.pauseReading();else if(!nextModal&&pdfModal)pdfView.resumeReading();pdfModal=nextModal;pdfHitRegions.clear();float density=getResources().getDisplayMetrics().density;
            JSONArray regions=data.optJSONArray("regions");if(regions!=null)for(int i=0;i<Math.min(12,regions.length());i++){JSONArray r=regions.getJSONArray(i);pdfHitRegions.add(new RectF((float)r.getDouble(0)*density,(float)r.getDouble(1)*density,(float)r.getDouble(2)*density,(float)r.getDouble(3)*density));}
            pdfView.setLeadingSpace(Math.max(12,Math.round((float)data.optDouble("leadingSpace",56)*density)));
            pdfView.setEdgeHeight(Math.max(4,Math.min(dp(64),Math.round((float)data.optDouble("edgeHeight",28)*density))));
        }else if("go".equals(command))pdfView.goTo(data.optInt("page",0),data.optDouble("offset",0));
        else if("pause".equals(command))pdfView.pauseReading();else if("resume".equals(command))pdfView.resumeReading();
        reply(requestId,true,null);
    }catch(Exception e){reply(requestId,null,"PDF 操作未完成");}});}
    private void closePdf(){closePdf(true);}
    private void closePdf(boolean invalidate){if(pdfOpeningRequest!=null){String pending=pdfOpeningRequest;pdfOpeningRequest=null;reply(pending,jsonCancelled(),null);}if(invalidate)pdfOpenEpoch.incrementAndGet();if(pdfView!=null){int page=pdfView.currentPage();double offset=pdfView.pageOffset();String id=pdfBookId;pdfView.close();pdfView=null;if(id!=null)notifyPdfPosition(id,page,offset,true);}if(pdfRoot!=null){pdfRoot.animate().cancel();root.removeView(pdfRoot);pdfRoot=null;}pdfBookId=null;immersiveReading=false;applySystemBars();pdfModal=false;pdfTransitioning=false;pdfHitRegions.clear();if(web!=null){web.setBackgroundColor(systemDark?Color.rgb(22,31,27):Color.rgb(244,242,233));if(invalidate)web.evaluateJavascript("window.Lumi&&window.Lumi.pdfClosed()",null);}}
    private void saveImage(JSONObject request,String id)throws Exception{
        String src=request.getString("src"),mime;byte[] bytes;
        if(src.matches("assets/prince-illustrations/[^/]+\\.(jpg|png|webp)")){mime=src.endsWith(".png")?"image/png":src.endsWith(".webp")?"image/webp":"image/jpeg";try(InputStream in=getAssets().open(src);ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,5*1024*1024);bytes=out.toByteArray();}}
        else if(src.matches("data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+")){mime=src.substring(5,src.indexOf(';'));bytes=Base64.decode(src.substring(src.indexOf(',')+1),Base64.DEFAULT);if(bytes.length>5*1024*1024)throw new IOException("图片过大");}
        else throw new IOException("图片来源无效");
        String extension="image/jpeg".equals(mime)?"jpg":mime.substring(6),name="TransRead-"+System.currentTimeMillis()+"-"+UUID.randomUUID().toString().substring(0,6)+"."+extension;
        if(Build.VERSION.SDK_INT>=29){ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,name);values.put(MediaStore.Images.Media.MIME_TYPE,mime);values.put(MediaStore.Images.Media.RELATIVE_PATH,Environment.DIRECTORY_PICTURES+"/TransRead");values.put(MediaStore.Images.Media.IS_PENDING,1);Uri uri=getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new IOException("图片保存失败");try{try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("图片保存失败");out.write(bytes);}values.clear();values.put(MediaStore.Images.Media.IS_PENDING,0);if(getContentResolver().update(uri,values,null,null)<1)throw new IOException("图片保存失败");reply(id,new JSONObject().put("uri",uri.toString()),null);}catch(Exception e){getContentResolver().delete(uri,null,null);throw e;}}
        else{File file=File.createTempFile("image-export-","."+extension,getCacheDir());try(OutputStream out=new FileOutputStream(file)){out.write(bytes);}runOnUiThread(()->{if(imageExportId!=null){file.delete();reply(id,null,"已有图片保存窗口打开");return;}imageExportId=id;imageExportFile=file;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,name);try{startActivityForResult(intent,SAVE_IMAGE);}catch(Exception e){file.delete();imageExportFile=null;imageExportId=null;reply(id,null,"未找到系统保存窗口");}});}
    }
    private void finishImageExport(int result,Intent data){String id=imageExportId;File file=imageExportFile;imageExportId=null;imageExportFile=null;if(id==null)return;if(result!=RESULT_OK||data==null||data.getData()==null){if(file!=null)file.delete();reply(id,jsonCancelled(),null);return;}Uri uri=data.getData();if(!"content".equals(uri.getScheme())){if(file!=null)file.delete();reply(id,null,"无效的保存位置");return;}io.execute(()->{try(InputStream in=new FileInputStream(file);OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();copy(in,out,5*1024*1024);reply(id,true,null);}catch(Exception e){reply(id,null,"图片保存失败");}finally{file.delete();}});}
    @Override public void onTrimMemory(int level){super.onTrimMemory(level);if(pdfView!=null&&level>=android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)pdfView.releaseMemory();}

    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void closeSource(){
        if(sourceToolbar!=null){sourceToolbar.stopLoading();sourceToolbar.destroy();sourceToolbar=null;}
        if(sourceWeb!=null){sourceWeb.stopLoading();sourceWeb.destroy();sourceWeb=null;}
        if(sourceRoot!=null){root.removeView(sourceRoot);sourceRoot=null;}
        sourceHeader=null;sourceLayout=null;sourceInsetScript=null;applySystemBars();
    }
    private void handleBack(){if(sourceRoot!=null){if(sourceWeb!=null&&sourceWeb.canGoBack())sourceWeb.goBack();else closeSource();return;}if(pdfRoot!=null){if(pdfModal&&web!=null)web.evaluateJavascript("window.Lumi.back()",null);else if(web!=null)web.evaluateJavascript("window.Lumi&&window.Lumi.pdfExit()",null);else closePdf();return;}if(web==null){recreate();return;}web.evaluateJavascript("window.Lumi?window.Lumi.back():false",result->{if(!"true".equals(result))finish();});}
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onPause(){if(offlineSpeech!=null)offlineSpeech.cancel();if(pdfView!=null)pdfView.pauseReading();if(web!=null){web.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'))",null);web.onPause();}if(tts!=null)tts.stop();super.onPause();}
    @Override protected void onResume(){super.onResume();if(pdfView!=null)pdfView.resumeReading();if(web!=null){web.onResume();applySystemBars();publishSystemLocales();publishSystemAppearance();}}
    @Override protected void onDestroy(){if(offlineSpeech!=null)offlineSpeech.close();closePdf();if(imageExportFile!=null)imageExportFile.delete();if(tts!=null){tts.stop();tts.shutdown();}closeSource();if(web!=null){web.removeJavascriptInterface("LumiNative");web.destroy();web=null;}io.shutdownNow();super.onDestroy();}
}
