/* =========================================================
   노은 — app.js
   정해진 영역(이미지 슬라이드 · 음악 · 디데이 · 방명록 · 캘린더 · 갤러리 ·
   문서 정리 · 세션카드 · 체크보드)이 항상 같은 구성으로 보이도록
   각각 고정 렌더 함수로 관리함. 위젯 제목은 전부 없음(애플 위젯 스타일),
   사이트 이름/잠금/테마 버튼은 배너 하단에 통합되어 있음.
   ========================================================= */

let editMode = sessionStorage.getItem('gh_edit') === '1';

const lockBtn = document.getElementById('lockBtn');
const lockBadge = document.getElementById('lockBadge');
const siteNameEl = document.getElementById('siteName');
const modalRoot = document.getElementById('modalRoot');
const siteBannerEl = document.getElementById('siteBanner');
const bgImageLayerEl = document.getElementById('bgImageLayer');
const bannerEditBtn = document.getElementById('bannerEditBtn');
const bgEditBtn = document.getElementById('bgEditBtn');
const globalStyleBtn = document.getElementById('globalStyleBtn');

/* ---------------- 설정 미완료 안내 ---------------- */

if (typeof FIREBASE_NOT_CONFIGURED !== 'undefined' && FIREBASE_NOT_CONFIGURED) {
  const banner = document.createElement('div');
  banner.style.cssText = 'background:#f4d9d9;color:#7a2b2b;padding:12px 20px;font-size:.85rem;text-align:center;position:sticky;top:0;z-index:999;';
  banner.innerHTML = '⚠️ 아직 firebase-config.js에 실제 Firebase 값을 넣지 않았어요. 설정가이드.md의 ①②단계를 먼저 완료해주세요. (지금은 저장이 되지 않아요)';
  document.body.prepend(banner);
}

/* ---------------- 공통 유틸 ---------------- */

function docRef(name){ return db.collection('content').doc(name); }

function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 1800);
}

async function sha256(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function openModal(innerHtml, onMount, extraClass){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal${extraClass ? ' ' + extraClass : ''}">${innerHtml}</div>`;
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closeModal(); });
  modalRoot.innerHTML = '';
  modalRoot.appendChild(overlay);
  if(onMount) onMount(overlay.querySelector('.modal'));
}
function closeModal(){ modalRoot.innerHTML = ''; }

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

/* 이미지 슬라이드/갤러리에서 공통으로 쓰는 확대보기 팝업.
   cfg = {
     items,             // 정규화된 아이템 배열 (이 팝업 안에서 좌우로 넘겨볼 목록)
     index,             // 시작 인덱스
     resolve(item, onReady), // item -> 표시할 url. 청크 저장이라 아직 없으면 null을 반환하고, 다 불러오면 onReady()로 다시 그림
     onDelete(idx),     // 있으면 삭제 버튼 표시. idx의 사진을 지우는 함수
     meta(item),        // 있으면 {title, desc} 반환 — 사진 아래 정보로 표시
     onEditMeta(idx)     // 있으면 "정보 편집" 버튼 표시 — 눌렀을 때 호출
   }
   화살표 버튼/키보드 ←→로 같은 목록 안에서 트위터처럼 옆 사진으로 바로 넘어갈 수 있음 */
