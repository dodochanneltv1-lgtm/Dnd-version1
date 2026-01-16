// Javascript/lobby.js - UPDATED WITH ADMIN/OWNER SYSTEM

// ตัวแปร Global สำหรับเก็บสถานะยศ
let currentUserRole = 'user';
let currentUserId = null;
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        currentUserId = user.uid;

        // 1. ดึงข้อมูล User และ Role ก่อนเป็นอันดับแรก
        db.ref('users/' + user.uid).once('value').then((snapshot) => {
            const userData = snapshot.val();
            
            // 1.1 เช็ค Role และอัปเดตตัวแปร Global
            if (userData && userData.role) {
                currentUserRole = userData.role; // ตอนนี้ค่าจะเป็น 'admin' แล้ว
                console.log("User Role Loaded:", currentUserRole); // เช็คใน Console ดูได้
            }

            // 1.2 แสดงชื่อและยศ
            const emailElem = document.getElementById('userEmail');
            let displayName = user.email.split('@')[0];
            
            if (userData && userData.username) {
                displayName = userData.username;
            }

            // เพิ่มป้ายยศ (Badge)
            let roleBadge = '';
            if (currentUserRole === 'admin') {
                roleBadge = ' <span class="role-badge role-admin" style="font-size:0.7em; background:#d9534f; color:white; padding:2px 6px; border-radius:4px; border:1px solid #c9302c;">👑 Admin</span>';
            } else if (currentUserRole === 'beta_tester') {
                roleBadge = ' <span class="role-badge role-beta" style="font-size:0.7em; background:#5bc0de; color:white; padding:2px 6px; border-radius:4px; border:1px solid #46b8da;">🧪 Beta Tester</span>';
            }
            emailElem.innerHTML = `${displayName}${roleBadge}`;

            // [สำคัญมาก!] 2. ย้ายมาเรียก loadPublicRooms() ตรงนี้
            // เพื่อให้มั่นใจว่าเรารู้ยศ (Role) ของคนเล่นแล้ว ค่อยไปสร้างปุ่ม
            loadPublicRooms(); 

        }).catch(err => {
            console.error("Error fetching user data:", err);
            // ถ้าดึงข้อมูล User ผิดพลาด ก็ยังให้โหลดห้องได้ (แต่จะเป็น User ธรรมดา)
            loadPublicRooms();
        });

        // 3. แสดงรูปโปรไฟล์
        if (user.photoURL) {
            const img = document.getElementById('lobbyAvatar');
            if (img) {
                img.src = user.photoURL;
                img.style.display = 'inline-block';
            }
        }

    } else {
        // ถ้าไม่ได้ล็อกอิน ดีดกลับไปหน้า Login
        window.location.replace('login.html');
    }
});

async function createRoom() {
    const roomName = document.getElementById('roomName').value.trim();
    const roomPassword = document.getElementById('roomPassword').value;
    const dmPassword = document.getElementById('dmPassword').value.trim();
    const user = firebase.auth().currentUser;

    if (!user) return Swal.fire('ข้อผิดพลาด', 'กรุณาล็อกอินก่อนสร้างห้อง', 'error');
    if (!roomName || !dmPassword) return Swal.fire('ข้อผิดพลาด', 'กรุณากรอก "ชื่อห้อง" และ "รหัสผ่าน DM Panel"', 'error');

    showLoading('กำลังสร้างห้อง...');

    try {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        
        // ดึงข้อมูล Username จาก DB (เหมือนเดิม)
        const userSnapshot = await db.ref('users/' + user.uid).get();
        const userData = userSnapshot.val();
        const username = userData?.username || 'Unknown DM';
        
        // [ใหม่] ดึง Role ของคนสร้างมาด้วย (ถ้าไม่มีให้เป็น 'user')
        const myRole = userData?.role || 'user';

        // บันทึกข้อมูลห้อง (เพิ่ม dmRole ลงไป)
        const roomData = {
            name: roomName,
            dmUid: user.uid, 
            dmUsername: username,
            dmRole: myRole, // <--- [เพิ่มบรรทัดนี้] บันทึกยศลงไปในห้อง
            dmPassword: dmPassword,
            createdAt: new Date().toISOString()
        };
        if (roomPassword) roomData.password = roomPassword;

        await db.ref('rooms/' + roomId).set(roomData);
        hideLoading();

        sessionStorage.setItem('roomId', roomId);
        await Swal.fire('สร้างห้องสำเร็จ', `ID ห้องของคุณคือ: ${roomId}`, 'success');
        window.location.href = 'dm-panel.html';
    } catch (error) {
        hideLoading();
        Swal.fire('ผิดพลาด', `ไม่สามารถสร้างห้องได้: ${error.message}`, 'error');
    }
}

