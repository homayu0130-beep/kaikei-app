/* Local LINE reservation parser. No server calls or data uploads. */
(function(){
 "use strict";
 const COURSE_MINUTES=new Set([50,60,70,80,90,100,110,120,130,160,190]);
 function clean(s){return String(s||"").normalize("NFKC").replace(/\u3000/g," ").trim()}
 function personName(raw){
  const s=clean(raw).replace(/^(?:名前|お名前)[:：\s]*/,"").replace(/(?:様|さん)$/,"").trim();
  if(!/^[ぁ-ゔァ-ヶー一-龥・]{2,22}$/.test(s))return "";
  if(/^(?:リセット|ネクサス|ネク|亀|かめ|もし亀|アクア|ホテル|自宅|ラブホ|指名|リピート)$/.test(s))return "";
  return s;
 }
 function parse(raw,opts={}){
  const append=Boolean(opts.append);
  const hotels=Array.isArray(opts.hotels)?opts.hotels:[];
  const lines=String(raw||"").replace(/\r/g,"").split("\n").map(clean).filter(Boolean);
  const p={},all=lines.join("\n"),used=new Set();
  if(/リセット|(?:^|\n)\s*reset\s*(?:\n|$)/i.test(all))p.store="リセット";
  else if(/ネクサス|ネク|nexus/i.test(all))p.store="NEXUS";
  else if(/もし亀|もしカメ|亀|かめ|カメ/.test(all))p.store="もし亀";
  else if(/アクア|aqua/i.test(all))p.store="アクア";
  // 「指名」だけなら初回予約（指名料0円）。2回目以降の「リピ」のときだけ有料。
  if(/リピ(?:ート)?/.test(all)){p.nomination=true;p.visitType="リピート";}
  else if(/指名/.test(all)){p.nomination=false;p.visitType="初回指名";}
  if(/(?:3\s*[PＰ]|3ピ|スリーピー)/i.test(all))p.three=true;
  const placePattern=/(?:愛知県|名古屋市|(?:千種|昭和|天白|名東|中村|中川|瑞穂|守山|熱田|中|東|西|北|南|緑|港)区|(?:一宮|稲沢|春日井|清須|北名古屋|長久手|尾張旭|小牧|岩倉|江南|犬山|あま)市|ホテル|ラブホ|マンション|アパート|自宅|住所|お届け先|行き先|号室|[0-9]{3,4}号|丁目|天白[0-9]|一宮ラブホ)/i;
  function isPlace(line){
   const normalized=clean(line).toLowerCase();
   return placePattern.test(line)||hotels.some(h=>[h.name,...(h.aliases||[])].some(a=>normalized===clean(a).toLowerCase()))||/^(?:今池|天白|一宮)(?:[0-9]{2,4}|ラブホ)/.test(line);
  }
  for(let i=0;i<lines.length;i++){
   const line=lines[i],v=line.replace(/[\s,，]/g,"");
   const time=v.match(/^(\d{2})(\d{2})$/);
   if(time&&Number(time[1])<=35&&Number(time[2])<=59){
    if(!p.time){const h=Number(time[1]);p.time=(h>=24?"翌":"")+String(h%24).padStart(2,"0")+":"+time[2];p.rawTime=v}
    used.add(i);continue;
   }
   const combined=v.match(/^(50|60|70|80|90|100|110|120|130|160|190)[\-‐‑−–—ー](\d{4,6})(.*)$/);
   if(combined){
    p.course=Number(combined[1]);p.advertisedPrice=Number(combined[2]);
    const name=personName(combined[3]);if(name)p.name=name;
    used.add(i);continue;
   }
   if(/^\d{2,3}$/.test(v)&&COURSE_MINUTES.has(Number(v))){p.course=Number(v);used.add(i);continue}
   const priceName=v.match(/^(\d{4,6})([^\d].*)?$/);
   if(priceName&&Number(priceName[1])>=3000&&Number(priceName[1])<=200000){
    if(!Number.isFinite(p.advertisedPrice))p.advertisedPrice=Number(priceName[1]);
    const name=personName(priceName[2]);if(name)p.name=name;
    used.add(i);continue;
   }
   const coded=v.match(/^([A-Za-z]{1,3}\d{3,8})([ぁ-ゔァ-ヶー一-龥・]{2,22})$/);
   if(coded){p.memberCode=coded[1];p.name=coded[2];used.add(i);continue}
   if(/^(?:NEXUS|ネクサス|ネク|もし亀|もしカメ|亀|かめ|カメ|リセット|アクア)(?:新規)?(?:本)?(?:指名|リピ(?:ート)?|3P)?$/i.test(v)){used.add(i);continue}
  }
  const destinations=[];
  for(const [i,line] of lines.entries()){
   if(used.has(i))continue;
   if(isPlace(line)){destinations.push(line);continue}
   const candidate=personName(line);
   if(!append&&!p.name&&candidate){p.name=candidate;continue}
   if(append||p.name||destinations.length)destinations.push(line);
  }
  if(destinations.length)p.destination=destinations.join(" ");
  return p;
 }
 window.parseKaikeiLine=parse;
})();