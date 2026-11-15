"""Fetch build prerequisites from their official distribution sources."""
import concurrent.futures
import pathlib
import urllib.request
import zipfile

root=pathlib.Path(__file__).resolve().parents[1]
tools=root/'tools'
sdk=tools/'sdk'
sources={
 'platform.zip':'https://dl.google.com/android/repository/platform-35_r02.zip',
 'build-tools.zip':'https://dl.google.com/android/repository/build-tools_r35_linux.zip',
 'ecj.jar':'https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.37.0/ecj-3.37.0.jar',
}
def fetch(item):
 name,url=item
 target=tools/name
 if not target.exists():
  print('Downloading',name,flush=True)
  temp=target.with_suffix(target.suffix+'.partial')
  urllib.request.urlretrieve(url,temp)
  temp.replace(target)
 if name.endswith('.zip'):
  with zipfile.ZipFile(target) as z:
   # Scratch dependencies may have been linked to an expired workspace.
   # Remove only dangling top-level links before restoring official archives.
   for top_name in {entry.filename.split('/')[0] for entry in z.infolist()}:
    dest=sdk/top_name
    if dest.is_symlink() and not dest.exists():dest.unlink()
   z.extractall(sdk)
 return name
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as p:
 for name in p.map(fetch,sources.items()):print('Ready',name,flush=True)
for name in ['aapt2','zipalign','d8','apksigner']:
 (sdk/'android-15'/name).chmod(0o755)
print('Run bash build.sh')
