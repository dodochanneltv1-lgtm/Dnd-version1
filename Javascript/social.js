// Javascript/social.js (Final Version: Unified Profile Modal)

let currentUser = null;
let currentChatType = 'world'; // 'world' | 'private'
let currentChatTargetId = null;
let activeListeners = []; 

// ==========================================
// 1. เริ่มต้นระบบ
// ==========================================
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        // Update Status
        db.ref('users/' + user.uid).update({ 
            status: 'online', 
            lastActive: firebase.database.ServerValue.TIMESTAMP 
        });
        db.ref('users/' + user.uid).onDisconnect().update({ status: 'offline' });

        switchTab('world');
        listenReq(); // ฟังตัวเลขแจ้งเตือน
    } else {
        window.location.replace('login.html');
    }
});

// ==========================================
// 2. Tab System
// ==========================================
function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`button[onclick="switchTab('${name}')"]`);
    if(btn) btn.classList.add('active');

    const sidebar = document.getElementById('sidebar-list');
    sidebar.innerHTML = '';

    if (name === 'world') {
        currentChatType = 'world';
        currentChatTargetId = null;
        sidebar.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">🌎 แชทโลก<br><small>พื้นที่พูดคุยรวม</small></div>';
        loadChat('world_chat');
    } else if (name === 'friends') {
        loadFriends();
    } else if (name === 'add') {
        renderSearchUI(sidebar);
    } else if (name === 'requests') {
        loadReqs();
    }
}

// ==========================================
// 3. Chat System
// ==========================================
function clearChat() {
    const box = document.getElementById('layer-chat-display');
    box.innerHTML = '';
    activeListeners.forEach(ref => ref.off());
    activeListeners = [];
}

function loadChat(path) {
    clearChat();
    const box = document.getElementById('layer-chat-display');
    const ref = db.ref(path).limitToLast(50);
    
    ref.on('child_added', snapshot => {
        renderMsg(snapshot.val());
    });
    activeListeners.push(ref);
}

