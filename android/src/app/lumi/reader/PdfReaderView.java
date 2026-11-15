package app.lumi.reader;

import android.content.Context;
import android.graphics.*;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.view.*;
import android.widget.OverScroller;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Native continuous PDF viewport. No document-sized bitmap or full-page View list. */
public final class PdfReaderView extends View {
    public interface Listener {void position(int page,double offset);void error(String message);void tap();void longPress(int page,double offset);}
    private static final int MAX_PIXELS=2000000,MAX_CACHE_BYTES=20*1024*1024,MAX_CACHE_PAGES=8;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final LinkedHashMap<Integer,Bitmap> cache=new LinkedHashMap<>();
    private final Set<Integer> pending=new HashSet<>(),failed=new HashSet<>();
    private final double[] ratios,tops;
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    private final OverScroller fling;
    private final ScaleGestureDetector pinch;
    private final GestureDetector drag;
    private final Listener listener;
    private volatile boolean closed=false;
    private volatile int activePage=0,generation=0;
    private PdfRenderer renderer;
    private ParcelFileDescriptor descriptor;
    private double scroll=0,total=0,initialOffset=0;
    private float zoom=1,panX=0,baseWidth=0;
    private final float topInset=0;
    private int edgeHeight=28,leadingSpace=12;
    private int paperColor=Color.rgb(244,242,233);
    private int visibleFirst=0,visibleLast=0;
    private boolean multiTouch=false;
    private EdgeBlur edgeBlur;
    private boolean scaling=false,initialized=false,paused=false;
    private final Runnable report;
    private boolean reportPending=false;
    private Runnable firstFrameReady,firstFrameFailure;
    private boolean firstFramePosted=false;
    public void whenFirstFrame(Runnable ready,Runnable failure){firstFrameReady=ready;firstFrameFailure=failure;invalidate();}
    private void failFirstFrame(){Runnable failure=firstFrameFailure;firstFrameReady=null;firstFrameFailure=null;if(!closed&&failure!=null)failure.run();}

