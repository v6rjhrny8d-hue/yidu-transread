/* Inflate away from the reading/UI thread with an explicit aggregate budget. */
importScripts('assets/fflate.js');
self.onmessage=e=>{try{let total=0;const files=fflate.unzipSync(new Uint8Array(e.data),{filter:file=>{total+=file.originalSize;if(total>70*1024*1024)throw Error('电子书解压后过大，暂不支持');return true;}});self.postMessage({files},Object.values(files).map(v=>v.buffer));}catch(error){self.postMessage({error:error.message});}};

self.postMessage({ready:true});