function renderMsg(msg) {
    const box = document.getElementById('layer-chat-display');
    const isMe = (msg.senderUid === currentUser.uid) || (msg.sender === currentUser.uid);

    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'mine' : 'other'}`;
    
    // [แก้ไขจุดนี้] เปลี่ยน onclick ให้ไปเรียก openUserProfile (ตัวใหม่)
    const avatarHtml = `
        <img class="msg-avatar-img" 
             src="${msg.photoURL || 'https://via.placeholder.com/40'}"
             onclick="openUserProfile('${msg.senderUid || msg.sender}')" 
             style="cursor: pointer;"
             title="ดูโปรไฟล์">
    `;

    // Role Badge
    let roleBadge = '';
    if (msg.role === 'admin') roleBadge = '<span class="rank-badge rank-admin">ADMIN</span>';
    else if (msg.role === 'beta_tester') roleBadge = '<span class="rank-badge rank-beta">TESTER</span>';

    // Name
    const nameHtml = `
        <div class="msg-header-info">
            <span style="font-weight:bold; color:${isMe ? '#8be4ff' : '#ffae00'}">
                ${msg.senderName || 'Unknown'}
            </span>
            ${roleBadge}
        </div>
    `;

    // Time
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const bubbleHtml = `
        <div class="msg-bubble">
            ${msg.text}
            <div class="msg-time">${timeStr}</div>
        </div>
    `;

    row.innerHTML = `${avatarHtml}<div class="msg-content-col">${nameHtml}${bubbleHtml}</div>`;
    box.appendChild(row);

    setTimeout(() => {
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    }, 50);
}

// Send Message
function sendMessageAction() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    if (currentChatType === 'world') {
        db.ref('users/' + currentUser.uid).once('value').then(s => {
            const u = s.val();
            db.ref('world_chat').push({
                senderUid: currentUser.uid,
                senderName: u.username || u.email,
                photoURL: u.photoURL,
                role: u.role || 'user',
                text: text,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        });
    } else if (currentChatType === 'private' && currentChatTargetId) {
        const chatId = getChatId(currentUser.uid, currentChatTargetId);
        db.ref(`chats/${chatId}`).push({
            sender: currentUser.uid,
            text: text,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }
    input.value = '';
    input.focus();
}
document.getElementById('chatInput').addEventListener('keypress', e => {
    if(e.key === 'Enter') sendMessageAction();
});

// ==========================================
// 4. Friends & Search
// ==========================================
function loadFriends() {
    const sidebar = document.getElementById('sidebar-list');
    db.ref(`users/${currentUser.uid}/friends`).on('value', async snap => {
        if(!snap.exists()) { sidebar.innerHTML = '<div style="padding:20px; text-align:center;">ไม่มีเพื่อน</div>'; return; }
        
        sidebar.innerHTML = '';
        const promises = [];
        snap.forEach(c => promises.push(db.ref('users/'+c.key).once('value')));
        const users = await Promise.all(promises);

        users.forEach(uSnap => {
            const u = uSnap.val();
            const uid = uSnap.key;
            const isOnline = u.status === 'online';
            
            // [แก้ไขจุดนี้] คลิกเพื่อนในลิสต์ ก็ให้เปิดแชทเลย (หรือจะแก้เป็น openUserProfile ก็ได้ถ้าต้องการ)
            const div = document.createElement('div');
            div.className = 'friend-card'; // ใช้ class จาก CSS ใหม่
            div.style.cursor = "pointer";
            div.onclick = () => openPrivate(uid, u.username);
            
            div.innerHTML = `
                <img src="${u.photoURL}" style="width:40px; height:40px; border-radius:50%; margin-right:10px; border:2px solid ${isOnline?'#2ecc71':'#555'}">
                <div class="friend-info">
                    <div style="font-weight:bold; color:white;">${u.username}</div>
                    <div style="font-size:0.8em; color:${isOnline?'#2ecc71':'#888'};">${isOnline?'Online':'Offline'}</div>
                </div>
            `;
            sidebar.appendChild(div);
        });
    });
}

function openPrivate(uid, name) {
    currentChatType = 'private';
    currentChatTargetId = uid;
    loadChat(`chats/${getChatId(currentUser.uid, uid)}`);
    
    // เปลี่ยน Header ให้รู้ว่าคุยกับใคร
    const sidebar = document.getElementById('sidebar-list');
    // ถ้าอยู่ในโหมดเพื่อน ไม่ต้องล้าง Sidebar แต่ถ้าจะให้ชัดเจนก็ทำได้
}

function renderSearchUI(container) {
    container.innerHTML = `
        <div style="padding:10px;">
            <input id="sInput" placeholder="ค้นหาจากชื่อ..." class="chat-input" style="width:100%; margin-bottom:10px;">
            <button onclick="doSearch()" class="tab-btn active" style="width:100%; justify-content:center;">🔍 ค้นหา</button>
            <div id="sRes" style="margin-top:15px; display:flex; flex-direction:column; gap:10px;"></div>
        </div>
    `;
}

function doSearch() {
    const val = document.getElementById('sInput').value.trim();
    if(!val) return;
    
    db.ref('users').orderByChild('username').startAt(val).endAt(val+"\uf8ff").once('value').then(s => {
        const res = document.getElementById('sRes');
        res.innerHTML = '';
        if(!s.exists()) { res.innerHTML = '<span style="color:#aaa; text-align:center;">ไม่พบผู้ใช้งาน</span>'; return; }
        
        s.forEach(c => {
            const u = c.val();
            const uid = c.key;
            if(uid === currentUser.uid) return;

            const div = document.createElement('div');
            div.className = 'friend-card';
            div.innerHTML = `
                <img src="${u.photoURL}" style="width:40px; height:40px; border-radius:50%; margin-right:10px; border:1px solid #ffae00;">
                <div style="flex:1; color:white;">${u.username}</div>
                <button onclick="openUserProfile('${uid}')" style="background:#ffae00; border:none; border-radius:5px; padding:5px 10px; cursor:pointer;">ดู</button>
            `;
            res.appendChild(div);
        });
    });
}

// 🔥 [CORE FIX] ระบบแอดเพื่อนอัจฉริยะ
async function handleSmartAdd(targetUid) {
    // 1. เช็คก่อนว่า "เขาแอดเรามาหรือยัง?"
    const incomingReq = await db.ref(`friend_requests/${currentUser.uid}/${targetUid}`).get();

    if (incomingReq.exists()) {
        await ansReq(targetUid, true);
        Swal.fire('สำเร็จ!', 'เป็นเพื่อนกันเรียบร้อย!', 'success');
    } else {
        await db.ref(`friend_requests/${targetUid}/${currentUser.uid}`).set({
            fromName: currentUser.displayName || currentUser.email,
            fromPhoto: currentUser.photoURL,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        Swal.fire('ส่งคำขอแล้ว', 'รออีกฝ่ายตอบรับ', 'success');
    }
    
    // Refresh UI
    if(document.getElementById('profileModal').style.display === 'flex') {
        openUserProfile(targetUid);
    }
}

function loadReqs() {
    const sidebar = document.getElementById('sidebar-list');
    db.ref(`friend_requests/${currentUser.uid}`).on('value', s => {
        sidebar.innerHTML = '';
        if(!s.exists()) { sidebar.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">ไม่มีคำขอใหม่</div>'; return; }
        
        s.forEach(c => {
            const r = c.val();
            const uid = c.key;
            sidebar.innerHTML += `
                <div class="friend-card" style="flex-direction:column; align-items:flex-start;">
                    <div style="display:flex; align-items:center; margin-bottom:10px;">
                        <img src="${r.fromPhoto}" style="width:35px; height:35px; border-radius:50%; margin-right:10px;">
                        <strong style="color:white;">${r.fromName}</strong>
                    </div>
                    <div style="display:flex; gap:10px; width:100%;">
                        <button onclick="ansReq('${uid}',true)" style="flex:1; background:#2ecc71; border:none; border-radius:5px; padding:5px; color:white; cursor:pointer;">รับแอด</button>
                        <button onclick="ansReq('${uid}',false)" style="flex:1; background:#e74c3c; border:none; border-radius:5px; padding:5px; color:white; cursor:pointer;">ลบ</button>
                    </div>
                </div>
            `;
        });
    });
}

// รับ/ลบเพื่อน
async function ansReq(uid, ok) {
    try {
        if (ok) {
            let updates = {};
            updates[`users/${currentUser.uid}/friends/${uid}`] = true;
            updates[`users/${uid}/friends/${currentUser.uid}`] = true;
            updates[`friend_requests/${currentUser.uid}/${uid}`] = null; 
            updates[`friend_requests/${uid}/${currentUser.uid}`] = null; 

            await db.ref().update(updates);
            Swal.fire('เรียบร้อย', 'เพิ่มเพื่อนสำเร็จ', 'success');
        } else {
            await db.ref(`friend_requests/${currentUser.uid}/${uid}`).remove();
        }
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}

function listenReq() {
    db.ref(`friend_requests/${currentUser.uid}`).on('value', s => {
        const c = s.numChildren();
        const badge = document.getElementById('reqCount');
        if(badge) badge.innerText = c > 0 ? c : '';
    });
}

function getChatId(u1, u2) { return u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`; }

