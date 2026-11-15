/* Historical fixture for tests; sample books are no longer seeded by the app. */
const fs=require('node:fs'),path=require('node:path');
module.exports=async page=>{
 const book=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/legacy-little-prince.json'),'utf8'));
 await page.addInitScript(book=>{const request=indexedDB.open('lumi-reader',2);request.onupgradeneeded=()=>{for(const name of ['books','notes','settings','translations','resources','resourceEntries'])request.result.createObjectStore(name,{keyPath:'id'});request.transaction.objectStore('books').put(book);};request.onsuccess=()=>request.result.close();},book);
};
