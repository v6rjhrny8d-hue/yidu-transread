# Best Practices and Security Alignment Update: PackageInstaller session and callback isolation

2026-10-28. Priority: Medium. The user reports helper installation/authorization did not update TransRead. Confirmed old-code gaps: returning from install-source permission only refreshed a button; fire-and-forget ACTION_INSTALL_PACKAGE had no trustworthy completion result. This explains a possible failed path, not proof of the exact OEM-side failure.

## Scope and implications

Replace file-URI sharing and its provider with a full APK PackageInstaller.Session. Main app remains0.5.56/code77, byte-identical, same signer and no permission changes. Helper alone advances to0.5.56.1/code78. No new dependency, network permission, background auto-update or private main-app data access.

The launcher uses onCreate to build its UI, not parse external intents. No onNewIntent or singleTop path is introduced: normal launcher instances each recheck private persisted state. onResume consumes a recent permission request once and revalidates payload before continuing; onPause invalidates obsolete UI inspection results. Cold recreation can reuse verified cache and persisted installer status.

## Implementation and security decisions

- Session writes all bytes, fsyncs and closes output before commit; failed writes/commit abandon the session. Only this helper's prior owned session is abandoned on retry. User confirmation is explicitly required on API31+.
- SDK35 installer result requires mutable PendingIntent. This documented exception to immutable-by-default is bound to an explicit, non-exported static receiver. A random nonce URI and tracked/system session IDs and package guard reject stale/mismatched results. No public broadcast filter or dynamic receiver is introduced. A PendingIntent capability is supplied to the system installer, not arbitrary apps.
- The system's nested pending-user-action Intent is not launched or forwarded. Its action must be CONFIRM_INSTALL, its session must match and its resolved component must be exported and system/updated-system. The foreground Activity revalidates that component and constructs a fresh explicit Intent containing only fixed action and session ID. Raw extras, flags, URI grants, data and clip payloads are discarded. AndroidX is absent; this is deliberately a freshly constructed system-UI request rather than same-package redirection or copying a foreign Intent. The receiver never launches UI in the background.
- Settings routing remains explicitly pinned to an exported system handler. The reader launcher is pinned to the known main package and certificate. Exceptions show generic messages; opt-in diagnostic copy includes public version/hash and bounded system status, no nonce/key/private paths or books.
- Result SUCCESS is not evidence of installation by itself. Main package code/name/current signer and actual installed APK SHA are checked before target completion. Newer original-signed readers are separately labelled and not downgraded. Old reader plus success callback gives a bounded retry and explicit mismatch message.

## Verification and practical limit

46 checks run production SessionInstaller/InstallTracker/InstallStatusReceiver/InstallRules with bounded Android fakes plus exact onResume/continuation code; includes write/commit failure, cancellation, nonce/session/package rejection, non-system/private/missing confirmation, permission return once, denied permission, unverified payload, API26 and35 paths. 24 production Delta checks include two actual0.5.54/0.5.55 signed APKs restored byte-identically to existing0.5.56 and apksigner validation. Final helper is SDK35-built, original-signed, manifest/asset/ZIP checked. See corresponding logs and release-update-r2.json.

No adb/emulator/physical phone was available. Android/OEM confirmation UI, settings handoff, actual PackageInstaller behavior and final user-device installation are not claimed as validated. Full APK remains fallback. The prior release's210 reader checks are historical and are not counted as new70 checks.