// ==========================================
// 5. 🆕 ULTRA PROFILE MODAL (Holo Edition)
// ==========================================

let currentModalTargetUid = null;

async function openUserProfile(targetUid) {
    const modal = document.getElementById('profileModal');
    const btnMain = document.getElementById('btnActionMain');
    
    // 1. Reset UI & Show Modal (เพื่อให้ Animation ทำงาน)
    modal.style.display = 'flex'; 
    
    // Reset ค่าต่างๆ
    document.getElementById('popupAvatar').src = 'https://via.placeholder.com/150';
    document.getElementById('popupName').innerText = 'Loading...';
    document.getElementById('popupBio').innerText = '...';
    document.getElementById('popupUID').innerText = targetUid;
    document.getElementById('popupJoinDate').innerText = '-';
    document.getElementById('popupEmail').innerText = '-';
    document.getElementById('popupFriendCount').innerText = '0';
    
    currentModalTargetUid = targetUid;

    try {
        // 2. ดึงข้อมูล User
        const snap = await db.ref('users/' + targetUid).get();
        if (!snap.exists()) {
            document.getElementById('popupName').innerText = 'User Not Found';
            return;
        }
        const user = snap.val();

        // 3. เติมข้อมูลพื้นฐาน
        document.getElementById('popupName').innerText = user.username || 'No Name';
        document.getElementById('popupAvatar').src = user.photoURL || 'https://via.placeholder.com/150';
        document.getElementById('popupBio').innerText = user.bio || "ผู้เล่นคนนี้ไม่ได้เขียนอะไรไว้...";
        
        // วันที่สมัคร
        if (user.createdAt) {
            document.getElementById('popupJoinDate').innerText = new Date(user.createdAt).toLocaleDateString('th-TH');
        }

        // อีเมล (Masked)
        if (user.email) {
            document.getElementById('popupEmail').innerText = user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3");
        }

        // จำนวนเพื่อน
        if (user.friends) {
            document.getElementById('popupFriendCount').innerText = Object.keys(user.friends).length;
        }

        // --- 4. จัดการ Yos (Rank & Badge) แบบจัดเต็ม ---
        const badgeElem = document.getElementById('popupRoleBadge');
        const ringElem = document.querySelector('.avatar-ring'); // วงแหวนรอบรูป

        // Reset Classes
        badgeElem.className = 'badge-float'; 
        
        if (user.role === 'admin') {
            badgeElem.innerText = 'ADMIN';
            badgeElem.classList.add('badge-admin'); // สีแดง
            ringElem.style.borderColor = '#ff4d4d'; // วงแหวนแดง
            ringElem.style.borderTopColor = 'transparent';
        } 
        else if (user.role === 'beta_tester') {
            badgeElem.innerText = 'BETA TESTER';
            badgeElem.classList.add('badge-tester'); // สีฟ้า Neon
            ringElem.style.borderColor = '#00d2ff'; // วงแหวนฟ้า
            ringElem.style.borderTopColor = 'transparent';
        } 
        else {
            badgeElem.innerText = 'ADVENTURER';
            badgeElem.classList.add('badge-user'); // สีเทา
            ringElem.style.borderColor = '#666'; 
            ringElem.style.borderTopColor = 'transparent';
        }

        // --- 5. Status Dot ---
        const statusText = document.getElementById('popupStatusText');
        const statusDot = document.getElementById('popupStatusDot');
        
        if (user.status === 'online') {
            statusText.innerText = 'Online';
            statusText.style.color = '#2ecc71';
            statusDot.className = 'dot online-dot';
        } else {
            statusText.innerText = 'Offline';
            statusText.style.color = '#7f8c8d';
            statusDot.className = 'dot';
        }

        // --- 6. ปุ่ม Action ---
        // Reset Style
        btnMain.className = 'holo-btn btn-main';
        btnMain.disabled = false;

        if (targetUid === currentUser.uid) {
            btnMain.innerText = '✏️ EDIT PROFILE';
            btnMain.className = 'holo-btn btn-main';
            btnMain.onclick = () => openEditProfileModal();
        } else {
            const friendSnap = await db.ref(`users/${currentUser.uid}/friends/${targetUid}`).get();
            
            if (friendSnap.exists()) {
                btnMain.innerText = '💬 CHAT';
                btnMain.className = 'holo-btn btn-chat';
                btnMain.onclick = () => {
                    closeProfileModal();
                    openPrivate(targetUid, user.username);
                };
            } else {
                const incomingReq = await db.ref(`friend_requests/${currentUser.uid}/${targetUid}`).get();
                if (incomingReq.exists()) {
                    btnMain.innerText = '✅ ACCEPT FRIEND';
                    btnMain.className = 'holo-btn btn-success';
                    btnMain.onclick = () => handleSmartAdd(targetUid);
                } else {
                    btnMain.innerText = '➕ ADD FRIEND';
                    btnMain.onclick = () => {
                        handleSmartAdd(targetUid);
                        btnMain.innerText = 'REQUEST SENT';
                        btnMain.disabled = true;
                    };
                }
            }
        }

    } catch (err) {
        console.error(err);
    }
}

