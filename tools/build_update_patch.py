#!/usr/bin/env python3
"""Build a bounded copy/literal patch over raw APK bytes, preserving release signatures."""
import argparse,gzip,hashlib,json,pathlib,struct,zipfile

def sha(data):return hashlib.sha256(data).hexdigest()
def data_offset(raw,info):
 header=struct.unpack_from('<IHHHHHIIIHH',raw,info.header_offset)
 if header[0]!=0x04034b50:raise ValueError('Invalid local ZIP header')
 return info.header_offset+30+header[-2]+header[-1]
def make_patch(base_path,target_path,out_path):
 old=pathlib.Path(base_path).read_bytes();new=pathlib.Path(target_path).read_bytes();old_hash,new_hash=sha(old),sha(new);ops=[];cursor=0
 with zipfile.ZipFile(base_path) as old_zip,zipfile.ZipFile(target_path) as target_zip:
  old_infos={i.filename:i for i in old_zip.infolist()};target_infos=sorted(target_zip.infolist(),key=lambda i:i.header_offset)
  for info in target_infos:
   prior=old_infos.get(info.filename)
   if prior is None or info.compress_size<=0 or prior.compress_type!=info.compress_type or prior.compress_size!=info.compress_size:continue
   start=data_offset(new,info);source=data_offset(old,prior);length=info.compress_size
   if old[source:source+length]!=new[start:start+length]:continue
   if start<cursor:raise ValueError('Overlapping ZIP data')
   if start>cursor:ops.append((1,new[cursor:start]))
   ops.append((0,source,length));cursor=start+length
 if cursor<len(new):ops.append((1,new[cursor:]))
 if not ops or len(ops)>20000 or max(len(old),len(new))>128*1024*1024:raise ValueError('Patch bounds exceeded')
 raw=bytearray(b'TRDP0001'+bytes.fromhex(old_hash)+bytes.fromhex(new_hash)+struct.pack('>QQI',len(old),len(new),len(ops)))
 for op in ops:
  raw.append(op[0])
  if op[0]==0:raw.extend(struct.pack('>QQ',op[1],op[2]))
  else:raw.extend(struct.pack('>I',len(op[1])));raw.extend(op[1])
 path=pathlib.Path(out_path);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(gzip.compress(raw,compresslevel=9,mtime=0))
 return {'base':str(base_path),'baseSha256':old_hash,'targetSha256':new_hash,'targetBytes':len(new),'patch':str(path),'patchBytes':path.stat().st_size,'operations':len(ops),'copiedBytes':sum(op[2] for op in ops if op[0]==0)}
def main():
 p=argparse.ArgumentParser();p.add_argument('--target',required=True);p.add_argument('--base',action='append',required=True);p.add_argument('--assets',required=True);p.add_argument('--spec',required=True);p.add_argument('--version',required=True);p.add_argument('--code',type=int,required=True);p.add_argument('--report',required=True);args=p.parse_args()
 if not args.version.replace('.','').isdigit() or args.code<=0:raise ValueError('Invalid release identity')
 assets=pathlib.Path(args.assets);assets.mkdir(parents=True,exist_ok=True)
 for path in assets.glob('*.trdp'):path.unlink()
 records=[]
 for base in args.base:
  base_hash=sha(pathlib.Path(base).read_bytes());records.append(make_patch(base,args.target,assets/(base_hash+'.trdp')))
 target_hash=sha(pathlib.Path(args.target).read_bytes());hashes=','.join('"'+r['baseSha256']+'"' for r in records)
 pathlib.Path(args.spec).write_text('package app.lumi.reader.update;\npublic final class UpdateSpec {public static final String VERSION_NAME="'+args.version+'",TARGET_SHA="'+target_hash+'";public static final int VERSION_CODE='+str(args.code)+';public static final String[] BASE_HASHES={'+hashes+'};}\n')
 pathlib.Path(args.report).write_text(json.dumps({'targetVersion':args.version,'targetCode':args.code,'targetSha256':target_hash,'patches':records},ensure_ascii=False,indent=2)+'\n');print(json.dumps({'patches':len(records),'totalPatchBytes':sum(r['patchBytes'] for r in records)}))
if __name__=='__main__':main()