async function joinRoomSelection() {
    const roomId = document.getElementById('roomIdInput').value.trim();
    if (!roomId) {
        return Swal.fire('ข้อผิดพลาด', 'กรุณากรอก ID ห้อง', 'error');
    }

    showLoading('กำลังตรวจสอบห้อง...');

    try {
        const roomSnapshot = await db.ref(`rooms/${roomId}`).get();

        if (!roomSnapshot.exists()) {
            hideLoading(); 
            return Swal.fire('ผิดพลาด', `ไม่พบห้อง ID: ${roomId}`, 'error');
        }

        const roomData = roomSnapshot.val();
        let proceedToRoleSelection = false;

        // Hide loading before prompt
        hideLoading();

        // Admin หรือ เจ้าของห้อง สามารถข้ามการกรอกรหัสห้องได้ (Option)
        // แต่ใน Logic นี้ผมจะให้ Admin/Owner เห็นรหัสผ่านได้จากหน้า Lobby แล้วเอามากรอก หรือจะข้ามก็ได้
        // เพื่อความปลอดภัยตาม Flow เดิม ให้เช็ครหัสผ่านปกติ แต่ Admin จะมีปุ่มดูรหัสจากหน้า Lobby

        // 1. Check room password (if exists)
        if (roomData.password) {
            const { value: password, isConfirmed } = await Swal.fire({
                title: 'ใส่รหัสผ่านห้อง',
                input: 'password',
                inputPlaceholder: 'กรอกรหัสผ่านเข้าห้อง',
                showCancelButton: true,
                confirmButtonText: 'ยืนยัน',
            });

            if (!isConfirmed) return; // User cancelled

            if (password !== roomData.password) {
                // พิเศษ: ถ้าเป็น Admin อนุญาตให้เข้าได้แม้รหัสผิด? 
                // หรือให้ไปดูรหัสที่หน้า Lobby เอา (แนะนำวิธีนี้ปลอดภัยกว่า)
                return Swal.fire('ผิดพลาด', 'รหัสผ่านห้องไม่ถูกต้อง!', 'error');
            }
            proceedToRoleSelection = true; 
        } else {
            proceedToRoleSelection = true; 
        }

        // 2. Prompt for role selection
        if (proceedToRoleSelection) {
            await promptRoleSelection(roomId, roomData);
        }

    } catch(error) {
        if (Swal.isVisible()) hideLoading();
        Swal.fire('ผิดพลาด', `เกิดข้อผิดพลาดในการเข้าร่วมห้อง: ${error.message}`, 'error');
    }
}

