/* Executes the current Bridge code with stub UI/TTS/JSON services and saturated I/O workers.
 * This checks routing only; it does not exercise real Android services or latency. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),native=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/MainActivity.java'),'utf8');
const bridge=native.slice(native.indexOf('    public class Bridge {'),native.indexOf('    private void configureEdgeToEdge')).replaceAll('@JavascriptInterface ','');
const validate=native.slice(native.indexOf('    private URL validURL('),native.indexOf('    private HttpURLConnection connection('));
assert(bridge.includes('class Bridge'));assert(validate.includes('只支持公开 HTTPS 地址'));
assert.match(native,/if\(owned&&Build\.VERSION\.SDK_INT>=35\)view\.setRequestedFrameRate\(View\.REQUESTED_FRAME_RATE_CATEGORY_HIGH\)/);
console.log('PASS Android 15+ owned reader WebView requests high refresh only while drawing');
const dir=fs.mkdtempSync(path.join(root,'build/native-routing-'));
const source=String.raw`
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
public class NativeUiRoutingHarness {
 final ExecutorService io=Executors.newFixedThreadPool(3);
 final java.util.concurrent.atomic.AtomicInteger pdfOpenEpoch=new java.util.concurrent.atomic.AtomicInteger();
 final Queue<Runnable> ui=new ConcurrentLinkedQueue<>();
 final List<String> hits=new CopyOnWriteArrayList<>(),errors=new CopyOnWriteArrayList<>();
 final Map<String,File> imports=new ConcurrentHashMap<>();
 boolean immersiveReading=false,ttsReady=true;String pdfRequestedSession,pdfSession;void closePdf(boolean x){}JSONObject jsonCancelled(){return new JSONObject("{}");}
 static final int MODE_PRIVATE=0;
 static class LocaleStub{int uiMode=0;}
 static class SharedPreferences{String getString(String key,String fallback){return fallback;}}
 static class Color{static int parseColor(String value){return 0;}}
 static class WindowStub{boolean hasWindowFocus(){return true;}}
 WindowStub web=new WindowStub();
 SharedPreferences getPreferences(int mode){return new SharedPreferences();}
 boolean startupDark(){return false;}int startupColor(String name,String fallback){return 0;}
 void saveStartupTheme(JSONObject data){hits.add("startupTheme");}
 String toastError="";void toast(String text){toastError=text;}
 File selectedImport(String url){return new File("unused");}
 interface SpeechResult{void done(Object value,String error);}
 class OfflineStub{String active(){return "";}void cancel(){}void speak(String text,String id,SpeechResult result){result.done(true,null);}void request(String op,JSONObject data,File file,SpeechResult result){result.done(true,null);}}
 OfflineStub offlineSpeech=new OfflineStub();
 String speakSystem(String text,String accent,boolean generic)throws Exception{speakSystem(text);return accent;}
 void speakSystem(String text)throws Exception{if(!ttsReady)throw new Exception("not ready");tts.stop();tts.speak(text,1,null,"test");}

 TextToSpeech tts=new TextToSpeech(hits);
 static final String ORIGIN="https://appassets.androidplatform.net";
 File getCacheDir(){return new File(System.getProperty("java.io.tmpdir"));}
 void appendData(JSONObject data){}
 File pdfFile(String id,String extension){return new File(getCacheDir(),id+extension);}
 JSONObject stash(InputStream in,String name){return new JSONObject("{}");}
 void runOnUiThread(Runnable action){ui.add(action);}
 void drainUi(){Runnable action;while((action=ui.poll())!=null)action.run();}
 void applySystemBars(){hits.add("immersive");}
 void setUiLanguage(String language){hits.add("locale");}
 void setSystemTheme(boolean dark){hits.add("theme");}
 void reply(String id,Object data,String error){if(error!=null)errors.add(id+":"+error);}
 void pick(String id){hits.add("pickFile");}
 void pickCover(String id){hits.add("pickCover");}
 JSONObject pdfSummary(JSONObject data){return data;}
 JSONObject importPdf(JSONObject data){hits.add("importPdf");return data;}
 void openPdf(JSONObject data,String id,int epoch){hits.add("openPdf");}
 void pdfControl(JSONObject data,String id){hits.add("pdfControl");}
 void deletePdf(String id){hits.add("deletePdf");}
 void saveImage(JSONObject data,String id){hits.add("saveImage");}
 void export(String id,JSONObject data){hits.add("export");}
 void showSource(String url,JSONObject palette){hits.add("openSource");}
 void playHaptic(JSONObject data){hits.add("haptic");}
 void openTtsSettings(String id){hits.add("ttsSettings");}
 String network(JSONObject data){hits.add("net");return "ok";}
 String download(String url,String name,boolean cookies){hits.add("download");return "ok";}
 void saveKey(String key){hits.add("saveApiKey");}
 static class TextToSpeech{List<String> hits;TextToSpeech(List<String> hits){this.hits=hits;}static final int QUEUE_FLUSH=0,QUEUE_ADD=1,ERROR=-1;static int getMaxSpeechInputLength(){return 4000;}int speak(String text,int mode,Object bundle,String id){hits.add("speak");return 0;}int stop(){hits.add("stopSpeak");return 0;}}
 static class Uri{String value;static Uri parse(String value){Uri uri=new Uri();uri.value=value;return uri;}String getLastPathSegment(){return value.substring(value.lastIndexOf('/')+1);}}
 // Only simple fixture fields are parsed; production still uses org.json.JSONObject.
 static class JSONObject{boolean has(String key){return !optString(key).isEmpty();}String text;JSONObject(){text="{}";}JSONObject(String value){text=value;}void put(String key,Object value){}String optString(String key){return optString(key,"");}String optString(String key,String fallback){int at=text.indexOf("\""+key+"\"");if(at<0)return fallback;int colon=text.indexOf(':',at),start=text.indexOf('"',colon+1),end=text.indexOf('"',start+1);return start<0||end<0?fallback:text.substring(start+1,end);}public String toString(){return text;}String getString(String key)throws Exception{String value=optString(key,null);if(value==null)throw new Exception("missing field");return value;}boolean optBoolean(String key){return text.contains("\""+key+"\":true");}JSONObject optJSONObject(String key){return null;}}
 static void check(String label,boolean result){if(!result)throw new AssertionError(label);System.out.println("PASS "+label);}
 public static void main(String[] args)throws Exception{
  NativeUiRoutingHarness h=new NativeUiRoutingHarness();CountDownLatch occupied=new CountDownLatch(3),release=new CountDownLatch(1);
  try{
   for(int i=0;i<3;i++)h.io.execute(()->{occupied.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}});
   if(!occupied.await(3,TimeUnit.SECONDS))throw new AssertionError("I/O setup failed");
   Bridge b=h.new Bridge();String payload="{\"text\":\"hello\",\"url\":\"https://example.org/books\"}";
   String[] operations={"locale","theme","immersive","speak","stopSpeak","pickFile","pickCover","export","openSource","ttsSettings","haptic"};
   for(String op:operations)b.request(op,payload,op);
   check("All interface commands reach the UI queue while every I/O worker is blocked",h.ui.size()==operations.length);
   h.drainUi();check("UI commands preserve order and speech/file/source actions do not wait for network completion",h.hits.equals(Arrays.asList("locale","theme","immersive","stopSpeak","speak","stopSpeak","pickFile","pickCover","export","openSource","ttsSettings","haptic")));
   h.ttsReady=false;b.request("speak",payload,"not-ready");b.request("openSource","{\"url\":\"http://example.org\"}","invalid-url");h.drainUi();
   check("Immediate UI routing preserves voice readiness and HTTPS validation errors",h.errors.size()==2&&h.errors.get(0).startsWith("not-ready:")&&h.errors.get(1).startsWith("invalid-url:"));
   b.request("net","{}","net");check("Network work stays off the UI queue and remains bounded by the I/O executor",h.ui.isEmpty()&&!h.hits.contains("net"));
   release.countDown();h.io.shutdown();if(!h.io.awaitTermination(3,TimeUnit.SECONDS))throw new AssertionError("I/O did not finish");
   check("Queued network work still completes after the occupied workers are released",h.hits.contains("net"));
   System.out.println("\n6 native routing checks passed with stub services. No Android device claims.");
  }finally{release.countDown();h.io.shutdownNow();}
 }
`+bridge+validate+'\n}\n';
fs.writeFileSync(path.join(dir,'NativeUiRoutingHarness.java'),source);
const compiled=spawnSync('java',['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'NativeUiRoutingHarness.java')],{encoding:'utf8',timeout:20000});
if(compiled.status!==0){process.stderr.write(compiled.stdout+compiled.stderr);process.exit(1);}
const result=spawnSync('java',['-cp',dir,'NativeUiRoutingHarness'],{encoding:'utf8',timeout:10000});process.stdout.write(result.stdout||'');if(result.status!==0){process.stderr.write(result.stderr||'');process.exit(1);}
