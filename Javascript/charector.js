/*
* =================================================================
* Javascript/charector.js (v3.2 - แก้ไขที่เก็บ Age)
* -----------------------------------------------------------------
* อัปเกรดระบบสร้างตัวละครตามข้อกำหนด V3 (ข้อ 4.1)
* - [อัปเดต v3.1] อ่านโบนัสอาชีพจาก CLASS_DATA
* - [อัปเดต v3.2] ย้ายการบันทึก 'age' เข้าไปใน 'info' object
* - ใช้สูตรคำนวณ HP ใหม่ (สมดุล)
* - ตรวจสอบเงื่อนไขเผ่าพันธุ์/อาชีพ (ข้อ 11)
* =================================================================
*/

// --- Helpers (ถูกลบออกเพราะโหลดมาจาก ui-helpers.js แล้ว) ---

/**
 * Helper function to calculate stat bonus.
 */
function getStatBonus(statValue) {
    if (typeof statValue !== 'number') return 0; // ป้องกัน Error
    return Math.floor((statValue - 10) / 2);
}

/**
 * [อัปเกรด v3] ดึงโบนัสสเตตัสจาก RACE_DATA (ข้อ 11)
 */
function getRaceStatBonus(charRace) {
    const race = (typeof RACE_DATA !== 'undefined') ? RACE_DATA[charRace] : null;
    const defaultStats = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
    
    if (race && race.bonuses) {
        // รวมโบนัสเริ่มต้นเข้ากับ default
        return { ...defaultStats, ...race.bonuses };
    }
    return defaultStats;
}

/**
 * [อัปเกรด v3.1] ดึงโบนัสสเตตัสจาก CLASS_DATA
 */
function getClassStatBonus(charClass) {
    const charClassData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charClass] : null;
    const defaultStats = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };

    if (charClassData && charClassData.bonuses) {
        return { ...defaultStats, ...charClassData.bonuses };
    }
    
    // (ถ้าไม่เจอ หรือเป็นอาชีพ T0 ที่ไม่มีโบนัส)
    return defaultStats;
}

/**
 * [อัปเกรด v3] คำนวณ HP ใหม่ให้สมดุล (ข้อ 4.1)
 */
function calculateHP(charRace, charClass, finalCon) {
    const race = (typeof RACE_DATA !== 'undefined') ? RACE_DATA[charRace] : null;
    
    // 1. HP พื้นฐานจากเผ่า (สมมติฐานเพื่อความสมดุล)
    let raceHP = 10;
    if (race && race.bonuses && race.bonuses.CON) {
        raceHP += (race.bonuses.CON * 2); 
    }

    // 2. HP พื้นฐานจากอาชีพ (สมมติฐานเพื่อความสมดุล)
    const classBaseHP = {
        'แทงค์': 20,
        'นักรบ': 15,
        'เรนเจอร์': 12,
        'โจร': 12,
        'นักบวช': 10,
        'พ่อค้า': 10,
        'นักเวท': 8
        // (อาชีพ T2+ จะใช้ค่า HP นี้เป็นฐานในการคำนวณ Level Up)
    };
    let classHP = classBaseHP[charClass] || 10; // (ค่ากลาง 10)

    // 3. โบนัสจาก CON (ให้ CON มีผลต่อ HP มากขึ้น)
    const conModifier = getStatBonus(finalCon);
    let totalHP = (raceHP + classHP) + (conModifier * 2);
    
    // 4. โบนัสพิเศษจากเผ่า
    if (charRace === 'โกเลม') {
        totalHP *= 1.25; // โกเลมมี HP มากกว่าปกติ 25% (จาก Passive)
    }
    
    return Math.floor(Math.max(1, totalHP));
}

/**
 * [อัปเกรด v3.2] ฟังก์ชันสร้างตัวละครหลัก
 * (อ่านจาก PlayerCharecter.html v3)
 */
