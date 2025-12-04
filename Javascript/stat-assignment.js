/*
* =================================================================
* Javascript/stat-assignment.js (v3.1 - อัปเกรดโบนัสอาชีพ)
* -----------------------------------------------------------------
* จัดการตรรกะการอัปสเตตัส (ข้อ 4.2)
* - [อัปเดต] อ่านและแสดงผลโบนัสสเตตัสจากอาชีพ (baseClassStats)
* - โหลดแต้มคงเหลือ (freeStatPoints)
* - คำนวณสเตตัสและ HP ใหม่แบบ Real-time
* - บันทึก investedStats, freeStatPoints, hp, maxHp กลับไปที่ Firebase
* =================================================================
*/

// --- Global Variables ---
let characterData = null; // ข้อมูลตัวละครฉบับเต็ม
let newPointsAvailable = 0; // แต้มที่เพิ่งได้มา (เช่น 10 แต้ม)
let baseInvested = {}; // ค่า investedStats เดิมก่อนเริ่มหน้านี้
const statsToAssign = {}; // ค่า investedStats ชั่วคราวบนหน้าจอ
const statOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

// --- Utility & Calculation Functions ---
// (ฟังก์ชัน showCustomAlert, calculateHP, getStatBonus จะถูกโหลดมาก่อนจาก
// ui-helpers.js และ charector.js ตามที่ระบุใน .html)

/**
 * [อัปเกรด v3.1] ฟังก์ชันคำนวณสเตตัสรวม (สำหรับหน้านี้โดยเฉพาะ)
 * (ข้อ 4.2)
 */
function calculateTotalStatForAssignment(statKey) {
    if (!characterData || !characterData.stats) return 0;
    
    const { stats, level = 1 } = characterData;
    const upperStatKey = statKey.toUpperCase();

    // 1. ดึงค่า stat ที่อัปบนหน้าจอ (statsToAssign)
    // ถ้าไม่มี ให้ใช้ค่าเดิม (baseInvested)
    const currentInvestedValue = statsToAssign[upperStatKey] !== undefined ? statsToAssign[upperStatKey] : (baseInvested[upperStatKey] || 0);

    // 2. [อัปเดต v3.1] คำนวณ Base Stat (เผ่า + อาชีพ + ที่อัป)
    const baseStat = (stats.baseRaceStats?.[upperStatKey] || 0) +
                     (stats.baseClassStats?.[upperStatKey] || 0) +
                     currentInvestedValue;
    
    // (หน้านี้จะไม่คำนวณ บัฟ, ดีบัฟ, หรือเลเวลชั่วคราว เพราะเป็นการอัปค่าถาวร)

    // 3. คำนวณโบนัสจาก Level ถาวร
    let finalStat = baseStat;
    if (finalStat > 0 && level > 1) {
         const levelBonus = finalStat * (level - 1) * 0.2;
         finalStat += levelBonus;
    }

    // 4. (ใหม่ ข้อ 11) ตรวจสอบเงื่อนไขพิเศษของเผ่า
    if (characterData.race === 'โกเลม' && (upperStatKey === 'INT' || upperStatKey === 'WIS')) {
        return 0; // โกเลมอัป INT/WIS ไม่ได้
    }

    return Math.floor(finalStat);
}


// --- Core Functions ---

/**
 * โหลดข้อมูลตัวละครเมื่อเข้าหน้านี้
 */
