/* Executes the actual semantic mapping and foreground guard against View stubs.
 * System behavior and motor quality still require an Android device. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/MainActivity.java'),'utf8');
const methods=source.slice(source.indexOf('    private static int hapticFeedbackFor('),source.indexOf('    public class Bridge {'));
assert(methods.includes('web.performHapticFeedback(effect)'));
const dir=fs.mkdtempSync(path.join(root,'build/native-haptics-'));
const harness=`import java.util.*;
public class NativeHapticHarness {
 static class HapticFeedbackConstants {static final int SEGMENT_TICK=26,SEGMENT_FREQUENT_TICK=27,CLOCK_TICK=4,CONTEXT_CLICK=6,TOGGLE_ON=21,TOGGLE_OFF=22,CONFIRM=16,GESTURE_END=13;}
 static class Build {static class VERSION {static int SDK_INT=35;}}
 static class JSONObject {String kind;boolean gentle;JSONObject(String value){kind=value;}JSONObject(String value,boolean soft){kind=value;gentle=soft;}String optString(String key){return kind;}boolean optBoolean(String key){return gentle;}}
 static class FakeView {boolean shown=true,focused=true,enabled=true,system=true;List<Integer> played=new ArrayList<>();boolean isShown(){return shown;}boolean hasWindowFocus(){return focused;}boolean performHapticFeedback(int effect){if(!enabled||!system)return false;played.add(effect);return true;}}
 FakeView web=new FakeView();
 static void check(String label,boolean value){if(!value)throw new AssertionError(label);System.out.println("PASS "+label);}
 public static void main(String[] args){NativeHapticHarness h=new NativeHapticHarness();
 check("Current Android maps actions to selection, toggle, confirmation and gesture constants",hapticFeedbackFor("selection",35)==27&&hapticFeedbackFor("toggle-on",35)==21&&hapticFeedbackFor("toggle-off",35)==22&&hapticFeedbackFor("confirm",35)==16&&hapticFeedbackFor("gesture",35)==13);
 check("Older Android versions use only supported short semantic constants",hapticFeedbackFor("selection",26)==4&&hapticFeedbackFor("toggle-on",26)==4&&hapticFeedbackFor("confirm",26)==6&&hapticFeedbackFor("gesture",26)==4);
 check("Dense ticks are skipped when a suitably subtle constant is unavailable",hapticFeedbackFor("segment",26)==-1&&hapticFeedbackFor("segment",34)==27);
 check("Unknown haptic operations have no arbitrary vibration fallback",hapticFeedbackFor("arbitrary-waveform",35)==-1);
 h.playHaptic(new JSONObject("confirm"));check("Foreground feedback reaches the View semantic API",h.web.played.equals(Arrays.asList(16)));
 h.web.played.clear();h.playHaptic(new JSONObject("gesture",true));h.playHaptic(new JSONObject("toggle-on",true));h.playHaptic(new JSONObject("confirm",true));check("Gentle mode softens gestures and toggles while retaining success confirmation",h.web.played.equals(Arrays.asList(27,27,16)));h.web.played.clear();h.playHaptic(new JSONObject("confirm"));
 check("Dock selection, card dismissal and buttons use the softest system tick",hapticFeedbackFor("selection",35)==27&&hapticFeedbackFor("sheet",35)==27&&hapticFeedbackFor("soft",35)==27);
 h.playHaptic(new JSONObject("invalid-kind",true));check("Gentle mode cannot turn an unknown operation into a vibration",h.web.played.size()==1);
 h.web.focused=false;h.playHaptic(new JSONObject("confirm"));h.web.focused=true;h.web.shown=false;h.playHaptic(new JSONObject("confirm"));check("Hidden or unfocused views discard feedback rather than queue it",h.web.played.size()==1);
 h.web.shown=true;h.web.system=false;h.playHaptic(new JSONObject("confirm"));h.web.system=true;h.web.enabled=false;h.playHaptic(new JSONObject("confirm"));check("App calls leave system and View settings in control",h.web.played.size()==1);
 h.web=null;h.playHaptic(new JSONObject("confirm"));check("Feedback is safe after the WebView is gone",true);
 System.out.println("\\n11 native haptic checks passed with View stubs. No physical vibration claims.");
 }
`+methods+'\n}\n';
fs.writeFileSync(path.join(dir,'NativeHapticHarness.java'),harness);
const compile=spawnSync('java',['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'NativeHapticHarness.java')],{encoding:'utf8',timeout:20000});
if(compile.status!==0){process.stderr.write(compile.stdout+compile.stderr);process.exit(1);}
const result=spawnSync('java',['-cp',dir,'NativeHapticHarness'],{encoding:'utf8',timeout:10000});process.stdout.write(result.stdout||'');if(result.status!==0){process.stderr.write(result.stderr||'');process.exit(1);}
const manifest=fs.readFileSync(path.join(root,'android/AndroidManifest.xml'),'utf8');assert(!manifest.includes('android.permission.VIBRATE'));assert(!methods.includes('FLAG_IGNORE'));console.log('PASS Haptic integration adds no vibration permission or settings-bypass flags');
