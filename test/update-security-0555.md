# Best Practices and Security Alignment Update: TransRead update helper

日期：2026-10-28。新增可选差量更新助手；不是主程序内的自动更新或网页热更新。主包仍保持原签名覆盖安装。

## Security alignment area / impact / priority

- **包身份与完整性（高）**：先校验已安装包证书、基础APK SHA256与固定支持集合，流式还原后校验目标SHA256，再核对目标包名、versionCode和原证书。系统安装仍做正常签名与用户确认。
- **ContentProvider data guarding（高）**：未导出的Provider仅暴露固定cache/release.apk，临时只读URI授权，不拼外部路径，不接收写模式/未知列/动态查询。
- **Intent routing（高）**：入口是普通launcher Activity，onCreate不读取传入Intent/URI/extra，未使用singleTop或onNewIntent；安装/设置Intent全部自行构造，解析后固定到exported的系统处理器。没有动态nested Intent或PendingIntent，因此不引入IntentSanitizer/AndroidX依赖。
- **生命周期与权限（中）**：只请求REQUEST_INSTALL_PACKAGES，限定package visibility，无网络/存储/读书数据权限；后台工作回调检查Activity仍存活，异常保留完整包替代流程。

## Scope and implementation

新增updater/AndroidManifest.xml、MainActivity.java、ApkProvider.java、Delta.java、UpdateSpec.java、字符串资源与updater/build.sh，另有tools/build_update_patch.py。主程序只修改按钮横滑动效与发行版本，没有新增安装权限。采用128MiB大小边界/20000指令边界/64KiB缓冲，失败清临时文件，成功同目录rename；不在手机重新签名。

## Testing and limits

- test/update-core-0555.py执行生产Delta.java：指令边界/损坏/错基础/错摘要/别名输出及失败清理；对两个实际基础APK还原后逐字节核对，apksigner验证原证书。
- test/update-provider-0555.py执行生产Provider和system-routing/certificate方法：只读固定文件、URI/列/条件/写操作拒绝、可信系统处理器选择、证书检查；并审查Manifest权限/暴露面。
- 两个APK均用SDK35实际编译、D8、zipalign及原证书签名验证。没有实体Android，OEM安装器可见性、未知来源授权与最终安装交互仍需用户验收；不从替身测试推断手机已安装成功。