function loadCharacterData(uid) {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) {
        showCustomAlert("ไม่พบข้อมูลห้อง!", 'error');
        window.location.replace('lobby.html');
        return;
    }

    showLoading("กำลังโหลดข้อมูล...");
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
    
    playerRef.get().then((snapshot) => {
        hideLoading();
        if (snapshot.exists()) {
            characterData = snapshot.val();
            
            // [FIX START] แก้ไข: แปลงข้อมูลทั้งหมดเป็นตัวเลข (Integer) ป้องกัน Error แต้มติดลบ/ต่อ String
            baseInvested = {};
            const rawInvested = characterData.stats.investedStats || {};
            
            // วนลูปแปลงค่าทุกค่าใน investedStats ให้เป็นตัวเลข
            for (const key in rawInvested) {
                baseInvested[key] = parseInt(rawInvested[key]) || 0;
            }

            // ล้างค่า statsToAssign เก่าออกก่อน แล้วคัดลอกค่าที่เป็นตัวเลขแล้วลงไป
            for (const key in statsToAssign) delete statsToAssign[key];
            Object.assign(statsToAssign, baseInvested);
            
            // แปลงแต้มคงเหลือเป็นตัวเลขด้วย
            newPointsAvailable = parseInt(characterData.freeStatPoints) || 0;
            // [FIX END]
            
            // เริ่มสร้าง UI
            renderStatAssignment();
        } else {
            showCustomAlert("ไม่พบข้อมูลตัวละคร! กรุณาสร้างตัวละครใหม่", 'error');
            window.location.replace('PlayerCharecter.html');
        }
    }).catch(err => {
        hideLoading();
        showCustomAlert("เกิดข้อผิดพลาดในการโหลดข้อมูล: " + err.message, 'error');
    });
}

/**
 * [อัปเกรด v3.1] สร้าง UI หน้าอัปสเตตัส (ข้อ 4.2)
 * (เพิ่มคอลัมน์ "โบนัสอาชีพ")
 */
function renderStatAssignment() {
    const panel = document.getElementById('statPanel');
    if (!panel) return;
    
    // [อัปเดต v3.1] เปลี่ยน grid-template-columns จาก 4 เป็น 5
    panel.innerHTML = `<div style="display: grid; grid-template-columns: 60px 1fr 100px 100px 100px; gap: 15px; font-weight: bold; color: #aaa; text-align: center; padding: 0 15px;"><div>สถานะ</div><div>แต้มที่ลง</div><div>โบนัสเผ่า</div><div>โบนัสอาชีพ</div><div>รวม</div></div>`;
    
    statOrder.forEach(stat => {
        // [อัปเกรด v2] โกเลมอัป INT/WIS ไม่ได้ (ข้อ 11)
        const raceInfo = (typeof RACE_DATA !== 'undefined') ? RACE_DATA[characterData.race] : null;
        let isDisabled = false;
        if (raceInfo?.restrictions?.noInvestStats?.includes(stat)) {
            isDisabled = true;
        }

        statsToAssign[stat] = statsToAssign[stat] || 0;
        const raceVal = characterData.stats.baseRaceStats[stat] || 0;
        // [อัปเดต v3.1] ดึงโบนัสอาชีพ
        const classVal = characterData.stats.baseClassStats[stat] || 0;
        
        const div = document.createElement('div');
        div.className = 'stat-line';
        // [อัปเดต v3.1] เพิ่ม div.stat-bonus สำหรับ classVal
        div.innerHTML = `
            <div class="stat-label">${stat}</div>
            <div class="points-control">
                <button class="btn-adjust" onclick="adjustStat('${stat}', -1)" ${isDisabled ? 'disabled' : ''}>-</button>
                <div class="stat-value" id="assign-${stat}">${statsToAssign[stat]}</div>
                <button class="btn-adjust" onclick="adjustStat('${stat}', 1)" ${isDisabled ? 'disabled' : ''}>+</button>
            </div>
            <div class="stat-bonus">${raceVal}</div>
            <div class="stat-bonus" style="background-color: rgba(40, 167, 69, 0.2); border-color: rgba(40, 167, 69, 0.5);">${classVal}</div>
            <div class="stat-total" id="total-${stat}">${calculateTotalStatForAssignment(stat)}</div>
        `;
        panel.appendChild(div);
    });

    updatePointsUI();
    updateStatsSummary();
}

/**
 * อัปเดต UI แต้มคงเหลือ
 */
