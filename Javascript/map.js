
const roomId = sessionStorage.getItem('roomId');
const currentUserUid = localStorage.getItem('currentUserUid'); // (Lobby.js v3 จะ set ค่านี้)
let playerRef = null;
let roomRef = null;
let playerData = null; // (เก็บข้อมูลผู้เล่นปัจจุบัน)
let guildQuests = {}; // (เก็บเควสเลื่อนขั้นทั้งหมด)
let shopData = {}; // (เก็บข้อมูลร้านค้าทั้งหมด)

// --- Helper Functions (ต้องถูกโหลดมาก่อนจาก charector.js) ---
const calcHPFn = typeof calculateHP === 'function' ? calculateHP : () => { console.error("calculateHP not found!"); return 10; };
const getStatBonusFn = typeof getStatBonus === 'function' ? getStatBonus : () => { console.error("getStatBonus not found!"); return 0; };


function calculateTotalStat(charData, statKey) {
    if (!charData || !charData.stats) return 0;
    
    const stats = charData.stats;
    const upperStatKey = statKey.toUpperCase();
    
    // 1. คำนวณ Level (ถาวร + ชั่วคราว)
    const permanentLevel = charData.level || 1;
    let tempLevel = 0;
    if (Array.isArray(charData.activeEffects)) {
         charData.activeEffects.forEach(effect => {
             if ((effect.stat === 'Level' && effect.modType === 'FLAT') || effect.type === 'TEMP_LEVEL_PERCENT') {
                 if(effect.type === 'TEMP_LEVEL_PERCENT') {
                     tempLevel += Math.floor(permanentLevel * (effect.amount / 100));
                 } else {
                     tempLevel += (effect.amount || 0);
                 }
             }
         });
    }
    const totalLevel = permanentLevel + tempLevel;

    // 2. คำนวณ Base Stat (เผ่า + ที่อัป + บัฟ God Mode จาก DM)
    let baseStat = (stats.baseRaceStats?.[upperStatKey] || 0) +
                   (stats.investedStats?.[upperStatKey] || 0) +
                   (stats.tempStats?.[upperStatKey] || 0);

    // [ v3.1 ] เพิ่มโบนัสจากอาชีพหลักและอาชีพรอง
    const classMainData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charData.classMain] : null;
    const classSubData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charData.classSub] : null;
    
    if (classMainData && classMainData.bonuses) {
        baseStat += (classMainData.bonuses[upperStatKey] || 0);
    }
    if (classSubData && classSubData.bonuses) {
        baseStat += (classSubData.bonuses[upperStatKey] || 0);
    }

    // 3. [v3] คำนวณโบนัสจากสกิลติดตัว (Passive Skills)
    const raceId = charData.raceEvolved || charData.race;
    const racePassives = (typeof RACE_DATA !== 'undefined' && RACE_DATA[raceId]?.passives) ? RACE_DATA[raceId].passives : [];
    
    const classMainId = charData.classMain;
    const classPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classMainId]?.passives) ? CLASS_DATA[classMainId].passives : [];
    
    const classSubId = charData.classSub;
    const subClassPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classSubId]?.passives) ? CLASS_DATA[classSubId].passives : [];
    
    const skillPassives = [];
    if (typeof SKILL_DATA !== 'undefined') {
        // [ ⭐️ แก้ไข Bug 4 (เหมือน player-dashboard) ⭐️ ]
        if(SKILL_DATA[classMainId]) {
            skillPassives.push(...SKILL_DATA[classMainId].filter(s => s.skillTrigger === 'PASSIVE'));
        }
        if(SKILL_DATA[classSubId]) {
            skillPassives.push(...SKILL_DATA[classSubId].filter(s => s.skillTrigger === 'PASSIVE'));
        }
    }

    const allPassives = [...racePassives, ...classPassives, ...subClassPassives, ...skillPassives];
    
    allPassives.forEach(passiveOrSkill => {
        // [ ⭐️ แก้ไข Bug 4 (เหมือน player-dashboard) ⭐️ ]
        let effectObject = null;
        if (passiveOrSkill.skillTrigger === 'PASSIVE') {
            effectObject = passiveOrSkill.effect;
        } else if (passiveOrSkill.id && passiveOrSkill.effect) {
            effectObject = passiveOrSkill.effect;
        }

        if (effectObject) {
            const effects = Array.isArray(effectObject) ? effectObject : [effectObject];
            
            effects.forEach(p => {
                if (p && p.type === 'PASSIVE_STAT_PERCENT' && p.stats?.includes(upperStatKey)) {
                    baseStat *= (1 + (p.amount / 100));
                }
                if (p && p.type === 'PASSIVE_STAT_FLAT' && p.stats?.includes(upperStatKey)) {
                    baseStat += p.amount;
                }
            });
        }
    });

    // 4. คำนวณโบนัสจากบัฟ/ดีบัฟชั่วคราว (Active Effects)
    let flatBonus = 0;
    let percentBonus = 0;

    if (Array.isArray(charData.activeEffects)) {
        charData.activeEffects.forEach(effect => {
            if (effect.stat === upperStatKey || effect.stat === 'ALL') {
                if (effect.modType === 'FLAT') flatBonus += (effect.amount || 0);
                else if (effect.modType === 'PERCENT') percentBonus += (effect.amount || 0);
            }
        });
    }
    
    // 5. [v3] คำนวณโบนัสจากออร่า (ข้ามส่วนนี้ใน map.js)
    // (allPlayersInRoom is not available here)

    // 6. คำนวณโบนัสจากอุปกรณ์ (Equipped Items)
    let equipBonus = 0;
    if (charData.equippedItems) {
        for (const slot in charData.equippedItems) {
            const item = charData.equippedItems[slot];
            if (!item || !item.bonuses || item.bonuses[upperStatKey] === undefined) continue;

            let itemStatBonus = item.bonuses[upperStatKey] || 0;
            
            if (item.itemType === 'อาวุธ') {
                if (slot === 'mainHand') {
                    if (item.isProficient) itemStatBonus *= 1.015;
                } else if (slot === 'offHand') {
                    itemStatBonus *= 0.70;
                }
            }
            equipBonus += itemStatBonus;
        }
    }

    // 7. รวมค่าสถานะ
    let finalStat = (baseStat * (1 + (percentBonus / 100))) + flatBonus + equipBonus;

    // 8. คำนวณโบนัสจาก Level
    if (finalStat > 0 && totalLevel > 1) {
         const levelBonus = finalStat * (totalLevel - 1) * 0.2;
         finalStat += levelBonus;
    }
   
    // 9. [v3] ตรวจสอบเงื่อนไขพิเศษ
    if (charData.race === 'โกเลม' && upperStatKey === 'DEX') {
        return 0;
    }

    return Math.floor(finalStat);
}