官方依据：[PackageManager](https://developer.android.com/reference/android/content/pm/PackageManager)、[包可见性](https://developer.android.com/training/package-visibility/declaring)、[安全文件分享](https://developer.android.com/training/secure-file-sharing/share-file)。固定单文件Provider为此独立无依赖工具专门实现，不接受通用目录或外部路径。

## Implementation diff

```diff
--- /dev/null
+++ updater/AndroidManifest.xml
@@ -0,0 +1,9 @@
+<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.lumi.reader.update" android:versionCode="76" android:versionName="0.5.55">
+ <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/>
+ <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
+ <queries><package android:name="app.lumi.reader"/><intent><action android:name="android.intent.action.INSTALL_PACKAGE"/><data android:mimeType="application/vnd.android.package-archive"/></intent><intent><action android:name="android.settings.MANAGE_UNKNOWN_APP_SOURCES"/><data android:scheme="package"/></intent></queries>
+ <application android:label="@string/app_name" android:icon="@android:drawable/ic_menu_upload" android:allowBackup="false" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:usesCleartextTraffic="false">
+  <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize|uiMode"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>
+  <provider android:name=".ApkProvider" android:authorities="app.lumi.reader.update.apk" android:exported="false" android:grantUriPermissions="true"/>
+ </application>
+</manifest>
```

```diff
--- /dev/null
+++ updater/src/app/lumi/reader/update/Delta.java
@@ -0,0 +1,30 @@
+package app.lumi.reader.update;
+import java.io.*;
+import java.security.*;
+import java.util.Arrays;
+import java.util.zip.GZIPInputStream;
+/** Bounded raw-byte COPY/literal patch. Output must equal an already-signed release APK. */
+public final class Delta {
+ public static final long LIMIT=128L*1024*1024;
+ private static final byte[] MAGIC={'T','R','D','P','0','0','0','1'};
+ public static byte[] hash(File file)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return d.digest();}
+ public static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
+ public static byte[] unhex(String s)throws IOException{if(s==null||!s.matches("[0-9a-f]{64}"))throw new IOException("Invalid digest");byte[] b=new byte[32];for(int i=0;i<32;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);return b;}
+ public static void restore(File base,InputStream patch,File output,String expectedBase,String expectedTarget)throws Exception{
+  File part=new File(output.getPath()+".part");if(base.getCanonicalFile().equals(output.getCanonicalFile())||base.getCanonicalFile().equals(part.getCanonicalFile()))throw new IOException("Invalid destination");
+  if(output.exists()&&!output.delete())throw new IOException("Output busy");if(part.exists()&&!part.delete())throw new IOException("Temporary output busy");boolean complete=false;
+  try(DataInputStream in=new DataInputStream(new BufferedInputStream(new GZIPInputStream(patch)));RandomAccessFile source=new RandomAccessFile(base,"r")){
+   byte[] magic=new byte[8],oldHash=new byte[32],newHash=new byte[32];in.readFully(magic);in.readFully(oldHash);in.readFully(newHash);long oldSize=in.readLong(),newSize=in.readLong();int operations=in.readInt();
+   if(!Arrays.equals(magic,MAGIC)||oldSize!=source.length()||oldSize<=0||oldSize>LIMIT||newSize<=0||newSize>LIMIT||operations<=0||operations>20000||!MessageDigest.isEqual(oldHash,unhex(expectedBase))||!MessageDigest.isEqual(newHash,unhex(expectedTarget))||!MessageDigest.isEqual(hash(base),oldHash))throw new IOException("Base or patch mismatch");
+   byte[] buffer=new byte[65536];long written=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");
+   try(FileOutputStream out=new FileOutputStream(part)){
+    for(int op=0;op<operations;op++){int type=in.readUnsignedByte();long length;if(type==0){long offset=in.readLong();length=in.readLong();if(offset<0||length<=0||offset>oldSize||length>oldSize-offset||length>newSize-written)throw new IOException("Invalid copy");source.seek(offset);}else if(type==1){length=in.readInt();if(length<=0||length>newSize-written)throw new IOException("Invalid literal");}else throw new IOException("Invalid operation");
+     for(long remain=length;remain>0;){int n=(int)Math.min(buffer.length,remain);if(type==0)source.readFully(buffer,0,n);else in.readFully(buffer,0,n);out.write(buffer,0,n);digest.update(buffer,0,n);written+=n;remain-=n;}
+    }
+    if(written!=newSize||in.read()!=-1||!MessageDigest.isEqual(digest.digest(),newHash))throw new IOException("Output verification failed");out.getFD().sync();
+   }
+   if(!part.renameTo(output))throw new IOException("Output commit failed");complete=true;
+  }finally{if(!complete){part.delete();output.delete();}}
+ }
+ private Delta(){}
+}
```

```diff
--- /dev/null
+++ updater/src/app/lumi/reader/update/ApkProvider.java
@@ -0,0 +1,20 @@
+package app.lumi.reader.update;
+import android.content.*;
+import android.database.*;
+import android.net.Uri;
+import android.os.ParcelFileDescriptor;
+import android.provider.OpenableColumns;
+import java.io.*;
+/** One read-only cache file, no user-controlled path or database selection. */
+public final class ApkProvider extends ContentProvider {
+ static final String AUTHORITY="app.lumi.reader.update.apk";
+ static Uri uri(){return Uri.parse("content://"+AUTHORITY+"/update.apk");}
+ private File file(Uri uri)throws FileNotFoundException{if(!"content".equals(uri.getScheme())||!AUTHORITY.equals(uri.getAuthority())||!"/update.apk".equals(uri.getPath())||uri.getQuery()!=null||uri.getFragment()!=null)throw new FileNotFoundException("Unknown file");File f=new File(getContext().getCacheDir(),"release.apk");if(!f.isFile()||f.length()<=0||f.length()>Delta.LIMIT)throw new FileNotFoundException("Update not ready");return f;}
+ @Override public boolean onCreate(){return true;}
+ @Override public String getType(Uri uri){try{file(uri);return "application/vnd.android.package-archive";}catch(FileNotFoundException e){return null;}}
+ @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
+ @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){try{File f=file(uri);if(selection!=null||args!=null||sort!=null)throw new IllegalArgumentException("Unsupported query");String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;if(columns.length>2)throw new IllegalArgumentException("Unsupported columns");Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++){if(OpenableColumns.DISPLAY_NAME.equals(columns[i]))values[i]="YiDu-"+UpdateSpec.VERSION_NAME+".apk";else if(OpenableColumns.SIZE.equals(columns[i]))values[i]=f.length();else throw new IllegalArgumentException("Unsupported column");}MatrixCursor cursor=new MatrixCursor(columns);cursor.addRow(values);return cursor;}catch(FileNotFoundException e){return null;}}
+ @Override public Uri insert(Uri uri,ContentValues values){throw new SecurityException("Read only");}
+ @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new SecurityException("Read only");}
+ @Override public int delete(Uri uri,String selection,String[] args){throw new SecurityException("Read only");}
+}
```

```diff
--- /dev/null
+++ updater/src/app/lumi/reader/update/MainActivity.java
@@ -0,0 +1,35 @@
+package app.lumi.reader.update;
+import android.app.*;
+import android.os.*;
+import android.content.*;
+import android.content.pm.*;
+import android.graphics.Color;
+import android.net.Uri;
+import android.provider.Settings;
+import android.view.*;
+import android.widget.*;
+import java.io.*;
+import java.security.MessageDigest;
+import java.util.concurrent.*;
+public final class MainActivity extends Activity {
+ static final String APP="app.lumi.reader",CERT="8d21d7bc40b619f048f03e266031c59f7ad50cff5337203f5dce891d487c61fd";
+ private final ExecutorService worker=Executors.newSingleThreadExecutor();private TextView status;private Button next,open;private ProgressBar progress;private boolean ready,busy,installed;private File apk;
+ @Override public void onCreate(Bundle state){setTheme(android.R.style.Theme_Material_Light_NoActionBar);super.onCreate(state);apk=new File(getCacheDir(),"release.apk");boolean dark=(getResources().getConfiguration().uiMode&48)==32;int paper=Color.rgb(dark?28:247,dark?33:249,dark?30:245),ink=dark?Color.WHITE:Color.rgb(38,48,42);getWindow().setStatusBarColor(paper);getWindow().setNavigationBarColor(paper);LinearLayout root=new LinearLayout(this);root.setOrientation(1);int pad=(int)(24*getResources().getDisplayMetrics().density);root.setPadding(pad,pad*2,pad,pad);root.setBackgroundColor(paper);ScrollView sc=new ScrollView(this);sc.addView(root);setContentView(sc);
+  TextView title=new TextView(this);title.setText(R.string.app_name);title.setTextSize(27);title.setTextColor(ink);root.addView(title);TextView version=new TextView(this);version.setText("0.5.53 / 0.5.54 → "+UpdateSpec.VERSION_NAME);version.setTextSize(15);version.setTextColor(ink);version.setPadding(0,pad,0,pad);root.addView(version);status=new TextView(this);status.setText(R.string.intro);status.setTextSize(16);status.setTextColor(ink);status.setLineSpacing(8,1);root.addView(status);progress=new ProgressBar(this);progress.setVisibility(View.GONE);root.addView(progress);next=new Button(this);root.addView(next);next.setOnClickListener(v->{if(ready)install();else if(!busy&&!installed)prepare();});open=new Button(this);open.setText(R.string.open_reader);open.setVisibility(View.GONE);root.addView(open);open.setOnClickListener(v->openReader());TextView foot=new TextView(this);foot.setText(R.string.footnote);foot.setTextSize(13);foot.setTextColor(ink);foot.setPadding(0,pad,0,0);root.addView(foot);refresh();
+ }
+ private void ui(Runnable task){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())task.run();});}
+ private int flags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
+ private long version(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
+ private boolean trusted(PackageInfo info)throws Exception{android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;return signatures!=null&&signatures.length==1&&Delta.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())).equals(CERT);}
+ private PackageInfo reader()throws Exception{PackageInfo p=getPackageManager().getPackageInfo(APP,flags());if(!trusted(p))throw new SecurityException();return p;}
+ private void refresh(){if(next==null)return;next.setEnabled(!busy&&!installed);next.setText(installed?R.string.done:ready?(getPackageManager().canRequestPackageInstalls()?R.string.install:R.string.allow_install):R.string.prepare);progress.setVisibility(busy?View.VISIBLE:View.GONE);}
+ private void prepare(){busy=true;status.setText(R.string.preparing);refresh();worker.execute(()->{int result=R.string.failed;try{PackageInfo old=reader();if(version(old)>=UpdateSpec.VERSION_CODE){ui(()->complete());return;}File base=new File(old.applicationInfo.publicSourceDir==null?old.applicationInfo.sourceDir:old.applicationInfo.publicSourceDir);String hash=Delta.hex(Delta.hash(base));boolean supported=false;for(String h:UpdateSpec.BASE_HASHES)if(h.equals(hash))supported=true;if(!supported){result=R.string.wrong_base;throw new IOException();}try(InputStream patch=getAssets().open(hash+".trdp")){Delta.restore(base,patch,apk,hash,UpdateSpec.TARGET_SHA);}PackageInfo target=getPackageManager().getPackageArchiveInfo(apk.getPath(),flags());if(target==null||!APP.equals(target.packageName)||version(target)!=UpdateSpec.VERSION_CODE||!trusted(target))throw new SecurityException();ui(()->{busy=false;ready=true;status.setText(R.string.ready);open.setVisibility(View.VISIBLE);refresh();});return;
+   }catch(PackageManager.NameNotFoundException e){result=R.string.missing;}catch(SecurityException e){result=R.string.signature;}catch(Exception e){}apk.delete();final int message=result;ui(()->{busy=false;ready=false;status.setText(message);refresh();});});}
+ private void complete(){busy=false;ready=false;installed=true;status.setText(R.string.already);open.setVisibility(View.VISIBLE);refresh();}
+ private void launchSystem(Intent intent){PackageManager pm=getPackageManager();for(ResolveInfo r:pm.queryIntentActivities(intent,PackageManager.MATCH_DEFAULT_ONLY)){ActivityInfo a=r.activityInfo;if(a!=null&&a.exported&&(a.applicationInfo.flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))!=0){intent.setComponent(new ComponentName(a.packageName,a.name));startActivity(intent);return;}}throw new ActivityNotFoundException();}
+ private void install(){if(!ready||busy)return;try{if(version(reader())>=UpdateSpec.VERSION_CODE){complete();return;}if(!getPackageManager().canRequestPackageInstalls()){launchSystem(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));return;}busy=true;refresh();worker.execute(()->{try{if(!Delta.hex(Delta.hash(apk)).equals(UpdateSpec.TARGET_SHA))throw new IOException();ui(()->{busy=false;try{Intent request=new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(ApkProvider.uri(),"application/vnd.android.package-archive");request.setClipData(ClipData.newRawUri("TransRead update",ApkProvider.uri()));request.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);launchSystem(request);status.setText(R.string.confirm);}catch(Exception e){status.setText(R.string.installer_unavailable);}refresh();});}catch(Exception e){ui(()->{busy=false;ready=false;status.setText(R.string.failed);refresh();});}});
+  }catch(Exception e){status.setText(R.string.installer_unavailable);refresh();}}
+ private void openReader(){try{reader();Intent intent=getPackageManager().getLaunchIntentForPackage(APP);if(intent==null||intent.getComponent()==null||!APP.equals(intent.getComponent().getPackageName()))throw new SecurityException();startActivity(intent);}catch(Exception e){status.setText(R.string.missing);}}
+ @Override protected void onResume(){super.onResume();if(status==null)return;try{if(version(reader())>=UpdateSpec.VERSION_CODE){complete();return;}}catch(Exception e){}refresh();}
+ @Override protected void onDestroy(){worker.shutdown();super.onDestroy();}
+}
```

```diff
--- /dev/null
+++ updater/build.sh
@@ -0,0 +1,33 @@
+#!/usr/bin/env bash
+set -euo pipefail
+cd "$(dirname "$0")/.."
+release_name="0.5.55"
+release_code="76"
+sdk_tools="$PWD/tools/sdk/android-15"
+sdk_jar="$PWD/tools/sdk/android-35/android.jar"
+python3 tools/build_update_patch.py --target "dist/YiDu-${release_name}.apk" --base dist/YiDu-0.5.53.apk --base dist/YiDu-0.5.54.apk --assets updater/assets --spec updater/src/app/lumi/reader/update/UpdateSpec.java --version "$release_name" --code "$release_code" --report "test/update-patches-${release_name}.json"
+work=$(mktemp -d "${TMPDIR:-/tmp}/transread-update.XXXXXX")
+trap 'rm -rf "$work"' EXIT
+mkdir -p "$work/classes" "$work/dex" "$work/gen"
+"$sdk_tools/aapt2" compile --dir updater/res -o "$work/resources.zip"
+"$sdk_tools/aapt2" link -o "$work/linked.apk" -I "$sdk_jar" --manifest updater/AndroidManifest.xml "$work/resources.zip" -A updater/assets --java "$work/gen" --min-sdk-version 26 --target-sdk-version 35
+java -jar tools/ecj.jar -1.8 -proc:none -warn:none -cp "$sdk_jar" -d "$work/classes" updater/src/app/lumi/reader/update/*.java "$work/gen/app/lumi/reader/update/R.java"
+python3 - "$work" <<'PY'
+import pathlib,sys,zipfile
+w=pathlib.Path(sys.argv[1])
+with zipfile.ZipFile(w/'classes.jar','w') as z:
+ for p in (w/'classes').rglob('*.class'):z.write(p,p.relative_to(w/'classes').as_posix())
+PY
+java -cp "$sdk_tools/lib/d8.jar" com.android.tools.r8.D8 --min-api 26 --lib "$sdk_jar" --output "$work/dex" "$work/classes.jar"
+python3 - "$work" <<'PY'
+import pathlib,sys,zipfile
+w=pathlib.Path(sys.argv[1])
+with zipfile.ZipFile(w/'linked.apk') as a,zipfile.ZipFile(w/'unsigned.apk','w') as z:
+ for entry in a.infolist():z.writestr(entry,a.read(entry.filename))
+ z.write(w/'dex/classes.dex','classes.dex',compress_type=zipfile.ZIP_DEFLATED)
+PY
+"$sdk_tools/zipalign" -f -P 16 4 "$work/unsigned.apk" "$work/aligned.apk"
+java -jar "$sdk_tools/lib/apksigner.jar" sign --ks tools/lumi-development.p12 --ks-key-alias lumi-development --ks-pass pass:android --key-pass pass:android --out "$work/signed.apk" "$work/aligned.apk"
+java -jar "$sdk_tools/lib/apksigner.jar" verify --verbose --print-certs "$work/signed.apk"
+"$sdk_tools/aapt2" dump badging "$work/signed.apk"
+cp "$work/signed.apk" "dist/YiDu-0.5.53-or-0.5.54-to-${release_name}-UpdateHelper.apk"
```

```diff
--- /dev/null
+++ tools/build_update_patch.py
@@ -0,0 +1,42 @@
+#!/usr/bin/env python3
+"""Build a bounded copy/literal patch over raw APK bytes, preserving release signatures."""
+import argparse,gzip,hashlib,json,pathlib,struct,zipfile
+
+def sha(data):return hashlib.sha256(data).hexdigest()
+def data_offset(raw,info):
+ header=struct.unpack_from('<IHHHHHIIIHH',raw,info.header_offset)
+ if header[0]!=0x04034b50:raise ValueError('Invalid local ZIP header')
+ return info.header_offset+30+header[-2]+header[-1]
+def make_patch(base_path,target_path,out_path):
+ old=pathlib.Path(base_path).read_bytes();new=pathlib.Path(target_path).read_bytes();old_hash,new_hash=sha(old),sha(new);ops=[];cursor=0
+ with zipfile.ZipFile(base_path) as old_zip,zipfile.ZipFile(target_path) as target_zip:
+  old_infos={i.filename:i for i in old_zip.infolist()};target_infos=sorted(target_zip.infolist(),key=lambda i:i.header_offset)
+  for info in target_infos:
+   prior=old_infos.get(info.filename)
+   if prior is None or info.compress_size<=0 or prior.compress_type!=info.compress_type or prior.compress_size!=info.compress_size:continue
+   start=data_offset(new,info);source=data_offset(old,prior);length=info.compress_size
+   if old[source:source+length]!=new[start:start+length]:continue
+   if start<cursor:raise ValueError('Overlapping ZIP data')
+   if start>cursor:ops.append((1,new[cursor:start]))
+   ops.append((0,source,length));cursor=start+length
+ if cursor<len(new):ops.append((1,new[cursor:]))
+ if not ops or len(ops)>20000 or max(len(old),len(new))>128*1024*1024:raise ValueError('Patch bounds exceeded')
+ raw=bytearray(b'TRDP0001'+bytes.fromhex(old_hash)+bytes.fromhex(new_hash)+struct.pack('>QQI',len(old),len(new),len(ops)))
+ for op in ops:
+  raw.append(op[0])
+  if op[0]==0:raw.extend(struct.pack('>QQ',op[1],op[2]))
+  else:raw.extend(struct.pack('>I',len(op[1])));raw.extend(op[1])
+ path=pathlib.Path(out_path);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(gzip.compress(raw,compresslevel=9,mtime=0))
+ return {'base':str(base_path),'baseSha256':old_hash,'targetSha256':new_hash,'targetBytes':len(new),'patch':str(path),'patchBytes':path.stat().st_size,'operations':len(ops),'copiedBytes':sum(op[2] for op in ops if op[0]==0)}
+def main():
+ p=argparse.ArgumentParser();p.add_argument('--target',required=True);p.add_argument('--base',action='append',required=True);p.add_argument('--assets',required=True);p.add_argument('--spec',required=True);p.add_argument('--version',required=True);p.add_argument('--code',type=int,required=True);p.add_argument('--report',required=True);args=p.parse_args()
+ if not args.version.replace('.','').isdigit() or args.code<=0:raise ValueError('Invalid release identity')
+ assets=pathlib.Path(args.assets);assets.mkdir(parents=True,exist_ok=True)
+ for path in assets.glob('*.trdp'):path.unlink()
+ records=[]
+ for base in args.base:
+  base_hash=sha(pathlib.Path(base).read_bytes());records.append(make_patch(base,args.target,assets/(base_hash+'.trdp')))
+ target_hash=sha(pathlib.Path(args.target).read_bytes());hashes=','.join('"'+r['baseSha256']+'"' for r in records)
+ pathlib.Path(args.spec).write_text('package app.lumi.reader.update;\npublic final class UpdateSpec {public static final String VERSION_NAME="'+args.version+'",TARGET_SHA="'+target_hash+'";public static final int VERSION_CODE='+str(args.code)+';public static final String[] BASE_HASHES={'+hashes+'};}\n')
+ pathlib.Path(args.report).write_text(json.dumps({'targetVersion':args.version,'targetCode':args.code,'targetSha256':target_hash,'patches':records},ensure_ascii=False,indent=2)+'\n');print(json.dumps({'patches':len(records),'totalPatchBytes':sum(r['patchBytes'] for r in records)}))
+if __name__=='__main__':main()
```