function updatePointsUI() {
    const currentTotalInvested = Object.values(statsToAssign).reduce((a, b) => a + b, 0);
    const baseTotalInvested = Object.values(baseInvested).reduce((a, b) => a + b, 0);
    const pointsSpentNew = currentTotalInvested - baseTotalInvested;
    
    const remaining = newPointsAvailable - pointsSpentNew;
    document.getElementById('remainingPointsUI').textContent = remaining;
    
    // ควบคุมปุ่มบวก
    document.querySelectorAll('.btn-adjust').forEach(btn => {
        if (btn.textContent === '+') {
            btn.disabled = (remaining <= 0);
        }
    });
}

/**
 * [อัปเกรด v2] ตรรกะการกด +/- แต้ม (ข้อ 4.2)
 */
function adjustStat(stat, amount) {
    // คำนวณแต้มที่ใช้ไปทั้งหมด ณ ปัจจุบัน (รวมที่เพิ่งกด)
    const currentTotalInvested = Object.values(statsToAssign).reduce((a, b) => a + b, 0);
    // คำนวณแต้ม Base เดิมทั้งหมด
    const baseTotalInvested = Object.values(baseInvested).reduce((a, b) => a + b, 0);
    
    // แต้มที่ใช้เพิ่มขึ้นมาจากเดิม
    const pointsSpentNew = currentTotalInvested - baseTotalInvested;
    
    // 1. เช็คกรณีเพิ่มแต้ม: ถ้าแต้มใหม่ที่ใช้ >= แต้มที่มีให้ใช้ --> ห้ามเพิ่ม
    if (amount > 0 && pointsSpentNew >= newPointsAvailable) {
        showCustomAlert("แต้มไม่พอ!", 'warning');
        return;
    }

    // 2. เช็คกรณีลดแต้ม: ห้ามลดต่ำกว่าค่า Base เดิมของ stat นั้น
    if (amount < 0 && statsToAssign[stat] <= (baseInvested[stat] || 0)) {
        return; // ห้ามลดต่ำกว่าค่าตั้งต้น
    }

    // อัปเดตค่า
    statsToAssign[stat] += amount;
    
    // อัปเดต UI
    document.getElementById(`assign-${stat}`).textContent = statsToAssign[stat];
    updatePointsUI();
    updateStatsSummary();
}
/**
 * [อัปเกรด v2] อัปเดตสรุปสเตตัสและ HP แบบ Real-time (ข้อ 4.2)
 */
function updateStatsSummary() {
    const summaryDiv = document.getElementById('baseStatsSummary');
    if (!summaryDiv) return;
    
    let summaryHTML = '';
    
    statOrder.forEach(stat => {
        const finalValue = calculateTotalStatForAssignment(stat);
        summaryHTML += `<p><strong>${stat}:</strong> ${finalValue}</p>`;
    });

    // คำนวณ HP ใหม่แบบ Real-time
    // (ใช้ calculateHP จาก charector.js)
    const finalCon = calculateTotalStatForAssignment('CON');
    const newMaxHp = calculateHP(characterData.race, characterData.classMain, finalCon);
    
    summaryHTML += `<p style="margin-top:15px; font-size: 1.2em; color: #ffc107;"><strong>พลังชีวิตสูงสุด (Max HP):</strong> ${newMaxHp}</p>`;
    summaryDiv.innerHTML = summaryHTML;
}

/**
 * [อัปเกรด v2] บันทึกสเตตัสและ HP ใหม่ (ข้อ 4.2)
 */