// =================================================================================
// 1. UI Management (ข้อ 9)
// (ส่วนนี้ไม่มีบั๊ก คงเดิม)
// =================================================================================


function showMapUI(panelId) {
    const container = document.getElementById('map-ui-container');
    if (!container) return;

    // ซ่อน Panel ที่เป็น UI หลักทั้งหมด
    container.querySelectorAll('.map-panel, .guild-panel, .inn-panel, .shop-panel').forEach(panel => {
        panel.classList.add('hidden');
    });

    let targetPanelId = '';
    switch (panelId) {
        case 'world':
            targetPanelId = 'world-map-panel';
            break;
        case 'city':
            targetPanelId = 'city-map-panel';
            break;
        case 'building':
        default:
            targetPanelId = 'building-map-panel';
            break;
    }

    const targetPanel = document.getElementById(targetPanelId);
    if (targetPanel) {
        targetPanel.classList.remove('hidden');
    }
    
    container.classList.remove('hidden');
}


function hideMapUI() {
    const container = document.getElementById('map-ui-container');
    if (container) {
        container.classList.add('hidden');
    }
}

/**
 * แสดง UI ของอาคารที่เลือก (กิลด์, ร้านค้า, โรงเตี๊ยม) (ข้อ 10)
 */
function showBuildingUI(buildingId) {
    const container = document.getElementById('map-ui-container');
    if (!container) return;

    // ซ่อน Panel แผนที่ทั้งหมด
    container.querySelectorAll('.map-panel, .shop-panel, .guild-panel, .inn-panel').forEach(panel => {
        panel.classList.add('hidden');
    });

    let targetPanelId = '';
    switch (buildingId) {
        case 'guild':
            targetPanelId = 'guild-panel';
            loadGuildUI(); // (โหลดข้อมูลกิลด์)
            break;
        case 'shops':
            targetPanelId = 'shop-select-panel';
            // (ไม่ต้องโหลดอะไร แค่แสดงหน้าเลือก)
            break;
        case 'inn':
            targetPanelId = 'inn-panel';
            loadInnUI(); // (โหลดข้อมูลโรงเตี๊ยม)
            break;
        case 'shop_items':
             targetPanelId = 'shop-item-panel';
             // (openShop() จะเรียกอันนี้เอง)
             break;
        case 'colosseum':
            targetPanelId = 'colosseum-panel'; // ชื่อ ID ของ div ที่เราสร้างใน map.html
            loadColosseumUI(); // เรียกฟังก์ชันโหลดรายชื่อคน (ที่เพิ่งเพิ่มไป)
            break;
        default:
            targetPanelId = 'building-map-panel';
            break;
    }

    const targetPanel = document.getElementById(targetPanelId);
    if (targetPanel) {
        targetPanel.classList.remove('hidden');
    }
}

// =================================================================================
// 2. Guild Logic (ข้อ 10)
// (ส่วนนี้ไม่มีบั๊ก คงเดิม)
// =================================================================================


