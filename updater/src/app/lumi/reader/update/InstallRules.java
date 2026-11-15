package app.lumi.reader.update;
/** Pure checks used by UI and authenticated installer callback handling. */
public final class InstallRules {
 public static final int OLD=0,EXACT=1,NEWER=2,NAME_MISMATCH=3,HASH_MISMATCH=4;
 public static int installed(long code,String name,String hash,long target,String targetName,String targetHash){if(code<target)return OLD;if(code>target)return NEWER;if(!targetName.equals(name))return NAME_MISMATCH;return targetHash.equals(hash)?EXACT:HASH_MISMATCH;}
 public static boolean permissionContinuation(long requested,long now,boolean allowed){return allowed&&requested>0&&now>=requested&&now-requested<600000;}
 public static boolean callback(int expectedId,String expectedNonce,int callbackId,String callbackNonce,String actualPackage,String target){return expectedId>=0&&expectedId==callbackId&&expectedNonce!=null&&!expectedNonce.isEmpty()&&expectedNonce.equals(callbackNonce)&&(actualPackage==null||target.equals(actualPackage));}
 private InstallRules(){}
}
