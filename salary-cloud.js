import {initializeApp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {getFirestore,collection,doc,onSnapshot,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const config={apiKey:"AIzaSyD_recBEQb3-_zSX7csc2eDpovdMFCBnWw",authDomain:"kaikei-kyuryo-e6479.firebaseapp.com",projectId:"kaikei-kyuryo-e6479",storageBucket:"kaikei-kyuryo-e6479.firebasestorage.app",messagingSenderId:"928238559312",appId:"1:928238559312:web:5b5d4d2a4e89955f1db155"};
const app=initializeApp(config,"salary-private"),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id),Y=v=>"¥"+Math.round(v).toLocaleString("ja-JP");
const names=["NEXUS","もし亀","リセット","アクア"];
const courses={"NEXUS":{"通常":[70,100,130,160,190],"3P":[70,100,130]},"もし亀":{"通常":[60,80,110],"3P":[60,80,110]},"リセット":{"通常":[60,90,120]},"アクア":{"通常":[60,90,120],"Wセラピスト":[60,90,120]}};
const pctMeta=[["optionsPct","オプション（基本）"],["changePct","チェンジ料"],["travelPct","交通費"],["extraPct","その他追加"],["discountPct","値引き控除"]];
const fullReset=new Set(["ベビードール","パウダー","極液","マイクロビキニ"]);
const defaultRules={
 "NEXUS":{courseBack:{"通常|70":7500,"通常|100":10000,"通常|130":12500,"通常|160":15000,"通常|190":17500},optionsPct:100,travelPct:0},
 "もし亀":{courseBack:{},optionsPct:100,travelPct:0},
 "リセット":{courseBack:{"通常|60":5000,"通常|90":7000,"通常|120":10000},optionsPct:100,travelPct:0},
 "アクア":{courseBack:{"通常|60":5000,"通常|90":7000,"通常|120":10000},optionsPct:100,travelPct:0}
};
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const blank=v=>v===null||v===undefined||v==="";
function jstDay(date){
 try{
  const d=new Date(date);
  if(Number.isNaN(d.getTime()))return "";
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
 }catch{return ""}
}
function recordDay(r){
 if(typeof r.serviceDate==="string"&&/^\d{4}-\d\d-\d\d$/.test(r.serviceDate))return r.serviceDate;
 return jstDay(r.date)||"日付不明";
}
let user=null,unsubs=[],records=[],diaries={},overrides={},selectedDay="",ready={records:false,diaries:false,settings:false};
const setStatus=(id,text,isError=false)=>{const el=$(id);if(el){el.textContent=text;el.classList.toggle("error",isError)}};
function authError(e){
 const code=String(e?.code||"");
 if(code.includes("unauthorized-domain"))return "Firebase Authentication の承認済みドメインに homayu0130-beep.github.io を追加してください。";
 if(code.includes("permission-denied"))return "Firestore のセキュリティルールを確認してください。データを読み込めません。";
 if(code.includes("operation-not-allowed"))return "Firebase Authentication で Googleログインを有効にしてください。";
 if(code.includes("popup-closed"))return "ログイン画面が閉じられました。";
 return "接続できません（"+(code||"ネットワーク／設定")+"）。";
}
const ruleFor=name=>{
 const def=defaultRules[name]||{courseBack:{}},own=overrides[name]||{};
 return {...def,...own,courseBack:{...def.courseBack,...(own.courseBack||{})}};
};
function compute(r){
 const rule=ruleFor(r.store),key=(r.mode==="3P"?"3P":"通常")+"|"+n(r.course);
 const missing=[],breakdown=[];
 let sum=0;
 const add=(name,amount)=>{sum+=amount;breakdown.push({name,amount})};
 if(r.complete!==true)missing.push("会計未確定");
 if(r.store==="リセット"&&r.mode==="3P")missing.push("リセットは3P対象外");
 const courseBack=rule.courseBack[key];
 const fee=n(r.base)+n(r.threeFee);
 if(!blank(courseBack))add("コースバック",n(courseBack));
 else if(!blank(rule.coursePct))add("コース歩合",Math.round(fee*n(rule.coursePct)/100));
 else missing.push("コースバック未設定");
 if(n(r.extMinutes)>0){
  if(blank(r.ext))missing.push("延長料金");
  else add("延長バック50％",Math.round(n(r.ext)/2));
 }
 if(n(r.nomination))add("指名料（全額）",n(r.nomination));
 if(n(r.optionsTotal)){
  if(r.store==="リセット"&&Array.isArray(r.options)&&r.options.length){
   let known=0,other=0;
   for(const op of r.options){
    const amount=blank(op.total)?n(op.price)*n(op.qty||1):n(op.total);
    if(fullReset.has(String(op.name)))known+=amount;
    else other+=amount;
   }
   other+=Math.max(0,n(r.optionsTotal)-known-other);
   if(known)add("フルバック対象オプション",known);
   if(other){
    if(blank(rule.optionsPct))missing.push("その他のオプションバック率");
    else add("その他のオプション",Math.round(other*n(rule.optionsPct)/100));
   }
  }else if(blank(rule.optionsPct))missing.push("オプションバック率");
  else add("オプション",Math.round(n(r.optionsTotal)*n(rule.optionsPct)/100));
 }
 const variable=[["チェンジ料","change","changePct"],["交通費","travel","travelPct"],["その他追加","surcharge","extraPct"],["値引き控除","discount","discountPct"]];
 for(const [label,property,field]of variable){
  const value=n(r[property]);
  if(!value)continue;
  if(blank(rule[field]))missing.push(label+"のバック率");
  else add(label,Math.round(value*n(rule[field])/100)*(field==="discountPct"?-1:1));
 }
 const diary=diaries[recordDay(r)];
 if(!Number.isInteger(diary)||diary<0)missing.push("日記投稿数");
 else add("雑費控除 "+(diary>=6?5:10)+"％",-Math.round(Math.max(0,fee+n(r.nomination))*(diary>=6?5:10)/100));
 return {amount:missing.length?null:Math.round(sum),known:Math.round(sum),missing,breakdown};
}
function scoped(){
 const month=$("month").value,store=$("storeFilter").value;
 return records.filter(r=>recordDay(r).startsWith(month)&&(store==="all"||r.store===store));
}
function render(){
 if(!user)return;
 const list=scoped(),res=list.map(r=>({r,p:compute(r)}));
 const pending=res.filter(x=>x.p.amount===null).length;
 $("jobs").textContent=list.length+"件";
 $("sales").textContent=Y(list.reduce((v,r)=>v+n(r.total),0));
 $("payTotal").textContent=Y(res.reduce((v,x)=>v+(x.p.amount||0),0));
 setStatus("pendingSummary",pending?pending+"件は給料の計算に必要な設定が未入力です。計算済み合計に含めていません。":"対象の給料はすべて計算済みです。");
 const groups=new Map();
 for(const item of res){
  const day=recordDay(item.r);
  if(!groups.has(day))groups.set(day,[]);
  groups.get(day).push(item);
 }
 const host=$("days");host.replaceChildren();
 if(!groups.size){host.textContent="選択した月に会計履歴がありません。";selectedDay="";$("dayDetails").textContent="会計記録がありません。";$("diaryBox").classList.add("hidden");return;}
 const sorted=[...groups].sort(([a],[b])=>b.localeCompare(a));
 if(!groups.has(selectedDay))selectedDay=sorted[0][0];
 for(const [day,entries] of sorted){
  const total=entries.reduce((v,x)=>v+(x.p.amount||0),0);
  const need=entries.filter(x=>x.p.amount===null).length;
  const b=document.createElement("button");
  b.type="button";b.className="day";b.setAttribute("aria-pressed",String(day===selectedDay));
  const top=document.createElement("div");top.className="flex";
  const label=document.createElement("strong");label.textContent=day;
  const count=document.createElement("span");count.className="pill";count.textContent=entries.length+"件";
  top.append(label,count);
  const value=document.createElement("div");value.className="big";value.textContent="給料 "+Y(total)+(need?" ＋ 要設定"+need+"件":"");
  const detail=document.createElement("div");detail.className="muted";detail.textContent=Number.isInteger(diaries[day])?"日記"+diaries[day]+"件":"日記未入力";
  b.append(top,value,detail);
  b.addEventListener("click",()=>{selectedDay=day;render()});
  host.append(b);
 }
 $("dayTitle").textContent=selectedDay+" の給料";
 const detailHost=$("dayDetails");detailHost.replaceChildren();
 const entries=groups.get(selectedDay)||[];
 for(const {r,p} of entries){
  const item=document.createElement("div");item.className="item";
  const line=document.createElement("div");line.className="flex";
  const name=document.createElement("strong");name.textContent=r.store+"｜"+r.course+"分 "+r.mode;
  const pay=document.createElement("span");pay.className="big";pay.textContent=p.amount===null?"要設定":Y(p.amount);
  line.append(name,pay);item.append(line);
  const sub=document.createElement("div");sub.className="muted";sub.textContent="会計 "+Y(n(r.total))+"／"+(r.area||"");item.append(sub);
  if(p.missing.length){
   const warning=document.createElement("div");warning.className="warn";warning.textContent="要確認："+p.missing.join("・");item.append(warning);
  }
  for(const section of p.breakdown){
   const row=document.createElement("div");row.className="flex muted";
   const title=document.createElement("span");title.textContent=section.name;
   const amount=document.createElement("span");amount.textContent=(section.amount<0?"−":"")+Y(Math.abs(section.amount));
   row.append(title,amount);item.append(row);
  }
  detailHost.append(item);
 }
 $("diaryBox").classList.remove("hidden");
 $("diaryCount").value=Number.isInteger(diaries[selectedDay])?String(diaries[selectedDay]):"";
}
function renderSettings(){
 const shop=$("ruleStore").value,rule=ruleFor(shop),h=$("courseBackFields");h.replaceChildren();
 const table=document.createElement("table");table.className="table";
 const head=document.createElement("thead");head.innerHTML="<tr><th>形態</th><th>コース</th><th>自分のバック（円）</th></tr>";table.append(head);
 const body=document.createElement("tbody");
 for(const [mode,minutes] of Object.entries(courses[shop]||{})){
  for(const min of minutes){
   const tr=document.createElement("tr");
   for(const value of [mode,min+"分"]){const td=document.createElement("td");td.textContent=value;tr.append(td)}
   const td=document.createElement("td");const inp=document.createElement("input");inp.type="number";inp.min="0";
   inp.dataset.back=mode+"|"+min;const value=rule.courseBack[inp.dataset.back];
   inp.value=blank(value)?"":String(value);inp.placeholder="未確認";td.append(inp);tr.append(td);body.append(tr);
  }
 }table.append(body);h.append(table);
 const percentages=$("pctFields");percentages.replaceChildren();
 for(const [field,title]of pctMeta){
  const wrap=document.createElement("div"),label=document.createElement("label");label.textContent=title;
  const inp=document.createElement("input");inp.type="number";inp.min="0";inp.max="100";inp.dataset.pct=field;inp.placeholder="未設定";
  inp.value=blank(rule[field])?"":String(rule[field]);
  wrap.append(label,inp);percentages.append(wrap);
 }
 setStatus("settingsStatus","");
}
async function saveSettings(){
 if(!user)return;
 const shop=$("ruleStore").value,courseBack={},patch={};
 for(const inp of $("courseBackFields").querySelectorAll("input[data-back]")){
  if(inp.value.trim()!==""){const value=Number(inp.value);if(!Number.isFinite(value)||value<0){setStatus("settingsStatus","バック額を正しく入力してください。",true);return}courseBack[inp.dataset.back]=value}
  else courseBack[inp.dataset.back]=null;
 }
 for(const inp of $("pctFields").querySelectorAll("input[data-pct]")){
  const value=inp.value.trim()===""?null:Number(inp.value);
  if(value!==null&&(!Number.isFinite(value)||value<0||value>100)){setStatus("settingsStatus","バック率は0～100％で入力してください。",true);return}
  patch[inp.dataset.pct]=value;
 }
 const before={...overrides};overrides={...overrides,[shop]:{...patch,courseBack}};
 render();setStatus("settingsStatus","設定を保存しています…");
 try{
  await setDoc(doc(db,"users",user.uid,"salarySettings","main"),{rules:overrides,updatedAt:serverTimestamp()});
  setStatus("settingsStatus","給料設定を保存しました。");
 }catch(e){overrides=before;render();setStatus("settingsStatus",authError(e),true)}
}
async function saveDiary(){
 if(!user||!selectedDay)return;
 const value=Number($("diaryCount").value);
 if($("diaryCount").value.trim()===""||!Number.isInteger(value)||value<0||value>999){setStatus("diaryMessage","日記件数を入力してください。",true);return}
 const day=selectedDay;setStatus("diaryMessage","保存中…");
 try{
  await setDoc(doc(db,"users",user.uid,"salaryDiary",day),{count:value,updatedAt:serverTimestamp()});
  diaries[day]=value;render();setStatus("diaryMessage","日記件数を保存しました。");
 }catch(e){setStatus("diaryMessage",authError(e),true)}
}
function cleanup(){
 for(const unsub of unsubs){try{unsub()}catch{}}
 unsubs=[];records=[];diaries={};overrides={};selectedDay="";
 ready={records:false,diaries:false,settings:false};
 $("privateContent").classList.add("hidden");$("authGate").classList.remove("hidden");
}
function attach(){
 if(!user)return;
 const uid=user.uid;
 const onFailure=e=>{if(user?.uid===uid)setStatus("syncStatus",authError(e),true)};
 unsubs.push(onSnapshot(collection(db,"users",uid,"accountingRecords"),s=>{
  if(user?.uid!==uid)return;
  records=s.docs.map(d=>d.data()).filter(v=>!v.deleted&&v.record&&typeof v.record.id==="string").map(v=>v.record).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  ready.records=true;updateStatus();render();
 },onFailure));
 unsubs.push(onSnapshot(collection(db,"users",uid,"salaryDiary"),s=>{
  if(user?.uid!==uid)return;
  diaries=Object.fromEntries(s.docs.map(d=>[d.id,Number(d.data().count)]).filter(([day,count])=>/^\d{4}-\d\d-\d\d$/.test(day)&&Number.isInteger(count)&&count>=0));
  ready.diaries=true;updateStatus();render();
 },onFailure));
 unsubs.push(onSnapshot(doc(db,"users",uid,"salarySettings","main"),s=>{
  if(user?.uid!==uid)return;
  const value=s.exists()?s.data().rules:{};
  overrides=value&&typeof value==="object"?value:{};
  ready.settings=true;updateStatus();renderSettings();render();
 },onFailure));
}
function updateStatus(){
 if(ready.records&&ready.diaries&&ready.settings)setStatus("syncStatus","会計履歴と給料設定を自動同期中");
 else setStatus("syncStatus","クラウドの情報を読み込んでいます…");
}
$("month").value=jstDay(new Date()).slice(0,7);
$("month").addEventListener("change",render);
$("storeFilter").addEventListener("change",render);
$("ruleStore").addEventListener("change",renderSettings);
$("saveSettings").addEventListener("click",saveSettings);
$("diarySave").addEventListener("click",saveDiary);
$("refresh").addEventListener("click",()=>{if(user){cleanup();$("authGate").classList.add("hidden");$("privateContent").classList.remove("hidden");attach()}});
$("login").addEventListener("click",async()=>{
 $("login").disabled=true;
 setStatus("loginStatus","Googleログインを開いています…");
 try{
  const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});
  await signInWithPopup(auth,provider);
 }catch(e){setStatus("loginStatus",authError(e),true)}
 finally{$("login").disabled=false}
});
$("logout").addEventListener("click",()=>{signOut(auth).catch(e=>setStatus("syncStatus",authError(e),true))});
onAuthStateChanged(auth,next=>{
 cleanup();user=next;
 if(!next){setStatus("loginStatus","");return}
 $("authGate").classList.add("hidden");$("privateContent").classList.remove("hidden");
 $("accountName").textContent=next.displayName||"Googleログイン中";
 setStatus("syncStatus","クラウドの情報を読み込んでいます…");
 attach();
},e=>setStatus("loginStatus",authError(e),true));
