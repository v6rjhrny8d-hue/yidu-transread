/* Bounded, lossless source segmentation; usable in a dedicated import worker. */
(function(root){
'use strict';
const VERSION=1,MAX_PARAGRAPH=1200,MAX_CHAPTER=18000;
const sourceText=p=>typeof p==='string'?p:String(p?.text||'');
const weight=s=>{let n=0;for(const c of s)if(!/\s/u.test(c))n++;return n;};
const scene=s=>/^(?:\s*(?:\*\s*){3,}|\s*[—―-]{3,}|\s*(?:meanwhile|later that|the next (?:morning|day|evening)|that (?:night|evening)|hours? later|days? later|back at|elsewhere)\b|\s*(?:与此同时|第二天|次日|翌日|当晚|数日后|几天后|另一边))/i.test(s);
function* split(text){
 let start=0;while(start<text.length){let end=Math.min(text.length,start+MAX_PARAGRAPH),reason='end';
  if(end<text.length){const window=text.slice(start,end),cjk=/[\u3400-\u9fff]/.test(window),min=cjk?160:380;
   let best=-1,score=-1;const re=/[.!?。！？][”’"'」』）)]*(?:\s+|(?=[\u3400-\u9fff]))|\n+/g;let m;
   while((m=re.exec(window))){const at=m.index+m[0].length;if(at<min)continue;const next=text.slice(start+at,start+at+100),rank=scene(next)?5:/\n\s*\n/.test(m[0])?4:/^[“「『"]/.test(next)?3:1;if(rank>score||rank===score&&at>best){score=rank;best=at;}}
   if(best>0){end=start+best;reason=score===5?'scene':'sentence';}else{const space=window.lastIndexOf(' ');if(space>=min)end=start+space+1;reason='limit';}
   if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  }
  yield {text:text.slice(start,end),start,end,reason};start=end;
 }
}
async function normalize(book,{yieldControl=()=>Promise.resolve()}={}){
 if(book.format==='pdf'||book.structureVersion===VERSION)return book;
 const chapters=[],archivedTranslations={...(book.archivedTranslations||{})};let count=0;
 for(let ci=0;ci<book.chapters.length;ci++){
  const old=book.chapters[ci];let current=null,chars=0,part=0;
  const begin=()=>{current={title:old.title,paragraphs:[],sourceSpans:[],readingWeights:[],translations:[],illustrations:[],sourceChapter:ci,virtualPart:++part};chapters.push(current);chars=0;};begin();
  for(let pi=0;pi<old.paragraphs.length;pi++){
   const original=sourceText(old.paragraphs[pi]);if(original.length>MAX_PARAGRAPH&&old.translations?.[pi])archivedTranslations[ci+':'+pi]=old.translations[pi];let last=null;
   for(const segment of split(original)){
    if(chars>=6000&&scene(segment.text)||chars+segment.text.length>MAX_CHAPTER&&chars>0){begin();current.title=(old.title||'正文')+' · '+part;}
    const index=current.paragraphs.length;current.paragraphs.push(segment.text);current.readingWeights.push(weight(segment.text));current.sourceSpans.push({chapter:ci,paragraph:pi,start:segment.start,end:segment.end,whole:segment.start===0&&segment.end===original.length});
    current.translations.push(segment.start===0&&segment.end===original.length?old.translations?.[pi]||null:null);chars+=segment.text.length;last={current,index};
    if(++count%100===0)await yieldControl();
   }
   if(!original){current.paragraphs.push('');current.readingWeights.push(0);current.sourceSpans.push({chapter:ci,paragraph:pi,start:0,end:0,whole:true});current.translations.push(old.translations?.[pi]||null);last={current,index:current.paragraphs.length-1};}
   if(last)for(const image of old.illustrations||[])if(image.after===pi)last.current.illustrations.push({...image,after:last.index});
  }
  const first=chapters.find(c=>c.sourceChapter===ci);for(const image of old.illustrations||[])if(image.after<0)first.illustrations.unshift({...image});
  await yieldControl();
 }
 return {...book,chapters,archivedTranslations,structureVersion:VERSION};
}
function mapper(book){const lookup=new Map();book.chapters.forEach((c,ci)=>c.sourceSpans?.forEach((s,pi)=>{const key=s.chapter+':'+s.paragraph;if(!lookup.has(key))lookup.set(key,[]);lookup.get(key).push({...s,newChapter:ci,newParagraph:pi});}));
 return (chapter,paragraph=0,offset=0,end=false)=>{const list=lookup.get(chapter+':'+paragraph);if(!list?.length)return {chapter:0,paragraph:0,offset:0};const s=list.find(s=>end?offset<=s.end:offset<s.end)||list.at(-1);return {chapter:s.newChapter,paragraph:s.newParagraph,offset:Math.max(0,Math.min(s.end-s.start,offset-s.start))};};}
function parseText(bytes,name){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030').decode(bytes);}if(/^\s*(?:<!doctype\s+html|<html)/i.test(text.slice(0,1000)))throw Error('下载返回了网页，请选择真实 TXT 文件');
 const chapters=[];let current={title:'正文',paragraphs:[]},start=0;
 while(start<text.length){let end=text.indexOf('\n',start);if(end<0)end=text.length;const line=text.slice(start,end).replace(/\r$/,'');start=end+1;if(!line.trim())continue;
  if(line.length<110&&/^(?:chapter\s+[\divxlc]+\b|第[零〇一二三四五六七八九十百千万\d]+[章节回卷]|[IVXLC]{1,8}$)/i.test(line.trim())){if(current.paragraphs.length)chapters.push(current);current={title:line.trim(),paragraphs:[]};}else current.paragraphs.push(line);
 }
 if(current.paragraphs.length)chapters.push(current);let hash=2166136261;for(const b of bytes)hash=Math.imul(hash^b,16777619);
 return {id:crypto.randomUUID(),title:name.replace(/\.txt$/i,''),author:'本地图书',language:/[\u3400-\u9fff]/.test(text.slice(0,2000))?'zh':'en',format:'txt',chapters,fingerprint:(hash>>>0).toString(16)+'-'+bytes.length,created:Date.now()};
}
root.TransReadStructure={VERSION,split,normalize,mapper,parseText,weight,sourceText};
if(typeof module!=='undefined')module.exports=root.TransReadStructure;
if(typeof document==='undefined'&&typeof self!=='undefined'&&typeof self.postMessage==='function'){self.postMessage({ready:true});self.onmessage=async e=>{try{const book=await normalize(parseText(new Uint8Array(e.data.bytes),e.data.name));self.postMessage({book});}catch(error){self.postMessage({error:error.message});}};}
})(typeof window==='undefined'?globalThis:window);
