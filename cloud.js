import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_recBEQb3-_zSX7csc2eDpovdMFCBnWw",
  authDomain: "kaikei-kyuryo-e6479.firebaseapp.com",
  projectId: "kaikei-kyuryo-e6479",
  storageBucket: "kaikei-kyuryo-e6479.firebasestorage.app",
  messagingSenderId: "928238559312",
  appId: "1:928238559312:web:5b5d4d2a4e89955f1db155"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const loginButton = document.getElementById("cloudLogin");
const logoutButton = document.getElementById("cloudLogout");
const syncButton = document.getElementById("cloudSync");
const statusElement = document.getElementById("cloudStatus");
const DELETED_KEY = "tenpo_kaikei_cloud_deleted_ids_v1";
const OWNER_UID_KEY = "tenpo_kaikei_cloud_owner_uid_v1";
let currentUser = null;
let unsubscribe = null;
let hotelWatchUnsubscribe = null;
let syncing = false;

function status(message, error=false) {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.style.color = error ? "#a23630" : "#746a5d";
}
function bridge() { return window.kaikeiCloudBridge; }
function getDeletedIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(id=>typeof id==="string") : [];
  } catch { return []; }
}
function rememberDeletedId(id) {
  const ids = new Set(getDeletedIds());
  ids.add(id);
  localStorage.setItem(DELETED_KEY, JSON.stringify([...ids].slice(-10000)));
}
function storeDeletedIds(ids) {
  const all = new Set([...getDeletedIds(), ...ids]);
  localStorage.setItem(DELETED_KEY, JSON.stringify([...all].slice(-10000)));
}
function recordsCollection() {
  return collection(db, "users", currentUser.uid, "accountingRecords");
}
function recordDoc(id) {
  return doc(db, "users", currentUser.uid, "accountingRecords", id);
}
function hotelKey(name) {
  return String(name||"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
}
function hotelCollection() {
  return collection(db,"users",currentUser.uid,"hotelTravel");
}
function hotelDoc(name) {
  return doc(db,"users",currentUser.uid,"hotelTravel",encodeURIComponent(hotelKey(name)));
}
function validHotel(h) {
  return !!h && typeof h.name==="string" && h.name.trim().length>0 &&
    typeof h.travel==="number" && Number.isFinite(h.travel) && h.travel>=0 && h.travel<=999999;
}
async function saveHotel(hotel) {
  if (!currentUser || !validHotel(hotel)) return false;
  try {
    await setDoc(hotelDoc(hotel.name),{
      name:hotel.name,travel:hotel.travel,
      address:hotel.address||"",
      areaName:hotel.areaName||"",areaGroup:hotel.areaGroup||"",
      updatedAt:hotel.updatedAt||Date.now()
    });
    return true;
  } catch(e) {
    status("ホテル交通費のクラウド保存に失敗しました。端末の登録は残っています。 "+friendlyError(e),true);
    return false;
  }
}
function startHotelSync(userId) {
  if(hotelWatchUnsubscribe){hotelWatchUnsubscribe();hotelWatchUnsubscribe=null}
  if(!currentUser || !bridge() || !window.kaikeiHotelBridge)return;
  hotelWatchUnsubscribe=onSnapshot(hotelCollection(), snapshot=>{
    if(!currentUser || currentUser.uid!==userId) return;
    const remote=[];
    const cloud=new Map();
    snapshot.forEach(entry=>{
      const h=entry.data();
      if(validHotel(h)){remote.push(h);cloud.set(hotelKey(h.name),h)}
    });
    const hotelBridge=window.kaikeiHotelBridge;
    hotelBridge.merge(remote);
    for(const h of hotelBridge.get()){
      const previous=cloud.get(hotelKey(h.name));
      if(!previous || (h.updatedAt||0)>(previous.updatedAt||0)){
        saveHotel(h).catch(()=>{});
      }
    }
  },e=>status("ホテル交通費を同期できませんでした。 "+friendlyError(e),true));
}
function friendlyError(e) {
  const code = String(e && e.code || "");
  if (code.includes("unauthorized-domain")) return "Firebaseの「承認済みドメイン」に homayu0130-beep.github.io を追加してください。";
  if (code.includes("operation-not-allowed")) return "Firebase AuthenticationでGoogleログインを有効にしてください。";
  if (code.includes("permission-denied")) return "Firestoreのルールが保存されているか確認してください。";
  if (code.includes("popup-closed")) return "Googleログインがキャンセルされました。";
  if (code.includes("network")) return "通信を確認してください。端末内の会計履歴は残っています。";
  return "クラウドの処理に失敗しました（" + (code || "通信・設定を確認") + "）。端末内の記録は残っています。";
}
function setButtons(active) {
  if (loginButton) loginButton.classList.toggle("hidden", active);
  if (logoutButton) logoutButton.classList.toggle("hidden", !active);
  if (syncButton) syncButton.classList.toggle("hidden", !active);
}

async function upsertRecord(record) {
  if (!currentUser) return false;
  try {
    await setDoc(recordDoc(record.id), {
      deleted: false,
      record: JSON.parse(JSON.stringify(record)),
      updatedAt: serverTimestamp()
    });
    status("クラウドにも保存しました。");
    return true;
  } catch (e) {
    status(friendlyError(e), true);
    return false;
  }
}
async function tombstoneRecord(id) {
  rememberDeletedId(id);
  if (!currentUser) return false;
  try {
    await setDoc(recordDoc(id), {deleted:true, deletedAt:serverTimestamp()});
    status("クラウドの会計履歴も削除しました。");
    return true;
  } catch (e) {
    status(friendlyError(e), true);
    return false;
  }
}
function unpackSnapshot(snapshot) {
  const remote = [], deleted = [], known = new Set();
  snapshot.forEach(entry=>{
    known.add(entry.id);
    const val = entry.data();
    if (val.deleted) {
      deleted.push(entry.id);
    } else if (val.record && val.record.id === entry.id &&
      typeof val.record.date==="string" && typeof val.record.store==="string") {
      remote.push(val.record);
    }
  });
  return { remote, deleted, known };
}
async function synchronize() {
  if (!currentUser || syncing || !bridge()) return;
  syncing = true;
  const uid = currentUser.uid;
  status("会計履歴を同期しています…");
  if (syncButton) syncButton.disabled = true;
  try {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const snapshot = await getDocs(recordsCollection());
    if (!currentUser || uid!==currentUser.uid) return;
    const cloud = unpackSnapshot(snapshot);
    storeDeletedIds(cloud.deleted);
    bridge().merge(cloud.remote, getDeletedIds());
    const deletedIds = getDeletedIds();
    const deletedSet = new Set(deletedIds);
    const missing = bridge().get().filter(item =>
      item && item.id && !cloud.known.has(item.id) && !deletedSet.has(item.id));
    const missingDeletes = deletedIds.filter(id => !cloud.deleted.includes(id));
    let failures=0;
    const work=[
      ...missing.map(record=>()=>setDoc(recordDoc(record.id),{deleted:false,record:JSON.parse(JSON.stringify(record)),updatedAt:serverTimestamp()})),
      ...missingDeletes.map(id=>()=>setDoc(recordDoc(id),{deleted:true,deletedAt:serverTimestamp()}))
    ];
    for (let i=0; i<work.length; i+=10) {
      const results=await Promise.allSettled(work.slice(i,i+10).map(fn=>fn()));
      failures+=results.filter(r=>r.status==="rejected").length;
    }
    if (!currentUser || uid!==currentUser.uid) return;
    if (failures) {
      status("一部の記録が同期できませんでした。再同期してください。",true);
    } else {
      status("Googleログイン中・会計履歴の自動同期が有効です。");
    }
    unsubscribe = onSnapshot(recordsCollection(), snap=>{
      if (!currentUser || uid!==currentUser.uid) return;
      const cloudNow=unpackSnapshot(snap);
      storeDeletedIds(cloudNow.deleted);
      bridge().merge(cloudNow.remote,getDeletedIds());
    }, e=>status(friendlyError(e),true));
  } catch (e) {
    status(friendlyError(e), true);
  } finally {
    syncing=false;
    if (syncButton) syncButton.disabled=false;
  }
}
window.kaikeiCloud = {
  saveRecord: upsertRecord,
  removeRecord: tombstoneRecord,
  saveHotel,
  synchronize
};
if (loginButton) loginButton.addEventListener("click",async()=>{
  loginButton.disabled=true;
  try {
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:"select_account"});
    await signInWithPopup(auth, provider);
  } catch(e) {
    status(friendlyError(e),true);
  } finally {loginButton.disabled=false;}
});
if (logoutButton) logoutButton.addEventListener("click",()=>{
  signOut(auth).catch(e=>status(friendlyError(e),true));
});
if (syncButton) syncButton.addEventListener("click",synchronize);
onAuthStateChanged(auth,async user=>{
  if (unsubscribe) {unsubscribe();unsubscribe=null;}
  if (hotelWatchUnsubscribe) {hotelWatchUnsubscribe();hotelWatchUnsubscribe=null;}
  currentUser=null;
  if (!user) {
    setButtons(false);
    status("クラウド未接続。会計履歴はこの端末に保存されます。");
    return;
  }
  const lockedUid=localStorage.getItem(OWNER_UID_KEY);
  if (lockedUid && lockedUid!==user.uid) {
    status("この端末は別のGoogleアカウントで登録済みです。元のアカウントでログインしてください。",true);
    await signOut(auth);
    return;
  }
  if (!lockedUid) localStorage.setItem(OWNER_UID_KEY,user.uid);
  currentUser=user;
  setButtons(true);
  status("Googleアカウントを確認しました。同期しています…");
  startHotelSync(user.uid);
  await synchronize();
},e=>status(friendlyError(e),true));
