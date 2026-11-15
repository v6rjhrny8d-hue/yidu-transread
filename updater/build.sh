#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_name="0.5.57"
release_code="78"
sdk_tools="$PWD/tools/sdk/android-15"
sdk_jar="$PWD/tools/sdk/android-35/android.jar"
python3 tools/build_update_patch.py --target "dist/YiDu-${release_name}.apk" --base dist/YiDu-0.5.55.apk --base dist/YiDu-0.5.56.apk --assets updater/assets --spec updater/src/app/lumi/reader/update/UpdateSpec.java --version "$release_name" --code "$release_code" --report "test/update-patches-${release_name}.json"
work=$(mktemp -d "${TMPDIR:-/tmp}/transread-update.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex" "$work/gen"
"$sdk_tools/aapt2" compile --dir updater/res -o "$work/resources.zip"
"$sdk_tools/aapt2" link -o "$work/linked.apk" -I "$sdk_jar" --manifest updater/AndroidManifest.xml "$work/resources.zip" -A updater/assets --java "$work/gen" --min-sdk-version 26 --target-sdk-version 35
java -jar tools/ecj.jar -1.8 -proc:none -warn:none -cp "$sdk_jar" -d "$work/classes" updater/src/app/lumi/reader/update/*.java "$work/gen/app/lumi/reader/update/R.java"
python3 - "$work" <<'PY'
import pathlib,sys,zipfile
w=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(w/'classes.jar','w') as z:
 for p in (w/'classes').rglob('*.class'):z.write(p,p.relative_to(w/'classes').as_posix())
PY
java -cp "$sdk_tools/lib/d8.jar" com.android.tools.r8.D8 --min-api 26 --lib "$sdk_jar" --output "$work/dex" "$work/classes.jar"
python3 - "$work" <<'PY'
import pathlib,sys,zipfile
w=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(w/'linked.apk') as a,zipfile.ZipFile(w/'unsigned.apk','w') as z:
 for entry in a.infolist():z.writestr(entry,a.read(entry.filename))
 z.write(w/'dex/classes.dex','classes.dex',compress_type=zipfile.ZIP_DEFLATED)
PY
"$sdk_tools/zipalign" -f -P 16 4 "$work/unsigned.apk" "$work/aligned.apk"
java -jar "$sdk_tools/lib/apksigner.jar" sign --ks tools/lumi-development.p12 --ks-key-alias lumi-development --ks-pass pass:android --key-pass pass:android --out "$work/signed.apk" "$work/aligned.apk"
java -jar "$sdk_tools/lib/apksigner.jar" verify --verbose --print-certs "$work/signed.apk"
"$sdk_tools/aapt2" dump badging "$work/signed.apk"
cp "$work/signed.apk" "dist/YiDu-${release_name}-UpdateHelper.apk"