function loadGuildUI() {
    if (!playerData) {
        console.error("Guild: Player data not loaded yet.");
        return;
    }

    const subClassSection = document.getElementById('guild-subclass-section');
    const subClassSelect = document.getElementById('subclass-select');

    // ตรวจสอบเงื่อนไขการเลือกอาชีพรอง (ข้อ 10)
    if (playerData.level >= 10 && !playerData.classSub) {
        subClassSelect.innerHTML = '<option value="">-- เลือกอาชีพรอง --</option>';
        
        // (ดึงอาชีพ T1 ทั้งหมด)
        const t1Classes = ["นักรบ", "นักเวท", "นักบวช", "โจร", "เรนเจอร์", "แทงค์", "พ่อค้า"];
        
        t1Classes.forEach(className => {
            // (ห้ามเลือกซ้ำกับอาชีพหลัก)
            if (playerData.classMain !== className) {
                subClassSelect.innerHTML += `<option value="${className}">${className}</option>`;
            }
        });
        subClassSection.classList.remove('hidden');
    } else {
        subClassSection.classList.add('hidden');
    }

    // โหลดเควสเลื่อนขั้น
    loadGuildQuests();
}

function loadGuildQuests() {
    const listDiv = document.getElementById('guild-quest-list');
    listDiv.innerHTML = '<h3 style="color:#ffc107; border-bottom:1px solid #555; padding-bottom:5px;">📋 ภารกิจเลื่อนขั้น</h3>';
    let foundQuest = false;

    if (!guildQuests || Object.keys(guildQuests).length === 0) {
        listDiv.innerHTML += '<p style="text-align:center; padding:20px; color:#aaa;"><em>- ไม่มีประกาศจากกิลด์ -</em></p>';
        return;
    }

    for (const questId in guildQuests) {
        const quest = guildQuests[questId];
        
        // กรอง: อาชีพต้องตรง และ เลเวลต้องถึง
        if (quest.requiredClass === playerData.classMain && playerData.level >= quest.requiredLevel) {
            
            const playerHasQuest = (playerData.quest && playerData.quest.id === questId);
            
            let btnHtml = '';
            if (playerHasQuest) {
                btnHtml = '<button disabled style="width:100%; padding:8px; background-color:#ffc107; color:#000; border:none; border-radius:5px; font-weight:bold; cursor:default;">กำลังดำเนินการ...</button>';
            } else {
                btnHtml = `<button onclick="acceptGuildQuest('${questId}')" style="width:100%; padding:8px; background:linear-gradient(90deg, #007bff, #0056b3); color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">รับภารกิจนี้</button>`;
            }

            listDiv.innerHTML += `
                <div class="guild-quest" style="background:rgba(255,255,255,0.05); border-left:4px solid #007bff; padding:15px; margin-bottom:10px; border-radius:5px;">
                    <div style="display:flex; justify-content:space-between;">
                        <h4 style="margin:0; color:#fff;">${quest.title}</h4>
                        <span style="font-size:0.8em; background:#333; padding:2px 6px; border-radius:4px; color:#aaa;">Lv.${quest.requiredLevel}+</span>
                    </div>
                    <p style="font-style:italic; color:#ccc; margin:10px 0; font-size:0.9em;">"${quest.description}"</p>
                    <div style="font-size:0.9em; color:#ffeb8a; margin-bottom:10px;">
                        <strong>🏆 รางวัล:</strong> เลื่อนขั้นอาชีพ
                    </div>
                    ${btnHtml}
                </div>
            `;
            foundQuest = true;
        }
    }

    if (!foundQuest) {
        listDiv.innerHTML += `
            <div style="text-align:center; padding:20px; color:#aaa; background:rgba(0,0,0,0.2); border-radius:8px; margin-top:10px;">
                <p style="margin:0;">ยังไม่มีภารกิจสำหรับ <strong>${playerData.classMain}</strong> (Lv.${playerData.level})</p>
                <small style="color:#777;">โปรดเก็บเลเวลเพิ่ม หรือรอ DM อัปเดต</small>
            </div>`;
    }
}
function loadColosseumUI() {
    // 1. เช็คว่าตัวเราลงทะเบียนอยู่ไหม
    const isRegistered = playerData.location === 'colosseum_lobby';
    updateColosseumButton(isRegistered);

    // 2. ดึงรายชื่อคนในล็อบบี้
    const listEl = document.getElementById('colosseum-player-list');
    
    // (ใช้ Listener เดิมจาก roomRef แต่กรองเอาเฉพาะคนที่ location = 'colosseum_lobby')
    db.ref(`rooms/${roomId}/playersByUid`).on('value', snapshot => {
        if(document.getElementById('colosseum-panel').classList.contains('hidden')) return;
        
        const players = snapshot.val() || {};
        listEl.innerHTML = '';
        let count = 0;

        for (const uid in players) {
            const p = players[uid];
            if (p.location === 'colosseum_lobby') {
                count++;
                const status = p.hp > 0 ? '<span style="color:#00ff00;">(พร้อม)</span>' : '<span style="color:red;">(บาดเจ็บ)</span>';
                listEl.innerHTML += `<li style="padding: 5px; border-bottom: 1px solid #444;">🛡️ <strong>${p.name}</strong> ${status} <small>Lv.${p.level}</small></li>`;
            }
        }
        if(count === 0) listEl.innerHTML = '<li style="color:#777; text-align:center;">ยังไม่มีใครลงทะเบียน</li>';
    });
}
function toggleColosseumStatus() {
    const isRegistered = playerData.location === 'colosseum_lobby';
    const newLocation = isRegistered ? 'city' : 'colosseum_lobby'; // สลับสถานะ
    
    playerRef.update({ location: newLocation }).then(() => {
        updateColosseumButton(!isRegistered);
        if (!isRegistered) Swal.fire('ลงทะเบียนแล้ว!', 'รอ DM จับคู่ประลอง...', 'success');
        else Swal.fire('ยกเลิกแล้ว', 'คุณออกจากรายการประลอง', 'info');
    });
}
function updateColosseumButton(isRegistered) {
    const btn = document.getElementById('btn-join-colosseum');
    if (btn) {
        if (isRegistered) {
            btn.textContent = "❌ ยกเลิกการลงทะเบียน";
            btn.style.backgroundColor = "#dc3545";
        } else {
            btn.textContent = "✅ ลงทะเบียนประลอง";
            btn.style.backgroundColor = "#28a745";
        }
    }
}
async function acceptGuildQuest(questId) {
    if (!guildQuests[questId]) return;
    
    // (ตรวจสอบว่ามีเควสอยู่แล้วหรือไม่)
    if (playerData.quest) {
        return Swal.fire('ผิดพลาด', 'คุณมีเควสอื่นค้างอยู่ กรุณาส่งเควสเก่าก่อน', 'warning');
    }
    
    const questData = {
        id: questId, // (บันทึก ID เควส)
        title: guildQuests[questId].title,
        detail: guildQuests[questId].description,
        reward: "เลื่อนขั้นอาชีพ",
        expReward: 0,
        isGuildQuest: true // (ระบุว่าเป็นเควสเลื่อนขั้น)
    };

    try {
        await playerRef.child('quest').set(questData);
        Swal.fire('สำเร็จ', `รับเควส "${questData.title}" แล้ว!`, 'success');
        loadGuildQuests(); // (รีเฟรช UI)
    } catch (error) {
        Swal.fire('ผิดพลาด', 'ไม่สามารถรับเควสได้: ' + error.message, 'error');
    }
}

