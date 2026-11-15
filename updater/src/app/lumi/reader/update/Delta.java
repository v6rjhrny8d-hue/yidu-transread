package app.lumi.reader.update;
import java.io.*;
import java.security.*;
import java.util.Arrays;
import java.util.zip.GZIPInputStream;
/** Bounded raw-byte COPY/literal patch. Output must equal an already-signed release APK. */
public final class Delta {
 public static final long LIMIT=128L*1024*1024;
 private static final byte[] MAGIC={'T','R','D','P','0','0','0','1'};
 public static byte[] hash(File file)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return d.digest();}
 public static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
 public static byte[] unhex(String s)throws IOException{if(s==null||!s.matches("[0-9a-f]{64}"))throw new IOException("Invalid digest");byte[] b=new byte[32];for(int i=0;i<32;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);return b;}
 public static void restore(File base,InputStream patch,File output,String expectedBase,String expectedTarget)throws Exception{
  File part=new File(output.getPath()+".part");if(base.getCanonicalFile().equals(output.getCanonicalFile())||base.getCanonicalFile().equals(part.getCanonicalFile()))throw new IOException("Invalid destination");
  if(output.exists()&&!output.delete())throw new IOException("Output busy");if(part.exists()&&!part.delete())throw new IOException("Temporary output busy");boolean complete=false;
  try(DataInputStream in=new DataInputStream(new BufferedInputStream(new GZIPInputStream(patch)));RandomAccessFile source=new RandomAccessFile(base,"r")){
   byte[] magic=new byte[8],oldHash=new byte[32],newHash=new byte[32];in.readFully(magic);in.readFully(oldHash);in.readFully(newHash);long oldSize=in.readLong(),newSize=in.readLong();int operations=in.readInt();
   if(!Arrays.equals(magic,MAGIC)||oldSize!=source.length()||oldSize<=0||oldSize>LIMIT||newSize<=0||newSize>LIMIT||operations<=0||operations>20000||!MessageDigest.isEqual(oldHash,unhex(expectedBase))||!MessageDigest.isEqual(newHash,unhex(expectedTarget))||!MessageDigest.isEqual(hash(base),oldHash))throw new IOException("Base or patch mismatch");
   byte[] buffer=new byte[65536];long written=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");
   try(FileOutputStream out=new FileOutputStream(part)){
    for(int op=0;op<operations;op++){int type=in.readUnsignedByte();long length;if(type==0){long offset=in.readLong();length=in.readLong();if(offset<0||length<=0||offset>oldSize||length>oldSize-offset||length>newSize-written)throw new IOException("Invalid copy");source.seek(offset);}else if(type==1){length=in.readInt();if(length<=0||length>newSize-written)throw new IOException("Invalid literal");}else throw new IOException("Invalid operation");
     for(long remain=length;remain>0;){int n=(int)Math.min(buffer.length,remain);if(type==0)source.readFully(buffer,0,n);else in.readFully(buffer,0,n);out.write(buffer,0,n);digest.update(buffer,0,n);written+=n;remain-=n;}
    }
    if(written!=newSize||in.read()!=-1||!MessageDigest.isEqual(digest.digest(),newHash))throw new IOException("Output verification failed");out.getFD().sync();
   }
   if(!part.renameTo(output))throw new IOException("Output commit failed");complete=true;
  }finally{if(!complete){part.delete();output.delete();}}
 }
 private Delta(){}
}
