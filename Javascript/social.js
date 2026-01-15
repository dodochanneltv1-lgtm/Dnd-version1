// Javascript/social.js (Final Version: Mutual Friend Fix)

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
    
    // Avatar
    const avatarHtml = `
        <img class="msg-avatar-img" 
             src="${msg.photoURL || 'https://via.placeholder.com/40'}"
             onclick="showUserProfile('${msg.senderUid || msg.sender}')" 
             title="ดูข้อมูล">
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
            
            const div = document.createElement('div');
            div.style.cssText = "padding:10px; border-bottom:1px solid #333; cursor:pointer; display:flex; align-items:center;";
            div.onclick = () => openPrivate(uid, u.username);
            
            div.innerHTML = `
                <img src="${u.photoURL}" style="width:35px; height:35px; border-radius:50%; margin-right:10px;">
                <div>
                    <div style="font-weight:bold; color:${isOnline?'#0f0':'#ccc'}">${u.username}</div>
                    <div style="font-size:0.8em; color:#666;">${isOnline?'ออนไลน์':'ออฟไลน์'}</div>
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
}

function renderSearchUI(container) {
    container.innerHTML = `
        <div style="padding:10px;">
            <input id="sInput" placeholder="ชื่อเพื่อน..." style="width:100%; padding:8px; background:#333; border:1px solid #555; color:#fff;">
            <button onclick="doSearch()" style="width:100%; margin-top:5px; padding:5px; background:#ffae00; border:none; cursor:pointer;">ค้นหา</button>
            <div id="sRes" style="margin-top:10px;"></div>
        </div>
    `;
}

function doSearch() {
    const val = document.getElementById('sInput').value.trim();
    if(!val) return;
    db.ref('users').orderByChild('username').equalTo(val).once('value').then(s => {
        const res = document.getElementById('sRes');
        res.innerHTML = '';
        if(!s.exists()) { res.innerHTML = '<span style="color:red">ไม่พบ</span>'; return; }
        s.forEach(async c => {
            const u = c.val();
            const uid = c.key;
            if(uid === currentUser.uid) return;

            // ตรวจสอบสถานะเพื่อแสดงปุ่มให้ถูก
            let btnHtml = await getFriendButtonState(uid);
            
            // สร้าง Element
            const div = document.createElement('div');
            div.style.cssText = "background:#222; padding:5px; margin-bottom:5px; display:flex; align-items:center;";
            div.innerHTML = `
                <img src="${u.photoURL}" style="width:30px; height:30px; border-radius:50%; margin-right:5px;">
                <span style="flex:1">${u.username}</span>
                ${btnHtml}
            `;
            res.appendChild(div);
        });
    });
}

// 🔥 Helper ตรวจสอบสถานะเพื่อนสำหรับปุ่ม (Search)
async function getFriendButtonState(targetUid) {
    // 1. เป็นเพื่อนกันแล้ว?
    const isFriend = (await db.ref(`users/${currentUser.uid}/friends/${targetUid}`).get()).exists();
    if (isFriend) return `<button disabled style="background:#555; color:#fff; border:none; padding:2px 5px;">เพื่อนแล้ว</button>`;

    // 2. เขาแอดเรามา? (Incoming)
    const incoming = (await db.ref(`friend_requests/${currentUser.uid}/${targetUid}`).get()).exists();
    if (incoming) return `<button onclick="handleSmartAdd('${targetUid}')" style="background:#17a2b8; color:#fff; border:none; padding:2px 5px; cursor:pointer;">รับแอด</button>`;

    // 3. เราแอดเขาไป? (Outgoing - เช็คยากหน่อยถ้าไม่มี Node เก็บ แต่เราปล่อยให้กด + ได้ มันจะแค่ทับอันเดิม)
    return `<button onclick="handleSmartAdd('${targetUid}')" style="background:green; color:#fff; border:none; padding:2px 8px; cursor:pointer;">+</button>`;
}