/**
 * ลงทะเบียนอาชีพรอง (ข้อ 10)
 */
async function registerSubClass() {
    const selectedClass = document.getElementById('subclass-select').value;
    if (!selectedClass) {
        return Swal.fire('ผิดพลาด', 'กรุณาเลือกอาชีพรอง', 'warning');
    }
    
    // (ตรวจสอบเงื่อนไขอีกครั้ง)
    if (playerData.level < 10 || playerData.classSub) {
         return Swal.fire('ผิดพลาด', 'คุณไม่ตรงตามเงื่อนไข (Level 10 และยังไม่มีอาชีพรอง)', 'error');
    }
    
    // (ตรวจสอบอาชีพลับ - นักดาบเวทย์)
    if ( (playerData.classMain === 'นักรบ' && selectedClass === 'นักเวท') ||
         (playerData.classMain === 'นักเวท' && selectedClass === 'นักรบ') ) {
        
        Swal.fire({
            title: 'อาชีพลับ!',
            text: `การผสมผสานระหว่าง "นักรบ" และ "นักเวท" ทำให้คุณปลดล็อคอาชีพลับ "นักดาบเวทย์"! คุณต้องการเปลี่ยนอาชีพหลักเป็น "นักดาบเวทย์" หรือไม่? (อาชีพรองของคุณจะหายไป)`,
            icon: 'success',
            showCancelButton: true,
            confirmButtonText: 'ใช่, ฉันจะเป็นนักดาบเวทย์!',
            cancelButtonText: 'ไม่, ฉันจะเลือกอาชีพรองอื่น'
        }).then(async (result) => {
            if (result.isConfirmed) {
                await playerRef.update({
                    classMain: 'นักดาบเวทย์',
                    classSub: null // (อาชีพลับจะแทนที่อาชีพหลัก)
                });
                Swal.fire('สำเร็จ!', 'คุณได้เปลี่ยนเป็น "นักดาบเวทย์" แล้ว!', 'success');
                hideMapUI();
            }
        });
        
    } else {
        // (อาชีพรองทั่วไป)
        try {
            await playerRef.child('classSub').set(selectedClass);
            Swal.fire('สำเร็จ', `คุณได้เลือกอาชีพรองเป็น "${selectedClass}" แล้ว!`, 'success');
            hideMapUI();
        } catch (error) {
            Swal.fire('ผิดพลาด', 'ไม่สามารถบันทึกอาชีพรองได้: ' + error.message, 'error');
        }
    }
}