async function createCharacter() {
    const roomId = sessionStorage.getItem('roomId');
    const user = firebase.auth().currentUser;
    if (!roomId || !user) {
        showCustomAlert("ไม่พบข้อมูลห้องหรือผู้ใช้! กรุณาล็อกอินและเข้าร่วมห้องใหม่อีกครั้ง", 'error');
        window.location.href = 'lobby.html';
        return;
    }
    const uid = user.uid;

    // --- 1. ดึงข้อมูลจาก Form (รวมฟิลด์ใหม่ ข้อ 4.1) ---
    const name = document.getElementById('name')?.value.trim();
    const gender = document.getElementById('gender')?.value;
    const age = document.getElementById('age')?.value; // <-- [v3.2] อ่านค่า age
    
    // ฟิลด์ข้อมูล Info ใหม่
    const height = document.getElementById('height')?.value;
    const weight = document.getElementById('weight')?.value;
    const appearance = document.getElementById('appearance')?.value.trim();
    const personality = document.getElementById('personality')?.value.trim();
    const likes = document.getElementById('likes')?.value.trim();
    const dislikes = document.getElementById('dislikes')?.value.trim();
    
    const race = document.getElementById('race')?.value;
    const charClass = document.getElementById('class')?.value; // นี่คือ classMain
    const background = document.getElementById('background')?.value.trim();
    const alignment = document.getElementById('alignment')?.value;

    // --- 2. ตรวจสอบข้อมูล (Validation) ---
    if (!name || !gender || !age || !race || !charClass || !background || !alignment) {
        return showCustomAlert("กรุณากรอกข้อมูลหลัก (ชื่อ, เพศ, อายุ, เผ่า, อาชีพ, ภูมิหลัง, แนวทาง) ให้ครบถ้วน", 'warning');
    }
    if (parseInt(age) <= 0) {
        return showCustomAlert("กรุณาระบุอายุที่ถูกต้อง", 'error');
    }

    // [อัปเกรด v3] ตรวจสอบเงื่อนไขเผ่า/อาชีพ (ข้อ 11)
    const raceInfo = (typeof RACE_DATA !== 'undefined') ? RACE_DATA[race] : null;
    if (!raceInfo) {
        return showCustomAlert("เกิดข้อผิดพลาด: ไม่พบข้อมูลเผ่าพันธุ์ที่เลือก", 'error');
    }

    // ตรวจสอบเพศ
    if (raceInfo.restrictions?.gender && raceInfo.restrictions.gender !== gender) {
        return showCustomAlert(`เผ่า '${race}' จำกัดเฉพาะเพศ '${raceInfo.restrictions.gender}' เท่านั้น!`, 'error');
    }
    // ตรวจสอบอาชีพ
    if (raceInfo.restrictions?.noMagicClass && ['นักเวท', 'นักบวช'].includes(charClass)) {
        return showCustomAlert(`เผ่า '${race}' ไม่สามารถเลือกอาชีพสายเวทมนตร์ได้!`, 'error');
    }
    // (เพิ่มข้อจำกัดอื่นๆ ตามเผ่า เช่น มาร + นักบวช)
    if (race === 'มาร' && charClass === 'นักบวช') {
        return showCustomAlert(`เผ่า '${race}' ไม่สามารถเลือกอาชีพ '${charClass}' ได้!`, 'error');
    }

    // --- 3. คำนวณสเตตัสและ HP เริ่มต้น ---
    const baseRaceStats = getRaceStatBonus(race);
    // [ ⭐️ อัปเดต v3.1 ⭐️ ]
    const baseClassStats = getClassStatBonus(charClass); // (ดึงโบนัสอาชีพ)
    const investedStats = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
    const tempStats = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };

    // [ ⭐️ อัปเดต v3.1 ⭐️ ] HP เริ่มต้น คำนวณจาก Con ของเผ่า + Con ของอาชีพ
    const initialCon = (baseRaceStats.CON || 0) + (baseClassStats.CON || 0);
    const maxHp = calculateHP(race, charClass, initialCon);

    // --- 4. สร้างโครงสร้างข้อมูลตัวละคร (v3) ---
    const characterData = {
        // ข้อมูลหลัก
        name, gender, race, background, alignment, // <-- [v3.2] ลบ age ออกจากตรงนี้
        
        // [ ⭐️ อัปเดต v3.2 ⭐️ ] ย้าย age เข้าไปใน info
        info: {
            age: parseInt(age) || 1, // <-- [v3.2] เพิ่ม age เข้ามาในนี้
            height: height || 'ไม่ระบุ',
            weight: weight || 'ไม่ระบุ',
            appearance: appearance || 'ไม่ระบุ',
            personality: personality || 'ไม่ระบุ',
            likes: likes || 'ไม่ระบุ',
            dislikes: dislikes || 'ไม่ระบุ'
        },
        
        // ระบบอาชีพ (ข้อ 10)
        classMain: charClass,
        classSub: null, // ยังไม่มีอาชีพรอง
        
        // ระบบเผ่าพันธุ์ (ข้อ 11)
        raceEvolved: null, // ยังไม่วิวัฒนาการ
        
        // ระบบเศรษฐกิจ
        gp: 100, // เงินเริ่มต้น
        
        // ระบบเลเวล (ข้อ 4.1)
        level: 1,
        freeStatPoints: 10, // แต้มเริ่มต้น 10 แต้ม
        exp: 0,
        expToNextLevel: 300, // (ค่าเริ่มต้น)
        
        // สเตตัส
        stats: { baseRaceStats, baseClassStats, investedStats, tempStats },
        hp: maxHp,
        maxHp: maxHp,
        
        // ข้อมูลระบบ (คงเดิม)
        inventory: [],
        quest: null,
        equippedItems: { mainHand: null, offHand: null, head: null, chest: null, legs: null, feet: null },
        activeEffects: [], // (สำหรับบัฟ/ดีบัฟ)
        skillCooldowns: {}, // (สำหรับคูลดาวน์สกิล)
    };

    // --- 5. บันทึกลง Firebase ---
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);

    showLoading("กำลังสร้างตัวละคร...");

    try {
        const snapshot = await playerRef.get();
        if (snapshot.exists()) {
             hideLoading();
             showCustomAlert(`คุณมีตัวละครอยู่ในห้องนี้แล้ว (${snapshot.val().name})`, 'error');
             // ถ้ามีตัวละครแล้ว ให้ไปที่ Dashboard เลย
             window.location.href = 'player-dashboard.html';
        } else {
            // สร้างตัวละครใหม่
            await playerRef.set(characterData);
            hideLoading();
            showCustomAlert("สร้างตัวละครสำเร็จ! กำลังไปหน้าลงแต้มสถานะ", 'success');
            // ไปหน้าอัปสเตตัสเริ่มต้น (ข้อ 4.1 -> 4.2)
            window.location.href = 'stat-assignment.html';
        }
    } catch (error) {
         hideLoading();
         showCustomAlert("ไม่สามารถสร้างตัวละครได้: " + error.message, 'error');
         console.error("Firebase Set Error:", error);
    }
}

