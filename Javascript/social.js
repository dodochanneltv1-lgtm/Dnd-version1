// Javascript/social.js (Final Fixed Version)

let currentUser = null;
let currentChatType = 'world'; // 'world' หรือ 'private'
let currentChatTargetId = null; // ID เพื่อนที่คุยด้วย
let activeListeners = []; // เก็บตัวดักฟังเพื่อปิดเมื่อเปลี่ยนห้อง

// ==========================================
// 1. เริ่มต้นระบบ
// ==========================================
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        // อัปเดตสถานะออนไลน์
        db.ref('users/' + user.uid).update({ 
            status: 'online', 
            lastActive: firebase.database.ServerValue.TIMESTAMP 
        });
        db.ref('users/' + user.uid).onDisconnect().update({ status: 'offline' });

        switchTab('world'); // เริ่มต้นที่แชทโลก
        listenReq(); // ฟังคำขอเพื่อน
    } else {
        window.location.replace('login.html');
    }
});

// ==========================================
// 2. ระบบ Tab (Sidebar)
// ==========================================
function switchTab(name) {
    // 1. เปลี่ยนสีปุ่ม Active
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`button[onclick="switchTab('${name}')"]`);
    if(btn) btn.classList.add('active');

    // 2. เคลียร์ Sidebar
    const sidebar = document.getElementById('sidebar-list');
    sidebar.innerHTML = '';

    // 3. Logic แต่ละหน้า
    if (name === 'world') {
        currentChatType = 'world';
        currentChatTargetId = null;
        sidebar.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">🌎 แชทโลก<br><small>พื้นที่พูดคุยรวมของทุกคน</small></div>';
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
// 3. ระบบแชท (Chat Core)
// ==========================================
function clearChat() {
    const box = document.getElementById('layer-chat-display');
    box.innerHTML = '';
    // ปิด Listener เก่า
    activeListeners.forEach(ref => ref.off());
    activeListeners = [];
}

function loadChat(path) {
    clearChat();
    const box = document.getElementById('layer-chat-display');
    const ref = db.ref(path).limitToLast(50);
    
    // ฟังข้อความใหม่
    ref.on('child_added', snapshot => {
        const msg = snapshot.val();
        renderMsg(msg);
    });
    activeListeners.push(ref);
}

// 🔥 [แก้ไขจุดสำคัญ] ฟังก์ชันวาดข้อความ
function renderMsg(msg) {
    const box = document.getElementById('layer-chat-display');
    const isMe = (msg.senderUid === currentUser.uid) || (msg.sender === currentUser.uid);

    // สร้าง Row
    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'mine' : 'other'}`;
    
    // 1. รูปโปรไฟล์ (แก้ onclick ให้เรียก showUserProfile)
    const avatarHtml = `
        <img class="msg-avatar-img" 
             src="${msg.photoURL || 'https://via.placeholder.com/40'}"
             onclick="showUserProfile('${msg.senderUid || msg.sender}')" 
             title="ดูข้อมูล">
    `;

    // 2. ป้ายยศ (Role)
    let roleBadge = '';
    if (msg.role === 'admin') roleBadge = '<span class="rank-badge rank-admin">ADMIN</span>';
    else if (msg.role === 'beta_tester') roleBadge = '<span class="rank-badge rank-beta">TESTER</span>';

    // 3. ชื่อผู้ส่ง
    const nameHtml = `
        <div class="msg-header-info">
            <span style="font-weight:bold; color:${isMe ? '#8be4ff' : '#ffae00'}">
                ${msg.senderName || 'Unknown'}
            </span>
            ${roleBadge}
        </div>
    `;

    // 4. ข้อความ + เวลา
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const bubbleHtml = `
        <div class="msg-bubble">
            ${msg.text}
            <div class="msg-time">${timeStr}</div>
        </div>
    `;

    // ประกอบร่าง
    row.innerHTML = `
        ${avatarHtml}
        <div class="msg-content-col">
            ${nameHtml}
            ${bubbleHtml}
        </div>
    `;

    box.appendChild(row);

    // Scroll ลงล่างสุด (รอ 50ms ให้วาดเสร็จ)
    setTimeout(() => {
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    }, 50);
}

// ==========================================
// 4. ส่งข้อความ
// ==========================================
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
// กด Enter ส่ง
document.getElementById('chatInput').addEventListener('keypress', e => {
    if(e.key === 'Enter') sendMessageAction();
});

// ==========================================
// 5. ระบบเพื่อน & ค้นหา
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
    // เปลี่ยน Header ชั่วคราวเพื่อให้รู้ว่าคุยกับใคร
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
        s.forEach(c => {
            const u = c.val();
            const uid = c.key;
            if(uid === currentUser.uid) return;
            res.innerHTML += `
                <div style="background:#222; padding:5px; margin-bottom:5px; display:flex; align-items:center;">
                    <img src="${u.photoURL}" style="width:30px; height:30px; border-radius:50%; margin-right:5px;">
                    <span>${u.username}</span>
                    <button onclick="sendReq('${uid}')" style="margin-left:auto; background:green; border:none; color:fff; cursor:pointer;">+</button>
                </div>
            `;
        });
    });
}

function sendReq(uid) {
    db.ref(`friend_requests/${uid}/${currentUser.uid}`).set({
        fromName: currentUser.displayName || 'Unknown',
        fromPhoto: currentUser.photoURL,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    }).then(() => Swal.fire('ส่งแล้ว','','success'));
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
                    <div>${r.fromName} ขอเป็นเพื่อน</div>
                    <div style="margin-top:5px; display:flex; gap:5px;">
                        <button onclick="ansReq('${uid}',true)" style="flex:1; background:green; border:none; color:white;">รับ</button>
                        <button onclick="ansReq('${uid}',false)" style="flex:1; background:red; border:none; color:white;">ลบ</button>
                    </div>
                </div>
            `;
        });
    });
}

