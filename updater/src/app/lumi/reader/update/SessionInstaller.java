package app.lumi.reader.update;
import android.app.PendingIntent;
import android.content.*;
import android.content.pm.*;
import android.os.Build;
import java.io.*;
import java.util.UUID;
/** All APK bytes are written and closed before commit; completion is asynchronous. */
public final class SessionInstaller {
 static int stage(Context context,File apk)throws Exception{
  PackageInstaller installer=context.getPackageManager().getPackageInstaller();int previous=InstallTracker.session(context);InstallTracker.clearSession(context);
  if(previous>=0)try{PackageInstaller.SessionInfo old=installer.getSessionInfo(previous);if(old!=null&&context.getPackageName().equals(old.getInstallerPackageName()))installer.abandonSession(previous);}catch(Exception ignored){}
  PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);params.setAppPackageName(MainActivity.APP);params.setSize(apk.length());params.setInstallReason(PackageManager.INSTALL_REASON_USER);if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
  int id=installer.createSession(params);String nonce=UUID.randomUUID().toString();InstallTracker.begin(context,id,nonce);boolean committed=false;
  try(PackageInstaller.Session session=installer.openSession(id)){
   try(InputStream in=new FileInputStream(apk);OutputStream out=session.openWrite("base.apk",0,apk.length())){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);session.fsync(out);}
   Intent callback=new Intent(context,InstallStatusReceiver.class).setAction(InstallTracker.ACTION).setData(InstallTracker.resultUri(nonce)).putExtra(InstallTracker.OWN_SESSION,id);
   int flags=PendingIntent.FLAG_UPDATE_CURRENT;if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
   PendingIntent result=PendingIntent.getBroadcast(context,id,callback,flags);InstallTracker.committed(context);session.commit(result.getIntentSender());committed=true;return id;
  }finally{if(!committed){try{installer.abandonSession(id);}catch(Exception ignored){}InstallTracker.fail(context,PackageInstaller.STATUS_FAILURE,"session_commit_failed");}}
 }
 private SessionInstaller(){}
}
