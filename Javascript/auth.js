// Javascript/auth.js - ระบบสมัครสมาชิกและล็อกอินที่ปรับปรุงใหม่

/**
 * ฟังก์ชันสมัครสมาชิก
 */
async function registerUser() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    // --- 1. ตรวจสอบข้อมูลเบื้องต้น ---
    if (!username || !password || !confirmPassword) {
        return Swal.fire('ข้อผิดพลาด!', 'กรุณากรอกข้อมูลให้ครบทุกช่อง', 'error');
    }
    if (username.length < 3) {
        return Swal.fire('ข้อผิดพลาด!', 'ชื่อผู้ใช้ต้องมีความยาวอย่างน้อย 3 ตัวอักษร', 'error');
    }
    // ตรวจสอบความยาวรหัสผ่านเบื้องต้น (6 ตัวอักษร)
    if (password.length < 6) {
        return Swal.fire('ข้อผิดพลาด!', 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร', 'error');
    }
    if (password !== confirmPassword) {
        return Swal.fire('ข้อผิดพลาด!', 'รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน', 'error');
    }

    // ✨ [ปรับปรุง] เพิ่ม Loading Screen
    showLoading('กำลังสมัครสมาชิก...');

    try {
        const email = username + "@dnd.local";
        
        // --- 2. สร้างผู้ใช้ใน Firebase Authentication ---
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // --- 3. บันทึกข้อมูลเพิ่มเติมใน Realtime Database ---
        const userData = {
            username: username,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        await db.ref('users/' + user.uid).set(userData);

        hideLoading(); // ซ่อน Loading ก่อนแสดงข้อความสำเร็จ

        await Swal.fire({
            title: 'สมัครสมาชิกสำเร็จ!',
            text: `ยินดีต้อนรับ ${username}`,
            icon: 'success',
            timer: 2000,
            showConfirmButton: false
        });
        
        // **[ปรับปรุงจากโค้ดเก่า]** โค้ดเก่าเปลี่ยนไป 'lobby.html' แต่โค้ดใหม่เปลี่ยนไป 'login.html'
        // เพื่อให้ผู้ใช้เข้าสู่ระบบใหม่ตามแนวทางที่ดีกว่า (ถ้าต้องการให้ไป lobby เลย ให้เปลี่ยนบรรทัดถัดไปเป็น 'lobby.html')
        window.location.href = 'login.html'; 

    } catch (error) {
        hideLoading(); // ✨ [ปรับปรุง] ซ่อน Loading เสมอเมื่อเกิดข้อผิดพลาด
        console.error("Auth Error:", error.code, error.message);
        
        let errorMessage = "เกิดข้อผิดพลาดที่ไม่รู้จัก";
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage = 'ชื่อผู้ใช้นี้มีผู้ใช้งานแล้ว';
                break;
            case 'auth/invalid-email':
                errorMessage = 'ชื่อผู้ใช้มีอักขระไม่ถูกต้อง';
                break;
            case 'auth/weak-password': 
                // **[เพิ่ม]** เพิ่มการจัดการ error จากโค้ดเก่า 'auth/weak-password'
                errorMessage = 'รหัสผ่านไม่ปลอดภัย (ต้องมีอย่างน้อย 6 ตัวอักษร)';
                break;
        }
        Swal.fire('สมัครสมาชิกไม่สำเร็จ!', errorMessage, 'error');
    }
}

// --------------------------------------------------------------------------------

async function loginUser() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        return Swal.fire('ข้อผิดพลาด!', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'error');
    }

    // ✨ [ปรับปรุง] เพิ่ม Loading Screen
    showLoading('กำลังเข้าสู่ระบบ...');
    
    try {
        // ⭐️ [เพิ่ม] สั่งให้ Firebase จำสถานะล็อกอินไว้ในเครื่องตลอดไป (แม้รีเฟรชหรือปิดแท็บ)
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

        const email = username + "@dnd.local";
        const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // อัปเดตเวลาล็อกอินล่าสุด
        await db.ref('users/' + user.uid).update({
            lastLogin: new Date().toISOString()
        });

        hideLoading();
        await Swal.fire({
            title: 'เข้าสู่ระบบสำเร็จ!',
            icon: 'success',
            timer: 1000,
            showConfirmButton: false
        });
        
        window.location.href = 'lobby.html';

    } catch (error) {
        hideLoading();
        console.error("Auth Error:", error.code, error.message);
        Swal.fire('เข้าสู่ระบบไม่สำเร็จ!', "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 'error'); 
    }
}