// ปิด Modal
function closeProfileModal(e) {
    if (e && e.target.id !== 'profileModal' && e.target.className !== 'close-holo-btn') return;
    document.getElementById('profileModal').style.display = 'none';
}

function copyPopupUID() {
    const uid = document.getElementById('popupUID').innerText;
    navigator.clipboard.writeText(uid);
    const tooltip = document.getElementById('copyTooltip');
    tooltip.style.display = 'block';
    setTimeout(() => tooltip.style.display = 'none', 1500);
}

function openEditProfileModal() {
    // ปิดหน้าดูโปรไฟล์ก่อน (ถ้าเปิดอยู่)
    document.getElementById('profileModal').style.display = 'none';
    
    // ตั้งค่า Iframe ให้โหลดหน้า profile.html
    const iframe = document.getElementById('editProfileFrame');
    iframe.src = 'profile.html?mode=iframe'; // ส่ง parameter ไปบอกว่าอยู่ใน iframe
    
    // แสดง Modal
    document.getElementById('editProfileModal').style.display = 'flex';
}

// ฟังก์ชันนี้จะถูกเรียกจากภายใน Iframe (profile.html) เมื่อกดปุ่ม "ย้อนกลับ"
window.closeEditProfileModal = function() {
    document.getElementById('editProfileModal').style.display = 'none';
    
    // (Optional) รีเฟรชข้อมูลผู้ใช้ปัจจุบันในหน้าหลักเผื่อมีการเปลี่ยนรูป/ชื่อ
    if (currentUser) {
        // อาจจะเรียกฟังก์ชันอัปเดต UI หน้าจอหลักที่นี่
    }
}