/* Runs the production bounded data writer in a JVM; not an Android SAF test. */
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),root=path.resolve(__dirname,'..');
const native=fs.readFileSync(path.join(root,'android/src/app/lumi/reader/MainActivity.java'),'utf8');const a=native.indexOf('    private void appendData('),b=native.indexOf('    private void export(',a),writer=native.slice(a,b);
const dir=path.join(root,'build/native-data-0541');fs.mkdirSync(dir,{recursive:true});
const code=`import java.io.*;import java.nio.file.*;import java.util.*;
public class DataHarness {
 static final int DATA_LIMIT=180*1024*1024;File file;
 File selectedImport(String value)throws Exception{if(!value.equals("https://appassets.androidplatform.net/import/test"))throw new IOException("invalid import");return file;}
 static class JSONObject{Map<String,Object> fields=new HashMap<>();JSONObject(long offset,byte[] data){fields.put("url","https://appassets.androidplatform.net/import/test");fields.put("offset",offset);fields.put("data",Base64.getEncoder().encodeToString(data));}String getString(String k){return (String)fields.get(k);}long getLong(String k){return (Long)fields.get(k);}}
 static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);System.out.println("PASS "+label);}
 ${writer}
 public static void main(String[] args)throws Exception{DataHarness h=new DataHarness();h.file=File.createTempFile("yidu-data-test", ".bin");try{
 byte[] first=new byte[196608];new Random(1).nextBytes(first);h.appendData(new JSONObject(0,first));h.appendData(new JSONObject(first.length,new byte[]{1,2,3}));byte[] got=Files.readAllBytes(h.file.toPath());check(got.length==first.length+3&&Arrays.equals(first,Arrays.copyOf(got,first.length)),"Chunked binary transfer preserves bytes and append order");
 try{h.appendData(new JSONObject(0,new byte[]{9}));throw new AssertionError();}catch(IOException expected){}check(h.file.length()==got.length,"Mismatched offsets fail without changing the file");
 try{h.appendData(new JSONObject(got.length,new byte[262145]));throw new AssertionError();}catch(IOException expected){}check(h.file.length()==got.length,"Oversized chunks are rejected before writing");
 JSONObject bad=new JSONObject(got.length,new byte[]{1});bad.fields.put("data","!");try{h.appendData(bad);throw new AssertionError();}catch(IllegalArgumentException expected){}check(h.file.length()==got.length,"Malformed base64 cannot corrupt an existing staged file");
 try(RandomAccessFile f=new RandomAccessFile(h.file,"rw")){f.setLength(DATA_LIMIT);}try{h.appendData(new JSONObject(DATA_LIMIT,new byte[]{1}));throw new AssertionError();}catch(IOException expected){}check(h.file.length()==DATA_LIMIT,"Total transfer cap is enforced");
 JSONObject foreign=new JSONObject(DATA_LIMIT,new byte[0]);foreign.fields.put("url","https://other.invalid/data");try{h.appendData(foreign);throw new AssertionError();}catch(IOException expected){}check(true,"Foreign staged-file references are rejected");
 }finally{h.file.delete();}}
}`;
fs.writeFileSync(path.join(dir,'DataHarness.java'),code);for(const args of [['-jar',path.join(root,'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',dir,path.join(dir,'DataHarness.java')],['-cp',dir,'DataHarness']]){const r=spawnSync('java',args,{encoding:'utf8',timeout:20000});process.stdout.write(r.stdout+r.stderr);if(r.status)process.exit(r.status);}