// --------------------------------------------------------------------------------

/**
 * ฟังก์ชันออกจากระบบ
 */
async function logoutUser() {
    // ✨ [ปรับปรุง] เพิ่ม Loading Screen
    showLoading('กำลังออกจากระบบ...');
    try {
        await firebase.auth().signOut();
        sessionStorage.clear(); // ล้างข้อมูล session ที่อาจค้างอยู่
        window.location.href = 'login.html';
    } catch (error) {
        hideLoading();
        console.error("Logout Error:", error);
        Swal.fire('ผิดพลาด', 'ไม่สามารถออกจากระบบได้', 'error');
    }
}

// --------------------------------------------------------------------------------

/**
 * Listener ตรวจสอบสถานะการล็อกอิน (ทำหน้าที่เป็น "ยาม")
 */
firebase.auth().onAuthStateChanged((user) => {
    // **[รวม]** รวมรายการหน้าที่มีการป้องกันทั้งหมดจากโค้ดทั้งสอง
    const protectedPages = [
        'lobby.html', 
        'dm-panel.html', 
        'player-dashboard.html', 
        'PlayerCharecter.html' // จากโค้ดฉบับปรับปรุง
        // โค้ดเดิม: มี lobby.html, dm-panel.html, player-dashboard.html
    ];
    const currentPage = window.location.pathname.split('/').pop();
    const isProtectedPage = protectedPages.includes(currentPage);

    if (user) {
        console.log("ผู้ใช้ล็อกอินอยู่:", user.uid);

        // **[เพิ่ม]** โหลดข้อมูลผู้ใช้เหมือนโค้ดเก่า (เป็นทางเลือกที่ดีในการอัปเดตข้อมูล UI)
        db.ref('users/' + user.uid).once('value').then((snapshot) => {
            const userData = snapshot.val();
            if (userData) {
                console.log("ข้อมูลผู้ใช้:", userData.username);
            }
        });

    } else if (isProtectedPage) {
        // ถ้าผู้ใช้ไม่ได้ล็อกอิน และกำลังพยายามเข้าถึงหน้าที่ต้องป้องกัน
        console.log("ผู้ใช้ไม่ได้รับอนุญาต, กำลัง redirect ไปหน้า login...");
        window.location.replace('login.html');
    }
});

async function changeUserPassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    // 1. ตรวจสอบความถูกต้องเบื้องต้น
    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return Swal.fire('ข้อผิดพลาด', 'กรุณากรอกข้อมูลให้ครบทุกช่อง', 'warning');
    }
    if (newPassword.length < 6) {
        return Swal.fire('ข้อผิดพลาด', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร', 'warning');
    }
    if (newPassword !== confirmNewPassword) {
        return Swal.fire('ข้อผิดพลาด', 'รหัสผ่านใหม่ไม่ตรงกัน', 'error');
    }

    const user = firebase.auth().currentUser;

    if (user) {
        showLoading('กำลังดำเนินการ...');

        try {
            // 2. Re-authenticate: ต้องยืนยันตัวตนด้วยรหัสเดิมก่อน (สำคัญมากใน Firebase)
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
            await user.reauthenticateWithCredential(credential);

            // 3. เมื่อยืนยันผ่านแล้ว จึงทำการเปลี่ยนรหัส
            await user.updatePassword(newPassword);

            hideLoading();
            await Swal.fire('สำเร็จ!', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบใหม่', 'success');
            
            // 4. บังคับ Logout ให้เข้าใหม่
            logoutUser();

        } catch (error) {
            hideLoading();
            console.error("Change Password Error:", error);
            
            if (error.code === 'auth/wrong-password') {
                Swal.fire('ผิดพลาด', 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 'error');
            } else {
                Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาด: ' + error.message, 'error');
            }
        }
    } else {
        Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลผู้ใช้ โปรดล็อกอินใหม่', 'error');
    }
}