// 🔥 [CORE FIX] ระบบแอดเพื่อนอัจฉริยะ (จัดการ Mutual Request)
async function handleSmartAdd(targetUid) {
    // 1. เช็คก่อนว่า "เขาแอดเรามาหรือยัง?" (เช็คใน Inbox เรา)
    const incomingReq = await db.ref(`friend_requests/${currentUser.uid}/${targetUid}`).get();

    if (incomingReq.exists()) {
        // CASE A: เขาแอดมาแล้ว -> เรากดแอดกลับ = รับเพื่อนทันที! (Mutual Fix)
        await ansReq(targetUid, true); // เรียกฟังก์ชันรับเพื่อน
        Swal.fire('ยินดีด้วย!', 'คุณทั้งคู่ใจตรงกัน เป็นเพื่อนกันเรียบร้อย!', 'success');
    } else {
        // CASE B: ปกติ -> ส่งคำขอไปหาเขา
        await db.ref(`friend_requests/${targetUid}/${currentUser.uid}`).set({
            fromName: currentUser.displayName || 'Unknown',
            fromPhoto: currentUser.photoURL,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        Swal.fire('ส่งคำขอแล้ว', '', 'success');
    }
    
    // Refresh UI ถ้าเปิด Modal อยู่
    if(document.getElementById('profileModal').style.display === 'flex') {
        showUserProfile(targetUid);
    }
    // Refresh UI ถ้าค้นหาอยู่
    const sInput = document.getElementById('sInput');
    if(sInput && sInput.value) doSearch(); 
}

function loadReqs() {
    const sidebar = document.getElementById('sidebar-list');
    db.ref(`friend_requests/${currentUser.uid}`).on('value', s => {
        sidebar.innerHTML = '';
        if(!s.exists()) { sidebar.innerHTML = '<div style="padding:20px; text-align:center;">ไม่มีคำขอ</div>'; return; }
        s.forEach(c => {
            const r = c.val();
            const uid = c.key;
            sidebar.innerHTML += `
                <div style="padding:10px; border-bottom:1px solid #333;">
                    <div style="display:flex; align-items:center; margin-bottom:5px;">
                        <img src="${r.fromPhoto}" style="width:25px; height:25px; border-radius:50%; margin-right:5px;">
                        <strong>${r.fromName}</strong>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <button onclick="ansReq('${uid}',true)" style="flex:1; background:green; border:none; color:white; cursor:pointer;">รับ</button>
                        <button onclick="ansReq('${uid}',false)" style="flex:1; background:red; border:none; color:white; cursor:pointer;">ลบ</button>
                    </div>
                </div>
            `;
        });
    });
}

// รับ/ลบเพื่อน
async function ansReq(uid, ok) {
    if(ok) {
        let u = {};
        u[`users/${currentUser.uid}/friends/${uid}`] = true;
        u[`users/${uid}/friends/${currentUser.uid}`] = true;
        u[`friend_requests/${currentUser.uid}/${uid}`] = null; // ลบคำขอฝั่งเรา
        u[`friend_requests/${uid}/${currentUser.uid}`] = null; // (เผื่อ) ลบคำขอฝั่งเขาด้วย ถ้ามันค้าง
        await db.ref().update(u);
    } else {
        await db.ref(`friend_requests/${currentUser.uid}/${uid}`).remove();
    }
}

function listenReq() {
    db.ref(`friend_requests/${currentUser.uid}`).on('value', s => {
        const c = s.numChildren();
        document.getElementById('reqCount').innerText = c > 0 ? c : '';
    });
}

// ==========================================
// 5. Profile Modal (Logic ใหม่)
// ==========================================
async function showUserProfile(uid) {
    if(!uid) return;
    document.getElementById('profileModal').style.display = 'flex';
    
    const s = await db.ref('users/'+uid).once('value');
    const u = s.val();
    
    document.getElementById('modalAvatar').src = u.photoURL || '';
    document.getElementById('modalName').innerText = u.username || 'Unknown';
    document.getElementById('modalBio').innerText = u.bio || '-';
    
    const roleArea = document.getElementById('modalRole');
    if (u.role === 'admin') roleArea.innerHTML = '<span style="color:red; font-weight:bold;">👑 ADMIN</span>';
    else if (u.role === 'beta_tester') roleArea.innerHTML = '<span style="color:cyan; font-weight:bold;">🧪 TESTER</span>';
    else roleArea.innerHTML = '<span style="color:#aaa;">นักผจญภัย</span>';

    // ตั้งค่าปุ่ม Action
    const btn = document.getElementById('modalActionBtn');
    
    if (uid === currentUser.uid) {
        btn.innerText = 'นี่คือตัวคุณ';
        btn.disabled = true;
        btn.style.background = '#555';
        btn.onclick = null;
        return;
    }

    // 🔥 1. เช็คว่าเป็นเพื่อนยัง?
    const isFriend = (await db.ref(`users/${currentUser.uid}/friends/${uid}`).get()).exists();
    if(isFriend) {
        btn.innerText = '💬 ทักแชท';
        btn.disabled = false;
        btn.style.background = '#17a2b8';
        btn.onclick = () => {
            document.getElementById('profileModal').style.display = 'none';
            openPrivate(uid, u.username);
        };
        return;
    }

    // 🔥 2. เช็คว่าเขาแอดเรามาหรือยัง? (Incoming)
    const incomingReq = (await db.ref(`friend_requests/${currentUser.uid}/${uid}`).get()).exists();
    if (incomingReq) {
        btn.innerText = '✅ ตอบรับคำขอ'; // ปุ่มเปลี่ยนเป็นรับเพื่อนทันที
        btn.disabled = false;
        btn.style.background = '#28a745';
        btn.onclick = () => {
            handleSmartAdd(uid); // ใช้ฟังก์ชันอัจฉริยะ รับเพื่อนเลย
            btn.innerText = 'เป็นเพื่อนแล้ว';
            btn.disabled = true;
        };
        return;
    }

    // 🔥 3. ถ้าไม่มีอะไรเลย หรือเราแอดไปแล้ว (Default)
    btn.innerText = '➕ เพิ่มเพื่อน';
    btn.disabled = false;
    btn.style.background = '#28a745';
    btn.onclick = () => {
        handleSmartAdd(uid);
        btn.innerText = 'ส่งคำขอแล้ว';
        btn.disabled = true;
    };
}

function getChatId(u1, u2) { return u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`; }