function openImageLightbox(cfg){
  const items = cfg.items.slice();
  let index = cfg.index || 0;

  function render(){
    if(items.length === 0){ closeModal(); return; }
    if(index >= items.length) index = items.length - 1;
    if(index < 0) index = 0;
    const item = items[index];
    const url = cfg.resolve(item, render);
    const metaInfo = cfg.meta ? cfg.meta(item) : null;
    const showNav = items.length > 1;
    openModal(`
      <div class="lightbox-body">
        ${url ? `<img src="${escapeHtml(url)}" class="lightbox-img">` : `<div class="lightbox-loading">불러오는 중…</div>`}
        ${showNav ? `<button class="lightbox-nav prev" id="lbPrev" title="이전 사진">‹</button><button class="lightbox-nav next" id="lbNext" title="다음 사진">›</button>` : ''}
        ${showNav ? `<div class="lightbox-count">${index+1} / ${items.length}</div>` : ''}
      </div>
      ${metaInfo && (metaInfo.title || metaInfo.desc) ? `
        <div class="lightbox-meta">
          ${metaInfo.title ? `<div class="lightbox-meta-title">${escapeHtml(metaInfo.title)}</div>` : ''}
          ${metaInfo.desc ? `<div class="lightbox-meta-desc">${escapeHtml(metaInfo.desc)}</div>` : ''}
        </div>` : ''}
      <div class="modal-actions">
        ${cfg.onEditMeta ? `<button class="btn ghost" id="editMeta">${metaInfo && (metaInfo.title || metaInfo.desc) ? '정보 수정' : '정보 추가'}</button>` : ''}
        ${cfg.onDelete ? `<button class="btn danger" id="del">삭제</button>` : ''}
        <button class="btn ghost" id="c">닫기</button>
      </div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      if(url) attachImgFallback(m.querySelector('img'));
      if(cfg.onDelete) m.querySelector('#del').onclick = async ()=>{
        await cfg.onDelete(index);
        items.splice(index,1);
        render();
      };
      if(cfg.onEditMeta) m.querySelector('#editMeta').onclick = ()=> cfg.onEditMeta(index);
      const prevBtn = m.querySelector('#lbPrev');
      const nextBtn = m.querySelector('#lbNext');
      if(prevBtn) prevBtn.onclick = ()=>{ index = (index - 1 + items.length) % items.length; render(); };
      if(nextBtn) nextBtn.onclick = ()=>{ index = (index + 1) % items.length; render(); };
    }, 'modal-lightbox');
  }

  const onKey = (e)=>{
    if(!modalRoot.querySelector('.modal-lightbox')) return;
    if(e.key === 'ArrowLeft' && items.length > 1){ index = (index - 1 + items.length) % items.length; render(); }
    else if(e.key === 'ArrowRight' && items.length > 1){ index = (index + 1) % items.length; render(); }
    else if(e.key === 'Escape'){ closeModal(); }
  };
  document.addEventListener('keydown', onKey);
  const mo = new MutationObserver(()=>{
    if(!modalRoot.querySelector('.modal-lightbox')){
      document.removeEventListener('keydown', onKey);
      mo.disconnect();
    }
  });
  mo.observe(modalRoot, { childList:true });

  render();
}

/* 갤러리 사진 타일을 드래그로 끌어서 순서 바꾸기 (편집모드에서만 동작) */
function bindPinDragReorder(container, tileSelector, getItems, saveItems){
  if(!editMode) return;
  let dragIdx = null;
  container.querySelectorAll(tileSelector).forEach(el=>{
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', e=>{
      if(e.target.closest('button')){ e.preventDefault(); return; }
      dragIdx = Number(el.dataset.idx);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try{ e.dataTransfer.setData('text/plain', String(dragIdx)); }catch(_){}
    });
    el.addEventListener('dragend', ()=>{
      el.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(x=> x.classList.remove('drag-over'));
      dragIdx = null;
    });
    el.addEventListener('dragover', e=>{
      if(dragIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.drag-over').forEach(x=>{ if(x!==el) x.classList.remove('drag-over'); });
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', ()=> el.classList.remove('drag-over'));
    el.addEventListener('drop', async e=>{
      e.preventDefault();
      el.classList.remove('drag-over');
      const targetIdx = Number(el.dataset.idx);
      const srcIdx = dragIdx;
      dragIdx = null;
      if(srcIdx === null || srcIdx === targetIdx) return;
      const arr = getItems();
      const [moved] = arr.splice(srcIdx, 1);
      arr.splice(targetIdx, 0, moved);
      await saveItems(arr);
    });
  });
}

/* imgur 공유 페이지 링크(예: imgur.com/xxxxx)는 실제 이미지 파일이 아니라 HTML 페이지라
   <img>에 넣으면 깨짐. 직접 이미지 주소(i.imgur.com/xxxxx.jpg)로 자동 변환해줌. */
function normalizeImageUrl(url){
  if(!url) return url;
  url = url.trim();
  const m = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/(?!a\/|gallery\/|t\/)([a-zA-Z0-9]+)(?:[.?#].*)?$/i);
  if(m) return `https://i.imgur.com/${m[1]}.jpg`;
  return url;
}

/* 확장자를 정확히 몰라도(.jpg로 변환했는데 실제로는 png/gif인 경우 등) 로딩에 실패하면
   다른 확장자로 자동 재시도. i.imgur.com 주소에만 적용됨 */
function attachImgFallback(imgEl){
  if(!imgEl) return;
  const src = imgEl.getAttribute('src') || '';
  const m = src.match(/^(https:\/\/i\.imgur\.com\/[a-zA-Z0-9]+)\.[a-zA-Z]+$/i);
  if(!m) return;
  const exts = ['jpg','jpeg','png','gif','webp'];
  let tries = 0;
  imgEl.addEventListener('error', function handler(){
    tries++;
    if(tries < exts.length){ imgEl.src = `${m[1]}.${exts[tries]}`; }
    else{ imgEl.removeEventListener('error', handler); }
  });
}

/* 배너/배경은 <img>가 아니라 CSS background-image라 위 방식이 안 통해서, 미리 로드 테스트 후 적용.
   el에 배경으로 넣고 싶은 대상 엘리먼트를 넘김 (배너, 전체 배경 레이어 등 공용으로 사용) */
function setElementBgImageWithFallback(el, url){
  if(!el || !url) return;
  const m = url.match(/^(https:\/\/i\.imgur\.com\/[a-zA-Z0-9]+)\.[a-zA-Z]+$/i);
  if(!m){ el.style.backgroundImage = `url('${url}')`; return; }
  el.style.backgroundImage = `url('${url}')`; // 우선 낙관적으로 적용
  const exts = ['jpg','jpeg','png','gif','webp'];
  let i = 0;
  const tryNext = ()=>{
    if(i >= exts.length) return;
    const testUrl = `${m[1]}.${exts[i]}`;
    const testImg = new Image();
    testImg.onload = ()=>{ el.style.backgroundImage = `url('${testUrl}')`; };
    testImg.onerror = ()=>{ i++; tryNext(); };
    testImg.src = testUrl;
  };
  tryNext();
}

function extractYouTubeId(url){
  if(!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* 사진을 화면에서 바로 올릴 수 있도록 브라우저에서 리사이즈+압축 후 base64로 변환.
   Firestore 문서 1건당 최대 1MB라서, 별도 유료 스토리지 없이 쓰려면 이렇게 줄여서 저장해야 함. */
function compressImageFile(file, maxDim=1600, maxBytes=700000, gifMaxBytes=700000){
  return new Promise((resolve, reject)=>{
    // GIF는 캔버스로 다시 그리면 첫 프레임만 남고 움직임이 사라져버려서,
    // 압축(리사이즈)을 건너뛰고 원본 그대로 base64로 저장해 애니메이션을 보존함.
    // 사진용 압축 목표치(maxBytes)는 GIF에 쓰기엔 너무 작아서(예: 260KB) 대부분의
    // 움직이는 GIF가 거절됐었음 — GIF는 별도의 더 넉넉한 한도(gifMaxBytes)를 씀.
    if(file.type === 'image/gif'){
      if(file.size > gifMaxBytes){
        reject(new Error(`GIF 용량이 너무 커요(최대 약 ${Math.round(gifMaxBytes/1024)}KB). 더 작은 GIF를 쓰거나, URL 방식(Giphy/Tenor/imgur 등)을 이용해주세요.`));
        return;
      }
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = ()=> reject(new Error('파일을 읽지 못했어요'));
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let { width, height } = img;
        if(width > height && width > maxDim){ height = Math.round(height * (maxDim/width)); width = maxDim; }
        else if(height >= width && height > maxDim){ width = Math.round(width * (maxDim/height)); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while(dataUrl.length > maxBytes * 1.37 && quality > 0.25){
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = ()=> reject(new Error('이미지를 불러오지 못했어요'));
      img.src = reader.result;
    };
    reader.onerror = ()=> reject(new Error('파일을 읽지 못했어요'));
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.onerror = ()=> reject(new Error('파일을 읽지 못했어요'));
    reader.readAsDataURL(file);
  });
}

/* ---------------- 큰 파일(문서/PDF) 청크 저장 ----------------
   Firestore는 문서 1개당 1MB 제한이 있어서, 큰 파일은 하나의 문서에
   통째로 못 넣음. 그래서 base64 문자열을 잘게 잘라 fileChunks 컬렉션에
   여러 문서로 나눠 저장하고, 카드에는 이 조각들을 다시 찾을 수 있는
   fileId/chunkTotal만 남겨둠(파이어 스토리지 없이 파이어스토어만으로 해결). */
const CHUNK_SIZE = 700000; // 조각 하나당 글자 수 (문서 1MB 제한에 여유있게 안전한 크기)

function splitIntoChunks(str, size){
  const out = [];
  for(let i=0; i<str.length; i+=size) out.push(str.slice(i, i+size));
  return out;
}

async function saveFileChunked(base64DataUrl){
  const fileId = uid();
  const chunks = splitIntoChunks(base64DataUrl, CHUNK_SIZE);
  const batch = db.batch();
  chunks.forEach((chunk, i)=>{
    batch.set(db.collection('fileChunks').doc(`${fileId}_${i}`), { fileId, index: i, data: chunk });
  });
  await batch.commit();
  return { fileId, total: chunks.length };
}

async function loadFileChunked(fileId, total){
  const snaps = await Promise.all(
    Array.from({ length: total }, (_, i)=> db.collection('fileChunks').doc(`${fileId}_${i}`).get())
  );
  return snaps.map(s=> (s.exists ? s.data().data : '')).join('');
}

async function deleteFileChunked(fileId, total){
  const batch = db.batch();
  for(let i=0; i<total; i++){
    batch.delete(db.collection('fileChunks').doc(`${fileId}_${i}`));
  }
  await batch.commit();
}

/* base64 데이터 URL을 Blob으로 바꿔서 새 탭에 열어줌.
   큰 파일을 data: URL 그대로 window.open에 넘기면 브라우저별 주소 길이
   제한에 걸릴 수 있어서, 실제 파일처럼 동작하는 Blob 주소로 변환해서 씀. */
function openDataUrlAsBlob(dataUrl){
  const commaIdx = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(()=> URL.revokeObjectURL(url), 60000);
}

/* ---------------- 잠금 / 편집모드 ---------------- */

function refreshLockUI(){
  document.body.classList.toggle('edit-mode', editMode);
  siteNameEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  bannerEditBtn.style.display = editMode ? 'inline-flex' : 'none';
  bgEditBtn.style.display = editMode ? 'inline-flex' : 'none';
  document.getElementById('checklistAddWrap').style.display = editMode ? 'flex' : 'none';
  lockBadge.textContent = editMode ? '🔓 편집 가능' : '🔒 보기 전용';
  lockBadge.classList.toggle('unlocked', editMode);
  lockBtn.textContent = editMode ? '잠그기' : '잠금 해제';
}

function renderAllModules(){
  renderImages(); renderMusic(); renderDday(); renderGuestbook();
  renderCalendar(); renderGallery(); renderGallery2(); renderRefGallery(); renderDocs(); renderSessions(); renderChecklist();
}

lockBtn.addEventListener('click', async ()=>{
  if(editMode){
    editMode = false;
    sessionStorage.removeItem('gh_edit');
    refreshLockUI();
    renderAllModules();
    return;
  }
  let lockDoc;
  try{
    lockDoc = await db.collection('meta').doc('lock').get();
  }catch(err){
    console.error(err);
    toast('저장소 연결에 실패했어요. firebase-config.js 설정을 확인해주세요.');
    return;
  }
  if(!lockDoc.exists){
    openModal(`
      <h3>편집 비밀번호 설정</h3>
      <p style="font-size:.8rem;color:var(--ink-soft)">이 갠홈을 처음 여셨네요. 앞으로 사용할 편집 비밀번호를 정해주세요. 이 비밀번호를 아는 사람만 내용을 수정할 수 있어요.</p>
      <label>비밀번호</label>
      <input type="password" id="pwSet1">
      <label>비밀번호 확인</label>
      <input type="password" id="pwSet2">
      <div class="modal-actions">
        <button class="btn ghost" id="pwCancel">취소</button>
        <button class="btn primary" id="pwSave">설정하고 시작</button>
      </div>
    `, (m)=>{
      m.querySelector('#pwCancel').onclick = closeModal;
      m.querySelector('#pwSave').onclick = async ()=>{
        const p1 = m.querySelector('#pwSet1').value;
        const p2 = m.querySelector('#pwSet2').value;
        if(!p1 || p1.length < 4){ toast('4자 이상 입력해주세요'); return; }
        if(p1 !== p2){ toast('비밀번호가 서로 달라요'); return; }
        const hash = await sha256(p1);
        await db.collection('meta').doc('lock').set({ passwordHash: hash });
        editMode = true;
        sessionStorage.setItem('gh_edit','1');
        refreshLockUI(); renderAllModules(); closeModal();
        toast('편집 모드가 시작됐어요');
      };
    });
    return;
  }
  openModal(`
    <h3>편집 비밀번호 입력</h3>
    <input type="password" id="pwEnter" placeholder="비밀번호">
    <div class="modal-actions">
      <button class="btn ghost" id="pwCancel">취소</button>
      <button class="btn primary" id="pwOk">확인</button>
    </div>
  `, (m)=>{
    const input = m.querySelector('#pwEnter');
    input.focus();
    const submit = async ()=>{
      const hash = await sha256(input.value);
      if(hash === lockDoc.data().passwordHash){
        editMode = true;
        sessionStorage.setItem('gh_edit','1');
        refreshLockUI(); renderAllModules(); closeModal();
        toast('편집 모드로 전환됐어요');
      } else {
        toast('비밀번호가 일치하지 않아요');
      }
    };
    m.querySelector('#pwOk').onclick = submit;
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
    m.querySelector('#pwCancel').onclick = closeModal;
  });
});

siteNameEl.addEventListener('blur', ()=>{
  if(!editMode) return;
  db.collection('meta').doc('site').set({ name: siteNameEl.textContent.trim() || '노은' }, {merge:true});
});
db.collection('meta').doc('site').onSnapshot(doc=>{
  if(doc.exists && doc.data().name && document.activeElement !== siteNameEl){ siteNameEl.textContent = doc.data().name; }
});

/* ---------------- 배너 (항상 최상단 고정) ---------------- */

bannerEditBtn.addEventListener('click', async ()=>{
  const doc = await db.collection('meta').doc('banner').get();
  const cur = doc.exists ? doc.data() : {};
  const curIsUrl = cur.image && !cur.image.startsWith('data:');
  openModal(`
    <h3>배너 편집</h3>
    <label>배너 사진 올리기 (기기에서 바로 선택)</label>
    <input type="file" id="bImgFile" accept="image/*">
    <p class="hint">기기의 사진을 바로 선택하면 화면에 맞게 자동으로 압축해서 저장해요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="bImg" placeholder="https://..." value="${curIsUrl ? cur.image : ''}">
    <p class="hint">imgbb.com, postimages.org 등에 올린 "직접 링크" 주소를 붙여넣어도 돼요. 위에서 사진을 선택하면 이 URL 입력은 무시돼요.</p>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const file = m.querySelector('#bImgFile').files[0];
      let image = normalizeImageUrl(m.querySelector('#bImg').value.trim());
      if(file){
        saveBtn.disabled = true;
        saveBtn.textContent = '사진 처리 중…';
        try{
          image = await compressImageFile(file);
        }catch(err){
          toast(err.message || '이미지를 처리하지 못했어요');
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          return;
        }
      } else if(!image){
        image = cur.image || '';
      }
      await db.collection('meta').doc('banner').set({ image }, {merge:true});
      closeModal();
      toast('배너를 저장했어요');
    };
  });
});

db.collection('meta').doc('banner').onSnapshot(doc=>{
  if(!doc.exists) return;
  const d = doc.data();
  if(d.image) setElementBgImageWithFallback(siteBannerEl, d.image);
});

/* ---------------- 홈페이지 전체 배경 이미지 (배너와 별개) ---------------- */

bgEditBtn.addEventListener('click', async ()=>{
  const doc = await db.collection('meta').doc('background').get();
  const cur = doc.exists ? doc.data() : {};
  const curIsUrl = cur.image && !cur.image.startsWith('data:');
  openModal(`
    <h3>홈페이지 배경 이미지</h3>
    <p class="hint">배너와는 별개로, 사이트 전체 뒤에 깔리는 배경이에요. 위젯들이 반투명 유리 카드라 배경이 은은하게 비쳐 보여요.</p>
    <label>배경 사진 올리기 (기기에서 바로 선택)</label>
    <input type="file" id="bgImgFile" accept="image/*">
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="bgImg" placeholder="https://..." value="${curIsUrl ? cur.image : ''}">
    <div class="modal-actions">
      <button class="btn danger" id="rm" type="button">배경 사진 없애기</button>
      <button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button>
    </div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#rm').onclick = async ()=>{
      await db.collection('meta').doc('background').set({ image:'' }, {merge:true});
      closeModal();
      toast('배경 사진을 없앴어요');
    };
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const file = m.querySelector('#bgImgFile').files[0];
      let image = normalizeImageUrl(m.querySelector('#bgImg').value.trim());
      if(file){
        saveBtn.disabled = true;
        saveBtn.textContent = '사진 처리 중…';
        try{
          image = await compressImageFile(file, 1920, 700000);
        }catch(err){
          toast(err.message || '이미지를 처리하지 못했어요');
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          return;
        }
      } else if(!image){
        image = cur.image || '';
      }
      await db.collection('meta').doc('background').set({ image }, {merge:true});
      closeModal();
      toast('배경 이미지를 저장했어요');
    };
  });
});

db.collection('meta').doc('background').onSnapshot(doc=>{
  const d = doc.exists ? doc.data() : {};
  if(d.image){
    setElementBgImageWithFallback(bgImageLayerEl, d.image);
    bgImageLayerEl.classList.add('has-image');
  } else {
    bgImageLayerEl.style.backgroundImage = '';
    bgImageLayerEl.classList.remove('has-image');
  }
});

/* ---------------- 테마 편집 (전체 색/폰트 일괄 적용) ---------------- */

/* <input type=color>는 알파(투명도)를 다룰 수 없어서, 카드 배경색은
   "색상(hex) + 투명도(슬라이더)"를 따로 받아 rgba()로 합성함.
   이렇게 해야 사용자가 테마를 바꿔도 유리카드 특유의 반투명함이 유지됨. */
function hexToRgba(hex, alpha){
  const h = (hex||'#20141d').replace('#','');
  const full = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
  const bigint = parseInt(full, 16) || 0;
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function parseColorToHexAlpha(str){
  if(!str) return {hex:'#20141d', alpha:.38};
  str = str.trim();
  const rgbaMatch = str.match(/rgba?\(([^)]+)\)/);
  if(rgbaMatch){
    const parts = rgbaMatch[1].split(',').map(s=>s.trim());
    const r = Math.max(0, Math.min(255, Math.round(parseFloat(parts[0])||0)));
    const g = Math.max(0, Math.min(255, Math.round(parseFloat(parts[1])||0)));
    const b = Math.max(0, Math.min(255, Math.round(parseFloat(parts[2])||0)));
    const a = parts.length>3 ? parseFloat(parts[3]) : 1;
    const hex = '#' + [r,g,b].map(x=> x.toString(16).padStart(2,'0')).join('');
    return {hex, alpha: isNaN(a) ? 1 : a};
  }
  if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(str)) return {hex:str, alpha:1};
  return {hex:'#20141d', alpha:.38};
}

const THEME_VARS = ['--rose','--sage','--gold','--paper','--card-bg','--card-bg2','--ink'];
const FONT_DISPLAY_OPTIONS = ['ZEN SERIF','Song Myung','Noto Serif KR','Nanum Myeongjo','Gowun Batang'];
const FONT_BODY_OPTIONS = ['ZEN SERIF','Noto Sans KR','Gowun Dodum'];
const CUSTOM_FONT_MAX_BYTES = 500000;

function injectCustomFontFace(srcDecl){
  let styleTag = document.getElementById('customFontFace');
  if(!styleTag){
    styleTag = document.createElement('style');
    styleTag.id = 'customFontFace';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = srcDecl
    ? `@font-face{ font-family:'CustomUserFont'; src:${srcDecl}; font-weight:400; font-style:normal; font-display:swap; }`
    : '';
}

function applyTheme(theme){
  if(!theme) return;
  THEME_VARS.forEach(v=>{
    const key = v.replace('--','');
    if(theme[key]) document.documentElement.style.setProperty(v, theme[key]);
  });
  if(theme.customFontData){
    injectCustomFontFace(`url(${theme.customFontData}) format('truetype')`);
    document.documentElement.style.setProperty('--font-display', `'CustomUserFont', 'ZEN SERIF', serif`);
    document.documentElement.style.setProperty('--font-body', `'CustomUserFont', 'ZEN SERIF', sans-serif`);
  } else if(theme.customFontFile){
    injectCustomFontFace(`url('./fonts/${theme.customFontFile}') format('truetype')`);
    document.documentElement.style.setProperty('--font-display', `'CustomUserFont', 'ZEN SERIF', serif`);
    document.documentElement.style.setProperty('--font-body', `'CustomUserFont', 'ZEN SERIF', sans-serif`);
  } else {
    injectCustomFontFace(null);
    if(theme.fontDisplay) document.documentElement.style.setProperty('--font-display', `'${theme.fontDisplay}', 'Noto Serif KR', serif`);
    if(theme.fontBody) document.documentElement.style.setProperty('--font-body', `'${theme.fontBody}', sans-serif`);
  }
}

db.collection('meta').doc('theme').onSnapshot(doc=>{
  if(doc.exists) applyTheme(doc.data());
});

globalStyleBtn.addEventListener('click', async ()=>{
  if(!editMode){ toast('잠금 해제 후 편집모드에서 변경할 수 있어요'); return; }
  const cs = getComputedStyle(document.documentElement);
  const cur = {};
  THEME_VARS.forEach(v=> cur[v.replace('--','')] = cs.getPropertyValue(v).trim());
  const themeDoc = await db.collection('meta').doc('theme').get();
  const saved = themeDoc.exists ? themeDoc.data() : {};
  const cardBgParsed = parseColorToHexAlpha(cur['card-bg']);
  const cardBgAlphaPct = Math.round(cardBgParsed.alpha*100);
  openModal(`
    <h3>테마 편집</h3>
    <p style="font-size:.78rem;color:var(--ink-soft)">여기서 바꾸면 사이트 전체에 한 번에 적용돼요.</p>
    <label>메인 포인트 컬러</label>
    <div class="color-row"><input type="color" id="tRose" value="${cur.rose}"></div>
    <label>보조 포인트 컬러</label>
    <div class="color-row"><input type="color" id="tSage" value="${cur.sage}"></div>
    <label>라인/코너 컬러</label>
    <div class="color-row"><input type="color" id="tGold" value="${cur.gold}"></div>
    <label>배경색</label>
    <div class="color-row"><input type="color" id="tPaper" value="${cur.paper}"></div>
    <label>카드 색상 · 투명도</label>
    <div class="color-row">
      <input type="color" id="tCardBgHex" value="${cardBgParsed.hex}">
      <input type="range" id="tCardBgAlpha" min="10" max="90" value="${cardBgAlphaPct}" style="flex:1;">
      <span id="tCardBgAlphaLabel" style="font-size:.78rem;color:var(--ink-soft);min-width:34px;">${cardBgAlphaPct}%</span>
    </div>
    <p class="hint">투명도를 낮출수록(왼쪽) 배경이 카드 뒤로 더 비쳐서 유리 느낌이 강해져요.</p>
    <label>글자색</label>
    <div class="color-row"><input type="color" id="tInk" value="${cur.ink}"></div>
    <label>제목 폰트</label>
    <select id="tFontDisplay">${FONT_DISPLAY_OPTIONS.map(f=>`<option value="${f}" ${saved.fontDisplay===f?'selected':''}>${f}</option>`).join('')}</select>
    <label>본문 폰트</label>
    <select id="tFontBody">${FONT_BODY_OPTIONS.map(f=>`<option value="${f}" ${saved.fontBody===f?'selected':''}>${f}</option>`).join('')}</select>

    <label style="margin-top:16px;">커스텀 폰트 파일로 전체 글자체 통일 (선택)</label>
    <input type="file" id="tFontUpload" accept=".ttf,.otf,font/ttf,font/otf">
    <p class="hint">폰트 파일을 올리면 위에서 고른 제목/본문 폰트 대신, 사이트 전체 글자체가 이 폰트 하나로 통일돼요. 500KB 이하 파일만 여기서 바로 올릴 수 있어요.</p>
    <label>또는, GitHub의 fonts 폴더에 직접 올린 폰트 파일명</label>
    <input type="text" id="tFontFileName" placeholder="예: ZenSerif.ttf" value="${escapeHtml(saved.customFontFile||'')}">
    <p class="hint">500KB보다 큰 폰트는 저장소의 fonts 폴더에 파일을 올린 뒤, 정확한 파일 이름만 여기에 입력해주세요.</p>
    <div style="margin-top:6px;">
      <button class="btn small ghost" id="tFontClear" type="button">커스텀 폰트 해제 (기본 ZEN SERIF로)</button>
    </div>

    <div class="modal-actions">
      <button class="btn ghost" id="tReset" type="button" style="margin-right:auto;">테마 전체 초기화</button>
      <button class="btn ghost" id="c">취소</button>
      <button class="btn primary" id="s">전체 적용</button>
    </div>
  `, m=>{
    m.querySelector('#tCardBgAlpha').addEventListener('input', (e)=>{
      m.querySelector('#tCardBgAlphaLabel').textContent = `${e.target.value}%`;
    });
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#tFontClear').onclick = async ()=>{
      await db.collection('meta').doc('theme').set({ customFontData:'', customFontFile:'' }, {merge:true});
      closeModal();
      toast('커스텀 폰트를 해제했어요');
    };
    m.querySelector('#tReset').onclick = async ()=>{
      try{
        await db.collection('meta').doc('theme').delete();
      }catch(err){ console.error(err); }
      THEME_VARS.forEach(v=> document.documentElement.style.removeProperty(v));
      document.documentElement.style.removeProperty('--font-display');
      document.documentElement.style.removeProperty('--font-body');
      injectCustomFontFace(null);
      closeModal();
      toast('테마를 기본값으로 초기화했어요');
    };
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const cardHex = m.querySelector('#tCardBgHex').value;
      const cardAlpha = Number(m.querySelector('#tCardBgAlpha').value)/100;
      const theme = {
        rose: m.querySelector('#tRose').value,
        sage: m.querySelector('#tSage').value,
        gold: m.querySelector('#tGold').value,
        paper: m.querySelector('#tPaper').value,
        'card-bg': hexToRgba(cardHex, cardAlpha),
        'card-bg2': hexToRgba(cardHex, Math.max(0.08, +(cardAlpha*0.6).toFixed(2))),
        ink: m.querySelector('#tInk').value,
        fontDisplay: m.querySelector('#tFontDisplay').value,
        fontBody: m.querySelector('#tFontBody').value
      };
      const fontFile = m.querySelector('#tFontUpload').files[0];
      const fontFileName = m.querySelector('#tFontFileName').value.trim();
      if(fontFile){
        if(fontFile.size > CUSTOM_FONT_MAX_BYTES){
          toast('폰트 파일이 너무 커요(500KB 이하 권장). 대신 fonts 폴더에 올리고 파일명을 입력해주세요.');
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '폰트 처리 중…';
        try{
          theme.customFontData = await fileToBase64(fontFile);
          theme.customFontFile = '';
        }catch(err){
          toast('폰트 파일을 읽지 못했어요');
          saveBtn.disabled = false;
          saveBtn.textContent = '전체 적용';
          return;
        }
      } else if(fontFileName){
        theme.customFontFile = fontFileName;
        theme.customFontData = '';
      }
      await db.collection('meta').doc('theme').set(theme, {merge:true});
      closeModal();
      toast('테마를 적용했어요');
    };
  });
});

/* ================================================================
   콘텐츠 모듈 8종 — 각자 독립된 Firestore 문서(collection 'content')를
   구독하고, 자기 영역만 렌더링함
   ================================================================ */

/* ---------------- 1. 이미지 위젯 (가로형 슬라이드) ---------------- */

let imagesData = { items: [] };
let imgSlideIndex = 0;

/* 예전 데이터(문자열 URL 배열)와 새 데이터({url, caption} 객체 배열)를 함께 지원 */
function normalizeImageItem(it){
  if(typeof it === 'string') return { url: it, caption: '' };
  return { url: it.url || '', caption: it.caption || '' };
}

function renderImages(){
  const box = document.getElementById('cardImages');
  const items = (imagesData.items || []).map(normalizeImageItem);
  if(items.length === 0){
    box.innerHTML = `
      <div class="slide-empty">아직 사진이 없어요</div>
      ${editMode ? `<button class="btn small slide-add" id="imgAddBtn">+ 사진 추가</button>` : ''}
    `;
  } else {
    if(imgSlideIndex >= items.length) imgSlideIndex = 0;
    const cur = items[imgSlideIndex];
    box.innerHTML = `
      <div class="slide-viewport" id="slideViewport">
        <img src="${cur.url}" id="slideImg" title="눌러서 크게 보기">
        ${cur.caption ? `<div class="slide-caption">${escapeHtml(cur.caption).replace(/\n/g,'<br>')}</div>` : ''}
        ${editMode ? `<button class="icon-btn slide-caption-btn" id="imgCaptionBtn" title="문구 편집">Aa</button>` : ''}
        ${editMode ? `<button class="icon-btn slide-del" id="imgDelBtn" title="이 사진 삭제">✕</button>` : ''}
        ${items.length>1 ? `<button class="slide-nav prev" id="imgPrev">‹</button><button class="slide-nav next" id="imgNext">›</button>` : ''}
      </div>
      ${items.length>1 ? `<div class="slide-dots">${items.map((_,i)=>`<span class="dot ${i===imgSlideIndex?'active':''}" data-dot="${i}"></span>`).join('')}</div>` : ''}
      ${editMode ? `<button class="btn small slide-add" id="imgAddBtn">+ 사진 추가</button>` : ''}
    `;
  }
  bindImages();
}

function bindImages(){
  const box = document.getElementById('cardImages');
  const items = (imagesData.items || []).map(normalizeImageItem);
  const prev = box.querySelector('#imgPrev');
  const next = box.querySelector('#imgNext');
  if(prev) prev.onclick = ()=>{ imgSlideIndex = (imgSlideIndex - 1 + items.length) % items.length; renderImages(); };
  if(next) next.onclick = ()=>{ imgSlideIndex = (imgSlideIndex + 1) % items.length; renderImages(); };
  box.querySelectorAll('[data-dot]').forEach(d=> d.onclick = ()=>{ imgSlideIndex = Number(d.dataset.dot); renderImages(); });
  const del = box.querySelector('#imgDelBtn');
  if(del) del.onclick = async (e)=>{
    e.stopPropagation();
    const arr = [...items]; arr.splice(imgSlideIndex,1);
    await docRef('images').set({items:arr}, {merge:true});
  };
  const capBtn = box.querySelector('#imgCaptionBtn');
  if(capBtn) capBtn.onclick = (e)=>{ e.stopPropagation(); openImageCaptionModal(imgSlideIndex, items); };
  const addBtn = box.querySelector('#imgAddBtn');
  if(addBtn) addBtn.onclick = openImagesAddModal;
  const img = box.querySelector('#slideImg');
  if(img){
    attachImgFallback(img);
    img.onclick = ()=>{
      openImageLightbox({
        items,
        index: imgSlideIndex,
        resolve: (item)=> item.url,
        onDelete: editMode ? async (idx)=>{
          const arr = [...items]; arr.splice(idx,1);
          await docRef('images').set({items:arr}, {merge:true});
        } : null
      });
    };
  }
}

function openImageCaptionModal(idx, items){
  const cur = items[idx];
  openModal(`
    <h3>사진 위 문구</h3>
    <p class="hint">사진 위에 크게 겹쳐 보이는 문구예요. 비워두면 문구 없이 사진만 보여요.</p>
    <label>문구 (줄바꿈 가능)</label>
    <textarea id="capText" style="min-height:80px;">${escapeHtml(cur.caption||'')}</textarea>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const arr = [...items];
      arr[idx] = { url: cur.url, caption: m.querySelector('#capText').value.trim() };
      await docRef('images').set({items:arr}, {merge:true});
      closeModal();
    };
  });
}

function openImagesAddModal(){
  openModal(`
    <h3>사진 추가</h3>
    <label>사진 올리기 (기기에서 여러 장 선택 가능)</label>
    <input type="file" id="imgFiles" accept="image/*" multiple>
    <p class="hint">화면에 맞게 자동으로 압축해서 슬라이드에 바로 추가돼요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="imgUrl" placeholder="https://...">
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const files = Array.from(m.querySelector('#imgFiles').files || []);
      const url = normalizeImageUrl(m.querySelector('#imgUrl').value.trim());
      const newItems = [];
      if(files.length){
        saveBtn.disabled = true;
        for(let i=0;i<files.length;i++){
          saveBtn.textContent = `처리 중… (${i+1}/${files.length})`;
          try{ newItems.push({ url: await compressImageFile(files[i], 2000, 480000), caption:'' }); }
          catch(err){ toast(`"${files[i].name}" 처리 실패`); }
        }
      } else if(url){
        newItems.push({ url, caption:'' });
      } else {
        toast('사진을 선택하거나 URL을 입력해주세요');
        return;
      }
      try{
        await docRef('images').set({ items: [...(imagesData.items||[]).map(normalizeImageItem), ...newItems] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 용량이 크면 URL 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('images').onSnapshot(doc=>{ imagesData = doc.exists ? doc.data() : {items:[]}; renderImages(); });

/* ---------------- 2. 음악 위젯 ---------------- */

let musicData = { tracks: [] };

function renderMusic(){
  const box = document.getElementById('cardMusic');
  const tracks = musicData.tracks || [];
  box.innerHTML = `
    <div class="player-tracks">
      ${tracks.map((t,i)=>`
        <div class="player-track" data-idx="${i}">
          ♪ <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title)}</span>
          ${editMode ? `<button class="icon-btn" data-del="${i}" style="width:18px;height:18px;font-size:.6rem;">✕</button>` : ''}
        </div>
      `).join('') || `<div class="w-empty">등록된 곡이 없어요</div>`}
    </div>
    <audio id="musicAudio" controls style="display:none;"></audio>
    <div class="yt-frame" id="musicYt" style="display:none;"></div>
    ${editMode ? `<button class="btn small music-add" id="musicAddBtn">+ 곡 추가</button>` : ''}
  `;
  bindMusic();
}

function bindMusic(){
  const box = document.getElementById('cardMusic');
  box.querySelectorAll('[data-idx]').forEach(row=>{
    row.addEventListener('click', (e)=>{
      if(e.target.closest('[data-del]')) return;
      const idx = Number(row.dataset.idx);
      playTrack(idx);
      box.querySelectorAll('.player-track').forEach(x=>x.classList.remove('active'));
      row.classList.add('active');
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async e=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const tracks = [...musicData.tracks]; tracks.splice(idx,1);
    await docRef('music').set({tracks}, {merge:true});
  }));
  const addBtn = box.querySelector('#musicAddBtn');
  if(addBtn) addBtn.onclick = openMusicAddModal;
}

function playTrack(idx){
  const t = musicData.tracks[idx]; if(!t) return;
  const audioEl = document.getElementById('musicAudio');
  const ytEl = document.getElementById('musicYt');
  const ytId = extractYouTubeId(t.url);
  if(ytId){
    audioEl.pause(); audioEl.removeAttribute('src'); audioEl.style.display = 'none';
    ytEl.style.display = 'block';
    ytEl.innerHTML = `<iframe height="150" src="https://www.youtube.com/embed/${ytId}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen title="${escapeHtml(t.title)}"></iframe>`;
  } else {
    ytEl.style.display = 'none'; ytEl.innerHTML = '';
    audioEl.style.display = 'block'; audioEl.src = t.url; audioEl.play().catch(()=>{});
  }
}

function openMusicAddModal(){
  openModal(`
    <h3>곡 추가</h3>
    <label>곡 제목</label><input type="text" id="mTitle">
    <label>오디오 파일 URL 또는 유튜브 링크</label><input type="url" id="mUrl" placeholder="mp3 직링크 또는 https://youtu.be/...">
    <p class="hint">유튜브 링크는 그대로 붙여넣으면 화면 안에서 바로 재생돼요. mp3는 구글드라이브 등의 직링크를 붙여넣어주세요.</p>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const title = m.querySelector('#mTitle').value.trim();
      const url = m.querySelector('#mUrl').value.trim();
      if(!title || !url){ toast('제목과 주소를 입력해주세요'); return; }
      await docRef('music').set({ tracks: [...(musicData.tracks||[]), {title, url}] }, {merge:true});
      closeModal();
    };
  });
}

docRef('music').onSnapshot(doc=>{ musicData = doc.exists ? doc.data() : {tracks:[]}; renderMusic(); });

/* ---------------- 3. 디데이 ---------------- */

let ddayData = { items: [] };

function ddayDiffText(dateStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr+'T00:00:00');
  const diff = Math.round((target - today) / 86400000);
  if(diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function renderDday(){
  const items = (ddayData.items || []).map((it,i)=>({...it, _i:i})).sort((a,b)=> a.date.localeCompare(b.date));
  const body = document.getElementById('ddayBody');
  body.innerHTML = items.map(it=> `
    <div class="dday-item">
      ${editMode ? `<button class="icon-btn" data-del="${it._i}">✕</button>` : ''}
      <div class="dday-label">${escapeHtml(it.label)}</div>
      <div class="dday-count">${ddayDiffText(it.date)}</div>
    </div>
  `).join('') || `<div class="w-empty">등록된 디데이가 없어요</div>`;
  body.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async ()=>{
    const idx = Number(btn.dataset.del);
    const arr = [...ddayData.items]; arr.splice(idx,1);
    await docRef('dday').set({items:arr}, {merge:true});
  }));

  const wrap = document.getElementById('ddayAddWrap');
  wrap.innerHTML = editMode ? `<button class="btn small" id="ddayAddBtn">+ 디데이 추가</button>` : '';
  const addBtn = document.getElementById('ddayAddBtn');
  if(addBtn) addBtn.onclick = openDdayAddModal;
}

function openDdayAddModal(){
  openModal(`
    <h3>디데이 추가</h3>
    <label>이름</label><input type="text" id="dLabel" placeholder="예: 처음 만난 날">
    <label>날짜</label><input type="date" id="dDate">
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const label = m.querySelector('#dLabel').value.trim();
      const date = m.querySelector('#dDate').value;
      if(!label || !date){ toast('이름과 날짜를 입력해주세요'); return; }
      await docRef('dday').set({ items: [...(ddayData.items||[]), {label, date}] }, {merge:true});
      closeModal();
    };
  });
}

docRef('dday').onSnapshot(doc=>{ ddayData = doc.exists ? doc.data() : {items:[]}; renderDday(); renderCalendar(); });

/* ---------------- 4. 방명록 (누구나 남길 수 있음, 삭제만 편집모드 전용) ---------------- */

let guestbookData = { entries: [] };

function renderGuestbook(){
  const entries = (guestbookData.entries || []).slice().sort((a,b)=> (b.ts||0) - (a.ts||0));
  const body = document.getElementById('guestbookBody');
  body.innerHTML = entries.map(e=> `
    <div class="gb-entry" data-id="${e.id}">
      ${editMode ? `<button class="gb-del">✕</button>` : ''}
      <span class="gb-name">${escapeHtml(e.name||'익명')}</span>
      <span class="gb-time">${e.ts ? new Date(e.ts).toLocaleDateString('ko-KR') : ''}</span>
      <div class="gb-msg">${escapeHtml(e.message)}</div>
    </div>
  `).join('') || `<div class="w-empty">아직 남겨진 방명록이 없어요</div>`;
  body.querySelectorAll('.gb-del').forEach(btn=> btn.addEventListener('click', async ()=>{
    const id = btn.closest('.gb-entry').dataset.id;
    const arr = (guestbookData.entries||[]).filter(x=> x.id !== id);
    await docRef('guestbook').set({entries: arr}, {merge:true});
  }));
}

docRef('guestbook').onSnapshot(doc=>{ guestbookData = doc.exists ? doc.data() : {entries:[]}; renderGuestbook(); });

// 방명록은 잠금 상태와 관계없이 누구나 남길 수 있어요 (삭제만 편집모드 전용)
document.getElementById('gbSubmit').addEventListener('click', async ()=>{
  const nameInput = document.getElementById('gbName');
  const msgInput = document.getElementById('gbMsg');
  const name = nameInput.value.trim();
  const message = msgInput.value.trim();
  if(!message){ toast('메시지를 입력해주세요'); return; }
  try{
    await docRef('guestbook').set({
      entries: [...(guestbookData.entries||[]), { id: uid(), name: name || '익명', message, ts: Date.now() }]
    }, {merge:true});
    nameInput.value = ''; msgInput.value = '';
    toast('방명록을 남겼어요');
  }catch(err){
    console.error(err);
    toast('저장하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
});

/* ---------------- 5. 캘린더 (내용만, 제목 없음) ---------------- */

let calendarData = { events: {} };
let calState = (()=>{ const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

const DDAY_MILESTONE_INTERVAL = 50; // "50일 간격" 기념일 자동 표시 주기

function daysBetween(baseDateStr, targetDateStr){
  const base = new Date(baseDateStr + 'T00:00:00');
  const target = new Date(targetDateStr + 'T00:00:00');
  return Math.round((target - base) / 86400000);
}

// 디데이 위젯에 등록된 날짜를 기준으로, 해당 날짜와 그 뒤 50일 단위가 되는 날짜마다
// 캘린더에 자동으로 기념일 표시를 띄워줌 (직접 캘린더에 따로 입력할 필요 없음)
function ddayMilestonesForDate(dateStr){
  const marks = [];
  (ddayData.items || []).forEach(it=>{
    if(!it.date) return;
    const diff = daysBetween(it.date, dateStr);
    if(diff >= 0 && diff % DDAY_MILESTONE_INTERVAL === 0){
      marks.push(diff === 0 ? `${it.label} 시작일` : `${it.label} ${diff}일`);
    }
  });
  return marks;
}

function renderCalendar(){
  const box = document.getElementById('cardCalendar');
  const events = calendarData.events || {};
  const first = new Date(calState.y, calState.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(calState.y, calState.m+1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0,10);
  let cells = '';
  for(let i=0;i<startDow;i++) cells += `<div class="cal-day empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${calState.y}-${String(calState.m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasManual = events[dateStr] && events[dateStr].length;
    const ddayMarks = ddayMilestonesForDate(dateStr);
    const cls = [
      'cal-day',
      dateStr===todayStr ? 'today' : '',
      (hasManual || ddayMarks.length) ? 'has-event' : '',
      ddayMarks.length ? 'has-dday' : ''
    ].filter(Boolean).join(' ');
    cells += `<div class="${cls}" data-day="${dateStr}" title="${ddayMarks.length ? escapeHtml(ddayMarks.join(', ')) : ''}">${d}</div>`;
  }
  box.innerHTML = `
    <div class="cal-head">
      <span class="icon-btn" id="calPrev">‹</span>
      <strong>${calState.y}. ${calState.m+1}</strong>
      <span class="icon-btn" id="calNext">›</span>
    </div>
    <div class="cal-grid">
      ${['일','월','화','수','목','금','토'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>
  `;
  box.querySelector('#calPrev').onclick = ()=>{ calState.m--; if(calState.m<0){calState.m=11; calState.y--;} renderCalendar(); };
  box.querySelector('#calNext').onclick = ()=>{ calState.m++; if(calState.m>11){calState.m=0; calState.y++;} renderCalendar(); };
  box.querySelectorAll('[data-day]').forEach(el=> el.addEventListener('click', ()=> openDayModal(el.dataset.day)));
}

function openDayModal(dateStr){
  const events = calendarData.events || {};
  const manual = events[dateStr] || [];
  const ddayMarks = ddayMilestonesForDate(dateStr);
  if(!editMode){
    if(!manual.length && !ddayMarks.length){ toast('이 날은 등록된 일정이 없어요'); return; }
    const lines = [...ddayMarks.map(t=>`🎉 ${t}`), ...manual];
    openModal(`<h3>${dateStr}</h3><div style="white-space:pre-wrap;font-size:.88rem;">${escapeHtml(lines.join('\n'))}</div>
      <div class="modal-actions"><button class="btn ghost" id="c">닫기</button></div>`,
      m=> m.querySelector('#c').onclick = closeModal);
    return;
  }
  openModal(`
    <h3>${dateStr} 일정</h3>
    ${ddayMarks.length ? `<p class="hint">🎉 디데이 연동: ${escapeHtml(ddayMarks.join(', '))} (자동으로 표시되는 항목이라 여기서 지울 필요 없어요)</p>` : ''}
    <label>내용 (줄바꿈으로 여러 개 가능)</label>
    <textarea id="evText">${escapeHtml(manual.join('\n'))}</textarea>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const text = m.querySelector('#evText').value.trim();
      const newEvents = {...events};
      if(text) newEvents[dateStr] = text.split('\n').filter(Boolean); else delete newEvents[dateStr];
      await docRef('calendar').set({events:newEvents}, {merge:true});
      closeModal();
    };
  });
}

docRef('calendar').onSnapshot(doc=>{ calendarData = doc.exists ? doc.data() : {events:{}}; renderCalendar(); });

/* ---------------- 6. 갤러리 (핀터레스트형 매스너리) ---------------- */

/* 예전엔 items가 그냥 URL 문자열 배열이었어서, 새로 추가된 블러 옵션과 호환되도록
   문자열이면 {url, blur:false}로, 객체면 그대로 정규화해줌 */
function normalizeGalleryItem(it){
  if(typeof it === 'string') return { url: it, blur: false };
  if(it.chunked) return { chunked:true, fileId: it.fileId, chunkTotal: it.chunkTotal, blur: !!it.blur };
  return { url: it.url, blur: !!it.blur };
}

/* 갤러리는 사진 여러 장이 문서 하나(gallery/gallery2)에 배열로 함께 저장되는데,
   사진을 그대로 base64로 박아넣으면 Firestore 문서 1MB 한도를 여러 장이
   나눠 써야 해서, 사진이 늘어날수록(특히 용량 큰 GIF는 몇 장만 있어도) 저장이
   막혀버림. 일정 크기 이상인 파일은 이미 있는 청크 저장 방식(saveFileChunked)으로
   따로 보관하고, 갤러리 문서에는 작은 참조 정보만 남겨서 사진이 몇 장이든
   용량 걱정 없이 계속 추가할 수 있게 함. */
const GALLERY_INLINE_MAX = 200000; // 이보다 크면 청크 저장으로 분리
const chunkedImageCache = new Map(); // fileId -> 이미 불러온 data URL(캐시)

async function storeGalleryImage(dataUrl){
  if(dataUrl.length <= GALLERY_INLINE_MAX) return { url: dataUrl };
  const { fileId, total } = await saveFileChunked(dataUrl);
  chunkedImageCache.set(fileId, dataUrl); // 방금 올린 사진은 바로 캐시해서 다시 안 불러와도 되게 함
  return { chunked: true, fileId, chunkTotal: total };
}

/* 청크로 저장된 사진은 비동기로 불러와야 해서, 아직 캐시에 없으면 null을 반환하고
   (그동안 로딩 타일을 보여줌) 다 불러오면 onReady()로 다시 그리게 함 */
function resolveGalleryItemUrl(item, onReady){
  if(!item.chunked) return item.url;
  if(chunkedImageCache.has(item.fileId)) return chunkedImageCache.get(item.fileId);
  loadFileChunked(item.fileId, item.chunkTotal).then(url=>{
    chunkedImageCache.set(item.fileId, url);
    onReady();
  }).catch(()=>{ chunkedImageCache.set(item.fileId, ''); onReady(); });
  return null;
}

function deleteGalleryImageIfChunked(item){
  if(item && item.chunked){ deleteFileChunked(item.fileId, item.chunkTotal).catch(()=>{}); }
}

let galleryData = { items: [] };

function renderGallery(){
  const box = document.getElementById('cardGallery');
  const items = (galleryData.items || []).map(normalizeGalleryItem);
  box.innerHTML = `
    <div class="pin-grid" id="galleryGrid">
      ${items.map((it,i)=>{
        const resolved = resolveGalleryItemUrl(it, renderGallery);
        if(resolved === null){
          return `<div class="pin-item pin-loading" data-idx="${i}"><span>불러오는 중…</span></div>`;
        }
        return `
        <div class="pin-item ${it.blur ? 'blurred' : ''}" data-idx="${i}">
          <img src="${escapeHtml(resolved)}">
          ${editMode ? `<button class="pin-del-btn" data-del="${i}" title="삭제">✕</button>` : ''}
          ${editMode ? `<button class="pin-blur-btn" data-blur="${i}" title="${it.blur ? '블러 해제' : '블러 처리'}">${it.blur ? '🙈' : '👁'}</button>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${items.length===0 ? `<div class="w-empty">아직 사진이 없어요</div>` : ''}
    ${editMode ? `<button class="gallery-add-fab" id="galAddBtn" title="사진 추가">＋</button>` : ''}
  `;
  box.querySelectorAll('.pin-item:not(.pin-loading)').forEach(el=> el.addEventListener('click', (e)=>{
    if(e.target.closest('[data-blur], [data-del]')) return;
    openGalleryViewModal(Number(el.dataset.idx));
  }));
  box.querySelectorAll('.pin-item img').forEach(attachImgFallback);
  box.querySelectorAll('[data-blur]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.blur);
    const arr = items.slice();
    arr[idx] = { ...arr[idx], blur: !arr[idx].blur };
    await docRef('gallery').set({ items: arr }, {merge:true});
  }));
  box.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const arr = items.slice();
    const [removed] = arr.splice(idx,1);
    await docRef('gallery').set({items:arr}, {merge:true});
    deleteGalleryImageIfChunked(removed);
  }));
  const addBtn = box.querySelector('#galAddBtn');
  if(addBtn) addBtn.onclick = openGalleryAddModal;
  bindPinDragReorder(
    box.querySelector('#galleryGrid'), '.pin-item:not(.pin-loading)',
    ()=> items.slice(),
    async (arr)=> docRef('gallery').set({items:arr}, {merge:true})
  );
}

function openGalleryViewModal(idx){
  const items = (galleryData.items || []).map(normalizeGalleryItem);
  openImageLightbox({
    items,
    index: idx,
    resolve: resolveGalleryItemUrl,
    onDelete: editMode ? async (i)=>{
      const arr = (galleryData.items||[]).map(normalizeGalleryItem);
      const [removed] = arr.splice(i,1);
      await docRef('gallery').set({items:arr}, {merge:true});
      deleteGalleryImageIfChunked(removed);
    } : null
  });
}

function openGalleryAddModal(){
  openModal(`
    <h3>사진 추가</h3>
    <label>사진 올리기 (기기에서 여러 장 선택 가능)</label>
    <input type="file" id="galFiles" accept="image/*" multiple>
    <p class="hint">화면에 맞게 자동으로 압축해서 갤러리 맨 앞에 추가돼요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="galUrl" placeholder="https://...">
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;">
      <input type="checkbox" id="galBlur" style="width:auto;">
      <span style="font-size:.82rem;color:var(--ink);">썸네일 블러 처리 (눌러야만 원본이 보여요)</span>
    </label>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const files = Array.from(m.querySelector('#galFiles').files || []);
      const url = normalizeImageUrl(m.querySelector('#galUrl').value.trim());
      const blur = m.querySelector('#galBlur').checked;
      const newItems = [];
      if(files.length){
        saveBtn.disabled = true;
        for(let i=0;i<files.length;i++){
          saveBtn.textContent = `처리 중… (${i+1}/${files.length})`;
          try{
            const dataUrl = await compressImageFile(files[i], 1200, 260000);
            const stored = await storeGalleryImage(dataUrl);
            newItems.push({ ...stored, blur });
          }catch(err){ toast(`"${files[i].name}" 처리 실패`); }
        }
      } else if(url){
        newItems.push({ url, blur });
      } else {
        toast('사진을 선택하거나 URL을 입력해주세요');
        return;
      }
      try{
        const existing = (galleryData.items||[]).map(normalizeGalleryItem);
        await docRef('gallery').set({ items: [...newItems, ...existing] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 용량이 크면 URL 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('gallery').onSnapshot(doc=>{ galleryData = doc.exists ? doc.data() : {items:[]}; renderGallery(); });

/* ---------------- 6-2. 갤러리 2번째 (기존 갤러리 바로 아래 — 완전히 독립된 두 번째 갤러리)
   접었다 펼치기 가능(기본은 접힘), 펼치면 빽빽한 정사각형 그리드로 세로 스크롤 ---------------- */

let gallery2Data = { items: [] };
let gallery2Collapsed = true;

function renderGallery2(){
  const box = document.getElementById('cardGallery2');
  if(!box) return;
  const items = (gallery2Data.items || []).map(normalizeGalleryItem);
  box.innerHTML = `
    <button class="gallery-toggle-btn" id="gallery2ToggleBtn">
      <span>${gallery2Collapsed ? '펼쳐보기' : '접기'}${items.length ? ` (${items.length})` : ''}</span>
      <span class="gallery-toggle-arrow ${gallery2Collapsed ? '' : 'open'}">⌄</span>
    </button>
    <div class="pin-grid-dense" id="gallery2Grid" style="${gallery2Collapsed ? 'display:none;' : ''}">
      ${items.map((it,i)=>{
        const resolved = resolveGalleryItemUrl(it, renderGallery2);
        if(resolved === null){
          return `<div class="pin-item-dense pin-loading" data-idx="${i}"><span>불러오는 중…</span></div>`;
        }
        return `
        <div class="pin-item-dense ${it.blur ? 'blurred' : ''}" data-idx="${i}">
          <img src="${escapeHtml(resolved)}">
          ${editMode ? `<button class="pin-del-btn" data-del="${i}" title="삭제">✕</button>` : ''}
          ${editMode ? `<button class="pin-blur-btn" data-blur="${i}" title="${it.blur ? '블러 해제' : '블러 처리'}">${it.blur ? '🙈' : '👁'}</button>` : ''}
        </div>`;
      }).join('')}
      ${items.length===0 ? `<div class="w-empty">아직 사진이 없어요</div>` : ''}
    </div>
    ${editMode && !gallery2Collapsed ? `<button class="gallery-add-fab" id="galAddBtn2" title="사진 추가">＋</button>` : ''}
  `;
  const toggleBtn = box.querySelector('#gallery2ToggleBtn');
  if(toggleBtn) toggleBtn.onclick = ()=>{
    gallery2Collapsed = !gallery2Collapsed;
    renderGallery2();
  };
  box.querySelectorAll('.pin-item-dense:not(.pin-loading)').forEach(el=> el.addEventListener('click', (e)=>{
    if(e.target.closest('[data-blur], [data-del]')) return;
    openGallery2ViewModal(Number(el.dataset.idx));
  }));
  box.querySelectorAll('.pin-item-dense img').forEach(attachImgFallback);
  box.querySelectorAll('[data-blur]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.blur);
    const arr = items.slice();
    arr[idx] = { ...arr[idx], blur: !arr[idx].blur };
    await docRef('gallery2').set({ items: arr }, {merge:true});
  }));
  box.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const arr = items.slice();
    const [removed] = arr.splice(idx,1);
    await docRef('gallery2').set({items:arr}, {merge:true});
    deleteGalleryImageIfChunked(removed);
  }));
  const addBtn = box.querySelector('#galAddBtn2');
  if(addBtn) addBtn.onclick = openGallery2AddModal;
  if(!gallery2Collapsed){
    bindPinDragReorder(
      box.querySelector('#gallery2Grid'), '.pin-item-dense:not(.pin-loading)',
      ()=> items.slice(),
      async (arr)=> docRef('gallery2').set({items:arr}, {merge:true})
    );
  }
}

function openGallery2ViewModal(idx){
  const items = (gallery2Data.items || []).map(normalizeGalleryItem);
  openImageLightbox({
    items,
    index: idx,
    resolve: resolveGalleryItemUrl,
    onDelete: editMode ? async (i)=>{
      const arr = (gallery2Data.items||[]).map(normalizeGalleryItem);
      const [removed] = arr.splice(i,1);
      await docRef('gallery2').set({items:arr}, {merge:true});
      deleteGalleryImageIfChunked(removed);
    } : null
  });
}

function openGallery2AddModal(){
  openModal(`
    <h3>사진 추가</h3>
    <label>사진 올리기 (기기에서 여러 장 선택 가능)</label>
    <input type="file" id="gal2Files" accept="image/*" multiple>
    <p class="hint">화면에 맞게 자동으로 압축해서 갤러리 맨 앞에 추가돼요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="gal2Url" placeholder="https://...">
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;">
      <input type="checkbox" id="gal2Blur" style="width:auto;">
      <span style="font-size:.82rem;color:var(--ink);">썸네일 블러 처리 (눌러야만 원본이 보여요)</span>
    </label>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const files = Array.from(m.querySelector('#gal2Files').files || []);
      const url = normalizeImageUrl(m.querySelector('#gal2Url').value.trim());
      const blur = m.querySelector('#gal2Blur').checked;
      const newItems = [];
      if(files.length){
        saveBtn.disabled = true;
        for(let i=0;i<files.length;i++){
          saveBtn.textContent = `처리 중… (${i+1}/${files.length})`;
          try{
            const dataUrl = await compressImageFile(files[i], 1200, 260000);
            const stored = await storeGalleryImage(dataUrl);
            newItems.push({ ...stored, blur });
          }catch(err){ toast(`"${files[i].name}" 처리 실패`); }
        }
      } else if(url){
        newItems.push({ url, blur });
      } else {
        toast('사진을 선택하거나 URL을 입력해주세요');
        return;
      }
      try{
        const existing = (gallery2Data.items||[]).map(normalizeGalleryItem);
        await docRef('gallery2').set({ items: [...newItems, ...existing] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 용량이 크면 URL 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('gallery2').onSnapshot(doc=>{ gallery2Data = doc.exists ? doc.data() : {items:[]}; renderGallery2(); });

/* ---------------- 6-3. 레퍼런스 갤러리 (캘린더 옆, 완전히 독립된 세 번째 갤러리)
   블러 옵션 없이 작고 촘촘한 정사각형 썸네일로만 구성 — 자료 수집/레퍼런스 모음용.
   ---------------- */

function normalizeRefGalleryItem(it){
  if(typeof it === 'string') return { url: it };
  if(it.chunked) return { chunked:true, fileId: it.fileId, chunkTotal: it.chunkTotal };
  return { url: it.url };
}

let refGalleryData = { items: [] };

function renderRefGallery(){
  const box = document.getElementById('cardRefGallery');
  if(!box) return;
  const items = (refGalleryData.items || []).map(normalizeRefGalleryItem);
  box.innerHTML = `
    <div class="ref-gallery-grid" id="refGalleryGrid">
      ${items.map((it,i)=>{
        const resolved = resolveGalleryItemUrl(it, renderRefGallery);
        if(resolved === null){
          return `<div class="pin-item-dense pin-loading" data-idx="${i}"><span>...</span></div>`;
        }
        return `
        <div class="pin-item-dense" data-idx="${i}">
          <img src="${escapeHtml(resolved)}">
          ${editMode ? `<button class="pin-del-btn" data-del="${i}" title="삭제">✕</button>` : ''}
        </div>`;
      }).join('')}
      ${items.length===0 ? `<div class="w-empty">아직 사진이 없어요</div>` : ''}
    </div>
    ${editMode ? `<button class="gallery-add-fab" id="refGalAddBtn" title="사진 추가">＋</button>` : ''}
  `;
  box.querySelectorAll('.pin-item-dense:not(.pin-loading)').forEach(el=> el.addEventListener('click', (e)=>{
    if(e.target.closest('[data-del]')) return;
    openRefGalleryViewModal(Number(el.dataset.idx));
  }));
  box.querySelectorAll('.pin-item-dense img').forEach(attachImgFallback);
  box.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const arr = items.slice();
    const [removed] = arr.splice(idx,1);
    await docRef('refgallery').set({items:arr}, {merge:true});
    deleteGalleryImageIfChunked(removed);
  }));
  const addBtn = box.querySelector('#refGalAddBtn');
  if(addBtn) addBtn.onclick = openRefGalleryAddModal;
  bindPinDragReorder(
    box.querySelector('#refGalleryGrid'), '.pin-item-dense:not(.pin-loading)',
    ()=> items.slice(),
    async (arr)=> docRef('refgallery').set({items:arr}, {merge:true})
  );
}

function openRefGalleryViewModal(idx){
  const items = (refGalleryData.items || []).map(normalizeRefGalleryItem);
  openImageLightbox({
    items,
    index: idx,
    resolve: resolveGalleryItemUrl,
    onDelete: editMode ? async (i)=>{
      const arr = (refGalleryData.items||[]).map(normalizeRefGalleryItem);
      const [removed] = arr.splice(i,1);
      await docRef('refgallery').set({items:arr}, {merge:true});
      deleteGalleryImageIfChunked(removed);
    } : null
  });
}

function openRefGalleryAddModal(){
  openModal(`
    <h3>레퍼런스 사진 추가</h3>
    <label>사진 올리기 (기기에서 여러 장 선택 가능)</label>
    <input type="file" id="refGalFiles" accept="image/*" multiple>
    <p class="hint">화면에 맞게 자동으로 압축해서 맨 앞에 추가돼요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="refGalUrl" placeholder="https://...">
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const files = Array.from(m.querySelector('#refGalFiles').files || []);
      const url = normalizeImageUrl(m.querySelector('#refGalUrl').value.trim());
      const newItems = [];
      if(files.length){
        saveBtn.disabled = true;
        for(let i=0;i<files.length;i++){
          saveBtn.textContent = `처리 중… (${i+1}/${files.length})`;
          try{
            const dataUrl = await compressImageFile(files[i], 1200, 260000);
            const stored = await storeGalleryImage(dataUrl);
            newItems.push(stored);
          }catch(err){ toast(`"${files[i].name}" 처리 실패`); }
        }
      } else if(url){
        newItems.push({ url });
      } else {
        toast('사진을 선택하거나 URL을 입력해주세요');
        return;
      }
      try{
        const existing = (refGalleryData.items||[]).map(normalizeRefGalleryItem);
        await docRef('refgallery').set({ items: [...newItems, ...existing] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 용량이 크면 URL 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('refgallery').onSnapshot(doc=>{ refGalleryData = doc.exists ? doc.data() : {items:[]}; renderRefGallery(); });

/* ---------------- 6-1. 문서 정리 (갤러리와 세션카드 사이) ---------------- */

let docsData = { cards: [] };
let docOptionsData = { options: [] };
const DOC_FILE_MAX_BYTES = 650000; // 이 크기까지는 카드 문서 안에 바로 저장(가장 빠름)
const DOC_FILE_CHUNKED_MAX_BYTES = 8 * 1024 * 1024; // 이보다 크면 여러 문서로 나눠 저장(파이어스토리지 없이 8MB까지)

function renderDocs(){
  const list = document.getElementById('docList');
  const cards = docsData.cards || [];
  list.innerHTML = cards.map((c,i)=> `
    <div class="doc-row" data-idx="${i}">
      <span class="doc-icon">${escapeHtml(c.icon || '📄')}</span>
      <div class="doc-main">
        <div class="doc-title">${escapeHtml(c.title)}</div>
        ${c.opt ? `<div class="doc-opt">${escapeHtml(c.opt)}</div>` : ''}
        ${c.desc ? `<div class="doc-desc">${escapeHtml(c.desc)}</div>` : ''}
      </div>
      ${c.chunked
        ? `<a class="doc-open" href="#" data-open="${i}">열기 ↗</a>`
        : (c.link
            ? (c.link.startsWith('data:')
                ? `<a class="doc-open" href="#" data-open-direct="${i}">열기 ↗</a>`
                : `<a class="doc-open" href="${escapeHtml(c.link)}" target="_blank" rel="noopener">열기 ↗</a>`)
            : '')}
      ${editMode ? `<button class="doc-edit" data-edit="${i}">✎</button>` : ''}
      ${editMode ? `<button class="doc-del" data-del="${i}">✕</button>` : ''}
    </div>
  `).join('') || `<div class="w-empty">정리된 문서가 없어요</div>`;

  list.querySelectorAll('[data-open]').forEach(a=> a.addEventListener('click', async (e)=>{
    e.preventDefault();
    const idx = Number(a.dataset.open);
    const c = docsData.cards[idx];
    const original = a.textContent;
    a.textContent = '불러오는 중…';
    try{
      const base64 = await loadFileChunked(c.fileId, c.chunkTotal);
      openDataUrlAsBlob(base64);
    }catch(err){ toast('파일을 불러오지 못했어요'); }
    a.textContent = original;
  }));

  list.querySelectorAll('[data-open-direct]').forEach(a=> a.addEventListener('click', (e)=>{
    e.preventDefault();
    const idx = Number(a.dataset.openDirect);
    const c = docsData.cards[idx];
    if(c && c.link) openDataUrlAsBlob(c.link);
  }));

  list.querySelectorAll('[data-edit]').forEach(btn=> btn.addEventListener('click', ()=> openDocEditModal(Number(btn.dataset.edit))));

  list.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async ()=>{
    const idx = Number(btn.dataset.del);
    const removed = docsData.cards[idx];
    const arr = [...docsData.cards]; arr.splice(idx,1);
    await docRef('documents').set({cards:arr}, {merge:true});
    if(removed && removed.chunked) deleteFileChunked(removed.fileId, removed.chunkTotal).catch(()=>{});
  }));

  const wrap = document.getElementById('docAddWrap');
  wrap.innerHTML = editMode ? `<div class="doc-add-row"><button class="btn small doc-add" id="docAddBtn">+ 문서 추가</button><button class="btn small ghost" id="docOptsBtn">⚙ 옵션 관리</button></div>` : '';
  const addBtn = document.getElementById('docAddBtn');
  if(addBtn) addBtn.onclick = openDocAddModal;
  const optsBtn = document.getElementById('docOptsBtn');
  if(optsBtn) optsBtn.onclick = openDocOptionsModal;
}

function openDocAddModal(){
  openModal(`
    <h3>문서 추가</h3>
    <label>아이콘(이모지, 선택)</label><input type="text" id="dcIcon" placeholder="📄" maxlength="2">
    <label>제목</label><input type="text" id="dcTitle" placeholder="예: 설정집, 규칙 정리">
    <label>설명 (선택)</label><input type="text" id="dcDesc" placeholder="한 줄 설명">
    <label>옵션 (부제, 선택)</label>
    <select id="dcOpt">
      <option value="">없음</option>
      ${(docOptionsData.options||[]).map(o=> `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
    </select>
    <p class="hint">옵션 목록은 아래쪽 "⚙ 옵션 관리"에서 직접 추가/수정할 수 있어요.</p>
    <div class="radio-row">
      <label><input type="radio" name="doc-src" value="link" checked> 링크로 연결</label>
      <label><input type="radio" name="doc-src" value="file"> 파일 올리기</label>
    </div>
    <div id="dcLinkWrap">
      <label>문서 링크 (구글드라이브 공유 링크 등)</label><input type="url" id="dcLink" placeholder="https://drive.google.com/...">
    </div>
    <div id="dcFileWrap" style="display:none">
      <label>파일 선택</label><input type="file" id="dcFile">
      <p class="hint">약 ${Math.round(DOC_FILE_CHUNKED_MAX_BYTES/1024/1024)}MB까지 파이어스토리지 없이 바로 올릴 수 있어요. 그보다 크면 "링크로 연결"을 이용해주세요. (용량이 크면 저장/열기에 몇 초 더 걸릴 수 있어요)</p>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelectorAll('input[name="doc-src"]').forEach(r=> r.addEventListener('change', ()=>{
      const isLink = m.querySelector('input[name="doc-src"]:checked').value === 'link';
      m.querySelector('#dcLinkWrap').style.display = isLink ? '' : 'none';
      m.querySelector('#dcFileWrap').style.display = isLink ? 'none' : '';
    }));
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const title = m.querySelector('#dcTitle').value.trim();
      const desc = m.querySelector('#dcDesc').value.trim();
      const icon = m.querySelector('#dcIcon').value.trim();
      if(!title){ toast('제목을 입력해주세요'); return; }
      const isLink = m.querySelector('input[name="doc-src"]:checked').value === 'link';
      const opt = m.querySelector('#dcOpt').value;
      let link = '';
      let chunkInfo = null;
      if(isLink){
        link = m.querySelector('#dcLink').value.trim();
      } else {
        const file = m.querySelector('#dcFile').files[0];
        if(file){
          if(file.size > DOC_FILE_CHUNKED_MAX_BYTES){
            toast(`파일이 너무 커요 (최대 ${Math.round(DOC_FILE_CHUNKED_MAX_BYTES/1024/1024)}MB). "링크로 연결"을 이용해주세요.`);
            return;
          }
          saveBtn.disabled = true; saveBtn.textContent = '처리 중…';
          let base64;
          try{ base64 = await fileToBase64(file); }
          catch(err){ toast('파일을 읽지 못했어요'); saveBtn.disabled=false; saveBtn.textContent='추가'; return; }
          if(file.size > DOC_FILE_MAX_BYTES){
            try{ chunkInfo = await saveFileChunked(base64); }
            catch(err){ toast('저장하지 못했어요. 링크 방식을 이용해주세요.'); saveBtn.disabled=false; saveBtn.textContent='추가'; return; }
          } else {
            link = base64;
          }
        }
      }
      const newCard = { icon, title, desc, opt, link };
      if(chunkInfo){ newCard.chunked = true; newCard.fileId = chunkInfo.fileId; newCard.chunkTotal = chunkInfo.total; }
      const updatedCards = [...(docsData.cards||[]), newCard];
      try{
        await docRef('documents').set({ cards: updatedCards }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 링크 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      docsData = { ...docsData, cards: updatedCards };
      renderDocs();
      closeModal();
    };
  });
}

docRef('documents').onSnapshot(doc=>{ docsData = doc.exists ? doc.data() : {cards:[]}; renderDocs(); });
docRef('docOptions').onSnapshot(doc=>{ docOptionsData = doc.exists ? doc.data() : {options:[]}; });

function openDocOptionsModal(){
  let workingOptions = [...(docOptionsData.options||[])];
  openModal(`
    <h3>문서 옵션(부제) 관리</h3>
    <p class="hint">여기서 만든 옵션은 문서 추가/수정 시 부제처럼 고를 수 있어요.</p>
    <div class="opt-list" id="optList"></div>
    <div class="w-edit-row" style="display:flex;gap:6px;">
      <input type="text" id="optNew" placeholder="새 옵션 (예: 설정집)">
      <button class="btn small" id="optAddBtn">+ 추가</button>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    const listEl = m.querySelector('#optList');
    const draw = ()=>{
      listEl.innerHTML = workingOptions.map((opt,i)=> `
        <div class="opt-row" data-idx="${i}">
          <input type="text" class="opt-input" value="${escapeHtml(opt)}">
          <button class="btn small danger" data-del="${i}">✕</button>
        </div>
      `).join('') || `<div class="w-empty">등록된 옵션이 없어요</div>`;
      listEl.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', ()=>{
        workingOptions.splice(Number(btn.dataset.del), 1);
        draw();
      }));
    };
    draw();
    m.querySelector('#optAddBtn').onclick = ()=>{
      const input = m.querySelector('#optNew');
      const val = input.value.trim();
      if(!val) return;
      workingOptions.push(val);
      input.value = '';
      draw();
    };
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const options = Array.from(listEl.querySelectorAll('.opt-input')).map(inp=> inp.value.trim()).filter(Boolean);
      saveBtn.disabled = true; saveBtn.textContent = '저장 중…';
      try{
        await docRef('docOptions').set({ options }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요');
        saveBtn.disabled = false; saveBtn.textContent = '저장';
        return;
      }
      docOptionsData = { options };
      renderDocs();
      closeModal();
    };
  });
}

function openDocEditModal(idx){
  const c = docsData.cards[idx];
  const currentDesc = c.chunked ? '파일 (자동 분할 저장됨)' : (c.link ? (c.link.startsWith('data:') ? '파일 (직접 저장됨)' : '링크') : '없음');
  openModal(`
    <h3>문서 수정</h3>
    <label>아이콘(이모지, 선택)</label><input type="text" id="dcIcon" placeholder="📄" maxlength="2" value="${escapeHtml(c.icon||'')}">
    <label>제목</label><input type="text" id="dcTitle" value="${escapeHtml(c.title||'')}">
    <label>설명 (선택)</label><input type="text" id="dcDesc" value="${escapeHtml(c.desc||'')}">
    <label>옵션 (부제, 선택)</label>
    <select id="dcOptE">
      <option value="" ${!c.opt?'selected':''}>없음</option>
      ${(docOptionsData.options||[]).map(o=> `<option value="${escapeHtml(o)}" ${o===c.opt?'selected':''}>${escapeHtml(o)}</option>`).join('')}
    </select>
    <p class="hint">현재 연결: ${currentDesc}. 그대로 두거나 아래에서 바꿀 수 있어요.</p>
    <div class="radio-row">
      <label><input type="radio" name="doc-src-e" value="keep" checked> 그대로 유지</label>
      <label><input type="radio" name="doc-src-e" value="link"> 링크로 바꾸기</label>
      <label><input type="radio" name="doc-src-e" value="file"> 파일로 바꾸기</label>
    </div>
    <div id="dcLinkWrapE" style="display:none">
      <label>문서 링크 (구글드라이브 공유 링크 등)</label><input type="url" id="dcLinkE" placeholder="https://drive.google.com/...">
    </div>
    <div id="dcFileWrapE" style="display:none">
      <label>파일 선택</label><input type="file" id="dcFileE">
      <p class="hint">약 ${Math.round(DOC_FILE_CHUNKED_MAX_BYTES/1024/1024)}MB까지 가능해요.</p>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    m.querySelectorAll('input[name="doc-src-e"]').forEach(r=> r.addEventListener('change', ()=>{
      const val = m.querySelector('input[name="doc-src-e"]:checked').value;
      m.querySelector('#dcLinkWrapE').style.display = val==='link' ? '' : 'none';
      m.querySelector('#dcFileWrapE').style.display = val==='file' ? '' : 'none';
    }));
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const title = m.querySelector('#dcTitle').value.trim();
      const desc = m.querySelector('#dcDesc').value.trim();
      const icon = m.querySelector('#dcIcon').value.trim();
      const opt = m.querySelector('#dcOptE').value;
      if(!title){ toast('제목을 입력해주세요'); return; }
      const mode = m.querySelector('input[name="doc-src-e"]:checked').value;
      const updated = { icon, title, desc, opt, link: c.link || '' };
      if(c.chunked){ updated.chunked = true; updated.fileId = c.fileId; updated.chunkTotal = c.chunkTotal; }
      let oldChunkToDelete = null;

      if(mode === 'link'){
        const link = m.querySelector('#dcLinkE').value.trim();
        if(!link){ toast('링크를 입력해주세요'); return; }
        if(c.chunked) oldChunkToDelete = { fileId: c.fileId, total: c.chunkTotal };
        updated.link = link;
        delete updated.chunked; delete updated.fileId; delete updated.chunkTotal;
      } else if(mode === 'file'){
        const file = m.querySelector('#dcFileE').files[0];
        if(!file){ toast('파일을 선택해주세요'); return; }
        if(file.size > DOC_FILE_CHUNKED_MAX_BYTES){
          toast(`파일이 너무 커요 (최대 ${Math.round(DOC_FILE_CHUNKED_MAX_BYTES/1024/1024)}MB).`);
          return;
        }
        saveBtn.disabled = true; saveBtn.textContent = '처리 중…';
        let base64;
        try{ base64 = await fileToBase64(file); }
        catch(err){ toast('파일을 읽지 못했어요'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
        if(c.chunked) oldChunkToDelete = { fileId: c.fileId, total: c.chunkTotal };
        if(file.size > DOC_FILE_MAX_BYTES){
          let chunkInfo;
          try{ chunkInfo = await saveFileChunked(base64); }
          catch(err){ toast('저장하지 못했어요.'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
          updated.chunked = true; updated.fileId = chunkInfo.fileId; updated.chunkTotal = chunkInfo.total;
          updated.link = '';
        } else {
          updated.link = base64;
          delete updated.chunked; delete updated.fileId; delete updated.chunkTotal;
        }
      }

      const arr = [...docsData.cards]; arr[idx] = updated;
      saveBtn.disabled = true; saveBtn.textContent = '저장 중…';
      try{
        await docRef('documents').set({ cards: arr }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요.');
        saveBtn.disabled = false; saveBtn.textContent = '저장';
        return;
      }
      if(oldChunkToDelete) deleteFileChunked(oldChunkToDelete.fileId, oldChunkToDelete.total).catch(()=>{});
      docsData = { ...docsData, cards: arr };
      renderDocs();
      closeModal();
    };
  });
}

/* ---------------- 7. 자료 카드 (썸네일 이미지만 보이고, 누르면 PDF/링크로 연결) ---------------- */

let sessionsData = { cards: [] };
const SESSION_PDF_MAX_BYTES = 650000; // 이 크기까지는 카드 문서 안에 바로 저장(가장 빠름)
const SESSION_PDF_CHUNKED_MAX_BYTES = 8 * 1024 * 1024; // 이보다 크면 여러 문서로 나눠 저장(파이어스토리지 없이 8MB까지)
const SESSION_THUMB_MAX_BYTES = 220000;

function renderSessions(){
  const grid = document.getElementById('sessionGrid');
  const cards = sessionsData.cards || [];
  grid.innerHTML = cards.map((c,i)=> `
    <div class="session-card" data-idx="${i}" title="${escapeHtml(c.title||'')}">
      ${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.title||'')}">` : `<div class="session-noimg">📄</div>`}
      ${editMode ? `<button class="edit" data-edit="${i}">✎</button>` : ''}
      ${editMode ? `<button class="del" data-del="${i}">✕</button>` : ''}
    </div>
  `).join('') || `<div class="w-empty" style="grid-column:1/-1">등록된 자료가 없어요</div>`;

  grid.querySelectorAll('.session-card').forEach(el=> el.addEventListener('click', async (e)=>{
    if(e.target.closest('[data-del]') || e.target.closest('[data-edit]')) return;
    const idx = Number(el.dataset.idx);
    const card = sessionsData.cards[idx];
    if(card.chunked){
      toast('자료를 불러오는 중…');
      try{
        const base64 = await loadFileChunked(card.fileId, card.chunkTotal);
        openDataUrlAsBlob(base64);
      }catch(err){ toast('자료를 불러오지 못했어요'); }
    } else if(card.pdf){
      if(card.pdf.startsWith('data:')) openDataUrlAsBlob(card.pdf);
      else window.open(card.pdf, '_blank');
    } else {
      toast('연결된 자료가 없어요');
    }
  }));
  grid.querySelectorAll('[data-edit]').forEach(btn=> btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    openSessionEditModal(Number(btn.dataset.edit));
  }));
  grid.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const removed = sessionsData.cards[idx];
    const arr = [...sessionsData.cards]; arr.splice(idx,1);
    await docRef('sessions').set({cards:arr}, {merge:true});
    if(removed && removed.chunked) deleteFileChunked(removed.fileId, removed.chunkTotal).catch(()=>{});
  }));

  const wrap = document.getElementById('sessionAddWrap');
  wrap.innerHTML = editMode ? `<button class="btn small session-add" id="sessAddBtn">+ 자료 추가</button>` : '';
  const addBtn = document.getElementById('sessAddBtn');
  if(addBtn) addBtn.onclick = openSessionAddModal;
}

function openSessionAddModal(){
  openModal(`
    <h3>자료 추가</h3>
    <label>썸네일 이미지 (사진 한 장)</label>
    <input type="file" id="sThumbFile" accept="image/*">
    <p class="hint">화면에 맞게 자동으로 압축해서 저장돼요. 카드에는 이 사진만 보여요.</p>
    <label>제목 (선택 — 마우스를 올리면 보여요)</label><input type="text" id="sTitle" placeholder="예: 1화 - 첫 만남">
    <div class="radio-row">
      <label><input type="radio" name="pdf-src" value="file" checked> PDF 파일 올리기</label>
      <label><input type="radio" name="pdf-src" value="link"> 링크로 연결</label>
    </div>
    <div id="pdfFileWrap">
      <label>PDF 파일</label><input type="file" id="sPdfFile" accept="application/pdf">
      <p class="hint">약 ${Math.round(SESSION_PDF_CHUNKED_MAX_BYTES/1024/1024)}MB까지 파이어스토리지 없이 바로 올릴 수 있어요. 그보다 크면 오른쪽 "링크로 연결"을 골라서 구글드라이브 공유 링크를 붙여넣어주세요. (용량이 크면 저장/열기에 몇 초 더 걸릴 수 있어요)</p>
    </div>
    <div id="pdfLinkWrap" style="display:none">
      <label>링크 (구글드라이브 공유 링크 등)</label><input type="url" id="sPdfLink" placeholder="https://drive.google.com/...">
    </div>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelectorAll('input[name="pdf-src"]').forEach(r=> r.addEventListener('change', ()=>{
      const isFile = m.querySelector('input[name="pdf-src"]:checked').value === 'file';
      m.querySelector('#pdfFileWrap').style.display = isFile ? '' : 'none';
      m.querySelector('#pdfLinkWrap').style.display = isFile ? 'none' : '';
    }));
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const title = m.querySelector('#sTitle').value.trim();
      const thumbFile = m.querySelector('#sThumbFile').files[0];
      if(!thumbFile){ toast('썸네일 이미지를 선택해주세요'); return; }
      const isFile = m.querySelector('input[name="pdf-src"]:checked').value === 'file';
      let pdf = '';
      let pdfChunkInfo = null;
      if(isFile){
        const file = m.querySelector('#sPdfFile').files[0];
        if(!file){ toast('PDF 파일을 선택하거나 "링크로 연결"을 골라주세요'); return; }
        if(file.size > SESSION_PDF_CHUNKED_MAX_BYTES){
          toast(`PDF 용량이 너무 커요 (최대 ${Math.round(SESSION_PDF_CHUNKED_MAX_BYTES/1024/1024)}MB). "링크로 연결"을 이용해주세요.`);
          return;
        }
        saveBtn.disabled = true; saveBtn.textContent = '처리 중…';
        let base64;
        try{ base64 = await fileToBase64(file); }
        catch(err){ toast('PDF를 읽지 못했어요'); saveBtn.disabled=false; saveBtn.textContent='추가'; return; }
        if(file.size > SESSION_PDF_MAX_BYTES){
          try{ pdfChunkInfo = await saveFileChunked(base64); }
          catch(err){ toast('저장하지 못했어요. 링크 방식을 이용해주세요.'); saveBtn.disabled=false; saveBtn.textContent='추가'; return; }
        } else {
          pdf = base64;
        }
      } else {
        pdf = m.querySelector('#sPdfLink').value.trim();
        if(!pdf){ toast('링크를 입력해주세요'); return; }
      }
      saveBtn.disabled = true; saveBtn.textContent = '처리 중…';
      let thumb = '';
      try{
        thumb = await compressImageFile(thumbFile, 900, SESSION_THUMB_MAX_BYTES);
      }catch(err){
        toast('썸네일 이미지를 처리하지 못했어요');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      const newCard = { title, thumb, pdf };
      if(pdfChunkInfo){ newCard.chunked = true; newCard.fileId = pdfChunkInfo.fileId; newCard.chunkTotal = pdfChunkInfo.total; }
      const updatedCards = [...(sessionsData.cards||[]), newCard];
      try{
        await docRef('sessions').set({ cards: updatedCards }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. PDF 용량이 크면 링크 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      sessionsData = { ...sessionsData, cards: updatedCards };
      renderSessions();
      closeModal();
    };
  });
}

docRef('sessions').onSnapshot(doc=>{ sessionsData = doc.exists ? doc.data() : {cards:[]}; renderSessions(); });

function openSessionEditModal(idx){
  const c = sessionsData.cards[idx];
  const pdfStatus = c.chunked ? '자료(자동 분할 저장됨)' : (c.pdf ? (c.pdf.startsWith('data:') ? '자료(직접 저장됨)' : '링크') : '없음');
  openModal(`
    <h3>자료 수정</h3>
    <label>제목 (선택 — 마우스를 올리면 보여요)</label><input type="text" id="sTitle" value="${escapeHtml(c.title||'')}">
    <label>썸네일 이미지 교체 (선택 — 비워두면 기존 사진 유지)</label>
    <input type="file" id="sThumbFileE" accept="image/*">
    <p class="hint">현재 연결된 자료: ${pdfStatus}. 그대로 두거나 아래에서 바꿀 수 있어요.</p>
    <div class="radio-row">
      <label><input type="radio" name="pdf-src-e" value="keep" checked> 그대로 유지</label>
      <label><input type="radio" name="pdf-src-e" value="file"> PDF 파일로 바꾸기</label>
      <label><input type="radio" name="pdf-src-e" value="link"> 링크로 바꾸기</label>
    </div>
    <div id="pdfFileWrapE" style="display:none">
      <label>PDF 파일</label><input type="file" id="sPdfFileE" accept="application/pdf">
      <p class="hint">약 ${Math.round(SESSION_PDF_CHUNKED_MAX_BYTES/1024/1024)}MB까지 가능해요.</p>
    </div>
    <div id="pdfLinkWrapE" style="display:none">
      <label>링크 (구글드라이브 공유 링크 등)</label><input type="url" id="sPdfLinkE" placeholder="https://drive.google.com/...">
    </div>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    m.querySelectorAll('input[name="pdf-src-e"]').forEach(r=> r.addEventListener('change', ()=>{
      const val = m.querySelector('input[name="pdf-src-e"]:checked').value;
      m.querySelector('#pdfFileWrapE').style.display = val==='file' ? '' : 'none';
      m.querySelector('#pdfLinkWrapE').style.display = val==='link' ? '' : 'none';
    }));
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const title = m.querySelector('#sTitle').value.trim();
      const mode = m.querySelector('input[name="pdf-src-e"]:checked').value;
      const updated = { title, thumb: c.thumb, pdf: c.pdf || '' };
      if(c.chunked){ updated.chunked = true; updated.fileId = c.fileId; updated.chunkTotal = c.chunkTotal; }
      let oldChunkToDelete = null;

      saveBtn.disabled = true; saveBtn.textContent = '처리 중…';

      const thumbFile = m.querySelector('#sThumbFileE').files[0];
      if(thumbFile){
        try{ updated.thumb = await compressImageFile(thumbFile, 900, SESSION_THUMB_MAX_BYTES); }
        catch(err){ toast('썸네일 이미지를 처리하지 못했어요'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
      }

      if(mode === 'link'){
        const link = m.querySelector('#sPdfLinkE').value.trim();
        if(!link){ toast('링크를 입력해주세요'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
        if(c.chunked) oldChunkToDelete = { fileId: c.fileId, total: c.chunkTotal };
        updated.pdf = link;
        delete updated.chunked; delete updated.fileId; delete updated.chunkTotal;
      } else if(mode === 'file'){
        const file = m.querySelector('#sPdfFileE').files[0];
        if(!file){ toast('PDF 파일을 선택해주세요'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
        if(file.size > SESSION_PDF_CHUNKED_MAX_BYTES){
          toast(`PDF 용량이 너무 커요 (최대 ${Math.round(SESSION_PDF_CHUNKED_MAX_BYTES/1024/1024)}MB).`);
          saveBtn.disabled=false; saveBtn.textContent='저장'; return;
        }
        let base64;
        try{ base64 = await fileToBase64(file); }
        catch(err){ toast('PDF를 읽지 못했어요'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
        if(c.chunked) oldChunkToDelete = { fileId: c.fileId, total: c.chunkTotal };
        if(file.size > SESSION_PDF_MAX_BYTES){
          let chunkInfo;
          try{ chunkInfo = await saveFileChunked(base64); }
          catch(err){ toast('저장하지 못했어요.'); saveBtn.disabled=false; saveBtn.textContent='저장'; return; }
          updated.chunked = true; updated.fileId = chunkInfo.fileId; updated.chunkTotal = chunkInfo.total;
          updated.pdf = '';
        } else {
          updated.pdf = base64;
          delete updated.chunked; delete updated.fileId; delete updated.chunkTotal;
        }
      }

      const arr = [...sessionsData.cards]; arr[idx] = updated;
      try{
        await docRef('sessions').set({ cards: arr }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요.');
        saveBtn.disabled = false; saveBtn.textContent = '저장';
        return;
      }
      if(oldChunkToDelete) deleteFileChunked(oldChunkToDelete.fileId, oldChunkToDelete.total).catch(()=>{});
      sessionsData = { ...sessionsData, cards: arr };
      renderSessions();
      closeModal();
    };
  });
}

/* ---------------- 8. 체크보드 (체크된 항목은 아래로) ---------------- */

let checklistData = { items: [] };

function renderChecklist(){
  const body = document.getElementById('checklistBody');
  const all = (checklistData.items || []).map((it,i)=>({...it, _i:i}));
  const unchecked = all.filter(it=> !it.checked);
  const checked = all.filter(it=> it.checked);

  function row(it){
    return `
      <div class="check-item ${it.checked?'checked':''}" data-idx="${it._i}">
        <input type="checkbox" ${it.checked?'checked':''} ${editMode?'':'disabled'}>
        <span>${escapeHtml(it.text)}</span>
        ${editMode ? `<button class="del">✕</button>` : ''}
      </div>
    `;
  }

  body.innerHTML =
    unchecked.map(row).join('') +
    (unchecked.length && checked.length ? `<div class="check-divider"></div>` : '') +
    checked.map(row).join('') ||
    `<div class="w-empty">등록된 항목이 없어요</div>`;

  body.querySelectorAll('.check-item').forEach(el=>{
    const idx = Number(el.dataset.idx);
    const cb = el.querySelector('input[type=checkbox]');
    cb.addEventListener('change', async ()=>{
      if(!editMode) return;
      const arr = [...checklistData.items];
      arr[idx] = { ...arr[idx], checked: cb.checked };
      await docRef('checklist').set({items:arr}, {merge:true});
    });
    const del = el.querySelector('.del');
    if(del) del.addEventListener('click', async ()=>{
      const arr = [...checklistData.items]; arr.splice(idx,1);
      await docRef('checklist').set({items:arr}, {merge:true});
    });
  });

  const wrap = document.getElementById('checklistAddWrap');
  wrap.innerHTML = `<input type="text" id="checkNewInput" placeholder="새 항목"><button class="btn small primary" id="checkAddBtn">추가</button>`;
  const addBtn = document.getElementById('checkAddBtn');
  const input = document.getElementById('checkNewInput');
  const submit = async ()=>{
    const text = input.value.trim();
    if(!text) return;
    await docRef('checklist').set({ items: [...(checklistData.items||[]), {text, checked:false}] }, {merge:true});
    input.value = '';
  };
  addBtn.onclick = submit;
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
}

docRef('checklist').onSnapshot(doc=>{ checklistData = doc.exists ? doc.data() : {items:[]}; renderChecklist(); });

/* ---------------- 초기화 ---------------- */

refreshLockUI();
