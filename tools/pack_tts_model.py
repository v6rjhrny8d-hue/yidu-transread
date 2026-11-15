"""Wrap an extracted sherpa-onnx VITS/Piper model directory as a YIDU model ZIP."""
import argparse,json,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('directory',type=Path);p.add_argument('output',type=Path);p.add_argument('--model',required=True);p.add_argument('--name',required=True);p.add_argument('--language',default='en-US');p.add_argument('--tokens',default='tokens.txt');p.add_argument('--data-dir',default='espeak-ng-data');p.add_argument('--lexicon');a=p.parse_args();root=a.directory.resolve();assert not a.output.resolve().is_relative_to(root),'Write the output ZIP outside the model directory'
manifest={'format':'yidu-tts','version':1,'engine':'sherpa-onnx-vits','name':a.name,'language':a.language,'model':a.model,'tokens':a.tokens}
for key,value in [('dataDir',a.data_dir),('lexicon',a.lexicon)]:
 if value:manifest[key]=value
for key in ('model','tokens','dataDir','lexicon'):
 if key in manifest:
  f=(root/manifest[key]).resolve();assert f.is_relative_to(root) and f.exists(),key
files=[f for f in root.rglob('*') if f.is_file() and f.name!='manifest.json'];assert sum(f.stat().st_size for f in files)<300*1024*1024
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
 for f in files:
  assert not f.is_symlink() and f.resolve().is_relative_to(root)
  z.write(f,f.relative_to(root).as_posix())
assert a.output.stat().st_size<180*1024*1024
print(a.output)
