/* Execute the production ActionMode wrapper with a known selection rectangle. */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process'),root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/MainActivity.java'),'utf8');
const a=src.indexOf('        @Override public ActionMode startActionMode'),b=src.indexOf('\n    }',a),method=src.slice(a,b).replaceAll('android.graphics.Rect','Rect');
const dir=fs.mkdtempSync('/tmp/transread-selection-');
const code=`public class SelectionHarness{
 static class Rect{int left,top,right,bottom;void set(int l,int t,int r,int b){left=l;top=t;right=r;bottom=b;}}
 static class View{}
 static class MenuItem{static final int SHOW_AS_ACTION_IF_ROOM=1;int getItemId(){return 0;}void setShowAsAction(int x){}}
 static class Menu{int added;MenuItem add(int a,int b,int c,String title){added++;return new MenuItem();}}
 static class ActionMode{Callback callback;interface Callback{boolean onCreateActionMode(ActionMode m,Menu menu);boolean onPrepareActionMode(ActionMode m,Menu menu);boolean onActionItemClicked(ActionMode m,MenuItem item);void onDestroyActionMode(ActionMode m);}abstract static class Callback2 implements Callback{public void onGetContentRect(ActionMode m,View v,Rect r){r.set(0,0,390,844);}}}
 static class Base{ActionMode startActionMode(ActionMode.Callback callback,int type){ActionMode mode=new ActionMode();mode.callback=callback;return mode;}}
 static class Web{void evaluateJavascript(String s,Object callback){}}static Web web=new Web();static String uiText(String s){return s;}
 static class Reader extends Base{${method}}
 static int created,prepared,destroyed,clicked,rects;static void check(boolean value,String name){if(!value)throw new AssertionError(name);System.out.println("PASS "+name);}
 public static void main(String[] args){ActionMode.Callback2 original=new ActionMode.Callback2(){public boolean onCreateActionMode(ActionMode m,Menu menu){created++;return true;}public boolean onPrepareActionMode(ActionMode m,Menu menu){prepared++;return true;}public boolean onActionItemClicked(ActionMode m,MenuItem item){clicked++;return true;}public void onDestroyActionMode(ActionMode m){destroyed++;}public void onGetContentRect(ActionMode m,View v,Rect r){rects++;r.set(200,600,240,630);}};
  ActionMode wrapped=new Reader().startActionMode(original,1);Rect rect=new Rect();((ActionMode.Callback2)wrapped.callback).onGetContentRect(wrapped,new View(),rect);check(rect.top==600&&rect.left==200&&rect.bottom==630&&rects==1,"Floating toolbar receives the real selection rectangle");
  Menu menu=new Menu();wrapped.callback.onCreateActionMode(wrapped,menu);wrapped.callback.onPrepareActionMode(wrapped,menu);wrapped.callback.onActionItemClicked(wrapped,new MenuItem());wrapped.callback.onDestroyActionMode(wrapped);check(created==1&&prepared==1&&clicked==1&&destroyed==1&&menu.added==1,"Original selection actions and sentence collection remain delegated");
  ((ActionMode.Callback2)wrapped.callback).onGetContentRect(wrapped,new View(),rect);check(rects==2,"Selection movement can request an updated rectangle");
  ActionMode.Callback old=new ActionMode.Callback(){public boolean onCreateActionMode(ActionMode m,Menu x){return true;}public boolean onPrepareActionMode(ActionMode m,Menu x){return true;}public boolean onActionItemClicked(ActionMode m,MenuItem i){return false;}public void onDestroyActionMode(ActionMode m){}};wrapped=new Reader().startActionMode(old,1);((ActionMode.Callback2)wrapped.callback).onGetContentRect(wrapped,new View(),rect);check(rect.top==0&&rect.bottom==844,"Legacy callbacks safely retain the platform default");
 }
}`;fs.writeFileSync(path.join(dir,'SelectionHarness.java'),code);for(const args of [['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'SelectionHarness.java')],['-cp',dir,'SelectionHarness']]){const r=spawnSync('java',args,{encoding:'utf8',timeout:20000});process.stdout.write(r.stdout||'');if(r.status!==0){process.stderr.write(r.stderr||'');process.exitCode=1;break;}}fs.rmSync(dir,{recursive:true,force:true});
