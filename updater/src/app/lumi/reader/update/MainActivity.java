package app.lumi.reader.update;
import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.*;
import android.graphics.Color;
import android.net.Uri;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.ref.WeakReference;
import java.security.MessageDigest;
import java.util.concurrent.*;
public final class MainActivity extends Activity {
 static final String APP="app.lumi.reader",CERT="8d21d7bc40b619f048f03e266031c59f7ad50cff5337203f5dce891d487c61fd";
 private static WeakReference<MainActivity> active=new WeakReference<>(null);
 private final ExecutorService worker=Executors.newSingleThreadExecutor();private final Handler main=new Handler(Looper.getMainLooper());
 private TextView status,versions;private Button next;private ProgressBar progress;private boolean ready,busy,checking,installed,foreground,continueAfterPermission;private File apk;private long inspection;private String installedName="?",installedHash="",diagnostic="";private int observed=InstallRules.OLD;
 @Override public void onCreate(Bundle state){
  setTheme(android.R.style.Theme_Material_Light_NoActionBar);super.onCreate(state);apk=new File(getCacheDir(),"release.apk");boolean dark=(getResources().getConfiguration().uiMode&48)==32;int paper=Color.rgb(dark?28:247,dark?33:249,dark?30:245),ink=dark?Color.WHITE:Color.rgb(38,48,42);getWindow().setStatusBarColor(paper);getWindow().setNavigationBarColor(paper);
  LinearLayout root=new LinearLayout(this);root.setOrientation(1);int pad=(int)(24*getResources().getDisplayMetrics().density);root.setPadding(pad,pad*2,pad,pad);root.setBackgroundColor(paper);ScrollView sc=new ScrollView(this);sc.addView(root);setContentView(sc);
  TextView title=new TextView(this);title.setText(R.string.app_name);title.setTextSize(27);title.setTextColor(ink);root.addView(title);versions=new TextView(this);versions.setTextSize(16);versions.setTextColor(ink);versions.setPadding(0,pad,0,pad);root.addView(versions);status=new TextView(this);status.setText(R.string.intro);status.setTextSize(16);status.setTextColor(ink);status.setLineSpacing(8,1);root.addView(status);progress=new ProgressBar(this);progress.setVisibility(View.GONE);root.addView(progress);
  next=new Button(this);next.setOnClickListener(v->{if(installed)openReader();else if(ready)install();else prepare();});root.addView(next);Button copy=new Button(this);copy.setText(R.string.copy_diagnostics);copy.setOnClickListener(v->copyDiagnostics());root.addView(copy);TextView foot=new TextView(this);foot.setText(R.string.footnote);foot.setTextColor(ink);foot.setTextSize(13);foot.setPadding(0,pad,0,0);root.addView(foot);refresh();
 }
 private void ui(Runnable task){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())task.run();});}
 private int flags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
 private long version(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
 private boolean trusted(PackageInfo info)throws Exception{android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;return signatures!=null&&signatures.length==1&&Delta.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())).equals(CERT);}
 private PackageInfo reader()throws Exception{PackageInfo p=getPackageManager().getPackageInfo(APP,flags());if(!trusted(p))throw new SecurityException();return p;}
 private File installedFile(PackageInfo p){return new File(p.applicationInfo.publicSourceDir==null?p.applicationInfo.sourceDir:p.applicationInfo.publicSourceDir);}
 private boolean cachedApk()throws Exception{if(!apk.isFile()||!Delta.hex(Delta.hash(apk)).equals(UpdateSpec.TARGET_SHA))return false;PackageInfo p=getPackageManager().getPackageArchiveInfo(apk.getPath(),flags());return p!=null&&APP.equals(p.packageName)&&version(p)==UpdateSpec.VERSION_CODE&&UpdateSpec.VERSION_NAME.equals(p.versionName)&&trusted(p);}
 private void refresh(){if(next==null)return;versions.setText(getString(R.string.version_lines,installedName,UpdateSpec.VERSION_NAME));next.setEnabled(!busy&&!checking);next.setText(installed?getString(R.string.open_verified):ready?getString(getPackageManager().canRequestPackageInstalls()?R.string.install_reader:R.string.allow_install,UpdateSpec.VERSION_NAME):getString(R.string.prepare));progress.setVisibility(busy||checking?View.VISIBLE:View.GONE);}
 static void installStateChanged(){MainActivity a=active.get();if(a!=null&&a.foreground)a.ui(a::handleInstallerState);}
 private void handleInstallerState(){if(!foreground)return;int phase=InstallTracker.phase(this);if(phase==InstallTracker.WAITING&&!InstallTracker.prefs(this).getBoolean("launched",false)){try{int id=InstallTracker.session(this);ComponentName component=ComponentName.unflattenFromString(InstallTracker.prefs(this).getString("confirm_component",""));InstallStatusReceiver.checkedComponent(this,component);Intent confirmation=new Intent(InstallTracker.CONFIRM).setComponent(component).putExtra(PackageInstaller.EXTRA_SESSION_ID,id);InstallTracker.prefs(this).edit().putBoolean("launched",true).commit();startActivity(confirmation);status.setText(R.string.confirm);return;}catch(Exception error){InstallTracker.fail(this,PackageInstaller.STATUS_FAILURE,"confirmation_launch_failed");}}
  inspect(0);
 }
 private void inspect(int attempt){if(busy)return;final long token=++inspection;checking=true;refresh();worker.execute(()->{
  String name=getString(R.string.missing_short),hash="",detail="";int state=InstallRules.OLD,error=0;boolean cache=ready;
  try{PackageInfo p=reader();name=p.versionName;long code=version(p);if(code==UpdateSpec.VERSION_CODE)hash=Delta.hex(Delta.hash(installedFile(p)));state=InstallRules.installed(code,p.versionName,hash,UpdateSpec.VERSION_CODE,UpdateSpec.VERSION_NAME,UpdateSpec.TARGET_SHA);detail="reader="+name+" ("+code+")\nreader_sha="+hash;if(!cache&&state!=InstallRules.EXACT&&state!=InstallRules.NEWER)cache=cachedApk();}
  catch(PackageManager.NameNotFoundException e){error=R.string.missing;}catch(SecurityException e){error=R.string.signature;}catch(Exception e){error=R.string.inspect_failed;}
  final String label=name,foundHash=hash,info=detail;final int current=state,problem=error;final boolean available=cache;
  ui(()->{if(token!=inspection)return;checking=false;installedName=label;installedHash=foundHash;observed=current;diagnostic=info;ready=problem==0&&available;installed=problem==0&&(current==InstallRules.EXACT||current==InstallRules.NEWER);int phase=InstallTracker.phase(this);
   if(installed){ready=false;continueAfterPermission=false;status.setText(current==InstallRules.NEWER?R.string.newer_verified:phase==InstallTracker.SUCCESS?R.string.success_verified:R.string.already_verified);}
   else if(problem!=0){continueAfterPermission=false;status.setText(problem);}
   else if(continueAfterPermission){continueAfterPermission=false;refresh();if(ready){install();return;}status.setText(R.string.prepare);}
   else if(phase==InstallTracker.SUCCESS&&attempt<3){status.setText(R.string.checking_installed);refresh();main.postDelayed(()->{if(foreground&&inspection==token)inspect(attempt+1);},300);return;}
   else if(phase==InstallTracker.SUCCESS)status.setText(R.string.not_updated);
   else if(phase==InstallTracker.FAILED)status.setText(failureText(InstallTracker.prefs(this).getInt("status",PackageInstaller.STATUS_FAILURE)));
   else if(phase==InstallTracker.COMMITTED||phase==InstallTracker.WRITING||phase==InstallTracker.WAITING)status.setText(R.string.pending_resume);
   else status.setText(ready?R.string.ready:R.string.intro);
   refresh();
  });
 });}
 private int failureText(int code){switch(code){case PackageInstaller.STATUS_FAILURE_ABORTED:return R.string.user_cancelled;case PackageInstaller.STATUS_FAILURE_BLOCKED:return R.string.system_blocked;case PackageInstaller.STATUS_FAILURE_STORAGE:return R.string.space_error;case PackageInstaller.STATUS_FAILURE_CONFLICT:return R.string.conflict_error;case PackageInstaller.STATUS_FAILURE_INVALID:return R.string.invalid_package;case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:return R.string.incompatible_error;default:return R.string.install_failed;}}
 private void prepare(){if(busy||checking)return;busy=true;inspection++;status.setText(R.string.preparing);refresh();worker.execute(()->{int result=R.string.failed;try{PackageInfo old=reader();if(version(old)>UpdateSpec.VERSION_CODE){ui(()->{busy=false;inspect(0);});return;}if(!cachedApk()){File base=installedFile(old);String hash=Delta.hex(Delta.hash(base));boolean supported=false;for(String h:UpdateSpec.BASE_HASHES)if(h.equals(hash))supported=true;if(!supported){result=R.string.wrong_base;throw new IOException();}try(InputStream patch=getAssets().open(hash+".trdp")){Delta.restore(base,patch,apk,hash,UpdateSpec.TARGET_SHA);}if(!cachedApk())throw new SecurityException();}ui(()->{busy=false;ready=true;status.setText(R.string.ready);refresh();});return;
  }catch(PackageManager.NameNotFoundException e){result=R.string.missing;}catch(SecurityException e){result=R.string.signature;}catch(Exception e){}final int message=result;ui(()->{busy=false;ready=false;status.setText(message);refresh();});});}
 private void launchSystem(Intent intent){PackageManager pm=getPackageManager();for(ResolveInfo r:pm.queryIntentActivities(intent,PackageManager.MATCH_DEFAULT_ONLY)){ActivityInfo a=r.activityInfo;if(a!=null&&a.exported&&(a.applicationInfo.flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))!=0){intent.setComponent(new ComponentName(a.packageName,a.name));startActivity(intent);return;}}throw new ActivityNotFoundException();}
 private void install(){if(!ready||busy||checking)return;if(!getPackageManager().canRequestPackageInstalls()){InstallTracker.prefs(this).edit().putLong("permission_at",System.currentTimeMillis()).commit();try{launchSystem(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}catch(Exception e){InstallTracker.prefs(this).edit().remove("permission_at").commit();status.setText(R.string.installer_unavailable);}return;}
  busy=true;inspection++;status.setText(R.string.staging);refresh();worker.execute(()->{try{PackageInfo old=reader();if(version(old)>UpdateSpec.VERSION_CODE){ui(()->{busy=false;inspect(0);});return;}if(!cachedApk())throw new IOException();SessionInstaller.stage(this,apk);ui(()->{busy=false;handleInstallerState();});}catch(Exception e){InstallTracker.fail(this,PackageInstaller.STATUS_FAILURE,"session_start_failed");ui(()->{busy=false;status.setText(R.string.install_failed);refresh();});}});
 }
 private void openReader(){try{if(!installed)return;reader();Intent intent=getPackageManager().getLaunchIntentForPackage(APP);if(intent==null||intent.getComponent()==null||!APP.equals(intent.getComponent().getPackageName()))throw new SecurityException();startActivity(intent);}catch(Exception e){status.setText(R.string.missing);}}
 private void copyDiagnostics(){String text="TransRead update helper r2\ntarget="+UpdateSpec.VERSION_NAME+" ("+UpdateSpec.VERSION_CODE+")\n"+diagnostic+"\nphase="+InstallTracker.phase(this)+"\nstatus="+InstallTracker.prefs(this).getInt("status",Integer.MIN_VALUE)+"\nsession="+InstallTracker.session(this)+"\nreason="+InstallTracker.prefs(this).getString("message","")+"\nsdk="+Build.VERSION.SDK_INT;ClipboardManager c=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(c!=null){c.setPrimaryClip(ClipData.newPlainText("TransRead update diagnostic",text));Toast.makeText(this,R.string.diagnostics_copied,Toast.LENGTH_SHORT).show();}}
 @Override protected void onResume(){super.onResume();foreground=true;active=new WeakReference<>(this);if(status==null)return;long requested=InstallTracker.prefs(this).getLong("permission_at",0);if(requested>0){continueAfterPermission=InstallRules.permissionContinuation(requested,System.currentTimeMillis(),getPackageManager().canRequestPackageInstalls());InstallTracker.prefs(this).edit().remove("permission_at").commit();}handleInstallerState();}
 @Override protected void onPause(){foreground=false;inspection++;checking=false;if(active.get()==this)active.clear();super.onPause();}
 @Override protected void onDestroy(){main.removeCallbacksAndMessages(null);worker.shutdown();super.onDestroy();}
}
