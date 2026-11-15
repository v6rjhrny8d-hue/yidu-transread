/* Execute the production recovery method against controlled View stubs. */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/MainActivity.java'),'utf8');
const method=src.slice(src.indexOf('    private boolean recoverRenderer('),src.indexOf('    private class ReaderWebView'));
assert.equal((src.match(/onRenderProcessGone\(WebView v,RenderProcessGoneDetail detail\)/g)||[]).length,3);
const dir=fs.mkdtempSync('/tmp/transread-recovery-');
const harness=`import java.util.*;
public class RendererRecoveryHarness {
 static class android {static class util {static class Log {static void w(String tag,String message){}}}}
 interface ViewParent {}
 static class View {ViewGroup parent;ViewParent getParent(){return parent;}interface Listener{void click(View v);}}
 static class ViewGroup extends View implements ViewParent {List<View> children=new ArrayList<>();void addView(View v,Object p){children.add(v);v.parent=this;}void addView(View v){addView(v,null);}void removeView(View v){children.remove(v);v.parent=null;}}
 static class WebView extends View {boolean destroyed;int calls;void removeJavascriptInterface(String s){calls++;}void destroy(){destroyed=true;}}
 static class FrameLayout extends ViewGroup {static class LayoutParams {LayoutParams(int w,int h){}}}
 static class LinearLayout extends ViewGroup {static final int VERTICAL=1;LinearLayout(Object c){}void setOrientation(int n){}void setGravity(int n){}void setPadding(int a,int b,int c,int d){}static class LayoutParams {LayoutParams(int w,int h){}}}
 static class TextView extends View {String text;TextView(Object c){}void setText(String t){text=t;}void setTextSize(int n){}void setTextColor(int n){}void setGravity(int n){}}
 static class Button extends TextView {View.Listener listener;Button(Object c){super(c);}void setOnClickListener(View.Listener l){listener=l;}}
 static class Color {static int rgb(int a,int b,int c){return 0;}}
 static class Gravity {static final int CENTER=1;}
 static class RenderProcessGoneDetail {boolean crash;RenderProcessGoneDetail(boolean c){crash=c;}boolean didCrash(){return crash;}}
 WebView web=new WebView(),sourceWeb;FrameLayout root=new FrameLayout(),sourceRoot;boolean immersiveReading=true,systemDark=false,finishing=false;int recreations,bars;
 boolean isFinishing(){return finishing;}boolean isDestroyed(){return false;}void applySystemBars(){bars++;}void setSystemTheme(boolean d){}void closeSource(){if(sourceRoot!=null)root.removeView(sourceRoot);sourceRoot=null;sourceWeb=null;}int dp(int n){return n;}String uiText(String t){return t;}void recreate(){recreations++;}
 static int passed;static void check(String s,boolean b){if(!b)throw new AssertionError(s);passed++;System.out.println("PASS "+s);}
 public static void main(String[] args){
  RendererRecoveryHarness h=new RendererRecoveryHarness();WebView main=h.web;h.root.addView(main);
  check("Main renderer termination is handled",h.recoverRenderer(main,new RenderProcessGoneDetail(true)));
  check("Dead main WebView is detached, destroyed and cleared",h.web==null&&main.destroyed&&main.parent==null&&main.calls==1);
  check("Recovery leaves an interactive native panel instead of exiting",h.root.children.size()==1&&!h.immersiveReading&&h.bars==1);
  LinearLayout panel=(LinearLayout)h.root.children.get(0);Button retry=(Button)panel.children.get(1);retry.listener.click(retry);check("Recovery button creates a fresh Activity",h.recreations==1);
  RendererRecoveryHarness s=new RendererRecoveryHarness();WebView reader=s.web;s.sourceWeb=new WebView();WebView source=s.sourceWeb;s.sourceRoot=new FrameLayout();s.sourceRoot.addView(source);s.root.addView(s.sourceRoot);
  check("Source renderer low-memory termination is also handled",s.recoverRenderer(source,new RenderProcessGoneDetail(false)));
  check("Source cleanup does not destroy an unaffected reader",s.web==reader&&!reader.destroyed&&source.destroyed&&s.sourceWeb==null&&s.sourceRoot==null);
  RendererRecoveryHarness closing=new RendererRecoveryHarness();closing.finishing=true;WebView c=closing.web;closing.root.addView(c);closing.recoverRenderer(c,new RenderProcessGoneDetail(true));check("Finishing Activity does not open another recovery panel",closing.root.children.isEmpty()&&c.destroyed);
  System.out.println(passed+" native renderer recovery checks passed with stubs. No Android process crash was injected.");
 }
`+"\n void closePdf(){}\n"+method+'\n}';
fs.writeFileSync(path.join(dir,'RendererRecoveryHarness.java'),harness);
for(const [cmd,args] of [['java',['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'RendererRecoveryHarness.java')]],['java',['-cp',dir,'RendererRecoveryHarness']]]){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:20000});process.stdout.write(r.stdout||'');if(r.status!==0){process.stderr.write(r.stderr||'');process.exitCode=1;break;}}
fs.rmSync(dir,{recursive:true,force:true});