async function finalizeStats() {
    const uid = firebase.auth().currentUser?.uid;
    const roomId = sessionStorage.getItem('roomId');
    if (!uid || !roomId || !characterData) return;

    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);

    // 1. คำนวณแต้มที่ใช้ไป
    const baseSpent = Object.values(baseInvested).reduce((a, b) => a + b, 0);
    const currentSpent = Object.values(statsToAssign).reduce((a, b) => a + b, 0);
    const newPointsUsed = currentSpent - baseSpent;
    const remainingPoints = newPointsAvailable - newPointsUsed;

    if (remainingPoints < 0) {
        return showCustomAlert("เกิดข้อผิดพลาด: แต้มติดลบ", 'error');
    }

    // 2. คำนวณ MaxHP "เก่า" (ก่อนอัป) และ "ใหม่" (หลังอัป)
    const oldCon = calculateTotalStatForAssignment('CON', true); // (คำนวณโดยใช้ baseInvested)
    const oldMaxHp = calculateHP(characterData.race, characterData.classMain, oldCon);
    const isHpFull = characterData.hp >= oldMaxHp;
    
    const newCon = calculateTotalStatForAssignment('CON'); // (คำนวณโดยใช้ statsToAssign)
    const newMaxHp = calculateHP(characterData.race, characterData.classMain, newCon);

    // 3. สร้าง Object ที่จะอัปเดต
    const updates = {
        'stats/investedStats': statsToAssign, // อัปเดตค่าที่ลงทุนใหม่
        'freeStatPoints': remainingPoints,     // อัปเดตแต้มคงเหลือ
        'maxHp': newMaxHp                      // อัปเดต MaxHP ใหม่
    };

    // 4. ตรรกะการอัปเดต HP ปัจจุบัน
    if (isHpFull) {
        // ถ้าเลือดเต็มอยู่แล้ว ก็ให้เต็มเท่า MaxHP ใหม่
        updates['hp'] = newMaxHp;
    } else {
        // ถ้าเลือดไม่เต็ม
        const hpDifference = newMaxHp - oldMaxHp;
        if (hpDifference > 0) {
            // ถ้า MaxHP เพิ่ม (อัป CON) ให้เพิ่ม HP ปัจจุบันด้วย
            updates['hp'] = characterData.hp + hpDifference;
        }
        // (ถ้า MaxHP ลด แต่เลือดไม่เต็ม ก็ไม่ต้องทำอะไร, hp จะถูกจำกัดด้วย maxHp ใน dashboard อยู่แล้ว)
    }

    showLoading("กำลังบันทึก...");

    // 5. บันทึกลง Firebase
    playerRef.update(updates).then(() => {
        hideLoading();
        showCustomAlert("บันทึกสถานะเรียบร้อยแล้ว! กำลังกลับไปที่แดชบอร์ด...", 'success');
        setTimeout(() => { window.location.href = "map.html"; }, 1500);
    }).catch((error) => {
        hideLoading();
        showCustomAlert("เกิดข้อผิดพลาดในการบันทึก: " + error.message, 'error');
    });
}

/**
 * [HELPER] [อัปเกรด v3.1] ฟังก์ชันคำนวณสเตตัสรวม (สำหรับหาค่า HP เก่า)
 */
function calculateTotalStatForAssignment(statKey, useBaseInvested = false) {
    if (!characterData || !characterData.stats) return 0;
    
    const { stats, level = 1 } = characterData;
    const upperStatKey = statKey.toUpperCase();

    let investedValue;
    if (useBaseInvested) {
        investedValue = baseInvested[upperStatKey] || 0;
    } else {
        investedValue = statsToAssign[upperStatKey] !== undefined ? statsToAssign[upperStatKey] : (baseInvested[upperStatKey] || 0);
    }

    // [อัปเดต v3.1] เพิ่มโบนัสอาชีพ
    const baseStat = (stats.baseRaceStats?.[upperStatKey] || 0) +
                     (stats.baseClassStats?.[upperStatKey] || 0) + 
                     investedValue;
    
    let finalStat = baseStat;
    if (finalStat > 0 && level > 1) {
         const levelBonus = finalStat * (level - 1) * 0.2;
         finalStat += levelBonus;
    }

    if (characterData.race === 'โกเลม' && (upperStatKey === 'INT' || upperStatKey === 'WIS')) {
        return 0;
    }

    return Math.floor(finalStat);
}


// --- Initializer ---
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        loadCharacterData(user.uid);
    } else {
        window.location.replace('login.html');
    }
});
