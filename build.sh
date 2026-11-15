#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sdk_tools="$PWD/tools/sdk/android-15"
sdk_jar="$PWD/tools/sdk/android-35/android.jar"
app_version=$(python3 - <<'PY'
import xml.etree.ElementTree as E
print(E.parse('android/AndroidManifest.xml').getroot().get('{http://schemas.android.com/apk/res/android}versionName'))
PY
)
release_apk="$PWD/dist/YiDu-${app_version}.apk"
if [[ ! -f tools/tts/classes.jar || ! -f tools/tts/kotlin-stdlib.jar ]]; then
 echo "Missing speech dependencies: run python3 tools/setup_tts.py" >&2
 exit 1
fi
if [[ ! -f tools/lumi-development.p12 ]]; then
 echo 'Missing original signing key: restore Lumi-Reader-Development-Signing.p12 as tools/lumi-development.p12. Refusing to generate an incompatible replacement key.' >&2
 exit 1
fi
chmod u+x "$sdk_tools/aapt2" "$sdk_tools/zipalign"
mkdir -p build dist
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/transread-build.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT
mkdir -p "$build_dir/classes" "$build_dir/dex"
"$sdk_tools/aapt2" compile --dir android/res -o "$build_dir/resources.zip"
"$sdk_tools/aapt2" link -o "$build_dir/linked.apk" -I "$sdk_jar" --manifest android/AndroidManifest.xml "$build_dir/resources.zip" -A web --min-sdk-version 26 --target-sdk-version 35
python3 - "$build_dir/linked.apk" <<'PY'
import sys,zipfile,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert 'AndroidManifest.xml' in z.namelist(), 'Linked APK has no manifest'
 assert z.testzip() is None, 'Linked APK CRC failed'
 for p in pathlib.Path('web').rglob('*'):
  if p.is_file():assert z.read('assets/'+str(p.relative_to('web')))==p.read_bytes(), str(p)
print('PASS Linked APK manifest, CRC and all web resources')
PY
java -jar tools/ecj.jar -1.8 -proc:none -warn:none -cp "$sdk_jar:tools/tts/classes.jar:tools/tts/kotlin-stdlib.jar" -d "$build_dir/classes" android/src/app/lumi/reader/*.java
python3 - "$build_dir" <<'PY'
import sys,zipfile,pathlib
work=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(work/'classes.jar','w') as z:
 for p in (work/'classes').rglob('*.class'):z.write(p,str(p.relative_to(work/'classes')))
PY
java -cp "$sdk_tools/lib/d8.jar" com.android.tools.r8.D8 --min-api 26 --lib "$sdk_jar" --output "$build_dir/dex" "$build_dir/classes.jar" tools/tts/classes.jar tools/tts/kotlin-stdlib.jar
# Rebuild a fresh archive rather than mutating the resource APK in place.
python3 - "$build_dir" <<'PY'
import sys,zipfile,pathlib
work=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(work/'linked.apk') as source,zipfile.ZipFile(work/'unsigned.apk','w') as target:
 for entry in source.infolist():target.writestr(entry,source.read(entry.filename))
 for dex in (work/'dex').glob('*.dex'):target.write(dex,dex.name,compress_type=zipfile.ZIP_DEFLATED)
 with zipfile.ZipFile('tools/tts/sherpa-onnx.aar') as aar:
  for name in aar.namelist():
   if name.startswith(('jni/arm64-v8a/','jni/armeabi-v7a/')) and name.endswith('.so'):target.writestr('lib/'+name[4:],aar.read(name),compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(work/'unsigned.apk') as z:
 assert {'AndroidManifest.xml','classes.dex','assets/index.html'}<=set(z.namelist())
 assert z.testzip() is None
print('PASS Assembled APK manifest, bytecode and CRC')
PY
"$sdk_tools/zipalign" -f -P 16 4 "$build_dir/unsigned.apk" "$build_dir/aligned.apk"
java -jar "$sdk_tools/lib/apksigner.jar" sign --ks tools/lumi-development.p12 --ks-key-alias lumi-development --ks-pass pass:android --key-pass pass:android --out "$build_dir/signed.apk" "$build_dir/aligned.apk"
java -jar "$sdk_tools/lib/apksigner.jar" verify --verbose --print-certs "$build_dir/signed.apk"
"$sdk_tools/aapt2" dump badging "$build_dir/signed.apk" > "$build_dir/badging.txt"
head -14 "$build_dir/badging.txt"
cp "$build_dir/signed.apk" "${release_apk}.tmp"
mv -f "${release_apk}.tmp" "$release_apk"
python3 - "$build_dir/signed.apk" "$release_apk" <<'PY'
import sys,hashlib,zipfile,pathlib
source,target=map(pathlib.Path,sys.argv[1:])
assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(target.read_bytes()).digest()
with zipfile.ZipFile(target) as z:assert z.testzip() is None
print('PASS Published APK byte identity and CRC')
PY
ls -lh "$release_apk"
