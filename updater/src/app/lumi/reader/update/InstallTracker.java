package app.lumi.reader.update;
import android.content.*;
import android.net.Uri;
public final class InstallTracker {
 static final String ACTION="app.lumi.reader.update.INSTALL_STATUS",CONFIRM="android.content.pm.action.CONFIRM_INSTALL",OWN_SESSION="tracked_session";
 static final int NONE=0,WRITING=1,COMMITTED=2,WAITING=3,SUCCESS=4,FAILED=5;
 static SharedPreferences prefs(Context c){return c.getSharedPreferences("install-result",Context.MODE_PRIVATE);}
 static int phase(Context c){return prefs(c).getInt("phase",NONE);}
 static int session(Context c){return prefs(c).getInt("session",-1);}
 static void begin(Context c,int id,String nonce){prefs(c).edit().clear().putInt("session",id).putString("nonce",nonce).putInt("phase",WRITING).commit();}
 static void committed(Context c){if(phase(c)==WRITING)prefs(c).edit().putInt("phase",COMMITTED).commit();}
 static void fail(Context c,int status,String reason){prefs(c).edit().putInt("phase",FAILED).putInt("status",status).putString("message",reason==null?"":reason.substring(0,Math.min(400,reason.length()))).putBoolean("launched",false).remove("confirm_component").commit();}
 static void clearSession(Context c){prefs(c).edit().putInt("session",-1).putString("nonce","").putInt("phase",NONE).remove("confirm_component").commit();}
 static Uri resultUri(String nonce){return Uri.parse("transread-update://result/"+nonce);}
 static boolean accepts(Context c,Intent intent){if(intent==null||!ACTION.equals(intent.getAction()))return false;SharedPreferences p=prefs(c);String nonce=p.getString("nonce","");return resultUri(nonce).equals(intent.getData())&&InstallRules.callback(p.getInt("session",-1),nonce,intent.getIntExtra(OWN_SESSION,-1),intent.getData()==null?null:intent.getData().getLastPathSegment(),intent.getStringExtra(android.content.pm.PackageInstaller.EXTRA_PACKAGE_NAME),MainActivity.APP)&&(!intent.hasExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID)||intent.getIntExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID,-1)==p.getInt("session",-1));}
 private InstallTracker(){}
}