function loadInnUI() {
    const btn = document.getElementById('btn-rest');
    if (!playerData) return; // (ป้องกัน Error ถ้าข้อมูลยังไม่โหลด)

    if (btn) {
        btn.textContent = `พักผ่อน (ราคา 10 GP) - (คุณมี ${playerData.gp || 0} GP)`;
        btn.disabled = (playerData.gp || 0) < 10;
    }
}

async function restAtInn() {
    const restCost = 10;
    
    Swal.fire({
        title: 'พักผ่อน?',
        text: `คุณต้องการใช้ ${restCost} GP เพื่อฟื้นฟู HP จนเต็มหรือไม่?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'ใช่, พักผ่อน',
        cancelButtonText: 'ยกเลิก'
    }).then((result) => {
        if (result.isConfirmed) {
            showLoading("กำลังพักผ่อน...");
            
            playerRef.transaction(currentData => {
                if (!currentData) return;
                
                if (currentData.gp < restCost) {
                    // (ป้องกันกรณีกดซ้ำ)
                    setTimeout(() => Swal.fire('ผิดพลาด', 'เงินไม่พอ!', 'error'), 100);
                    return; // (ยกเลิก Transaction)
                }
                
                // 1. หักเงิน
                currentData.gp -= restCost;
                
                // 2. [ ⭐️ KONGFA-FIX ⭐️ ]
                // คำนวณ MaxHP (ต้องใช้ charector.js และฟังก์ชัน v3.1)
                // (ใช้ฟังก์ชันใหม่ที่ถูกต้อง)
                const currentCon = calculateTotalStat(currentData, 'CON');
                const maxHp = calcHPFn(currentData.race, currentData.classMain, currentCon);
                
                // 3. เติม HP
                currentData.hp = maxHp;
                
                // 4. (ในอนาคต) ล้างคูลดาวน์ PERSONAL
                
                return currentData;
                
            }).then((result) => {
                if (result.committed) {
                    hideLoading();
                    Swal.fire('สดชื่น!', 'พักผ่อนเต็มอิ่มแล้ว HP ฟื้นฟูจนเต็ม!', 'success');
                    loadInnUI(); // (อัปเดตปุ่ม)
                } else {
                    hideLoading();
                }
            }).catch(error => {
                hideLoading();
                Swal.fire('ผิดพลาด', 'ไม่สามารถพักผ่อนได้: ' + error.message, 'error');
            });
        }
    });
}

// =================================================================================
async function openShop(shopId) {
    showBuildingUI('shop_items'); 
    
    const shopNameMap = {
        'weapon_basic': 'ร้านอาวุธเริ่มต้น',
        'weapon_common': 'ร้านอาวุธทั่วไป',
        'weapon_magic': 'ร้านเครื่องมือเวทย์',
        'weapon_high': 'ร้านอาวุธระดับสูง',
        'armor': 'ร้านอุปกรณ์/เกราะ',
        'general': 'ร้านจิปาถะ'
    };
    document.getElementById('shop-title').textContent = shopNameMap[shopId] || 'ร้านค้า';
    
    const listDiv = document.getElementById('shop-item-list');
    listDiv.innerHTML = '<p style="text-align:center;">กำลังโหลดสินค้า...</p>';

    const currentShopData = shopData[shopId];
    
    if (!currentShopData || Object.keys(currentShopData).length === 0) {
        listDiv.innerHTML = '<p style="text-align:center; color:#aaa; margin-top:20px;"><em>ร้านนี้ของหมด (DM ยังไม่ได้ลงของ)</em></p>';
        return;
    }

    listDiv.innerHTML = '';
    const playerGP = playerData?.gp || 0;

    for (const itemId in currentShopData) {
        const item = currentShopData[itemId];
        const canBuy = playerGP >= item.price;
        
        // 1.1 สร้าง HTML แสดงค่าโบนัส (Stats)
        let statsHtml = '';
        if (item.bonuses && Object.keys(item.bonuses).length > 0) {
            statsHtml += '<div style="font-size:0.85em; color:#00ff00; margin:5px 0;">';
            for (const stat in item.bonuses) {
                statsHtml += `<span style="margin-right:5px;">⚡ ${stat}+${item.bonuses[stat]}</span>`;
            }
            statsHtml += '</div>';
        }

        // 1.2 สร้าง HTML แสดงเอฟเฟกต์ (ยา/อาหาร)
        if (item.effects) {
             statsHtml += '<div style="font-size:0.85em; color:#00bcd4; margin:5px 0;">';
             if(item.effects.heal) statsHtml += `<div>❤️ ฟื้นฟู: ${item.effects.heal} HP</div>`;
             if(item.effects.permStats) item.effects.permStats.forEach(p => statsHtml += `<div>💪 ถาวร: ${p.stat} +${p.amount}</div>`);
             if(item.effects.tempStats) item.effects.tempStats.forEach(t => statsHtml += `<div>⏱️ ชั่วคราว: ${t.stat} +${t.amount} (${t.turns} เทิร์น)</div>`);
             statsHtml += '</div>';
        }

        // 1.3 แสดงอาวุธ
        let weaponInfo = '';
        if (item.damageDice) {
            weaponInfo = `<span style="color:#ff6666; font-size:0.9em;">⚔️ Dmg: ${item.damageDice}</span>`;
        }

        listDiv.innerHTML += `
            <div class="shop-item" style="border:1px solid #a97125; background:rgba(0,0,0,0.6); padding:12px; margin-bottom:10px; border-radius:8px; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0; color:#ffd700; font-size:1.1em;">${item.name}</h4>
                    <span style="color:${canBuy ? '#00ff00' : '#ff4d4d'}; font-weight:bold; font-size:1.1em;">${item.price} GP</span>
                </div>
                <div style="font-size:0.85em; color:#ccc; margin-top:2px;">
                    ${item.itemType || 'ทั่วไป'} ${weaponInfo} | ทนทาน: ${item.durability || 100}%
                </div>
                
                ${statsHtml}
                
                <button onclick="buyItem('${shopId}', '${itemId}')" 
                    style="margin-top:8px; width:100%; padding:8px; border:none; border-radius:5px; color:white; font-weight:bold; cursor:${canBuy ? 'pointer' : 'not-allowed'}; background-color:${canBuy ? '#28a745' : '#555'};" 
                    ${canBuy ? '' : 'disabled'}>
                    ${canBuy ? '🛒 ซื้อสินค้า' : '❌ เงินไม่พอ'}
                </button>
            </div>
        `;
    }
}

async function buyItem(shopId, itemId) {
    const item = shopData[shopId]?.[itemId];
    if (!item) return Swal.fire('ผิดพลาด', 'ไม่พบไอเทมนี้ในร้านค้า!', 'error');
    
    const price = item.price;

    showLoading(`กำลังซื้อ ${item.name}...`);

    playerRef.transaction(currentData => {
        if (!currentData) return;
        
        const playerGP = currentData.gp || 0;
        if (playerGP < price) {
            setTimeout(() => Swal.fire('ผิดพลาด', 'เงินไม่พอ!', 'error'), 100);
            return; // (ยกเลิก Transaction)
        }
        
        // 1. หักเงิน
        currentData.gp -= price;
        
        // 2. สร้างไอเทมใหม่
        const itemToBuy = {
            name: item.name,
            quantity: 1,
            durability: item.durability || 100,
            itemType: item.itemType || 'ทั่วไป',
            bonuses: item.bonuses ? { ...item.bonuses } : {},
            originalBonuses: item.originalBonuses ? { ...item.originalBonuses } : (item.bonuses ? { ...item.bonuses } : {})
        };
        
        // (เพิ่มข้อมูลเฉพาะประเภท)
        if (item.itemType === 'สวมใส่') itemToBuy.slot = item.slot;
        if (item.itemType === 'อาวุธ') {
            itemToBuy.damageDice = item.damageDice;
            itemToBuy.weaponType = item.weaponType;
            itemToBuy.recommendedClass = item.recommendedClass || [];
        }
        // [ ⭐️ KONGFA-FIX (New Bug) ⭐️ ]
        // คัดลอก 'effects' สำหรับไอเทมบริโภค (ยา)
        if (item.itemType === 'บริโภค' && item.effects) {
            itemToBuy.effects = JSON.parse(JSON.stringify(item.effects));
        }

        // 3. เพิ่มเข้า Inventory
        if (!currentData.inventory) currentData.inventory = [];
        
        // [ ⭐️ KONGFA-FIX (Bug 5) ⭐️ ]
        // (ตรรกะ Stack ไอเทม - เฉพาะไอเทมที่ไม่มีโบนัส และ ไม่มีเอฟเฟกต์)
        const hasBonuses = itemToBuy.bonuses && Object.keys(itemToBuy.bonuses).length > 0;
        const hasEffects = itemToBuy.effects && (
            (itemToBuy.effects.heal && itemToBuy.effects.heal > 0) ||
            (itemToBuy.effects.permStats && itemToBuy.effects.permStats.length > 0) ||
            (itemToBuy.effects.tempStats && itemToBuy.effects.tempStats.length > 0)
        );
        
        const isStackable = (itemToBuy.itemType === 'ทั่วไป' || itemToBuy.itemType === 'บริโภค') && !hasBonuses && !hasEffects;
        let found = false;
        
        if (isStackable) {
            for (let i = 0; i < currentData.inventory.length; i++) {
                const invItem = currentData.inventory[i];
                // (ตรวจสอบว่าไอเทมในช่องเก็บของ stack ได้หรือไม่)
                const invHasBonuses = invItem.bonuses && Object.keys(invItem.bonuses).length > 0;
                const invHasEffects = invItem.effects && (
                    (invItem.effects.heal && invItem.effects.heal > 0) ||
                    (invItem.effects.permStats && invItem.effects.permStats.length > 0) ||
                    (invItem.effects.tempStats && invItem.effects.tempStats.length > 0)
                );

                if (invItem.name === itemToBuy.name && !invHasBonuses && !invHasEffects) {
                    invItem.quantity += 1;
                    found = true;
                    break;
                }
            }
        }
        
        if (!found) {
            currentData.inventory.push(itemToBuy);
        }
        
        return currentData;
        
    }).then((result) => {
        hideLoading();
        if (result.committed) {
            Swal.fire('สำเร็จ', `ซื้อ ${item.name} สำเร็จ!`, 'success');
            // (รีเฟรช UI ร้านค้า เพื่ออัปเดตสถานะปุ่ม 'เงินไม่พอ')
            openShop(shopId);
        }
    }).catch(error => {
        hideLoading();
        Swal.fire('ผิดพลาด', 'ไม่สามารถซื้อไอเทมได้: ' + error.message, 'error');
    });
}

// =================================================================================
// 5. Initializer
// (ส่วนนี้ไม่มีบั๊ก คงเดิม)
// =================================================================================

window.onload = function() {
    if (!roomId || !currentUserUid) {
        Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลผู้ใช้หรือห้อง! กำลังกลับไปที่ล็อบบี้...', 'error');
        setTimeout(() => window.location.href = 'lobby.html', 2000);
        return;
    }
    
    playerRef = db.ref(`rooms/${roomId}/playersByUid/${currentUserUid}`);
    roomRef = db.ref(`rooms/${roomId}`);

    // 1. ฟังข้อมูลผู้เล่น (สำหรับ GP, Level, Class)
    playerRef.on('value', (snapshot) => {
        if (!snapshot.exists()) {
            console.log("ไม่พบข้อมูลตัวละคร -> ไปหน้าสร้างใหม่");
            window.location.replace('PlayerCharecter.html');
            return;
        }
        playerData = snapshot.val();
        
        // (อัปเดต UI ที่อาจจะเปิดค้างอยู่)
        if (document.getElementById('guild-panel').classList.contains('hidden') === false) {
            loadGuildUI();
        }
        if (document.getElementById('inn-panel').classList.contains('hidden') === false) {
            loadInnUI();
        }
    });

    // 2. ฟังข้อมูลกิลด์ (สำหรับเควสเลื่อนขั้น)
    roomRef.child('guild/quests').on('value', (snapshot) => {
        guildQuests = snapshot.val() || {};
        // (อัปเดต UI ถ้าเปิดค้างอยู่)
        if (playerData && document.getElementById('guild-panel').classList.contains('hidden') === false) {
            loadGuildQuests();
        }
    });

    // 3. ฟังข้อมูลร้านค้า (สำหรับไอเทม)
    roomRef.child('shops').on('value', (snapshot) => {
        shopData = snapshot.val() || {};
        // (ไม่ต้องทำอะไรจนกว่าผู้เล่นจะกดเปิดร้าน)
    });

    // (แสดง UI เริ่มต้น)
    showMapUI('building');
};

// =================================================================================
// 6. DM Tools Logic (เพิ่มใหม่)
// =================================================================================

// เช็คสิทธิ์ DM เมื่อโหลด
function checkDMPermission() {
    if (!roomRef || !currentUserUid) return;
    
    // ดึงข้อมูลห้องเพื่อเช็ค dmUid
    roomRef.once('value').then(snap => {
        const room = snap.val();
        if (room && room.dmUid === currentUserUid) {
            // ถ้าใช่ DM ให้แสดงปุ่ม
            const btn = document.getElementById('btn-dm-tools');
            if(btn) btn.style.display = 'block';
        }
    });
}

// เรียกใช้ฟังก์ชันเช็คสิทธิ์ตอนโหลดหน้าเว็บ
// (เพิ่มบรรทัดนี้ใน window.onload หรือเรียกต่อท้ายไฟล์เลยก็ได้)
setTimeout(checkDMPermission, 1000); 


// เปิด/ปิด หน้าต่างเครื่องมือ
function toggleDMTools() {
    const panel = document.getElementById('dm-tools-panel');
    const btn = document.getElementById('btn-dm-tools');
    
    if (panel && btn) {
        panel.classList.toggle('active');
        btn.classList.toggle('active');
    }
}

// สลับ Tab
function switchDMTab(tabName) {
    document.getElementById('dm-tab-shop').classList.add('hidden');
    document.getElementById('dm-tab-quest').classList.add('hidden');
    document.getElementById('dm-tab-misc').classList.add('hidden');
    
    document.getElementById('dm-tab-' + tabName).classList.remove('hidden');
}

// --- ฟังก์ชันทำงานจริง ---

// 1. เพิ่มไอเทมเข้าร้าน
function dmAddItem() {
    const shopId = document.getElementById('dmShopSelect').value;
    const name = document.getElementById('dmItemName').value.trim();
    const price = parseInt(document.getElementById('dmItemPrice').value) || 0;
    const type = document.getElementById('dmItemType').value;
    
    if (!name) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณาใส่ชื่อไอเทม', 'warning');

    // แปลง Stats string (เช่น "STR:2,DEX:1") เป็น Object
    const statsStr = document.getElementById('dmItemStats').value.trim();
    let bonuses = {};
    if (statsStr) {
        statsStr.split(',').forEach(pair => {
            const [key, val] = pair.split(':');
            if(key && val) bonuses[key.toUpperCase().trim()] = parseInt(val);
        });
    }

    const newItem = {
        name: name,
        price: price,
        itemType: type,
        bonuses: bonuses,
        durability: 100
    };

    db.ref(`rooms/${roomId}/shops/${shopId}`).push(newItem)
        .then(() => {
            Swal.fire('เรียบร้อย', `เพิ่ม ${name} เข้าร้านแล้ว`, 'success');
            // ล้างช่อง
            document.getElementById('dmItemName').value = '';
            document.getElementById('dmItemStats').value = '';
        });
}

// 2. เพิ่มเควส
function dmAddQuest() {
    const title = document.getElementById('dmQuestTitle').value.trim();
    const desc = document.getElementById('dmQuestDesc').value.trim();
    const job = document.getElementById('dmQuestClass').value;
    const lvl = parseInt(document.getElementById('dmQuestLevel').value);

    if (!title) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณาใส่ชื่อเควส', 'warning');

    const questId = `quest_${job}_${Date.now()}`; // สร้าง ID ไม่ซ้ำ
    const questData = {
        title: title,
        description: desc || "ไม่มีรายละเอียด",
        requiredClass: job,
        requiredLevel: lvl
    };

    db.ref(`rooms/${roomId}/guild/quests/${questId}`).set(questData)
        .then(() => Swal.fire('เรียบร้อย', 'ประกาศเควสแล้ว', 'success'));
}

// 3. ฟังก์ชันอื่นๆ
function dmHealAll() {
    // ดึงผู้เล่นทุกคน แล้ว Heal
    db.ref(`rooms/${roomId}/playersByUid`).once('value', snap => {
        const updates = {};
        snap.forEach(child => {
            const p = child.val();
            // (คำนวณ MaxHP ง่ายๆ หรือดึงจาก saved maxHp)
            const maxHp = p.maxHp || 100; 
            updates[`rooms/${roomId}/playersByUid/${child.key}/hp`] = maxHp;
        });
        db.ref().update(updates).then(() => Swal.fire('Healed!', 'ฟื้นฟูทุกคนแล้ว', 'success'));
    });
}

function dmClearEnemies() {
    Swal.fire({
        title: 'ยืนยัน?', text: 'ลบมอนสเตอร์ทั้งหมดในฉาก?', icon: 'warning',
        showCancelButton: true, confirmButtonText: 'ลบเลย'
    }).then((res) => {
        if (res.isConfirmed) {
            db.ref(`rooms/${roomId}/enemies`).remove()
                .then(() => Swal.fire('Deleted', 'เคลียร์พื้นที่เรียบร้อย', 'success'));
        }
    });
}

function dmGiveMoney() {
    db.ref(`rooms/${roomId}/playersByUid`).once('value', snap => {
        snap.forEach(child => {
            const p = child.val();
            const newGp = (p.gp || 0) + 100;
            db.ref(`rooms/${roomId}/playersByUid/${child.key}/gp`).set(newGp);
        });
        Swal.fire('Rich!', 'แจกเงินคนละ 100 GP แล้ว', 'success');
    });
}

function toggleMainMenu() {
    const panel = document.getElementById('main-menu-panel');
    const btn = document.getElementById('btn-main-menu');
    
    // สลับ class active
    panel.classList.toggle('active');
    btn.classList.toggle('active'); // ให้ปุ่มหมุนด้วย
}

// ฟังก์ชันเลือกแผนที่แล้วปิดเมนูอัตโนมัติ
function selectMap(type) {
    showMapUI(type);
    
    // ปิดเมนู (เอา class active ออก)
    document.getElementById('main-menu-panel').classList.remove('active');
    document.getElementById('btn-main-menu').classList.remove('active');
}

// (Optional) คลิกที่อื่นเพื่อปิดเมนู
window.addEventListener('click', function(e) {
    const btn = document.getElementById('btn-main-menu');
    const panel = document.getElementById('main-menu-panel');
    
    // ถ้าคลิกไม่ได้โดนปุ่ม และไม่ได้โดนเมนู
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
        panel.classList.remove('active');
        btn.classList.remove('active');
    }
});