    public static JSONObject inspect(File file)throws Exception {
        try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer pdf=new PdfRenderer(fd)){
            int count=pdf.getPageCount();if(count<1||count>20000)throw new IOException("PDF 页数无效或过多");
            JSONArray sizes=new JSONArray();String cover=null;
            for(int i=0;i<count;i++){
                try(PdfRenderer.Page page=pdf.openPage(i)){
                    if(page.getWidth()<=0||page.getHeight()<=0)throw new IOException("PDF 页面尺寸无效");
                    sizes.put(new JSONArray().put(page.getWidth()).put(page.getHeight()));
                    if(i==0){int w=Math.max(1,(int)Math.min(240,480d*page.getWidth()/page.getHeight())),h=Math.max(1,(int)((double)w*page.getHeight()/page.getWidth()));Bitmap image=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);try{image.eraseColor(Color.WHITE);page.render(image,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);ByteArrayOutputStream out=new ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.JPEG,85,out);cover="data:image/jpeg;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);}finally{image.recycle();}}
                }
            }
            return new JSONObject().put("pages",count).put("sizes",sizes).put("cover",cover);
        }
    }
    public PdfReaderView(Context context,File file,JSONArray sizes,int page,double offset,Listener listener)throws Exception {
        super(context);this.listener=listener;report=()->{reportPending=false;if(!closed&&initialized)listener.position(currentPage(),pageOffset());};ratios=new double[sizes.length()];tops=new double[ratios.length+1];
        if(ratios.length<1||ratios.length>20000)throw new IOException("PDF 页数无效");
        for(int i=0;i<ratios.length;i++){JSONArray size=sizes.getJSONArray(i);double width=size.getDouble(0),height=size.getDouble(1);if(width<=0||height<=0||!Double.isFinite(width)||!Double.isFinite(height))throw new IOException("PDF 页面尺寸无效");ratios[i]=height/width;}
        activePage=Math.max(0,Math.min(ratios.length-1,page));initialOffset=Math.max(0,Math.min(.999,offset));
        setBackgroundColor(Color.rgb(231,232,223));setFocusable(true);setContentDescription("PDF");fling=new OverScroller(context);
        pinch=new ScaleGestureDetector(context,new ScaleGestureDetector.SimpleOnScaleGestureListener(){
            @Override public boolean onScaleBegin(ScaleGestureDetector detector){fling.forceFinished(true);scaling=true;return true;}
            @Override public boolean onScale(ScaleGestureDetector detector){float old=zoom;zoom=Math.max(1,Math.min(5,zoom*detector.getScaleFactor()));float factor=zoom/old,focus=detector.getFocusX()-getWidth()/2f;float focusY=detector.getFocusY()-topInset;scroll=(scroll+focusY)*factor-focusY;panX=focus-(focus-panX)*factor;clamp();invalidate();return true;}
            @Override public void onScaleEnd(ScaleGestureDetector detector){scaling=false;clamp();invalidate();scheduleReport();}
        });
        drag=new GestureDetector(context,new GestureDetector.SimpleOnGestureListener(){
            @Override public boolean onDown(android.view.MotionEvent e){fling.forceFinished(true);return true;}
            @Override public boolean onSingleTapUp(android.view.MotionEvent e){if(!multiTouch&&!scaling)listener.tap();return true;}
            @Override public void onLongPress(android.view.MotionEvent e){if(!multiTouch&&!scaling){fling.forceFinished(true);int page=pageAt((scroll+Math.max(0,e.getY()-topInset))/zoom);double offset=Math.max(0,Math.min(.999,(scroll/zoom-tops[page])/Math.max(1,baseWidth*ratios[page])));listener.longPress(page,offset);}}
            @Override public boolean onScroll(android.view.MotionEvent first,android.view.MotionEvent current,float dx,float dy){if(!scaling){scroll+=dy;panX-=dx;clamp();invalidate();}return true;}
            @Override public boolean onFling(android.view.MotionEvent first,android.view.MotionEvent last,float vx,float vy){if(!scaling){int maxX=(int)Math.max(0,(baseWidth*zoom-getWidth()+24)/2);fling.fling((int)panX,(int)scroll,(int)vx,(int)-vy,-maxX,maxX,0,(int)Math.min(Integer.MAX_VALUE-1,Math.max(0,total*zoom-(getHeight()-topInset))));postInvalidateOnAnimation();}return true;}
        });
        worker.execute(()->{try{if(closed)return;descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);renderer=new PdfRenderer(descriptor);if(renderer.getPageCount()!=ratios.length)throw new IOException("PDF 页面信息不一致");post(this::invalidate);}catch(Exception e){post(()->{if(!closed){failFirstFrame();listener.error("PDF 无法打开，文件可能损坏或已加密");}});}});
    }
    private void layoutPages(){baseWidth=Math.max(1,getWidth()-24);tops[0]=leadingSpace;for(int i=0;i<ratios.length;i++)tops[i+1]=tops[i]+baseWidth*ratios[i]+16;total=tops[ratios.length];}
    private int pageAt(double y){int low=0,high=ratios.length;while(low<high){int mid=(low+high)>>>1;if(tops[mid+1]<=y)low=mid+1;else high=mid;}return Math.max(0,Math.min(ratios.length-1,low));}
    public int currentPage(){if(!initialized)return activePage;return pageAt((scroll+Math.min(80,(getHeight()-topInset)*.12))/zoom);}
    public double pageOffset(){if(!initialized)return initialOffset;int p=currentPage();return Math.max(0,Math.min(.999,(scroll/zoom-tops[p])/Math.max(1,baseWidth*ratios[p])));}
    public int pageCount(){return ratios.length;}
    public void goTo(int page){goTo(page,0);}
    public void goTo(int page,double offset){if(!initialized)return;fling.forceFinished(true);activePage=Math.max(0,Math.min(ratios.length-1,page));scroll=activePage==0&&offset<=0?0:(tops[activePage]+baseWidth*ratios[activePage]*Math.max(0,Math.min(.999,Double.isFinite(offset)?offset:0)))*zoom;clamp();invalidate();scheduleReport();}
    private void clamp(){double max=Math.max(0,total*zoom-(getHeight()-topInset));scroll=Math.max(0,Math.min(max,scroll));float maxX=Math.max(0,(baseWidth*zoom-getWidth()+24)/2);panX=Math.max(-maxX,Math.min(maxX,panX));}
    @Override protected void onSizeChanged(int w,int h,int oldW,int oldH){int page=initialized?pageAt(scroll/zoom):activePage;boolean inLead=initialized&&scroll/zoom<tops[0];double leadRatio=inLead?scroll/zoom/Math.max(1,tops[0]):0;double offset=initialized?Math.max(0,(scroll/zoom-tops[page])/Math.max(1,baseWidth*ratios[page])):initialOffset;if(w!=oldW)generation++;layoutPages();boolean freshStart=!initialized&&page==0&&offset<=0;initialized=true;scroll=freshStart?0:inLead?leadRatio*tops[0]*zoom:(tops[page]+baseWidth*ratios[page]*offset)*zoom;clamp();invalidate();scheduleReport();}
    public void setLeadingSpace(int value){value=Math.max(12,value);if(value==leadingSpace)return;double oldTop=initialized?tops[0]:leadingSpace;boolean inLead=initialized&&scroll/zoom<oldTop;double leadRatio=inLead?scroll/zoom/Math.max(1,oldTop):0;leadingSpace=value;if(initialized){layoutPages();scroll=inLead?leadRatio*tops[0]*zoom:scroll+(tops[0]-oldTop)*zoom;clamp();invalidate();}}
    public void setPaperColor(int value){paperColor=value;invalidate();}
    public void setEdgeHeight(int value){if(edgeHeight==value)return;edgeHeight=value;invalidate();}
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);if(closed||!initialized)return;
        visibleFirst=pageAt(scroll/zoom);visibleLast=Math.min(ratios.length-1,Math.min(visibleFirst+7,pageAt((scroll+getHeight()-topInset)/zoom)));activePage=currentPage();
        float left=getWidth()/2f-baseWidth*zoom/2+panX;paint.setColor(paperColor);canvas.drawRect(0,0,getWidth(),Math.max(0,(float)(tops[0]*zoom-scroll)),paint);canvas.save();canvas.clipRect(0,topInset,getWidth(),getHeight());
        for(int i=visibleFirst;i<=visibleLast;i++){
            float top=(float)(tops[i]*zoom-scroll+topInset),height=(float)(baseWidth*ratios[i]*zoom);RectF box=new RectF(left,top,left+baseWidth*zoom,top+height);
            paint.setColor(Color.WHITE);canvas.drawRect(box,paint);Bitmap image=cache.get(i);
            if(image!=null&&!image.isRecycled())canvas.drawBitmap(image,null,box,paint);
            requestPage(i);
        }
        canvas.restore();if(android.os.Build.VERSION.SDK_INT>=31&&canvas.isHardwareAccelerated()&&edgeHeight>0){if(edgeBlur==null)edgeBlur=new EdgeBlur();edgeBlur.draw(canvas,left);}scheduleReport();
        if(firstFrameReady!=null&&!firstFramePosted&&cache.containsKey(activePage)){firstFramePosted=true;postOnAnimation(()->{Runnable ready=firstFrameReady;firstFrameReady=null;firstFrameFailure=null;if(!closed&&ready!=null)ready.run();});}
    }
    /** EPUB and PDF read the same layer radii/mask stops; sample only the top strip. */
    private final class EdgeBlur {
        private final RenderNode source=new RenderNode("pdf-edge-source");
        private final RenderNode[] blur=new RenderNode[3],composite=new RenderNode[3];
        private final Paint[] masks=new Paint[3];
        private final float[] radii=new float[3],solid=new float[3],clear=new float[3];
        private final float density=getResources().getDisplayMetrics().density,pad=16*density;
        EdgeBlur(){
            try(InputStream in=getContext().getAssets().open("assets/reader-edge.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] bytes=new byte[1024];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>4096)throw new IOException();out.write(bytes,0,n);}JSONArray layers=new JSONObject(out.toString("UTF-8")).getJSONArray("layers");if(layers.length()!=3)throw new IOException();
                for(int i=0;i<3;i++){JSONObject layer=layers.getJSONObject(i);radii[i]=(float)layer.getDouble("blur");solid[i]=(float)layer.getDouble("solid");clear[i]=(float)layer.getDouble("clear");if(radii[i]<=0||radii[i]>8||solid[i]<0||clear[i]>1||solid[i]>=clear[i])throw new IOException();}
            }catch(Exception error){radii[0]=1;radii[1]=2;radii[2]=4;solid[0]=.6f;solid[1]=.3f;solid[2]=.05f;clear[0]=1;clear[1]=.72f;clear[2]=.44f;}
            for(int i=0;i<3;i++){blur[i]=new RenderNode("pdf-edge-blur-"+i);composite[i]=new RenderNode("pdf-edge-composite-"+i);blur[i].setRenderEffect(RenderEffect.createBlurEffect(radii[i]*density,radii[i]*density,Shader.TileMode.CLAMP));masks[i]=new Paint(Paint.ANTI_ALIAS_FLAG);masks[i].setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));}
        }
        void draw(Canvas canvas,float left){
            float height=edgeHeight;int width=getWidth(),recordHeight=(int)Math.ceil(height+pad*2);source.setPosition(0,0,width,recordHeight);Canvas strip=source.beginRecording();strip.drawColor(getBackground() instanceof android.graphics.drawable.ColorDrawable?((android.graphics.drawable.ColorDrawable)getBackground()).getColor():paperColor);strip.translate(0,pad);paint.setColor(paperColor);strip.drawRect(0,0,getWidth(),Math.max(0,(float)(tops[0]*zoom-scroll)),paint);
            for(int i=visibleFirst;i<=visibleLast;i++){float top=(float)(tops[i]*zoom-scroll),h=(float)(baseWidth*ratios[i]*zoom);if(top>height+pad)break;RectF box=new RectF(left,top,left+baseWidth*zoom,top+h);paint.setColor(Color.WHITE);strip.drawRect(box,paint);Bitmap image=cache.get(i);if(image!=null&&!image.isRecycled())strip.drawBitmap(image,null,box,paint);}source.endRecording();RenderNode previous=source;
            for(int i=0;i<3;i++){
                blur[i].setPosition(0,0,width,recordHeight);Canvas blurred=blur[i].beginRecording();blurred.drawRenderNode(previous);blur[i].endRecording();
                masks[i].setShader(new LinearGradient(0,pad,0,pad+height,new int[]{Color.BLACK,Color.BLACK,Color.TRANSPARENT,Color.TRANSPARENT},new float[]{0,solid[i],clear[i],1},Shader.TileMode.CLAMP));
                composite[i].setPosition(0,0,width,recordHeight);Canvas mixed=composite[i].beginRecording();mixed.drawRenderNode(previous);int layer=mixed.saveLayer(0,0,width,recordHeight,null);mixed.drawRenderNode(blur[i]);mixed.drawRect(0,0,width,recordHeight,masks[i]);mixed.restoreToCount(layer);composite[i].endRecording();previous=composite[i];
            }
            canvas.save();canvas.clipRect(0,0,width,height);canvas.translate(0,-pad);canvas.drawRenderNode(previous);canvas.restore();
        }
        void release(){source.discardDisplayList();for(int i=0;i<3;i++){blur[i].discardDisplayList();composite[i].discardDisplayList();}}
    }
    private int targetWidth(int page){double wanted=Math.min(1800,Math.max(480,baseWidth*Math.min(zoom,2)));int visible=Math.max(1,visibleLast-visibleFirst+1);double pixels=Math.min(MAX_PIXELS,(MAX_CACHE_BYTES/4d)/Math.max(3,visible+1));return Math.max(1,(int)Math.min(wanted,Math.min(Math.sqrt(pixels/ratios[page]),4096/ratios[page])));}
    private void requestPage(int index){int width=targetWidth(index);Bitmap existing=cache.get(index);if(closed||paused||pending.contains(index)||failed.contains(index)||pending.size()>=2||existing!=null&&(scaling||existing.getWidth()>=width*.9))return;pending.add(index);int epoch=generation;
        worker.execute(()->{Bitmap image=null;boolean error=false;try{if(!closed&&renderer!=null&&epoch==generation&&Math.abs(index-activePage)<=8){try(PdfRenderer.Page page=renderer.openPage(index)){int height=Math.max(1,(int)Math.min(4096,width*ratios[index]));image=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);image.eraseColor(Color.WHITE);page.render(image,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);}}}catch(Exception|OutOfMemoryError e){if(image!=null){image.recycle();image=null;}error=true;}final Bitmap ready=image;final boolean bad=error;post(()->{pending.remove(index);if(closed||epoch!=generation){if(ready!=null)ready.recycle();if(!closed&&!paused)invalidate();return;}if(bad){failed.add(index);if(index==activePage)failFirstFrame();listener.error("部分 PDF 页面无法显示");}if(ready!=null){cache.put(index,ready);trimCache();}invalidate();});});
    }
    private void trimCache(){long bytes=0;for(Bitmap bitmap:cache.values())bytes+=bitmap.getAllocationByteCount();while(cache.size()>MAX_CACHE_PAGES||bytes>MAX_CACHE_BYTES){Integer far=null;int distance=-1;for(Integer page:cache.keySet()){int d=Math.abs(page-activePage)+(page<visibleFirst||page>visibleLast?100000:0);if(d>distance){distance=d;far=page;}}if(far==null)break;Bitmap removed=cache.remove(far);bytes-=removed.getAllocationByteCount();/* Display-list bitmaps are released by GC after render-thread use. */}}
    private void scheduleReport(){if(!paused&&!reportPending){reportPending=true;postDelayed(report,160);}}
    public void savePosition(){removeCallbacks(report);reportPending=false;if(!closed&&initialized)listener.position(currentPage(),pageOffset());}
    public void pauseReading(){fling.forceFinished(true);savePosition();paused=true;removeCallbacks(report);reportPending=false;}
    public void resumeReading(){paused=false;invalidate();}
    public void releaseMemory(){if(paused||closed){cache.clear();if(edgeBlur!=null)edgeBlur.release();}else {Iterator<Integer> it=cache.keySet().iterator();while(it.hasNext()){int page=it.next();if(page<visibleFirst||page>visibleLast)it.remove();}}generation++;if(!paused&&!closed)invalidate();}
    @Override public boolean onTouchEvent(android.view.MotionEvent event){if(closed)return false;if(event.getActionMasked()==MotionEvent.ACTION_DOWN)multiTouch=false;if(event.getPointerCount()>1)multiTouch=true;pinch.onTouchEvent(event);drag.onTouchEvent(event);if(event.getActionMasked()==android.view.MotionEvent.ACTION_UP||event.getActionMasked()==android.view.MotionEvent.ACTION_CANCEL)scheduleReport();return true;}
    @Override public void computeScroll(){if(fling.computeScrollOffset()){panX=fling.getCurrX();scroll=fling.getCurrY();clamp();postInvalidateOnAnimation();}}
    public void close(){if(closed)return;firstFrameReady=null;firstFrameFailure=null;if(edgeBlur!=null)edgeBlur.release();savePosition();closed=true;generation++;fling.forceFinished(true);removeCallbacks(report);releaseMemory();worker.execute(()->{try{if(renderer!=null)renderer.close();}catch(Exception ignored){}try{if(descriptor!=null)descriptor.close();}catch(Exception ignored){}renderer=null;descriptor=null;});worker.shutdown();}
}