Official references checked this repair: [Session.commit](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session#commit(android.content.IntentSender)), [SessionParams](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams), [PackageInstaller statuses](https://developer.android.com/reference/android/content/pm/PackageInstaller), [AOSP PackageInstaller](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/content/pm/PackageInstaller.java).

## Files modified

- `updater/AndroidManifest.xml`
- `updater/README.md`
- `updater/build.sh`
- `updater/res/values-zh-rCN/strings.xml`
- `updater/res/values/strings.xml`
- `updater/src/app/lumi/reader/update/ApkProvider.java`
- `updater/src/app/lumi/reader/update/InstallRules.java`
- `updater/src/app/lumi/reader/update/InstallStatusReceiver.java`
- `updater/src/app/lumi/reader/update/InstallTracker.java`
- `updater/src/app/lumi/reader/update/MainActivity.java`
- `updater/src/app/lumi/reader/update/SessionInstaller.java`

## Exact implementation diff against saved revision1 source

```diff
--- a/updater/AndroidManifest.xml
+++ b/updater/AndroidManifest.xml
@@ -1,9 +1,9 @@
-<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.lumi.reader.update" android:versionCode="77" android:versionName="0.5.56">
+<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.lumi.reader.update" android:versionCode="78" android:versionName="0.5.56.1">
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/>
  <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
- <queries><package android:name="app.lumi.reader"/><intent><action android:name="android.intent.action.INSTALL_PACKAGE"/><data android:mimeType="application/vnd.android.package-archive"/></intent><intent><action android:name="android.settings.MANAGE_UNKNOWN_APP_SOURCES"/><data android:scheme="package"/></intent></queries>
+ <queries><package android:name="app.lumi.reader"/><intent><action android:name="android.content.pm.action.CONFIRM_INSTALL"/></intent><intent><action android:name="android.settings.MANAGE_UNKNOWN_APP_SOURCES"/><data android:scheme="package"/></intent></queries>
  <application android:label="@string/app_name" android:icon="@android:drawable/ic_menu_upload" android:allowBackup="false" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:usesCleartextTraffic="false">
   <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize|uiMode"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>
-  <provider android:name=".ApkProvider" android:authorities="app.lumi.reader.update.apk" android:exported="false" android:grantUriPermissions="true"/>
+  <receiver android:name=".InstallStatusReceiver" android:exported="false"/>
  </application>
 </manifest>
--- a/updater/README.md
+++ b/updater/README.md
@@ -1,20 +1,24 @@
-# 译读小更新包
+# 译读小更新包：修订2
 
-本轮目标0.5.56；提供独立的“译读更新助手APK”，使用手机已安装的原版0.5.54或0.5.55，还原与完整发行APK逐字节相同的0.5.56，再交给Android系统确认覆盖安装。它是可选的临时工具，包名`app.lumi.reader.update`；译读主程序包名仍为`app.lumi.reader`。
+更新目标仍为译读0.5.56 / versionCode77；本次仅修复独立更新助手，助手自身为0.5.56.1 / versionCode78。使用精确原签名0.5.54或0.5.55生成与完整0.5.56逐字节相同的APK。主程序未重构、未重新签名或升版。
 
-1. 下载并安装UpdateHelper.apk，打开“译读更新助手”。
-2. 点“准备更新”。助手仅读取已安装APK，不读取图书、笔记或其他译读私有数据；无需联网。
-3. 按页面提示允许该助手安装应用，然后返回助手点“安装更新”，在系统页面确认。
-4. 进入译读确认更新成功后，可在系统设置卸载助手。其他基础版本、修改版或无法获取基础APK时，改用完整安装包。
+1. 覆盖安装新版更新助手，打开“译读更新助手”，点“准备更新”。
+2. 点击安装译读；如需允许安装来源，授权并返回后会自动继续，不再停留在刷新按钮。
+3. 在系统页面确认安装。返回助手后核验译读实际版本、包名、原证书和目标APK摘要，核验通过才能显示完成并打开译读。
+4. 系统取消、冲突、空间不足或拒绝安装会显示对应状态。可点“复制更新诊断”反馈；也可直接用原签名完整包覆盖安装译读，无需卸载译读或清除数据。完成后可卸载助手。
 
-这不是能直接覆盖译读的残缺APK，也不是网页资源热更新。助手自身先安装一次，因此比完整APK多一个临时应用和系统确认步骤。生成新APK所需临时空间约为完整APK大小，安装时另需系统安装空间。
+助手包名app.lumi.reader.update，与主程序app.lumi.reader不同；仅安装助手或授予安装权限不会改变译读版本。已有新版译读不会降级。准备缓存约需一个完整APK大小，系统安装另需空间。助手不读取图书、笔记或主程序私有数据，无网络或存储权限。
 
-## 构建与校验
+## 实现与验证
 
-先`bash build.sh`构建原签名主程序，再`bash updater/build.sh`。`tools/build_update_patch.py`复用旧ZIP中完全相同的压缩成员数据，其余目标字节写为literal并gzip；不在手机重新签名。实际省量取决于变更，不保证每次都很小。
+Delta流式还原并验证基础/目标SHA256、尺寸、指令边界和gzip完整性，失败清理输出。目标包名/版本/证书再次验证后才交给系统。
 
-Delta.java按COPY/literal指令流式输出，检查基础/目标SHA256、大小、指令边界及gzip完整性，64KiB缓冲；失败删除临时/旧输出，成功后原子改名。活动还验证基础和目标包名、目标版本及原签名；只从内置资产读补丁，不接受传入文件/Intent。
+修订2使用PackageInstaller.Session：完整写入、fsync、关闭输出后commit。系统结果通过显式、未导出的InstallStatusReceiver接收，绑定随机nonce、会话ID和包名。target35回调必须可变，因此PendingIntent明确锁定私有receiver；不会用隐式可变Intent。旧ApkProvider和临时文件URI授权已移除。
 
-ApkProvider未导出，仅能临时只读分享固定cache/release.apk，不接受路径、写模式、未知列或查询条件。安装/设置Intent在系统处理器中解析并固定组件，URI只有临时读授权；不会请求网络、存储或图书访问权限。安装必须由用户确认；无法打开系统安装器时使用完整包。
+STATUS_PENDING_USER_ACTION只提取经验证的系统、exported组件，检查固定CONFIRM_INSTALL动作与会话；前台Activity重新创建仅含固定动作/组件/会话ID的确认Intent，不转发原始嵌套Intent、URI授权或任意extras。安装结果和实际已安装译读核验分开，成功状态本身不等于安装已生效；取消/错误可恢复，授权返回只继续一次。
 
-测试脚本：test/update-core-0555.py、test/update-provider-0555.py；浏览器与Java替身不能代替实体Android上OEM安装器的最终验收。主程序原签名、已安装基础版本字节一致性和系统安装策略必须满足。
+构建：现有完整APK不变时直接bash updater/build.sh。主程序发生变化才先bash build.sh，随后必须重建补丁/助手，不能混发不同字节的完整包与助手。助手版本独立于目标版本。
+
+测试：test/update-core-0555.py为生产Delta和两份真实签名APK还原24项；test/update-session-r2.py为生产会话/回调/持久状态/授权恢复46项。test/update-provider-0555.py保留旧命令入口，转调新版会话测试；旧Provider29项仅为历史证据。详细安全范围和diff见test/update-security-r2.md。
+
+没有实体Android设备，本轮不声称OEM授权页、系统安装确认与最终覆盖安装已真机通过；46项宿主测试的Android替身只验证明确的调用边界和逻辑。完整包保留作为备用。
--- a/updater/build.sh
+++ b/updater/build.sh
@@ -30,4 +30,4 @@
 java -jar "$sdk_tools/lib/apksigner.jar" sign --ks tools/lumi-development.p12 --ks-key-alias lumi-development --ks-pass pass:android --key-pass pass:android --out "$work/signed.apk" "$work/aligned.apk"
 java -jar "$sdk_tools/lib/apksigner.jar" verify --verbose --print-certs "$work/signed.apk"
 "$sdk_tools/aapt2" dump badging "$work/signed.apk"
-cp "$work/signed.apk" "dist/YiDu-0.5.54-or-0.5.55-to-${release_name}-UpdateHelper.apk"
+cp "$work/signed.apk" "dist/YiDu-${release_name}-UpdateHelper-r2.apk"
--- a/updater/res/values-zh-rCN/strings.xml
+++ b/updater/res/values-zh-rCN/strings.xml
@@ -1,3 +1,40 @@
 <resources>
- <string name="app_name">译读更新助手</string><string name="intro">这是本次更新的小安装包。读取手机现有译读，还原原签名完整安装包，全程无需联网；不会读取图书或笔记。</string><string name="footnote">安装时由系统弹出确认。更新完成后，可在系统设置中卸载本助手。其他基础版本请使用完整安装包。</string><string name="prepare">准备更新</string><string name="preparing">正在准备并校验更新…</string><string name="ready">更新已校验通过。点下方按钮进入系统安装确认，原有图书和笔记保留在译读中。</string><string name="allow_install">允许安装并继续</string><string name="install">安装更新</string><string name="confirm">请在系统页面确认安装。完成后返回这里打开译读。</string><string name="done">已更新</string><string name="already">译读已是本次或更新版本。可以打开译读，并卸载本助手。</string><string name="open_reader">打开译读</string><string name="missing">请先安装译读完整包，再使用对应版本的更新助手。</string><string name="wrong_base">当前安装版本与更新包不匹配，请使用完整安装包。</string><string name="signature">译读或更新包的签名不匹配，请使用原签名完整安装包。</string><string name="failed">更新准备或校验失败，请改用完整安装包。</string><string name="installer_unavailable">无法打开系统安装页面或安装设置，请改用完整安装包。</string>
+  <string name="app_name">译读更新助手</string>
+  <string name="intro">这是更新助手。准备好后仍需由系统安装译读；页面会核验译读实际版本，图书和笔记保留。</string>
+  <string name="footnote">安装时由系统弹出确认。更新完成后，可在系统设置中卸载本助手。其他基础版本请使用完整安装包。</string>
+  <string name="prepare">准备更新</string>
+  <string name="preparing">正在准备并校验更新…</string>
+  <string name="ready">准备完成。继续安装译读，并在系统页面确认。</string>
+  <string name="allow_install">允许安装译读 %1$s</string>
+  <string name="install">安装更新</string>
+  <string name="confirm">请在系统页面确认安装。完成后返回这里打开译读。</string>
+  <string name="done">已更新</string>
+  <string name="already">译读已是本次或更新版本。可以打开译读，并卸载本助手。</string>
+  <string name="open_reader">打开译读</string>
+  <string name="missing">请先安装译读完整包，再使用对应版本的更新助手。</string>
+  <string name="wrong_base">当前安装版本与更新包不匹配，请使用完整安装包。</string>
+  <string name="signature">译读或更新包的签名不匹配，请使用原签名完整安装包。</string>
+  <string name="failed">更新准备或校验失败，请改用完整安装包。</string>
+  <string name="installer_unavailable">无法打开系统安装页面或安装设置，请改用完整安装包。</string>
+  <string name="version_lines">译读当前：%1$s\n更新目标：%2$s</string>
+  <string name="missing_short">未找到</string>
+  <string name="copy_diagnostics">复制更新诊断</string>
+  <string name="diagnostics_copied">诊断已复制，可粘贴反馈</string>
+  <string name="install_reader">安装译读 %1$s</string>
+  <string name="open_verified">打开已核验的译读</string>
+  <string name="success_verified">系统安装成功，译读版本与安装文件均已核验。</string>
+  <string name="already_verified">当前译读已是目标版本，安装文件已核验。</string>
+  <string name="newer_verified">当前译读比本更新包更新，可以直接打开。</string>
+  <string name="checking_installed">系统已返回成功，正在核验译读的实际版本…</string>
+  <string name="not_updated">系统返回成功，但译读实际版本或安装文件尚未匹配。请重试安装，或复制诊断后使用完整包。</string>
+  <string name="pending_resume">系统尚未确认更新完成。可继续安装或重试；只有译读版本核验通过才显示完成。</string>
+  <string name="staging">正在把译读更新交给系统安装…</string>
+  <string name="inspect_failed">无法核验译读实际版本，请复制诊断或使用完整包。</string>
+  <string name="user_cancelled">系统安装已取消，译读尚未确认更新。可重试安装。</string>
+  <string name="system_blocked">更新被系统阻止，请复制诊断或使用完整安装包。</string>
+  <string name="space_error">系统报告存储空间不足，清理空间后可重试。</string>
+  <string name="conflict_error">系统报告安装冲突，请复制诊断或使用完整包。</string>
+  <string name="invalid_package">系统未接受安装文件，请复制诊断或使用完整包。</string>
+  <string name="incompatible_error">系统报告安装不兼容，请复制诊断或使用完整包。</string>
+  <string name="install_failed">系统安装未完成，请重试或复制更新诊断。</string>
 </resources>
--- a/updater/res/values/strings.xml
+++ b/updater/res/values/strings.xml
@@ -1,3 +1,40 @@
 <resources>
- <string name="app_name">TransRead Update Helper</string><string name="intro">This small update package rebuilds the signed release using your installed TransRead APK, entirely offline. It does not read your books or notes.</string><string name="footnote">Android will ask you to confirm the installation. After updating, you can uninstall this helper in system settings. Other base versions require the full APK.</string><string name="prepare">Prepare update</string><string name="preparing">Preparing and verifying the update…</string><string name="ready">Update verified. Continue below to the system installer. Your books and notes stay in TransRead.</string><string name="allow_install">Allow installation and continue</string><string name="install">Install update</string><string name="confirm">Complete the installation in the system confirmation screen, then return here to open TransRead.</string><string name="done">Updated</string><string name="already">TransRead is already on this or a newer version. You can open it and uninstall this helper.</string><string name="open_reader">Open TransRead</string><string name="missing">Install the full TransRead APK first, then use this helper for a matching update.</string><string name="wrong_base">This installed version does not match the update package. Please use the full APK.</string><string name="signature">The installed app or update signature does not match. Please use the original signed full APK.</string><string name="failed">The update could not be prepared or verified. Please use the full APK.</string><string name="installer_unavailable">The system installer or installation settings could not be opened. Please use the full APK.</string>
+  <string name="app_name">TransRead Update Helper</string>
+  <string name="intro">This is the update helper. After preparation, Android still installs TransRead. The installed TransRead version is verified; books and notes stay in TransRead.</string>
+  <string name="footnote">Android will ask you to confirm the installation. After updating, you can uninstall this helper in system settings. Other base versions require the full APK.</string>
+  <string name="prepare">Prepare update</string>
+  <string name="preparing">Preparing and verifying the update…</string>
+  <string name="ready">Update prepared. Continue to install TransRead and confirm on the system screen.</string>
+  <string name="allow_install">Allow TransRead %1$s installation</string>
+  <string name="install">Install update</string>
+  <string name="confirm">Complete the installation in the system confirmation screen, then return here to open TransRead.</string>
+  <string name="done">Updated</string>
+  <string name="already">TransRead is already on this or a newer version. You can open it and uninstall this helper.</string>
+  <string name="open_reader">Open TransRead</string>
+  <string name="missing">Install the full TransRead APK first, then use this helper for a matching update.</string>
+  <string name="wrong_base">This installed version does not match the update package. Please use the full APK.</string>
+  <string name="signature">The installed app or update signature does not match. Please use the original signed full APK.</string>
+  <string name="failed">The update could not be prepared or verified. Please use the full APK.</string>
+  <string name="installer_unavailable">The system installer or installation settings could not be opened. Please use the full APK.</string>
+  <string name="version_lines">TransRead installed: %1$s\nTarget: %2$s</string>
+  <string name="missing_short">Not found</string>
+  <string name="copy_diagnostics">Copy update diagnostic</string>
+  <string name="diagnostics_copied">Diagnostic copied</string>
+  <string name="install_reader">Install TransRead %1$s</string>
+  <string name="open_verified">Open verified TransRead</string>
+  <string name="success_verified">System installation succeeded. TransRead version and installed APK are verified.</string>
+  <string name="already_verified">TransRead is already on the target version. Its installed APK is verified.</string>
+  <string name="newer_verified">A newer TransRead version is installed. You can open it.</string>
+  <string name="checking_installed">The system reported success. Checking the installed TransRead version…</string>
+  <string name="not_updated">The system reported success, but the installed TransRead version or APK does not match. Retry or copy the diagnostic and use the full APK.</string>
+  <string name="pending_resume">The system has not confirmed completion. Continue or retry installation; completion requires the installed TransRead version to match.</string>
+  <string name="staging">Submitting the TransRead update to the system installer…</string>
+  <string name="inspect_failed">Cannot verify the installed TransRead version. Copy the diagnostic or use the full APK.</string>
+  <string name="user_cancelled">System installation was cancelled. TransRead is not confirmed updated. You can retry.</string>
+  <string name="system_blocked">The system blocked the update. Copy the diagnostic or use the full APK.</string>
+  <string name="space_error">The system reported insufficient storage. Free space and retry.</string>
+  <string name="conflict_error">The system reported an installation conflict. Copy the diagnostic or use the full APK.</string>
+  <string name="invalid_package">The system did not accept the APK. Copy the diagnostic or use the full APK.</string>
+  <string name="incompatible_error">The system reported an incompatible installation. Copy the diagnostic or use the full APK.</string>
+  <string name="install_failed">System installation did not complete. Retry or copy the update diagnostic.</string>
 </resources>
--- a/updater/src/app/lumi/reader/update/ApkProvider.java
+++ /dev/null
@@ -1,20 +0,0 @@
-package app.lumi.reader.update;
-import android.content.*;
-import android.database.*;
-import android.net.Uri;
-import android.os.ParcelFileDescriptor;
-import android.provider.OpenableColumns;
-import java.io.*;
-/** One read-only cache file, no user-controlled path or database selection. */
-public final class ApkProvider extends ContentProvider {
- static final String AUTHORITY="app.lumi.reader.update.apk";
- static Uri uri(){return Uri.parse("content://"+AUTHORITY+"/update.apk");}
- private File file(Uri uri)throws FileNotFoundException{if(!"content".equals(uri.getScheme())||!AUTHORITY.equals(uri.getAuthority())||!"/update.apk".equals(uri.getPath())||uri.getQuery()!=null||uri.getFragment()!=null)throw new FileNotFoundException("Unknown file");File f=new File(getContext().getCacheDir(),"release.apk");if(!f.isFile()||f.length()<=0||f.length()>Delta.LIMIT)throw new FileNotFoundException("Update not ready");return f;}
- @Override public boolean onCreate(){return true;}
- @Override public String getType(Uri uri){try{file(uri);return "application/vnd.android.package-archive";}catch(FileNotFoundException e){return null;}}
- @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
- @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){try{File f=file(uri);if(selection!=null||args!=null||sort!=null)throw new IllegalArgumentException("Unsupported query");String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;if(columns.length>2)throw new IllegalArgumentException("Unsupported columns");Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++){if(OpenableColumns.DISPLAY_NAME.equals(columns[i]))values[i]="YiDu-"+UpdateSpec.VERSION_NAME+".apk";else if(OpenableColumns.SIZE.equals(columns[i]))values[i]=f.length();else throw new IllegalArgumentException("Unsupported column");}MatrixCursor cursor=new MatrixCursor(columns);cursor.addRow(values);return cursor;}catch(FileNotFoundException e){return null;}}
- @Override public Uri insert(Uri uri,ContentValues values){throw new SecurityException("Read only");}
- @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new SecurityException("Read only");}
- @Override public int delete(Uri uri,String selection,String[] args){throw new SecurityException("Read only");}
-}
--- /dev/null
+++ b/updater/src/app/lumi/reader/update/InstallRules.java
@@ -0,0 +1,9 @@
+package app.lumi.reader.update;
+/** Pure checks used by UI and authenticated installer callback handling. */
+public final class InstallRules {
+ public static final int OLD=0,EXACT=1,NEWER=2,NAME_MISMATCH=3,HASH_MISMATCH=4;
+ public static int installed(long code,String name,String hash,long target,String targetName,String targetHash){if(code<target)return OLD;if(code>target)return NEWER;if(!targetName.equals(name))return NAME_MISMATCH;return targetHash.equals(hash)?EXACT:HASH_MISMATCH;}
+ public static boolean permissionContinuation(long requested,long now,boolean allowed){return allowed&&requested>0&&now>=requested&&now-requested<600000;}
+ public static boolean callback(int expectedId,String expectedNonce,int callbackId,String callbackNonce,String actualPackage,String target){return expectedId>=0&&expectedId==callbackId&&expectedNonce!=null&&!expectedNonce.isEmpty()&&expectedNonce.equals(callbackNonce)&&(actualPackage==null||target.equals(actualPackage));}
+ private InstallRules(){}
+}
--- /dev/null
+++ b/updater/src/app/lumi/reader/update/InstallStatusReceiver.java
@@ -0,0 +1,17 @@
+package app.lumi.reader.update;
+import android.content.*;
+import android.content.pm.*;
+import android.os.Build;
+/** Private explicit PendingIntent receiver; no public intent filter or nested-intent forwarding. */
+public final class InstallStatusReceiver extends BroadcastReceiver {
+ static ComponentName checkedComponent(Context c,ComponentName component)throws Exception{if(component==null)throw new SecurityException("Missing component");ActivityInfo a=c.getPackageManager().getActivityInfo(component,0);if(!a.exported||(a.applicationInfo.flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))==0)throw new SecurityException("Untrusted system UI");return component;}
+ static ComponentName confirmation(Context c,Intent raw,int id)throws Exception{if(raw==null||!InstallTracker.CONFIRM.equals(raw.getAction())||raw.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1)!=id)throw new SecurityException("Unexpected confirmation");ComponentName component=raw.getComponent();if(component==null){ResolveInfo resolved=c.getPackageManager().resolveActivity(raw,PackageManager.MATCH_DEFAULT_ONLY);if(resolved==null||resolved.activityInfo==null)throw new SecurityException("No confirmation UI");component=new ComponentName(resolved.activityInfo.packageName,resolved.activityInfo.name);}return checkedComponent(c,component);}
+ @Override public void onReceive(Context context,Intent intent){
+  try{if(!InstallTracker.accepts(context,intent))return;}catch(RuntimeException malformed){return;}
+  try{int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);String message=intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){Intent raw=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent.class):(Intent)intent.getParcelableExtra(Intent.EXTRA_INTENT);ComponentName component=confirmation(context,raw,InstallTracker.session(context));InstallTracker.prefs(context).edit().putInt("phase",InstallTracker.WAITING).putInt("status",status).putString("confirm_component",component.flattenToString()).putBoolean("launched",false).commit();}
+   else if(status==PackageInstaller.STATUS_SUCCESS)InstallTracker.prefs(context).edit().putInt("phase",InstallTracker.SUCCESS).putInt("status",status).putString("message","").remove("confirm_component").commit();
+   else InstallTracker.fail(context,status,message);
+  }catch(Exception error){InstallTracker.fail(context,PackageInstaller.STATUS_FAILURE,"confirmation_unavailable");}
+  MainActivity.installStateChanged();
+ }
+}
--- /dev/null
+++ b/updater/src/app/lumi/reader/update/InstallTracker.java
@@ -0,0 +1,17 @@
+package app.lumi.reader.update;
+import android.content.*;
+import android.net.Uri;
+public final class InstallTracker {
+ static final String ACTION="app.lumi.reader.update.INSTALL_STATUS",CONFIRM="android.content.pm.action.CONFIRM_INSTALL",OWN_SESSION="tracked_session";
+ static final int NONE=0,WRITING=1,COMMITTED=2,WAITING=3,SUCCESS=4,FAILED=5;
+ static SharedPreferences prefs(Context c){return c.getSharedPreferences("install-result",Context.MODE_PRIVATE);}
+ static int phase(Context c){return prefs(c).getInt("phase",NONE);}
+ static int session(Context c){return prefs(c).getInt("session",-1);}
+ static void begin(Context c,int id,String nonce){prefs(c).edit().clear().putInt("session",id).putString("nonce",nonce).putInt("phase",WRITING).commit();}
+ static void committed(Context c){if(phase(c)==WRITING)prefs(c).edit().putInt("phase",COMMITTED).commit();}
+ static void fail(Context c,int status,String reason){prefs(c).edit().putInt("phase",FAILED).putInt("status",status).putString("message",reason==null?"":reason.substring(0,Math.min(400,reason.length()))).putBoolean("launched",false).remove("confirm_component").commit();}
+ static void clearSession(Context c){prefs(c).edit().putInt("session",-1).putString("nonce","").putInt("phase",NONE).remove("confirm_component").commit();}
+ static Uri resultUri(String nonce){return Uri.parse("transread-update://result/"+nonce);}
+ static boolean accepts(Context c,Intent intent){if(intent==null||!ACTION.equals(intent.getAction()))return false;SharedPreferences p=prefs(c);String nonce=p.getString("nonce","");return resultUri(nonce).equals(intent.getData())&&InstallRules.callback(p.getInt("session",-1),nonce,intent.getIntExtra(OWN_SESSION,-1),intent.getData()==null?null:intent.getData().getLastPathSegment(),intent.getStringExtra(android.content.pm.PackageInstaller.EXTRA_PACKAGE_NAME),MainActivity.APP)&&(!intent.hasExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID)||intent.getIntExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID,-1)==p.getInt("session",-1));}
+ private InstallTracker(){}
+}
--- a/updater/src/app/lumi/reader/update/MainActivity.java
+++ b/updater/src/app/lumi/reader/update/MainActivity.java
@@ -9,27 +9,59 @@
 import android.view.*;
 import android.widget.*;
 import java.io.*;
+import java.lang.ref.WeakReference;
 import java.security.MessageDigest;
 import java.util.concurrent.*;
 public final class MainActivity extends Activity {
  static final String APP="app.lumi.reader",CERT="8d21d7bc40b619f048f03e266031c59f7ad50cff5337203f5dce891d487c61fd";
- private final ExecutorService worker=Executors.newSingleThreadExecutor();private TextView status;private Button next,open;private ProgressBar progress;private boolean ready,busy,installed;private File apk;
- @Override public void onCreate(Bundle state){setTheme(android.R.style.Theme_Material_Light_NoActionBar);super.onCreate(state);apk=new File(getCacheDir(),"release.apk");boolean dark=(getResources().getConfiguration().uiMode&48)==32;int paper=Color.rgb(dark?28:247,dark?33:249,dark?30:245),ink=dark?Color.WHITE:Color.rgb(38,48,42);getWindow().setStatusBarColor(paper);getWindow().setNavigationBarColor(paper);LinearLayout root=new LinearLayout(this);root.setOrientation(1);int pad=(int)(24*getResources().getDisplayMetrics().density);root.setPadding(pad,pad*2,pad,pad);root.setBackgroundColor(paper);ScrollView sc=new ScrollView(this);sc.addView(root);setContentView(sc);
-  TextView title=new TextView(this);title.setText(R.string.app_name);title.setTextSize(27);title.setTextColor(ink);root.addView(title);TextView version=new TextView(this);version.setText("0.5.54 / 0.5.55 → "+UpdateSpec.VERSION_NAME);version.setTextSize(15);version.setTextColor(ink);version.setPadding(0,pad,0,pad);root.addView(version);status=new TextView(this);status.setText(R.string.intro);status.setTextSize(16);status.setTextColor(ink);status.setLineSpacing(8,1);root.addView(status);progress=new ProgressBar(this);progress.setVisibility(View.GONE);root.addView(progress);next=new Button(this);root.addView(next);next.setOnClickListener(v->{if(ready)install();else if(!busy&&!installed)prepare();});open=new Button(this);open.setText(R.string.open_reader);open.setVisibility(View.GONE);root.addView(open);open.setOnClickListener(v->openReader());TextView foot=new TextView(this);foot.setText(R.string.footnote);foot.setTextSize(13);foot.setTextColor(ink);foot.setPadding(0,pad,0,0);root.addView(foot);refresh();
+ private static WeakReference<MainActivity> active=new WeakReference<>(null);
+ private final ExecutorService worker=Executors.newSingleThreadExecutor();private final Handler main=new Handler(Looper.getMainLooper());
+ private TextView status,versions;private Button next;private ProgressBar progress;private boolean ready,busy,checking,installed,foreground,continueAfterPermission;private File apk;private long inspection;private String installedName="?",installedHash="",diagnostic="";private int observed=InstallRules.OLD;
+ @Override public void onCreate(Bundle state){
+  setTheme(android.R.style.Theme_Material_Light_NoActionBar);super.onCreate(state);apk=new File(getCacheDir(),"release.apk");boolean dark=(getResources().getConfiguration().uiMode&48)==32;int paper=Color.rgb(dark?28:247,dark?33:249,dark?30:245),ink=dark?Color.WHITE:Color.rgb(38,48,42);getWindow().setStatusBarColor(paper);getWindow().setNavigationBarColor(paper);
+  LinearLayout root=new LinearLayout(this);root.setOrientation(1);int pad=(int)(24*getResources().getDisplayMetrics().density);root.setPadding(pad,pad*2,pad,pad);root.setBackgroundColor(paper);ScrollView sc=new ScrollView(this);sc.addView(root);setContentView(sc);
+  TextView title=new TextView(this);title.setText(R.string.app_name);title.setTextSize(27);title.setTextColor(ink);root.addView(title);versions=new TextView(this);versions.setTextSize(16);versions.setTextColor(ink);versions.setPadding(0,pad,0,pad);root.addView(versions);status=new TextView(this);status.setText(R.string.intro);status.setTextSize(16);status.setTextColor(ink);status.setLineSpacing(8,1);root.addView(status);progress=new ProgressBar(this);progress.setVisibility(View.GONE);root.addView(progress);
+  next=new Button(this);next.setOnClickListener(v->{if(installed)openReader();else if(ready)install();else prepare();});root.addView(next);Button copy=new Button(this);copy.setText(R.string.copy_diagnostics);copy.setOnClickListener(v->copyDiagnostics());root.addView(copy);TextView foot=new TextView(this);foot.setText(R.string.footnote);foot.setTextColor(ink);foot.setTextSize(13);foot.setPadding(0,pad,0,0);root.addView(foot);refresh();
  }
  private void ui(Runnable task){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())task.run();});}
  private int flags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
  private long version(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
  private boolean trusted(PackageInfo info)throws Exception{android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;return signatures!=null&&signatures.length==1&&Delta.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())).equals(CERT);}
  private PackageInfo reader()throws Exception{PackageInfo p=getPackageManager().getPackageInfo(APP,flags());if(!trusted(p))throw new SecurityException();return p;}
- private void refresh(){if(next==null)return;next.setEnabled(!busy&&!installed);next.setText(installed?R.string.done:ready?(getPackageManager().canRequestPackageInstalls()?R.string.install:R.string.allow_install):R.string.prepare);progress.setVisibility(busy?View.VISIBLE:View.GONE);}
- private void prepare(){busy=true;status.setText(R.string.preparing);refresh();worker.execute(()->{int result=R.string.failed;try{PackageInfo old=reader();if(version(old)>=UpdateSpec.VERSION_CODE){ui(()->complete());return;}File base=new File(old.applicationInfo.publicSourceDir==null?old.applicationInfo.sourceDir:old.applicationInfo.publicSourceDir);String hash=Delta.hex(Delta.hash(base));boolean supported=false;for(String h:UpdateSpec.BASE_HASHES)if(h.equals(hash))supported=true;if(!supported){result=R.string.wrong_base;throw new IOException();}try(InputStream patch=getAssets().open(hash+".trdp")){Delta.restore(base,patch,apk,hash,UpdateSpec.TARGET_SHA);}PackageInfo target=getPackageManager().getPackageArchiveInfo(apk.getPath(),flags());if(target==null||!APP.equals(target.packageName)||version(target)!=UpdateSpec.VERSION_CODE||!trusted(target))throw new SecurityException();ui(()->{busy=false;ready=true;status.setText(R.string.ready);open.setVisibility(View.VISIBLE);refresh();});return;
-   }catch(PackageManager.NameNotFoundException e){result=R.string.missing;}catch(SecurityException e){result=R.string.signature;}catch(Exception e){}apk.delete();final int message=result;ui(()->{busy=false;ready=false;status.setText(message);refresh();});});}
- private void complete(){busy=false;ready=false;installed=true;status.setText(R.string.already);open.setVisibility(View.VISIBLE);refresh();}
+ private File installedFile(PackageInfo p){return new File(p.applicationInfo.publicSourceDir==null?p.applicationInfo.sourceDir:p.applicationInfo.publicSourceDir);}
+ private boolean cachedApk()throws Exception{if(!apk.isFile()||!Delta.hex(Delta.hash(apk)).equals(UpdateSpec.TARGET_SHA))return false;PackageInfo p=getPackageManager().getPackageArchiveInfo(apk.getPath(),flags());return p!=null&&APP.equals(p.packageName)&&version(p)==UpdateSpec.VERSION_CODE&&UpdateSpec.VERSION_NAME.equals(p.versionName)&&trusted(p);}
+ private void refresh(){if(next==null)return;versions.setText(getString(R.string.version_lines,installedName,UpdateSpec.VERSION_NAME));next.setEnabled(!busy&&!checking);next.setText(installed?getString(R.string.open_verified):ready?getString(getPackageManager().canRequestPackageInstalls()?R.string.install_reader:R.string.allow_install,UpdateSpec.VERSION_NAME):getString(R.string.prepare));progress.setVisibility(busy||checking?View.VISIBLE:View.GONE);}
+ static void installStateChanged(){MainActivity a=active.get();if(a!=null&&a.foreground)a.ui(a::handleInstallerState);}
+ private void handleInstallerState(){if(!foreground)return;int phase=InstallTracker.phase(this);if(phase==InstallTracker.WAITING&&!InstallTracker.prefs(this).getBoolean("launched",false)){try{int id=InstallTracker.session(this);ComponentName component=ComponentName.unflattenFromString(InstallTracker.prefs(this).getString("confirm_component",""));InstallStatusReceiver.checkedComponent(this,component);Intent confirmation=new Intent(InstallTracker.CONFIRM).setComponent(component).putExtra(PackageInstaller.EXTRA_SESSION_ID,id);InstallTracker.prefs(this).edit().putBoolean("launched",true).commit();startActivity(confirmation);status.setText(R.string.confirm);return;}catch(Exception error){InstallTracker.fail(this,PackageInstaller.STATUS_FAILURE,"confirmation_launch_failed");}}
+  inspect(0);
+ }
+ private void inspect(int attempt){if(busy)return;final long token=++inspection;checking=true;refresh();worker.execute(()->{
+  String name=getString(R.string.missing_short),hash="",detail="";int state=InstallRules.OLD,error=0;boolean cache=ready;
+  try{PackageInfo p=reader();name=p.versionName;long code=version(p);if(code==UpdateSpec.VERSION_CODE)hash=Delta.hex(Delta.hash(installedFile(p)));state=InstallRules.installed(code,p.versionName,hash,UpdateSpec.VERSION_CODE,UpdateSpec.VERSION_NAME,UpdateSpec.TARGET_SHA);detail="reader="+name+" ("+code+")\nreader_sha="+hash;if(!cache&&state!=InstallRules.EXACT&&state!=InstallRules.NEWER)cache=cachedApk();}
+  catch(PackageManager.NameNotFoundException e){error=R.string.missing;}catch(SecurityException e){error=R.string.signature;}catch(Exception e){error=R.string.inspect_failed;}
+  final String label=name,foundHash=hash,info=detail;final int current=state,problem=error;final boolean available=cache;
+  ui(()->{if(token!=inspection)return;checking=false;installedName=label;installedHash=foundHash;observed=current;diagnostic=info;ready=problem==0&&available;installed=problem==0&&(current==InstallRules.EXACT||current==InstallRules.NEWER);int phase=InstallTracker.phase(this);
+   if(installed){ready=false;continueAfterPermission=false;status.setText(current==InstallRules.NEWER?R.string.newer_verified:phase==InstallTracker.SUCCESS?R.string.success_verified:R.string.already_verified);}
+   else if(problem!=0){continueAfterPermission=false;status.setText(problem);}
+   else if(continueAfterPermission){continueAfterPermission=false;refresh();if(ready){install();return;}status.setText(R.string.prepare);}
+   else if(phase==InstallTracker.SUCCESS&&attempt<3){status.setText(R.string.checking_installed);refresh();main.postDelayed(()->{if(foreground&&inspection==token)inspect(attempt+1);},300);return;}
+   else if(phase==InstallTracker.SUCCESS)status.setText(R.string.not_updated);
+   else if(phase==InstallTracker.FAILED)status.setText(failureText(InstallTracker.prefs(this).getInt("status",PackageInstaller.STATUS_FAILURE)));
+   else if(phase==InstallTracker.COMMITTED||phase==InstallTracker.WRITING||phase==InstallTracker.WAITING)status.setText(R.string.pending_resume);
+   else status.setText(ready?R.string.ready:R.string.intro);
+   refresh();
+  });
+ });}
+ private int failureText(int code){switch(code){case PackageInstaller.STATUS_FAILURE_ABORTED:return R.string.user_cancelled;case PackageInstaller.STATUS_FAILURE_BLOCKED:return R.string.system_blocked;case PackageInstaller.STATUS_FAILURE_STORAGE:return R.string.space_error;case PackageInstaller.STATUS_FAILURE_CONFLICT:return R.string.conflict_error;case PackageInstaller.STATUS_FAILURE_INVALID:return R.string.invalid_package;case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:return R.string.incompatible_error;default:return R.string.install_failed;}}
+ private void prepare(){if(busy||checking)return;busy=true;inspection++;status.setText(R.string.preparing);refresh();worker.execute(()->{int result=R.string.failed;try{PackageInfo old=reader();if(version(old)>UpdateSpec.VERSION_CODE){ui(()->{busy=false;inspect(0);});return;}if(!cachedApk()){File base=installedFile(old);String hash=Delta.hex(Delta.hash(base));boolean supported=false;for(String h:UpdateSpec.BASE_HASHES)if(h.equals(hash))supported=true;if(!supported){result=R.string.wrong_base;throw new IOException();}try(InputStream patch=getAssets().open(hash+".trdp")){Delta.restore(base,patch,apk,hash,UpdateSpec.TARGET_SHA);}if(!cachedApk())throw new SecurityException();}ui(()->{busy=false;ready=true;status.setText(R.string.ready);refresh();});return;
+  }catch(PackageManager.NameNotFoundException e){result=R.string.missing;}catch(SecurityException e){result=R.string.signature;}catch(Exception e){}final int message=result;ui(()->{busy=false;ready=false;status.setText(message);refresh();});});}
  private void launchSystem(Intent intent){PackageManager pm=getPackageManager();for(ResolveInfo r:pm.queryIntentActivities(intent,PackageManager.MATCH_DEFAULT_ONLY)){ActivityInfo a=r.activityInfo;if(a!=null&&a.exported&&(a.applicationInfo.flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))!=0){intent.setComponent(new ComponentName(a.packageName,a.name));startActivity(intent);return;}}throw new ActivityNotFoundException();}
- private void install(){if(!ready||busy)return;try{if(version(reader())>=UpdateSpec.VERSION_CODE){complete();return;}if(!getPackageManager().canRequestPackageInstalls()){launchSystem(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));return;}busy=true;refresh();worker.execute(()->{try{if(!Delta.hex(Delta.hash(apk)).equals(UpdateSpec.TARGET_SHA))throw new IOException();ui(()->{busy=false;try{Intent request=new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(ApkProvider.uri(),"application/vnd.android.package-archive");request.setClipData(ClipData.newRawUri("TransRead update",ApkProvider.uri()));request.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);launchSystem(request);status.setText(R.string.confirm);}catch(Exception e){status.setText(R.string.installer_unavailable);}refresh();});}catch(Exception e){ui(()->{busy=false;ready=false;status.setText(R.string.failed);refresh();});}});
-  }catch(Exception e){status.setText(R.string.installer_unavailable);refresh();}}
- private void openReader(){try{reader();Intent intent=getPackageManager().getLaunchIntentForPackage(APP);if(intent==null||intent.getComponent()==null||!APP.equals(intent.getComponent().getPackageName()))throw new SecurityException();startActivity(intent);}catch(Exception e){status.setText(R.string.missing);}}
- @Override protected void onResume(){super.onResume();if(status==null)return;try{if(version(reader())>=UpdateSpec.VERSION_CODE){complete();return;}}catch(Exception e){}refresh();}
- @Override protected void onDestroy(){worker.shutdown();super.onDestroy();}
+ private void install(){if(!ready||busy||checking)return;if(!getPackageManager().canRequestPackageInstalls()){InstallTracker.prefs(this).edit().putLong("permission_at",System.currentTimeMillis()).commit();try{launchSystem(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}catch(Exception e){InstallTracker.prefs(this).edit().remove("permission_at").commit();status.setText(R.string.installer_unavailable);}return;}
+  busy=true;inspection++;status.setText(R.string.staging);refresh();worker.execute(()->{try{PackageInfo old=reader();if(version(old)>UpdateSpec.VERSION_CODE){ui(()->{busy=false;inspect(0);});return;}if(!cachedApk())throw new IOException();SessionInstaller.stage(this,apk);ui(()->{busy=false;handleInstallerState();});}catch(Exception e){InstallTracker.fail(this,PackageInstaller.STATUS_FAILURE,"session_start_failed");ui(()->{busy=false;status.setText(R.string.install_failed);refresh();});}});
+ }
+ private void openReader(){try{if(!installed)return;reader();Intent intent=getPackageManager().getLaunchIntentForPackage(APP);if(intent==null||intent.getComponent()==null||!APP.equals(intent.getComponent().getPackageName()))throw new SecurityException();startActivity(intent);}catch(Exception e){status.setText(R.string.missing);}}
+ private void copyDiagnostics(){String text="TransRead update helper r2\ntarget="+UpdateSpec.VERSION_NAME+" ("+UpdateSpec.VERSION_CODE+")\n"+diagnostic+"\nphase="+InstallTracker.phase(this)+"\nstatus="+InstallTracker.prefs(this).getInt("status",Integer.MIN_VALUE)+"\nsession="+InstallTracker.session(this)+"\nreason="+InstallTracker.prefs(this).getString("message","")+"\nsdk="+Build.VERSION.SDK_INT;ClipboardManager c=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(c!=null){c.setPrimaryClip(ClipData.newPlainText("TransRead update diagnostic",text));Toast.makeText(this,R.string.diagnostics_copied,Toast.LENGTH_SHORT).show();}}
+ @Override protected void onResume(){super.onResume();foreground=true;active=new WeakReference<>(this);if(status==null)return;long requested=InstallTracker.prefs(this).getLong("permission_at",0);if(requested>0){continueAfterPermission=InstallRules.permissionContinuation(requested,System.currentTimeMillis(),getPackageManager().canRequestPackageInstalls());InstallTracker.prefs(this).edit().remove("permission_at").commit();}handleInstallerState();}
+ @Override protected void onPause(){foreground=false;inspection++;checking=false;if(active.get()==this)active.clear();super.onPause();}
+ @Override protected void onDestroy(){main.removeCallbacksAndMessages(null);worker.shutdown();super.onDestroy();}
 }
--- /dev/null
+++ b/updater/src/app/lumi/reader/update/SessionInstaller.java
@@ -0,0 +1,23 @@
+package app.lumi.reader.update;
+import android.app.PendingIntent;
+import android.content.*;
+import android.content.pm.*;
+import android.os.Build;
+import java.io.*;
+import java.util.UUID;
+/** All APK bytes are written and closed before commit; completion is asynchronous. */
+public final class SessionInstaller {
+ static int stage(Context context,File apk)throws Exception{
+  PackageInstaller installer=context.getPackageManager().getPackageInstaller();int previous=InstallTracker.session(context);InstallTracker.clearSession(context);
+  if(previous>=0)try{PackageInstaller.SessionInfo old=installer.getSessionInfo(previous);if(old!=null&&context.getPackageName().equals(old.getInstallerPackageName()))installer.abandonSession(previous);}catch(Exception ignored){}
+  PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);params.setAppPackageName(MainActivity.APP);params.setSize(apk.length());params.setInstallReason(PackageManager.INSTALL_REASON_USER);if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
+  int id=installer.createSession(params);String nonce=UUID.randomUUID().toString();InstallTracker.begin(context,id,nonce);boolean committed=false;
+  try(PackageInstaller.Session session=installer.openSession(id)){
+   try(InputStream in=new FileInputStream(apk);OutputStream out=session.openWrite("base.apk",0,apk.length())){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);session.fsync(out);}
+   Intent callback=new Intent(context,InstallStatusReceiver.class).setAction(InstallTracker.ACTION).setData(InstallTracker.resultUri(nonce)).putExtra(InstallTracker.OWN_SESSION,id);
+   int flags=PendingIntent.FLAG_UPDATE_CURRENT;if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
+   PendingIntent result=PendingIntent.getBroadcast(context,id,callback,flags);InstallTracker.committed(context);session.commit(result.getIntentSender());committed=true;return id;
+  }finally{if(!committed){try{installer.abandonSession(id);}catch(Exception ignored){}InstallTracker.fail(context,PackageInstaller.STATUS_FAILURE,"session_commit_failed");}}
+ }
+ private SessionInstaller(){}
+}
```