async function promptRoleSelection(roomId, roomData) {
  const user = firebase.auth().currentUser;
  if (!user) return Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลผู้ใช้!', 'error');

  await Swal.fire({
    title: 'เลือกบทบาท',
    html: `
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
        <button id="swal-player-btn" class="swal2-confirm swal2-styled" type="button">
          <span class="emoji-icon">🛡️</span> ผู้เล่น
        </button>
        <button id="swal-dm-btn" class="swal2-deny swal2-styled" type="button">
          <span class="emoji-icon">🧙‍♂️</span> DM PANEL
        </button>
        <button id="swal-cancel-btn" class="swal2-cancel swal2-styled" type="button">
          <span class="emoji-icon">❌</span> ยกเลิก
        </button>
      </div>
    `,
    showConfirmButton: false,
    showCancelButton: false,
    showDenyButton: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    didOpen: (modal) => {
      modal.querySelector('#swal-player-btn').addEventListener('click', () => {
        sessionStorage.setItem('roomId', roomId);
        localStorage.setItem('currentUserUid', user.uid);
        Swal.close();
        window.location.href = 'map.html';
      });

      modal.querySelector('#swal-dm-btn').addEventListener('click', async () => {
        Swal.close();
        await promptDmConfirmation(roomId, roomData);
      });

      modal.querySelector('#swal-cancel-btn').addEventListener('click', () => {
        Swal.close();
      });
    }
  });
}

async function promptDmConfirmation(roomId, roomData) {
    const user = firebase.auth().currentUser;
    
    // เช็คว่าเป็น Admin หรือ เจ้าของห้องหรือไม่
    const isOwner = (roomData.dmUid === user.uid);
    const isAdmin = (currentUserRole === 'admin');

    // ถ้าเป็น Admin หรือ Owner ข้ามการกรอกรหัส DM ได้เลย
    if (isAdmin || isOwner) {
        sessionStorage.setItem('roomId', roomId);
        await Swal.fire({
            title: 'Welcome Back!',
            text: isAdmin ? 'เข้าสู่ระบบด้วยสิทธิ์ Admin' : 'ยินดีต้อนรับผู้สร้างห้อง',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });
        window.location.href = 'dm-panel.html';
        return;
    }

    // ถ้าไม่ใช่ ต้องกรอกรหัส
    const { value: password, isConfirmed } = await Swal.fire({
        title: 'ยืนยันสิทธิ์ DM',
        text: 'กรุณาใส่รหัสผ่าน DM Panel',
        input: 'password',
        showCancelButton: true,
        confirmButtonText: 'เข้าสู่ DM Panel',
        cancelButtonText: 'ยกเลิก',
    });

    if (isConfirmed) {
        if (password === roomData.dmPassword) {
            sessionStorage.setItem('roomId', roomId);
            await Swal.fire('สำเร็จ', 'เข้าสู่ DM Panel', 'success');
            window.location.href = 'dm-panel.html';
        } else {
            Swal.fire('ผิดพลาด', 'รหัสผ่าน DM ไม่ถูกต้อง!', 'error');
        }
    }
}

