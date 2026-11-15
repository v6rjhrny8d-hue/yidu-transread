/* Older interaction suites explicitly seed their fixture. Production starts empty. */
const fs=require('node:fs'),path=require('node:path');
const book=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/legacy-little-prince.json'),'utf8'));
book.assetsMigrated=true;
module.exports=source=>source.replace(/\ninit\(\);\s*$/,`\n(async()=>{await openDB();await put('books',${JSON.stringify(book)});await init();})();\n`);
