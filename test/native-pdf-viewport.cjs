/* Execute production viewport geometry and cache eviction using lightweight stubs.
 * This does not emulate Android's PdfRenderer, Canvas, or MediaStore. */
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),assert=require('assert/strict');const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/PdfReaderView.java'),'utf8');
const geometry=source.slice(source.indexOf('    private void layoutPages()'),source.indexOf('    public void setEdgeHeight('));
const target=source.slice(source.indexOf('    private int targetWidth('),source.indexOf('    private void requestPage('));
const trim=source.slice(source.indexOf('    private void trimCache()'),source.indexOf('    private void scheduleReport()'));
assert(source.includes('epoch==generation')&&source.includes('if(closed||epoch!=generation)'));
const dir=fs.mkdtempSync('/tmp/transread-pdf-');
const harness=`import java.util.*;
class ViewStub {int width=412,height=780;int getWidth(){return width;}int getHeight(){return height;}void invalidate(){}protected void onSizeChanged(int w,int h,int oldW,int oldH){}}
public class PdfViewportHarness extends ViewStub {
 static final int MAX_PIXELS=2000000,MAX_CACHE_BYTES=20*1024*1024,MAX_CACHE_PAGES=8;
 static class Bitmap {int bytes;boolean recycled;Bitmap(int b){bytes=b;}int getAllocationByteCount(){return bytes;}void recycle(){recycled=true;}}
 final LinkedHashMap<Integer,Bitmap> cache=new LinkedHashMap<>();
 double[] ratios,tops;double scroll,total,initialOffset;float zoom=1,panX,baseWidth,topInset;int visibleFirst,visibleLast,edgeHeight=28,leadingSpace=12,paperColor;boolean initialized,scaling;int activePage,generation;
 static class Fling {void forceFinished(boolean b){}}Fling fling=new Fling();void scheduleReport(){}
 PdfViewportHarness(double[] sizes){ratios=sizes;tops=new double[sizes.length+1];}
 static int count;static void check(String label,boolean condition){if(!condition)throw new AssertionError(label);System.out.println("PASS "+label);count++;}
 public static void main(String[] args){
  PdfViewportHarness view=new PdfViewportHarness(new double[]{1.414,.707,2,1.2});view.activePage=2;view.initialOffset=.35;
  check("Closing before first layout retains the requested PDF page",view.currentPage()==2&&Math.abs(view.pageOffset()-.35)<1e-9);
  view.onSizeChanged(412,780,0,0);check("Initial layout restores page and within-page offset",view.currentPage()==2&&Math.abs(view.pageOffset()-.35)<1e-9);
  view.goTo(1);check("Page navigation lands at the correct page boundary",view.currentPage()==1&&view.pageOffset()<1e-9);
  view.scroll=-100;view.panX=900;view.clamp();check("A fitted page cannot pan sideways or scroll before the document",view.scroll==0&&view.panX==0);
  view.scroll=Double.MAX_VALUE;view.clamp();check("Scrolling is bounded by the complete document height",view.scroll==Math.max(0,view.total-view.getHeight()));
  view.goTo(2);view.scroll+=view.baseWidth*view.ratios[2]*.25;view.width=844;view.height=390;view.onSizeChanged(844,390,412,780);check("Landscape reflow retains the same source page and offset",view.currentPage()==2&&Math.abs(view.pageOffset()-.25)<1e-9);
  view.zoom=4;view.panX=99999;view.clamp();check("Zoomed panning stays within the scaled page edge",view.panX<2000&&view.panX>0);
  for(float z:new float[]{1,2,5}){view.zoom=z;for(double ratio:new double[]{.05,.707,1.414,5,100,100000000}){view.ratios[0]=ratio;int w=view.targetWidth(0),h=Math.max(1,(int)Math.min(4096,w*ratio));check("Bitmap pixel budget holds for scale "+z+" and aspect "+ratio,(long)w*h<=MAX_PIXELS&&w<=1800&&h<=4096);}}
  view.activePage=2;view.visibleFirst=2;view.visibleLast=3;for(int i=0;i<6;i++)view.cache.put(i,new Bitmap(8000000));view.trimCache();long bytes=0;for(Bitmap b:view.cache.values())bytes+=b.bytes;check("Cache eviction keeps nearby pages within both count and byte budgets",view.cache.containsKey(2)&&view.cache.size()<=MAX_CACHE_PAGES&&bytes<=MAX_CACHE_BYTES);
  view.goTo(2,.4);check("Bookmark navigation restores its within-page offset",Math.abs(view.pageOffset()-.4)<1e-9);view.goTo(2,.4);double anchor=view.scroll;float oldZoom=view.zoom,oldPan=view.panX;view.setEdgeHeight(16);view.setEdgeHeight(28);check("Changing the top edge effect does not change page offset, zoom or pan",view.scroll==anchor&&view.zoom==oldZoom&&view.panX==oldPan);view.width=844;view.height=430;view.onSizeChanged(844,430,844,390);check("Height-only changes retain the source position without invalidating render jobs",Math.abs(view.pageOffset()-.4)<1e-9);
  PdfViewportHarness large=new PdfViewportHarness(new double[12000]);Arrays.fill(large.ratios,1.414);large.onSizeChanged(412,780,0,0);large.goTo(11000);check("A large document uses accurate page lookup without a page View list",large.currentPage()==11000);
  PdfViewportHarness lead=new PdfViewportHarness(new double[]{1.414,1.414,1.414});lead.setLeadingSpace(74);lead.onSizeChanged(412,780,0,0);check("A new PDF starts above page one with the requested button-height lead-in",lead.scroll==0&&lead.tops[0]==74);lead.goTo(0);check("Jumping to the first page includes its lead-in",lead.scroll==0);lead.scroll=37;lead.width=844;lead.height=390;lead.onSizeChanged(844,390,412,780);check("Rotation preserves a position inside the leading strip",lead.scroll==37);lead.setLeadingSpace(70);check("Orientation-specific button height preserves relative lead-in position",lead.scroll==35);lead.goTo(1,.3);double screen=lead.tops[1]-lead.scroll;lead.setLeadingSpace(100);check("Updating lead-in geometry preserves content position away from the start",Math.abs(lead.tops[1]-lead.scroll-screen)<1e-8);double stable=lead.scroll;lead.setLeadingSpace(100);lead.setEdgeHeight(16);lead.setEdgeHeight(28);check("Chrome and blur changes cannot move the PDF after lead-in is established",lead.scroll==stable);
  System.out.println(count+" PDF geometry/cache checks passed with stubs. No Android rendering claim.");
 }
`+source.slice(source.indexOf('    public void setEdgeHeight('),source.indexOf('    @Override protected void onDraw'))+geometry+target+trim+'\n}';
fs.writeFileSync(path.join(dir,'PdfViewportHarness.java'),harness);for(const args of [['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'PdfViewportHarness.java')],['-cp',dir,'PdfViewportHarness']]){const r=spawnSync('java',args,{encoding:'utf8',timeout:20000});process.stdout.write(r.stdout||'');if(r.status!==0){process.stderr.write(r.stderr||'');process.exitCode=1;break;}}fs.rmSync(dir,{recursive:true,force:true});