function loadPublicRooms() {
    const roomsRef = db.ref('rooms');
    const roomsList = document.getElementById('publicRoomsList');

    roomsRef.on('value', (snapshot) => {
        roomsList.innerHTML = '';
        const rooms = snapshot.val();

        if (!rooms) {
            roomsList.innerHTML = '<li style="text-align:center; padding:20px; color:#666;">ยังไม่มีห้องใดถูกสร้าง</li>';
            return;
        }

        for (const roomId in rooms) {
            const roomData = rooms[roomId];
            
            // 1. ตรวจสอบสิทธิ์
            const isOwner = (roomData.dmUid === currentUserId);
            const isAdmin = (currentUserRole === 'admin');
            
            // 2. ไอคอนกุญแจ
            const lockIcon = roomData.password ? '🔒' : '🔓';
            
            // 3. สร้างป้ายยศ (Badge)
            let dmBadge = '';
            if (roomData.dmRole === 'admin') {
                dmBadge = ' <span class="role-badge role-admin" style="font-size:0.6em;">👑 ADMIN</span>';
            } else if (roomData.dmRole === 'beta_tester') {
                dmBadge = ' <span class="role-badge role-beta" style="font-size:0.6em;">TESTER</span>';
            }

            // 4. สร้าง Element <li> พร้อม Class ใหม่ "room-card"
            const li = document.createElement('li');
            li.className = 'room-card'; 
            
            // 5. จัดโครงสร้าง HTML ภายใน (ซ้าย: ข้อมูล, ขวา: ปุ่ม Admin)
            let htmlContent = `
                <div class="room-info">
                    <h4>${lockIcon} ${roomData.name}</h4>
                    <div class="room-meta">
                        <span>โดย: ${roomData.dmUsername || 'Unknown'}${dmBadge}</span>
                        <span class="room-id">ID: ${roomId}</span>
                    </div>
                </div>
            `;

            // เพิ่มปุ่ม Admin (ถ้ามีสิทธิ์) เป็นไอคอนเล็กๆ
            if (isAdmin || isOwner) {
                htmlContent += `
                    <div class="admin-actions">
                        <button class="btn-icon btn-reveal" data-id="${roomId}" title="ดูรหัสผ่าน">👁️</button>
                        <button class="btn-icon btn-delete" data-id="${roomId}" title="ลบห้อง">🗑️</button>
                    </div>
                `;
            }

            li.innerHTML = htmlContent;
            
            // 6. เพิ่ม Event Listeners
            
            // คลิกที่การ์ดเพื่อเข้าห้อง
            li.addEventListener('click', (e) => {
                // ถ้าเผลอไปกดโดนปุ่มเล็กๆ (Admin) ไม่ต้องทำงานส่วนนี้
                if (e.target.closest('button')) return; 
                
                document.getElementById('roomIdInput').value = roomId;
                joinRoomSelection();
            });

            // คลิกปุ่ม Admin
            if (isAdmin || isOwner) {
                const revealBtn = li.querySelector('.btn-reveal');
                const deleteBtn = li.querySelector('.btn-delete');
                
                if (revealBtn) {
                    revealBtn.onclick = (e) => { 
                        e.stopPropagation(); // ห้าม Trigger การเข้าห้อง
                        revealRoomSecrets(roomId, roomData); 
                    };
                }
                if (deleteBtn) {
                    deleteBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        forceDeleteRoom(roomId); 
                    };
                }
            }

            roomsList.appendChild(li);
        }
    });
}

// --- ฟังก์ชันเสริมสำหรับ Admin/Owner ---

function revealRoomSecrets(roomId, roomData) {
    Swal.fire({
        title: `ความลับห้อง: ${roomData.name}`,
        html: `
            <div style="text-align:left; background:#222; padding:15px; border-radius:5px; color:#fff;">
                <p><strong>🔑 รหัสเข้าห้อง:</strong> <span style="color:#5cb85c; font-size:1.2em;">${roomData.password || 'ไม่มี (สาธารณะ)'}</span></p>
                <p><strong>🧙‍♂️ รหัส DM:</strong> <span style="color:#d9534f; font-size:1.2em;">${roomData.dmPassword}</span></p>
                <hr style="border-color:#444;">
                <small style="color:#aaa;">คุณเห็นข้อมูลนี้เพราะคุณเป็น Admin หรือ เจ้าของห้อง</small>
            </div>
        `,
        confirmButtonText: 'ปิด',
        background: '#1c1c1c'
    });
}

function forceDeleteRoom(roomId) {
    Swal.fire({
        title: 'ยืนยันลบห้อง?',
        text: "การกระทำนี้ไม่สามารถย้อนกลับได้!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'ใช่, ลบเลย!',
        cancelButtonText: 'ยกเลิก',
        background: '#1c1c1c',
        color: '#fff'
    }).then((result) => {
        if (result.isConfirmed) {
            db.ref('rooms/' + roomId).remove()
            .then(() => {
                Swal.fire('ลบสำเร็จ', 'ห้องถูกลบออกจากระบบแล้ว', 'success');
            })
            .catch((error) => {
                Swal.fire('ผิดพลาด', error.message, 'error');
            });
        }
    });
}