function ansReq(uid, ok) {
    if(ok) {
        let u = {};
        u[`users/${currentUser.uid}/friends/${uid}`] = true;
        u[`users/${uid}/friends/${currentUser.uid}`] = true;
        u[`friend_requests/${currentUser.uid}/${uid}`] = null;
        db.ref().update(u);
    } else {
        db.ref(`friend_requests/${currentUser.uid}/${uid}`).remove();
    }
}

function listenReq() {
    db.ref(`friend_requests/${currentUser.uid}`).on('value', s => {
        document.getElementById('reqCount').innerText = s.numChildren();
    });
}

// ==========================================
// 6. Modal Profile (ดูข้อมูลคนอื่น)
// ==========================================
// 🔥 [แก้ไขชื่อฟังก์ชันให้ตรงกัน]
async function showUserProfile(uid) {
    if(!uid) return;
    
    // ถ้ากดดูตัวเอง ก็เปิดได้ (หรือจะ return ก็ได้)
    // if(uid === currentUser.uid) return;
    
    document.getElementById('profileModal').style.display = 'flex';
    
    // โหลดข้อมูล
    try {
        const s = await db.ref('users/'+uid).once('value');
        const u = s.val();
        
        document.getElementById('modalAvatar').src = u.photoURL || 'https://via.placeholder.com/100';
        document.getElementById('modalName').innerText = u.username || 'Unknown';
        document.getElementById('modalBio').innerText = u.bio || 'ไม่มีคำคม...';
        
        // ป้ายยศใน Modal
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
            return;
        }

        // เช็คสถานะเพื่อน
        const isFriend = (await db.ref(`users/${currentUser.uid}/friends/${uid}`).get()).exists();
        
        if(isFriend) {
            btn.innerText = '💬 ทักแชท';
            btn.disabled = false;
            btn.style.background = '#17a2b8';
            btn.onclick = () => {
                document.getElementById('profileModal').style.display = 'none';
                openPrivate(uid, u.username);
            };
        } else {
            btn.innerText = '➕ เพิ่มเพื่อน';
            btn.disabled = false;
            btn.style.background = '#28a745';
            btn.onclick = () => {
                sendReq(uid);
                btn.innerText = 'ส่งคำขอแล้ว';
                btn.disabled = true;
            };
        }
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'ไม่สามารถโหลดข้อมูลได้', 'error');
    }
}

function getChatId(u1, u2) { return u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`; }