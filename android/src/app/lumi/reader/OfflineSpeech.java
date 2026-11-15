package app.lumi.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.*;
import com.k2fsa.sherpa.onnx.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.*;

/** Private, bounded model packages; one worker owns all native engine lifetimes. */
final class OfflineSpeech {
    interface Result {void done(Object value,String error);}
    private final File base;
    private final SharedPreferences prefs;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicInteger epoch=new AtomicInteger();
    private OfflineTts engine;
    private String loaded="";
    private volatile AudioTrack track;
    private volatile boolean closed=false;
    OfflineSpeech(Context context){base=new File(context.getFilesDir(),"tts-models");base.mkdirs();prefs=context.getSharedPreferences("offline-speech",Context.MODE_PRIVATE);File[] files=base.listFiles();if(files!=null)for(File f:files)if(f.getName().startsWith("pending-"))erase(f);}
    void request(String op,JSONObject data,File source,Result result){
        if(closed){result.done(null,"朗读引擎已关闭");return;}
        if(!"ttsModels".equals(op))cancel();
        worker.execute(()->{try{
            Object answer;
            if("ttsModels".equals(op))answer=list();
            else if("importTts".equals(op))answer=install(source);
            else if("ttsManage".equals(op)){String id=data.optString("id"),command=data.optString("command");cancel();if("delete".equals(command)){File directory=modelDir(id);if(loaded.equals(id))release();if(active().equals(id))prefs.edit().remove("active").commit();erase(directory);if(directory.exists())throw new IOException("模型删除失败");}else if("enable".equals(command)){if(!id.isEmpty())load(id);else release();prefs.edit().putString("active",id).commit();}else throw new IOException("模型操作无效");answer=list();}
            else throw new IOException("模型操作无效");
            result.done(answer,null);
        }catch(Throwable e){result.done(null,"离线模型未能加载，请检查模型包格式、文件与可用内存");}});
    }
    String active(){return prefs.getString("active","");}
    void speak(String text,String previewId,Result result){
        cancel();final int token=epoch.get();final String id=previewId==null?active():previewId;
        if(id.isEmpty()){result.done(null,"未选择离线模型");return;}
        worker.execute(()->{try{if(token!=epoch.get()||closed){result.done(true,null);return;}load(id);int offset=0;
            while(offset<text.length()&&token==epoch.get()&&!closed){int end=Math.min(text.length(),offset+260);if(end<text.length()){int space=text.lastIndexOf(' ',end);if(space>offset+80)end=space;else if(Character.isHighSurrogate(text.charAt(end-1)))end--;}
                GeneratedAudio audio=engine.generate(text.substring(offset,end),0,1f);offset=end;
                if(token!=epoch.get()||closed)break;float[] samples=audio.getSamples();int rate=audio.getSampleRate();if(rate<8000||rate>96000||samples.length>rate*120)throw new IOException("语音输出无效");
                AudioTrack output=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(Math.max(8192,AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT))).setTransferMode(AudioTrack.MODE_STREAM).build();
                track=output;try{output.play();short[] buffer=new short[2048];int cursor=0;while(cursor<samples.length&&token==epoch.get()&&!closed){int n=Math.min(buffer.length,samples.length-cursor);for(int i=0;i<n;i++)buffer[i]=(short)(Math.max(-1,Math.min(1,samples[cursor+i]))*32767);int written=output.write(buffer,0,n,AudioTrack.WRITE_BLOCKING);if(written<=0)break;cursor+=written;}
                    while(token==epoch.get()&&!closed&&output.getPlaybackHeadPosition()<cursor){try{Thread.sleep(15);}catch(InterruptedException e){break;}}
                }finally{if(track==output)track=null;try{output.stop();}catch(Exception ignored){}output.release();}
            }result.done(true,null);
        }catch(Throwable e){if(token!=epoch.get()||closed){result.done(true,null);return;}release();if(previewId==null)prefs.edit().remove("active").commit();result.done(null,"离线朗读失败，已切回系统朗读");}});
    }
    void cancel(){epoch.incrementAndGet();AudioTrack current=track;if(current!=null)try{current.pause();current.flush();}catch(Exception ignored){}}
    void close(){closed=true;cancel();worker.execute(this::release);worker.shutdown();}
    private void release(){if(engine!=null){engine.release();engine=null;}loaded="";}
    private File modelDir(String id)throws IOException{if(!id.matches("[a-f0-9]{64}"))throw new IOException("模型标识无效");return new File(base,id);}
    private JSONObject read(File dir)throws Exception{File f=new File(dir,"manifest.json");if(f.length()>16384)throw new IOException("清单过大");try(InputStream in=new FileInputStream(f);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>16384)throw new IOException();out.write(b,0,n);}return new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));}}
    private static File path(File dir,String name,boolean directory)throws IOException{if(name==null||name.isEmpty()||name.startsWith("/")||name.contains("\\")||name.contains(":"))throw new IOException("模型路径无效");File f=new File(dir,name);if(!f.getCanonicalPath().startsWith(dir.getCanonicalPath()+File.separator)||(directory?!f.isDirectory():!f.isFile()))throw new IOException("缺少模型文件");return f;}
    private OfflineTts create(File dir,JSONObject m)throws Exception{
        if(!"yidu-tts".equals(m.optString("format"))||m.optInt("version")!=1||!"sherpa-onnx-vits".equals(m.optString("engine")))throw new IOException("模型格式不支持");
        OfflineTtsVitsModelConfig vits=new OfflineTtsVitsModelConfig();vits.setModel(path(dir,m.getString("model"),false).getPath());vits.setTokens(path(dir,m.getString("tokens"),false).getPath());
        if(m.has("dataDir"))vits.setDataDir(path(dir,m.getString("dataDir"),true).getPath());if(m.has("lexicon"))vits.setLexicon(path(dir,m.getString("lexicon"),false).getPath());
        if(!m.getString("model").endsWith(".onnx"))throw new IOException("需要ONNX模型");
        OfflineTtsModelConfig model=new OfflineTtsModelConfig();model.setVits(vits);model.setNumThreads(2);model.setDebug(false);model.setProvider("cpu");OfflineTtsConfig config=new OfflineTtsConfig();config.setModel(model);config.setMaxNumSentences(1);
        if(m.has("ruleFsts")){JSONArray rules=m.getJSONArray("ruleFsts");ArrayList<String> paths=new ArrayList<>();for(int i=0;i<rules.length();i++)paths.add(path(dir,rules.getString(i),false).getPath());config.setRuleFsts(android.text.TextUtils.join(",",paths));}
        return new OfflineTts(null,config);
    }
    private void load(String id)throws Exception{if(loaded.equals(id)&&engine!=null)return;release();File dir=modelDir(id);engine=create(dir,read(dir));loaded=id;}
    private Object list()throws Exception{JSONArray models=new JSONArray();File[] dirs=base.listFiles();if(dirs!=null)for(File dir:dirs){if(!dir.getName().matches("[a-f0-9]{64}"))continue;try{JSONObject m=read(dir);JSONObject item=new JSONObject();item.put("id",dir.getName());item.put("name",m.optString("name","VITS"));item.put("language",m.optString("language","en-US"));item.put("bytes",size(dir));models.put(item);}catch(Exception ignored){}}JSONObject result=new JSONObject();result.put("active",active());result.put("models",models);return result;}
    private Object install(File zip)throws Exception{
        if(zip==null||zip.length()>180L*1024*1024)throw new IOException("模型包过大");File stage=new File(base,"pending-"+UUID.randomUUID());stage.mkdirs();
        try{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(zip)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder key=new StringBuilder();for(byte b:digest.digest())key.append(String.format(Locale.ROOT,"%02x",b&255));String id=key.toString();File target=modelDir(id);if(target.exists())throw new IOException("模型已导入");
            long total=0;int count=0;Set<String> seen=new HashSet<>();try(ZipInputStream in=new ZipInputStream(new FileInputStream(zip))){ZipEntry e;while((e=in.getNextEntry())!=null){if(++count>6000)throw new IOException("模型包文件过多");String name=e.getName();if(name.isEmpty()||name.startsWith("/")||name.contains("\\")||name.contains(":")||Arrays.asList(name.split("/")).contains(".."))throw new IOException("模型路径无效");File out=new File(stage,name);if(!out.getCanonicalPath().startsWith(stage.getCanonicalPath()+File.separator)||!seen.add(out.getCanonicalPath()))throw new IOException("模型路径重复");if(e.isDirectory()){out.mkdirs();continue;}out.getParentFile().mkdirs();try(OutputStream stream=new FileOutputStream(out)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){total+=n;if(total>300L*1024*1024)throw new IOException("模型解压后超过300MB");stream.write(b,0,n);}}}}
            JSONObject m=read(stage);if(m.optString("name").isEmpty()||m.optString("name").length()>80||m.optString("language").length()>32)throw new IOException("模型名称无效");
            release();OfflineTts probe=create(stage,m);try{if(probe.sampleRate()<8000||probe.numSpeakers()<1)throw new IOException("模型无效");}finally{probe.release();}
            if(!stage.renameTo(target))throw new IOException("模型保存失败");return list();
        }finally{erase(stage);}
    }
    private static long size(File f){if(f.isFile())return f.length();long sum=0;File[] files=f.listFiles();if(files!=null)for(File child:files)sum+=size(child);return sum;}
    private static void erase(File f){File[] children=f.listFiles();if(children!=null)for(File child:children)erase(child);f.delete();}
}
