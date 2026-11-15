#!/usr/bin/env python3
"""Execute production Java delta parser, including real signed release APK restoration."""
import gzip,hashlib,json,pathlib,struct,subprocess,tempfile,sys
root=pathlib.Path(__file__).resolve().parents[1];count=0
version=json.loads((root/'package.json').read_text())['version']

def check(name,yes):
 global count
 assert yes,name;count+=1;print('PASS',name,flush=True)
def digest(b):return hashlib.sha256(b).digest()
with tempfile.TemporaryDirectory(prefix='transread-delta-test-') as temp:
 t=pathlib.Path(temp);h=t/'DeltaHarness.java';h.write_text('import java.io.*;import app.lumi.reader.update.Delta;public class DeltaHarness{public static void main(String[] a)throws Exception{try(InputStream p=new FileInputStream(a[1])){Delta.restore(new File(a[0]),p,new File(a[2]),a[3],a[4]);}}}')
 subprocess.run(['java','-jar',str(root/'tools/ecj.jar'),'-1.8','-proc:none','-warn:none','-d',str(t),str(root/'updater/src/app/lumi/reader/update/Delta.java'),str(h)],check=True)
 old=b'0123456789ABCDEF';new=old[2:10]+b'new';base=t/'base.apk';patch=t/'patch.gz';out=t/'out.apk';base.write_bytes(old)
 ops=b'\0'+struct.pack('>QQ',2,8)+b'\1'+struct.pack('>I',3)+b'new'
 raw=b'TRDP0001'+digest(old)+digest(new)+struct.pack('>QQI',len(old),len(new),2)+ops
 def run(data,expected=True,base_path=base,output=out,old_hash=digest(old).hex(),new_hash=digest(new).hex(),compressed=False):
  patch.write_bytes(data if compressed else gzip.compress(data,mtime=0));result=subprocess.run(['java','-cp',str(t),'DeltaHarness',str(base_path),str(patch),str(output),old_hash,new_hash],capture_output=True,timeout=30)
  if expected:assert result.returncode==0,result.stderr.decode()[:500]
  else:assert result.returncode!=0,'Invalid patch accepted';assert not out.exists() and not pathlib.Path(str(out)+'.part').exists(),'Partial output leaked'
  return result.returncode==0
 run(raw);check('COPY plus literal reconstructs exact output while preserving the base',out.read_bytes()==new and base.read_bytes()==old)
 def mutate(offset,data):return raw[:offset]+data+raw[offset+len(data):]
 bad=[('Wrong magic',mutate(0,b'INVALID!')),('Wrong base digest',mutate(8,b'\0'*32)),('Wrong target digest',mutate(40,b'\0'*32)),('Wrong base size',mutate(72,struct.pack('>Q',17))),('Oversized target',mutate(80,struct.pack('>Q',128*1024*1024+1))),('Excess operation count',mutate(88,struct.pack('>I',20001))),('Negative copy offset',mutate(93,struct.pack('>q',-1))),('Out-of-range copy',mutate(101,struct.pack('>Q',99))),('Oversized literal',mutate(110,struct.pack('>I',128*1024*1024))),('Negative literal length',mutate(110,struct.pack('>i',-1))),('Unknown opcode',mutate(92,b'\x07')),('Target content corruption',raw[:-1]+b'!'),('Trailing logical bytes',raw+b'!'),('Truncated operations',raw[:-2])]
 for name,data in bad:
  out.write_bytes(b'stale');run(data,False);check(name+' is rejected and partial/stale output removed',base.read_bytes()==old)
 run(gzip.compress(raw,mtime=0)[:-5],False,compressed=True);check('Truncated gzip CRC is rejected',not out.exists())
 base.write_bytes(b'x'*len(old));run(raw,False);check('A modified same-size installed APK is rejected',not out.exists());base.write_bytes(old)
 # Aliases must never delete or overwrite the installed APK.
 patch.write_bytes(gzip.compress(raw,mtime=0));r=subprocess.run(['java','-cp',str(t),'DeltaHarness',str(base),str(patch),str(base),digest(old).hex(),digest(new).hex()],capture_output=True);check('Using the base as output is rejected without changing it',r.returncode!=0 and base.read_bytes()==old)
 report_path=root/'test'/f'update-patches-{version}.json'
 if report_path.exists():
  report=json.loads(report_path.read_text());target=root/'dist'/f'YiDu-{version}.apk'
  for record in report['patches']:
   result=subprocess.run(['java','-cp',str(t),'DeltaHarness',record['base'],record['patch'],str(out),record['baseSha256'],record['targetSha256']],capture_output=True,timeout=60)
   check('Real '+pathlib.Path(record['base']).name+' reconstructs the signed release byte for byte',result.returncode==0 and out.read_bytes()==target.read_bytes())
   verify=subprocess.run(['java','-jar',str(root/'tools/sdk/android-15/lib/apksigner.jar'),'verify','--print-certs',str(out)],capture_output=True,timeout=30)
   check('Restored APK retains the original valid release signature',verify.returncode==0 and b'8d21d7bc40b619f048f03e266031c59f7ad50cff5337203f5dce891d487c61fd' in verify.stdout)
   check('Patch reuses unchanged signed APK data and is smaller than the full APK',record['copiedBytes']>len(target.read_bytes())*.9 and record['patchBytes']<target.stat().st_size*.1)
print('TOTAL',count)
