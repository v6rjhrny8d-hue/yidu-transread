"""Restore pinned speech runtime; no voice models or signing keys are downloaded."""
from pathlib import Path
import urllib.request,hashlib,zipfile
root=Path(__file__).resolve().parents[1];dest=root/'tools/tts';dest.mkdir(parents=True,exist_ok=True)
for name,url,digest in [
 ('sherpa-onnx.aar','https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-static-link-onnxruntime-1.13.8.aar','b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471'),
 ('kotlin-stdlib.jar','https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.jar','f31cc53f105a7e48c093683bbd5437561d1233920513774b470805641bedbc09')]:
 p=dest/name
 if not p.exists():
  temp=p.with_suffix('.partial');urllib.request.urlretrieve(url,temp);temp.replace(p)
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,'Speech dependency hash mismatch: '+name
with zipfile.ZipFile(dest/'sherpa-onnx.aar') as z:(dest/'classes.jar').write_bytes(z.read('classes.jar'))
print('Speech runtime restored and verified (ARM64 / ARMv7).')
