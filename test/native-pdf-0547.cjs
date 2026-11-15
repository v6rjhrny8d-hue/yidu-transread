/* Execute production first-frame/cancellation paths with stubs. Not an Android compositor test. */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),view=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/PdfReaderView.java'),'utf8'),activity=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/MainActivity.java'),'utf8');
const ready=view.slice(view.indexOf('    private Runnable firstFrameReady'),view.indexOf('\n\n',view.indexOf('    private Runnable firstFrameReady')));
const paint=view.slice(view.indexOf('        if(firstFrameReady!=null&&!firstFramePosted'),view.indexOf('\n    }\n    /** EPUB'));
const cancel=activity.slice(activity.indexOf('            // Cancel a preparation immediately'),activity.indexOf('            io.execute(()->{',activity.indexOf('            // Cancel a preparation immediately')));
assert(view.includes('if(index==activePage)failFirstFrame()'));assert(activity.includes('pdfView.whenFirstFrame('));
const code=`import java.util.*;import java.util.concurrent.atomic.AtomicInteger;
public class PdfReadyHarness {
 static int count;static void check(String name,boolean yes){if(!yes)throw new AssertionError(name);System.out.println("PASS "+name);count++;}
 static class View {
 boolean closed;int activePage;Map<Integer,Object> cache=new HashMap<>();List<Runnable> frames=new ArrayList<>();void invalidate(){}void postOnAnimation(Runnable r){frames.add(r);}void flush(){List<Runnable> list=new ArrayList<>(frames);frames.clear();for(Runnable r:list)r.run();}
 ${ready}
 void draw(){${paint}}
 void close(){firstFrameReady=null;firstFrameFailure=null;closed=true;}
 }
 static class JSONObject {String raw;JSONObject(String text){raw=text;}String optString(String key){return key.equals("session")?raw.split(":")[0]:raw.contains(":")?raw.split(":")[1]:"";}}
 AtomicInteger pdfOpenEpoch=new AtomicInteger();String pdfRequestedSession,pdfSession;int closedCount;List<Runnable> ui=new ArrayList<>();List<String> replies=new ArrayList<>();void runOnUiThread(Runnable r){ui.add(r);}Object jsonCancelled(){return "cancelled";}void reply(String id,Object value,String error){replies.add(id+":"+value);}void closePdf(boolean ignored){closedCount++;}void flush(){for(Runnable r:ui)r.run();ui.clear();}
 void request(String op,String payload,String id){${cancel}}
 public static void main(String[] args){
  int[] hits={0,0};View v=new View();v.whenFirstFrame(()->hits[0]++,()->hits[1]++);v.draw();v.flush();check("PDF cannot become ready before its visible page bitmap exists",hits[0]==0);v.cache.put(0,new Object());v.draw();check("Readiness waits for the next frame after drawing",hits[0]==0&&v.frames.size()==1);v.draw();v.flush();v.draw();v.flush();check("First-page readiness resolves exactly once",hits[0]==1&&hits[1]==0);
  View fail=new View();fail.whenFirstFrame(()->hits[0]++,()->hits[1]++);fail.failFirstFrame();fail.failFirstFrame();check("A render failure rejects preparation exactly once",hits[1]==1&&hits[0]==1);
  View gone=new View();gone.whenFirstFrame(()->hits[0]++,()->hits[1]++);gone.cache.put(0,new Object());gone.draw();gone.close();gone.flush();check("Closing before the queued frame cannot reveal or callback a removed PDF",hits[0]==1&&hits[1]==1);
  View offscreen=new View();offscreen.activePage=7;offscreen.cache.put(0,new Object());offscreen.whenFirstFrame(()->hits[0]++,()->{});offscreen.draw();offscreen.flush();check("An offscreen cached page does not satisfy first-visible-page readiness",hits[0]==1);
  PdfReadyHarness h=new PdfReadyHarness();h.request("openPdf","A","open-a");int opening=h.pdfOpenEpoch.get();h.pdfSession="A";h.request("pdfControl","A:cancelOpen","cancel-a");check("Cancel invalidates a pending worker immediately before UI execution",h.pdfOpenEpoch.get()>opening&&h.closedCount==0);h.flush();check("Cancel closes the matching prepared native surface",h.closedCount==1);
  h.request("openPdf","B","open-b");int next=h.pdfOpenEpoch.get();h.request("pdfControl","A:cancelOpen","stale-a");h.flush();check("A stale cancellation cannot invalidate a newer PDF session",h.pdfOpenEpoch.get()==next&&h.closedCount==1);
  h.pdfSession="B";h.request("pdfControl","B:cancelOpen","cancel-b");h.pdfSession="C";h.flush();check("Delayed UI cancellation cannot close a newer native surface",h.closedCount==1);
  System.out.println("TOTAL "+count);
 }
}`;
const dir=fs.mkdtempSync('/tmp/yidu-ready-');try{fs.writeFileSync(path.join(dir,'PdfReadyHarness.java'),code);for(const args of [['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'PdfReadyHarness.java')],['-cp',dir,'PdfReadyHarness']]){const r=spawnSync('java',args,{encoding:'utf8',timeout:20000});process.stdout.write(r.stdout||'');assert.equal(r.status,0,r.stderr);}}finally{fs.rmSync(dir,{recursive:true,force:true});}
