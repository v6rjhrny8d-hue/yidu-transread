package app.lumi.reader.update;
import android.content.*;
import android.content.pm.*;
import android.os.Build;
/** Private explicit PendingIntent receiver; no public intent filter or nested-intent forwarding. */
public final class InstallStatusReceiver extends BroadcastReceiver {
 static ComponentName checkedComponent(Context c,ComponentName component)throws Exception{if(component==null)throw new SecurityException("Missing component");ActivityInfo a=c.getPackageManager().getActivityInfo(component,0);if(!a.exported||(a.applicationInfo.flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))==0)throw new SecurityException("Untrusted system UI");return component;}
 static ComponentName confirmation(Context c,Intent raw,int id)throws Exception{if(raw==null||!InstallTracker.CONFIRM.equals(raw.getAction())||raw.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1)!=id)throw new SecurityException("Unexpected confirmation");ComponentName component=raw.getComponent();if(component==null){ResolveInfo resolved=c.getPackageManager().resolveActivity(raw,PackageManager.MATCH_DEFAULT_ONLY);if(resolved==null||resolved.activityInfo==null)throw new SecurityException("No confirmation UI");component=new ComponentName(resolved.activityInfo.packageName,resolved.activityInfo.name);}return checkedComponent(c,component);}
 @Override public void onReceive(Context context,Intent intent){
  try{if(!InstallTracker.accepts(context,intent))return;}catch(RuntimeException malformed){return;}
  try{int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);String message=intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){Intent raw=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent.class):(Intent)intent.getParcelableExtra(Intent.EXTRA_INTENT);ComponentName component=confirmation(context,raw,InstallTracker.session(context));InstallTracker.prefs(context).edit().putInt("phase",InstallTracker.WAITING).putInt("status",status).putString("confirm_component",component.flattenToString()).putBoolean("launched",false).commit();}
   else if(status==PackageInstaller.STATUS_SUCCESS)InstallTracker.prefs(context).edit().putInt("phase",InstallTracker.SUCCESS).putInt("status",status).putString("message","").remove("confirm_component").commit();
   else InstallTracker.fail(context,status,message);
  }catch(Exception error){InstallTracker.fail(context,PackageInstaller.STATUS_FAILURE,"confirmation_unavailable");}
  MainActivity.installStateChanged();
 }
}