// --- [V3 BUG FIX #2] ---
// (แก้ไข Bug ที่ปุ่มค้าง หรือกดแล้ว Error "ไม่พบผู้ใช้")
// -------------------------

function initializeAuthListener() {
    // 1. ตรวจสอบว่า firebase-init.js โหลดเสร็จหรือยัง
    if (typeof firebase === 'undefined' || typeof firebase.auth === 'undefined') {
        // ถ้ายังไม่เสร็จ ให้รอ 100ms แล้วลองใหม่
        setTimeout(initializeAuthListener, 100);
        return;
    }
    
    // 2. เมื่อ Firebase พร้อม, เริ่มการตรวจสอบสถานะผู้ใช้
    firebase.auth().onAuthStateChanged(user => {
        const createButton = document.getElementById('createCharButton');
        
        if (!createButton) {
            // (เผื่อกรณีที่ DOM ยังไม่พร้อม 100%)
            setTimeout(() => initializeAuthListener(), 50);
            return;
        }

        if (user) {
            // 3. ถ้าผู้ใช้ล็อกอินแล้ว: เปิดใช้งานปุ่ม
            createButton.disabled = false;
            createButton.textContent = "สร้างตัวละคร";
            createButton.onclick = createCharacter; // ผูกฟังก์ชันหลัก
        } else {
            // 4. ถ้าผู้ใช้ยังไม่ล็อกอิน: แจ้งเตือน
            createButton.disabled = false;
            createButton.textContent = "โปรดล็อกอินก่อน";
            createButton.onclick = () => { 
                showCustomAlert("ไม่พบข้อมูลผู้ใช้ กรุณาล็อกอินใหม่", "error");
                window.location.href = 'login.html'; 
            };
        }
    });
}

