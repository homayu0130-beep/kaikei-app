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
 "もし亀":{courseBack:{"通常|60":5000,"通常|80":7000,"通常|110":9000,"3P|60":5000,"3P|80":7000,"3P|110":9000},optionsPct:100,travelPct:0},
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
let user=null,unsubs=[],records=[],diaries={},dayChecks={},overrides={},selectedDay="",ready={records:false,diaries:false,settings:false};
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
 const courseBack={...def.courseBack,...(own.courseBack||{})};
 // Old blanks were saved before the confirmed Moshikame rates existed.
 // Explicitly entered numeric amounts still take precedence.
 if(name==="もし亀")for(const [key,value] of Object.entries(def.courseBack)){
   if(blank(courseBack[key]))courseBack[key]=value;
 }
 return {...def,...own,courseBack};
};
// Course + extension + nomination + travel are the shop-side total.
// Options are collected separately and must not be added to this figure.
function splitAmounts(r){
 const course=n(r.base)+n(r.threeFee);
 const extension=n(r.ext);
 const nomination=n(r.nomination);
 const travel=n(r.travel);
 const shop=course+extension+nomination+travel;
 const options=Array.isArray(r.options)?r.options.filter(o=>o&&typeof o==="object").map(o=>({
  name:String(o.name||"オプション"),
  amount:o.total===null||o.total===undefined?n(o.price)*n(o.qty||1):n(o.total)
 })):[];
 const listed=options.reduce((sum,o)=>sum+o.amount,0);
 const recorded=n(r.optionsTotal);
 if(recorded>listed)options.push({name:"内訳未登録のオプション",amount:recorded-listed});
 return {course,extension,nomination,travel,shop,optionsTotal:Math.max(recorded,listed),options};
}
function appendMoneyRow(target,label,value,strong=false){
 const row=document.createElement("div");
 row.className="moneyRow"+(strong?" total":"");
 const l=document.createElement("span");l.textContent=label;
 const v=document.createElement(strong?"strong":"span");v.textContent=Y(value);
 row.append(l,v);target.append(row);
}
function appendAmountGroup(target,title,rows,total,isPrivate=false){
 const box=document.createElement("div");box.className="detailGroup"+(isPrivate?" private":"");
 const h=document.createElement("h3");h.textContent=title;box.append(h);
 for(const [label,amount] of rows)appendMoneyRow(box,label,amount);
 appendMoneyRow(box,"合計",total,true);
 target.append(box);
}
function compute(r){
 const rule=ruleFor(r.store),key=(r.mode==="3P"?"3P":"通常")+"|"+n(r.course);
 const solo3P=r.mode==="3P"&&(r.store==="NEXUS"||r.store==="もし亀");
 const soloKey="通常|"+n(r.course);
 const missing=[],breakdown=[];
 let sum=0;
 const add=(name,amount)=>{sum+=amount;breakdown.push({name,amount})};
 if(r.complete!==true)missing.push("会計未確定");
 if(r.store==="リセット"&&r.mode==="3P")missing.push("リセットは3P対象外");
 // A 3P booking pays this therapist the same course back as a single-person booking.
 // Always use the normal rate, including when the normal rate is customized later.
 const courseBack=solo3P?rule.courseBack[soloKey]:rule.courseBack[key];
 const fee=n(r.base)+n(r.threeFee);
 const singleCoursePrices={
  "NEXUS":{70:15000,100:20000,130:25000,160:30000},
  "もし亀":{60:10000,80:13000,110:17000}
 };
 const expenseCourseFee=solo3P?(singleCoursePrices[r.store]?.[n(r.course)]??fee):fee;
 // If two therapists each have nominations, only this therapist's 2000 yen is hers.
 const nominationBack=solo3P?Math.min(2000,Math.max(0,n(r.nomination))):n(r.nomination);
 if(!blank(courseBack))add("コースバック"+(solo3P?"（1人分と同額）":""),n(courseBack));
 else if(!blank(rule.coursePct))add("コース歩合",Math.round(expenseCourseFee*n(rule.coursePct)/100));
 else missing.push("コースバック未設定");
 if(n(r.extMinutes)>0){
  if(blank(r.ext))missing.push("延長料金");
  else if(solo3P)add("延長バック（1人分・30分4,000円）",Math.round(n(r.extMinutes)/30*4000));
  else add("延長バック50％",Math.round(n(r.ext)/2));
 }
 if(nominationBack)add("指名料（本人分・全額）",nominationBack);
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
 else add("雑費控除 "+(diary>=6?5:10)+"％"+(solo3P?"（1人分コース＋本人の指名料）":""),-Math.round(Math.max(0,expenseCourseFee+nominationBack)*(diary>=6?5:10)/100));
 return {amount:missing.length?null:Math.round(sum),known:Math.round(sum),missing,breakdown};
}
function optionBackInPay(result){
 // 給料に加算されたオプションバックだけを抜き出す（店舗別の率やフルバック設定を尊重）。
 return result.breakdown.reduce((total,part)=>/オプション/.test(part.name)?total+part.amount:total,0);
}
function payWithoutOptions(result){
 return result.amount===null?null:result.amount-optionBackInPay(result);
}
function confirmedSignature(day,entries){
 const values=entries.map(({r,p})=>[r.id,r.date,r.serviceDate,r.store,r.course,r.total,r.base,r.ext,r.nomination,r.travel,r.optionsTotal,p.amount,p.known,p.missing.join("|")]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 const source=JSON.stringify([day,diaries[day]??null,values]);
 let h=2166136261;for(let i=0;i<source.length;i++){h^=source.charCodeAt(i);h=Math.imul(h,16777619)}
 return String(h>>>0);
}
async function toggleDayCheck(day,entries){
 if(!user||!entries.length)return;
 const signature=confirmedSignature(day,entries),isChecked=dayChecks[day]===signature;
 if(!isChecked&&entries.some(({p})=>p.amount===null)){
  setStatus("checkMessage","未確定の給料があります。日記件数や給料設定を確認してください。",true);return;
 }
 const previous=dayChecks[day];dayChecks[day]=isChecked?"":signature;render();
 setStatus("checkMessage","確認状態を保存しています…");
 try{
  await setDoc(doc(db,"users",user.uid,"salaryDiary",day),{checkedSignature:isChecked?"":signature,checkedAt:serverTimestamp()},{merge:true});
  setStatus("checkMessage",isChecked?"確認済みを解除しました。":"この日の会計と給料を確認済みにしました。");
 }catch(e){if(previous===undefined)delete dayChecks[day];else dayChecks[day]=previous;render();setStatus("checkMessage",authError(e),true)}
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
 $("shopTotal").textContent=Y(list.reduce((v,r)=>v+splitAmounts(r).shop,0));
 $("privateOptionsTotal").textContent=Y(list.reduce((v,r)=>v+splitAmounts(r).optionsTotal,0));
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
  const total=entries.reduce((v,x)=>v+(x.p.amount??0),0);
  const noOptions=entries.reduce((v,x)=>v+(payWithoutOptions(x.p)??0),0);
  const need=entries.filter(x=>x.p.amount===null).length;
  const shopTotal=entries.reduce((sum,x)=>sum+splitAmounts(x.r).shop,0);
  const optionTotal=entries.reduce((sum,x)=>sum+splitAmounts(x.r).optionsTotal,0);
  const btn=document.createElement("button");btn.type="button";
  btn.className="day";btn.setAttribute("aria-pressed",String(day===selectedDay));
  const top=document.createElement("div");top.className="dayTop";
  const dateLabel=document.createElement("strong");dateLabel.className="dayDate";dateLabel.textContent=day;
  const count=document.createElement("span");count.className="pill";count.textContent=entries.length+"件";
  const arrow=document.createElement("span");arrow.className="dayArrow";arrow.textContent="›";arrow.setAttribute("aria-hidden","true");
  top.append(dateLabel,count);
  if(dayChecks[day]===confirmedSignature(day,entries)){const checked=document.createElement("span");checked.className="confirmedTag";checked.textContent="✓ 確認済み";top.append(checked)}
  top.append(arrow);btn.append(top);
  const stats=document.createElement("div");stats.className="dayStats";
  const line=(label,amount)=>{
   const r=document.createElement("div");r.className="statLine";
   const l=document.createElement("span");l.className="statLabel";l.textContent=label;
   const a=document.createElement("strong");a.textContent=amount;
   r.append(l,a);stats.append(r);
  };
  line("給料",Y(total)+(need?"（要設定"+need+"件）":""));
  line("雑費控除後・オプション除く",Y(noOptions)+(need?" ＋未確定":""));
  const other=document.createElement("div");other.className="muted";
  other.textContent="この日のお店に渡す合計 "+Y(shopTotal)+" ／ オプション "+Y(optionTotal);
  const diary=document.createElement("div");diary.className="muted";
  diary.textContent=Number.isInteger(diaries[day])?"日記"+diaries[day]+"件":"日記未入力";
  stats.append(other,diary);btn.append(stats);
  btn.onclick=()=>{
   selectedDay=day;render();
   // Jump directly from the selected date card to its refreshed details.
   const heading=$("dayTitle");
   heading.setAttribute("tabindex","-1");
   heading.focus({preventScroll:true});
   heading.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});
  };
  host.append(btn);
 }
 $("dayTitle").textContent=selectedDay+" の詳細";
 const detailHost=$("dayDetails");detailHost.replaceChildren();
 const entries=groups.get(selectedDay)||[];
 const dayTotal=entries.reduce((sum,x)=>sum+(x.p.amount??0),0);
 const dayNoOptions=entries.reduce((sum,x)=>sum+(payWithoutOptions(x.p)??0),0);
 const dayBackOptions=entries.reduce((sum,x)=>sum+optionBackInPay(x.p),0);
 const dayShop=entries.reduce((sum,x)=>sum+splitAmounts(x.r).shop,0);
 const dayOptions=entries.reduce((sum,x)=>sum+splitAmounts(x.r).optionsTotal,0);
 const hasPending=entries.some(x=>x.p.amount===null);
 const summary=document.createElement("div");summary.className="c3Summary";
 appendMoneyRow(summary,"今まで通りの給料合計"+(hasPending?"（計算済みのみ）":""),dayTotal,true);
 appendMoneyRow(summary,"雑費控除後の給料（オプション除く）"+(hasPending?" ※":""),
  dayNoOptions,true);
 appendMoneyRow(summary,"給料に含まれるオプションバック",dayBackOptions,true);
 detailHost.append(summary);
 const shopDailyCard=document.createElement("div");shopDailyCard.className="shopDailyTotal";
 const shopDailyLabel=document.createElement("div");shopDailyLabel.className="shopDailyLabel";shopDailyLabel.textContent="この日のお店に渡す合計（"+entries.length+"件分）";
 const shopDailyValue=document.createElement("strong");shopDailyValue.textContent=Y(dayShop);
 const shopDailyNote=document.createElement("p");shopDailyNote.className="noteFine";
 shopDailyNote.textContent="コース料金＋延長料金＋指名料＋交通費。下にある各予約の「お店に渡す分」をすべて合計しています。オプション代は含みません。";
 shopDailyCard.append(shopDailyLabel,shopDailyValue,shopDailyNote);detailHost.append(shopDailyCard);
 const hint=document.createElement("p");hint.className="noteFine";
 hint.textContent="※ 給料は保存済みのバック率・日記投稿数で計算。オプションを除く給料＝今までの給料−給料に含まれるオプションバック。お店に渡す分とは別です。";
 detailHost.append(hint);
 const dayConfirmed=dayChecks[selectedDay]===confirmedSignature(selectedDay,entries);
 const confirmation=document.createElement("div");confirmation.className="salaryConfirm";
 const confirmationText=document.createElement("div");confirmationText.className="salaryConfirmTitle";
 confirmationText.textContent=dayConfirmed?"✓ この日は確認済み":"この日の会計・給料を確認";
 const confirmationButton=document.createElement("button");confirmationButton.type="button";
 confirmationButton.className=dayConfirmed?"confirmButton confirmed":"confirmButton";
 confirmationButton.textContent=dayConfirmed?"確認済みを解除":"確認済みにする";
 confirmationButton.onclick=()=>toggleDayCheck(selectedDay,entries);
 const checkMessage=document.createElement("p");checkMessage.id="checkMessage";checkMessage.className="muted";checkMessage.setAttribute("role","status");
 if(dayChecks[selectedDay]&&!dayConfirmed)checkMessage.textContent="確認後に記録や計算が変わりました。再確認してください。";
 confirmation.append(confirmationText,confirmationButton,checkMessage);detailHost.append(confirmation);
 const moneySummary=document.createElement("div");moneySummary.className="dayGroupSummary";
 const moneyTitle=document.createElement("strong");moneyTitle.textContent="この日のお金の受け渡し";moneySummary.append(moneyTitle);
 appendMoneyRow(moneySummary,"お店に渡す分・この日合計（"+entries.length+"件）",dayShop,true);
 appendMoneyRow(moneySummary,"自分で受け取るオプション代（お客様の支払額）",dayOptions,true);
 detailHost.append(moneySummary);
 for(const {r,p} of entries){
  const item=document.createElement("div");item.className="item";
  const line=document.createElement("div");line.className="flex";
  const name=document.createElement("strong");name.textContent=r.store+"｜"+r.course+"分 "+r.mode;
  const pay=document.createElement("span");pay.className="big";pay.textContent=p.amount===null?"要設定":Y(p.amount);
  line.append(name,pay);item.append(line);
  const sub=document.createElement("div");sub.className="muted";
  sub.textContent="会計 "+Y(n(r.total))+"／"+(r.area||"")+(r.hotelName?"／ホテル："+r.hotelName:"");
  item.append(sub);
  const split=splitAmounts(r);
  appendAmountGroup(item,"この予約のお店に渡す分",[
   ["コース料金",split.course],
   ["延長料金",split.extension],
   ["指名料",split.nomination],
   [r.hotelName?"交通費（"+r.hotelName+"）":"交通費",split.travel]
  ],split.shop);
  appendAmountGroup(item,"自分で受け取るオプション代",
   split.options.map(o=>[o.name,o.amount]),split.optionsTotal,true);
  if(p.missing.length){
   const warning=document.createElement("div");warning.className="warn";
   warning.textContent="要確認："+p.missing.join("・");item.append(warning);
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
   inp.dataset.back=mode+"|"+min;
   const shared3P=mode==="3P"&&(shop==="NEXUS"||shop==="もし亀");
   const value=shared3P?rule.courseBack["通常|"+min]:rule.courseBack[inp.dataset.back];
   inp.value=blank(value)?"":String(value);
   inp.placeholder=shared3P?"通常と同じ":"未確認";
   if(shared3P){inp.disabled=true;inp.title="3Pのバックは通常コースと同じ金額を自動適用します。"}
   td.append(inp);tr.append(td);body.append(tr);
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
  if(inp.disabled)continue;
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
  await setDoc(doc(db,"users",user.uid,"salaryDiary",day),{count:value,updatedAt:serverTimestamp()},{merge:true});
  diaries[day]=value;render();setStatus("diaryMessage","日記件数を保存しました。");
 }catch(e){setStatus("diaryMessage",authError(e),true)}
}
function cleanup(){
 for(const unsub of unsubs){try{unsub()}catch{}}
 unsubs=[];records=[];diaries={};dayChecks={};overrides={};selectedDay="";
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
  dayChecks=Object.fromEntries(s.docs.map(d=>[d.id,d.data().checkedSignature]).filter(([day,v])=>/^\d{4}-\d\d-\d\d$/.test(day)&&typeof v==="string"&&v));
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