// 5. สั่งให้ฟังก์ชันตรวจสอบเริ่มทำงานทันทีที่ไฟล์นี้ถูกโหลด
initializeAuthListener();

firebase.auth().onAuthStateChanged(user => {
    if (user) {
        let isInitialLoadComplete = false;
        const currentUserUid = user.uid;
        localStorage.setItem('currentUserUid', currentUserUid); 
        const roomId = sessionStorage.getItem('roomId');
        if (!roomId) { window.location.replace('lobby.html'); return; }
        
        registerRoomPresence(roomId);

        if (!isInitialLoadComplete) showLoading('กำลังโหลดข้อมูลตัวละคร...');
        injectDashboardStyles();

        const playerRef = db.ref(`rooms/${roomId}/playersByUid/${currentUserUid}`);
        const roomRef = db.ref(`rooms/${roomId}`);

        roomRef.child('combatLogs').limitToLast(1).on('child_added', snapshot => {
            const log = snapshot.val();
            if (log && log.timestamp > (Date.now() - 5000)) { 
                const Toast = Swal.mixin({
                    toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                    background: 'rgba(0, 0, 0, 0.9)', color: '#fff',
                    didOpen: (toast) => {
                        toast.addEventListener('mouseenter', Swal.stopTimer)
                        toast.addEventListener('mouseleave', Swal.resumeTimer)
                    }
                });
                
                let icon = 'info';
                if (log.message.includes('โจมตี')) icon = 'warning';
                if (log.message.includes('พลาด')) icon = 'error';
                if (log.message.includes('เข้า')) icon = 'success';

                Toast.fire({ icon: icon, title: log.message });
            }
        });

        db.ref(`rooms/${roomId}`).on('value', snapshot => {
            const roomData = snapshot.val() || {};
            
            allPlayersInRoom = roomData.playersByUid || {};
            allEnemiesInRoom = roomData.enemies || {};
            combatState = roomData.combat || {};
            const afkPlayers = roomData.afkPlayersByUid || {}; // ✅ 1. ดึงข้อมูลคน AFK มาดู

            // ✅ 2. ตรวจสอบ: ถ้าไม่เจอในห้องปกติ แต่เจอในห้อง AFK ให้กู้คืนทันที!
            if (!allPlayersInRoom[currentUserUid] && afkPlayers[currentUserUid]) {
                console.log("Found player in AFK list! Auto-restoring...");
                
                const afkData = afkPlayers[currentUserUid];
                // ลบ Tag AFK ทิ้ง
                delete afkData.__afk;
                delete afkData.__afkReason;
                delete afkData.__afkAt;

                // เตรียมข้อมูลสำหรับ Update
                const updates = {};
                updates[`rooms/${roomId}/playersByUid/${currentUserUid}`] = afkData;
                updates[`rooms/${roomId}/afkPlayersByUid/${currentUserUid}`] = null;
                
                // สั่งอัปเดต Firebase ทันที
                db.ref().update(updates);
                
                // หลอกระบบว่ามีตัวละครแล้ว (เพื่อให้เรนเดอร์ทันทีไม่ต้องรอ Firebase ตอบกลับ)
                allPlayersInRoom[currentUserUid] = afkData;
            }

            currentCharacterData = allPlayersInRoom[currentUserUid]; 

            // ถ้ามีข้อมูลตัวละคร ให้ทำการเช็คและแสดงผล
            if (currentCharacterData) {
                // อัปเดต UID ใน object ให้แน่ใจ
                currentCharacterData.uid = currentUserUid; 

                // ✅ 3. เรียกฟังก์ชันเช็ค Level Up (ใส่ตรงนี้เพื่อให้เช็คทุกครั้งที่มีการเปลี่ยนแปลง)
                checkLevelUp(currentCharacterData, currentUserUid, roomId);

                // ✅ 4. เช็ค MaxHP ให้ตรงกับสูตรใหม่ (ถ้าไม่ตรงให้อัปเดตเงียบๆ)
                // ต้องแน่ใจว่าโหลด stats-engine.js แล้ว
                if (typeof calculateMaxHp === 'function') {
                    const correctMaxHp = calculateMaxHp(currentCharacterData);
                    if (currentCharacterData.maxHp !== correctMaxHp) {
                        console.log(`Auto-correcting MaxHP from ${currentCharacterData.maxHp} to ${correctMaxHp}`);
                        // อัปเดตเฉพาะค่า maxHp ไปที่ Firebase
                        db.ref(`rooms/${roomId}/playersByUid/${currentUserUid}/maxHp`).set(correctMaxHp);
                        // อัปเดตค่า local เพื่อให้แสดงผลถูกต้องทันที
                        currentCharacterData.maxHp = correctMaxHp;
                    }
                }

                // แสดงผลต่างๆ
                displayCharacter(currentCharacterData, combatState);
                displayInventory(currentCharacterData.inventory);
                displayEquippedItems(currentCharacterData.equippedItems);
                displayQuest(currentCharacterData.quest);
                displayTeammates(currentUserUid); 
                
                displayEnemies(allEnemiesInRoom, currentUserUid);
                
                updateTurnDisplay(combatState, currentUserUid);
                if (roomData.story) displayStory(roomData.story);

                if (!isInitialLoadComplete) {
                    hideLoading();
                    isInitialLoadComplete = true;
                }

            } else if (isInitialLoadComplete) {
                // กรณีโหลดเสร็จแล้วแต่ยังไม่มีตัวละคร (หรือถูกลบไปจริงๆ ไม่ใช่ AFK)
                document.getElementById("characterInfoPanel").innerHTML = `<h2>สร้างตัวละคร</h2><p>คุณยังไม่มีตัวละครในห้องนี้</p><a href="PlayerCharecter.html"><button style="width:100%;">สร้างตัวละครใหม่</button></a>`;
                if (typeof Swal !== 'undefined' && Swal.isVisible() && Swal.isLoading()) hideLoading();

            } else {
                // กรณีเพิ่งเข้ามาครั้งแรกแล้วไม่มีตัวละคร
                hideLoading();
                document.getElementById("characterInfoPanel").innerHTML = `<h2>สร้างตัวละคร</h2><p>คุณยังไม่มีตัวละครในห้องนี้</p><a href="PlayerCharecter.html"><button style="width:100%;">สร้างตัวละครใหม่</button></a>`;
                isInitialLoadComplete = true;
            }
        });

    } else {
        window.location.replace('login.html');
    }

    playerRef.child('pendingAttack').on('value', s => {
            const val = s.val();
            
            if (val && !Swal.isVisible()) {
                handlePendingAttack(val, playerRef);
            } 
            
            else if (!val && Swal.isVisible()) {
                const titleEl = Swal.getTitle();
                if (titleEl && titleEl.textContent.includes('ถูกโจมตี')) {
                    Swal.close(); 
                }
            }
        });
});
// --- END OF FILE ---