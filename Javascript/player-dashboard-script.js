// Javascript/player-dashboard-script.js (v3.7 - Fix MaxHP Sync)

// --- Global State ---
let allPlayersInRoom = {};
let allEnemiesInRoom = {};
let combatState = {};
let currentCharacterData = null; 

// let useVisualBars = localStorage.getItem('useVisualBars') === 'true';
let visualMode = parseInt(localStorage.getItem('visualMode')) || 0;

function toggleVisualMode() {
    visualMode = (visualMode + 1) % 5; // วนลูป 0, 1, 2, 3, 4
    localStorage.setItem('visualMode', visualMode);
    
    // อัปเดตข้อความปุ่ม (Optional: เพื่อให้รู้ว่าอยู่โหมดไหน)
    // const btn = document.querySelector('.view-toggle-btn');
    // if(btn) btn.textContent = `👁️ โหมด ${visualMode + 1}/5`;

    // รีเฟรชหน้าจอทันที
    if (currentCharacterData) {
        displayCharacter(currentCharacterData, combatState);
        displayInventory(currentCharacterData.inventory);
        displayEquippedItems(currentCharacterData.equippedItems);
        displayEnemies(allEnemiesInRoom, currentCharacterData.uid);
        showTeammateInfo(); 
    }
}

/* [NEW] ฟังก์ชัน Helper สร้าง HTML (หลอด หรือ ตัวเลข) */
function getStatusDisplay(current, max, type = 'HP') {
    const curVal = parseInt(current) || 0;
    const maxVal = parseInt(max) || 1;
    const percent = Math.min(100, Math.max(0, (curVal / maxVal) * 100));
    
    // 1. กำหนดสี
    let color = '#fff'; // สีตัวอักษร
    let barColor = '#ccc'; // สีหลอด

    if (type === 'HP') {
        if (percent > 50) { color = '#00ff00'; barColor = '#28a745'; } // เขียว
        else if (percent > 25) { color = '#ffc107'; barColor = '#ffc107'; } // เหลือง
        else { color = '#ff4d4d'; barColor = '#dc3545'; } // แดง
    } else if (type === 'DURA') {
        if (percent <= 0) { color = '#ff4d4d'; barColor = '#555'; } // พัง (เทา/แดง)
        else if (percent > 50) { color = '#00ff00'; barColor = '#17a2b8'; } // ฟ้า/เขียว
        else if (percent > 20) { color = '#ffc107'; barColor = '#ffc107'; } // เหลือง
        else { color = '#ff4d4d'; barColor = '#dc3545'; } // แดง
    }

    // กรณีของพัง (แสดงข้อความพิเศษเสมอ หรือจะให้เป็นหลอดแดงเปล่าๆ ก็ได้)
    // แต่เพื่อความชัดเจน ถ้าพังแล้วขอแสดง Text พิเศษในโหมด Text
    if (type === 'DURA' && curVal <= 0) {
        if (visualMode < 2) return `<span style="color:${color}; font-weight:bold;">[พัง 0%]</span>`;
    }

    // 2. สร้าง HTML ตามโหมด
    switch (visualMode) {
        case 0: // [194/194] (Text)
            return `<span style="color:${color}; font-weight:bold;">${curVal} / ${maxVal}</span>`;
            
        case 1: // [100%] (Text)
            return `<span style="color:${color}; font-weight:bold;">${Math.floor(percent)}%</span>`;
            
        case 2: // [Bar] 194/194
            return createBarHtml(percent, barColor, `${curVal}/${maxVal}`);
            
        case 3: // [Bar] 100%
            return createBarHtml(percent, barColor, `${Math.floor(percent)}%`);
            
        case 4: // [Bar] (Empty)
            return createBarHtml(percent, barColor, ``); // ไม่ใส่ข้อความ
            
        default: return `${curVal}/${maxVal}`;
    }
}

function createBarHtml(percent, color, text) {
    return `
        <div class="status-bar-container" style="width: 100px; display: inline-block; vertical-align: middle;">
            <div class="status-bar-fill" style="width: ${percent}%; background-color: ${color}; height: 100%;"></div>
            <div class="status-text-overlay" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.75em; color: #fff; text-shadow: 1px 1px 2px #000; font-weight: bold; white-space: nowrap; pointer-events: none;">
                ${text}
            </div>
        </div>
    `;
}

// --- Utility Functions ---
const calcHPFn = typeof calculateHP === 'function' ? calculateHP : () => { console.error("calculateHP not found!"); return 10; };
const getStatBonusFn = typeof getStatBonus === 'function' ? getStatBonus : () => { console.error("getStatBonus not found!"); return 0; };
const showAlert = typeof showCustomAlert === 'function' ? showCustomAlert : (msg, type) => { console.log(type + ':', msg); };

// =================================================================
function calculateTotalStat(charData, statKey) {
    if (!charData) return 0;
    
    const upperStatKey = statKey.toUpperCase();
    let baseStat = 0;

    // 1. คำนวณ Base Stat
    if (charData.type === 'enemy' || (charData.stats && !charData.stats.baseRaceStats)) {
        // [FIX] สำหรับศัตรู ให้ตั้ง Base Stat แล้วทำต่อ ไม่ Return ทันที
        const s = charData.stats || {};
        const rawValue = s[upperStatKey] || s[statKey.toLowerCase()] || 0;
        baseStat = parseInt(rawValue) || 0;
    } else {
        // สำหรับผู้เล่น
        const stats = charData.stats || {};
        baseStat = (stats.baseRaceStats?.[upperStatKey] || 0) +
                   (stats.investedStats?.[upperStatKey] || 0) +
                   (stats.tempStats?.[upperStatKey] || 0);

        const classMainData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charData.classMain] : null;
        const classSubData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charData.classSub] : null;
        
        if (classMainData && classMainData.bonuses) baseStat += (classMainData.bonuses[upperStatKey] || 0);
        if (classSubData && classSubData.bonuses) baseStat += (classSubData.bonuses[upperStatKey] || 0);
        
        // (ละส่วน Passive เพื่อความกระชับ)
    }

    // 2. [FIX] คำนวณ Active Effects (Buff/Debuff) ให้กับทั้งคนและศัตรู
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

    // 3. รวมผลลัพธ์
    let finalStat = (baseStat * (1 + (percentBonus / 100))) + flatBonus;
    
    // (โบนัสอุปกรณ์และเลเวลเฉพาะผู้เล่น)
    if (charData.type !== 'enemy') {
        const permanentLevel = charData.level || 1;
        
        // Equip Bonus... (ละไว้)
        let equipBonus = 0;
        if (charData.equippedItems) {
             for (const slot in charData.equippedItems) {
                const item = charData.equippedItems[slot];
                if (item && item.bonuses && item.bonuses[upperStatKey]) {
                    equipBonus += item.bonuses[upperStatKey];
                }
             }
        }
        finalStat += equipBonus;

        if (finalStat > 0 && permanentLevel > 1) {
             finalStat += (finalStat * (permanentLevel - 1) * 0.2);
        }
    }
    
    if (charData.race === 'โกเลม' && upperStatKey === 'DEX') return 0; 

    return Math.floor(finalStat);
}

// =================================================================
// ส่วนที่ 2: Display Functions
// =================================================================

const CHARACTER_INFO_HTML = `
    <h2>
        ข้อมูลตัวละคร
        <button onclick="toggleSectionVisibility('characterInfoPanel_body')" class="toggle-btn">ซ่อน</button>
        <button onclick="toggleVisualMode()" class="view-toggle-btn">👁️ เปลี่ยนมุมมอง</button>
    </h2>
    <div id="characterInfoPanel_body">
        <p><strong>ชื่อ:</strong> <span id="name"></span> (<span id="level"></span>)</p>
        <p><strong>เผ่า:</strong> <span id="race"></span></p>
        <p><strong>อาชีพหลัก:</strong> <span id="classMain"></span></p>
        <p><strong>อาชีพรอง:</strong> <span id="classSub"></span></p>
        
        <details class="info-details">
            <summary><strong>ข้อมูลกายภาพ/นิสัย (คลิกเพื่อดู)</strong></summary>
            <p><strong>อายุ:</strong> <span id="age"></span> | <strong>เพศ:</strong> <span id="gender"></span></p>
            <p><strong>สูง:</strong> <span id="height"></span> ซม. | <strong>หนัก:</strong> <span id="weight"></span> กก.</p>
            <p><strong>ลักษณะ:</strong> <span id="appearance"></span></p>
            <p><strong>นิสัย:</strong> <span id="personality"></span></p>
            <p><strong>ชอบ:</strong> <span id="likes"></span></p>
            <p><strong>เกลียด:</strong> <span id="dislikes"></span></p>
            <p><strong>ภูมิหลัง:</strong> <span id="background"></span></p>
        </details>
        
        <p><strong>พลังชีวิต:</strong> <span id="hpContainer"></span></p>
        <p><strong>GP:</strong> <span id="gp"></span></p>
        <div style="margin: 5px 0;"><small><strong>EXP:</strong>
        <span id="exp">0</span> / <span id="expToNextLevel">300</span></small>
        </div>
        <div style="background-color: #333; border-radius: 5px; padding: 2px;">
            <div id="expBar" style="height: 8px; width: 0%; background-color: #00bcd4; border-radius: 3px; transition: width 0.5s ease-in-out;"></div>
        </div>
        
        <div class="stat-grid">
            <li>STR: <span id="str"></span></li>
            <li>DEX: <span id="dex"></span></li>
            <li>CON: <span id="con"></span></li>
            <li>INT: <span id="int"></span></li>
            <li>WIS: <span id="wis"></span></li>
            <li>CHA: <span id="cha"></span></li>
        </div>

        <div id="effectsContainer" style="margin-top: 15px;"></div>
    </div>
`;

function injectDashboardStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; list-style: none; padding: 0; margin-top: 10px; }
        .stat-grid li { background: rgba(0,0,0,0.2); padding: 5px; border-radius: 4px; text-align: center; }
        .info-details { margin-top: 5px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px; }
        .info-details p { margin: 2px 0; }
        .toggle-btn { float: right; padding: 2px 8px; font-size: 0.8em; background-color: #6c757d; margin-top: 0; }
        @keyframes stat-up-anim { 0% { transform: scale(1); color: #00ff00; } 50% { transform: scale(1.2); } 100% { transform: scale(1); color: inherit; } }
        @keyframes stat-down-anim { 0% { transform: scale(1); color: #ff4d4d; } 50% { transform: scale(0.8); } 100% { transform: scale(1); color: inherit; } }
        .stat-change { animation-duration: 1.5s; animation-fill-mode: forwards; }
        .stat-up { animation-name: stat-up-anim; }
        .stat-down { animation-name: stat-down-anim; }
        .effect-buff, .effect-cooldown, .effect-passive, .effect-aura { margin: 4px 0; padding: 6px; border-radius: 4px; font-family: 'Prompt', sans-serif; font-size: 0.9em; opacity: 0; animation: fadeInEffect 0.5s forwards; }
        .effect-buff { background: rgba(0, 123, 255, 0.2); border-left: 3px solid #007bff; }
        .effect-cooldown { background: rgba(255, 193, 7, 0.2); border-left: 3px solid #ffc107; }
        .effect-passive { background: rgba(108, 117, 125, 0.2); border-left: 3px solid #6c757d; }
        .effect-aura { background: rgba(23, 162, 184, 0.2); border-left: 3px solid #17a2b8; }
        @keyframes fadeInEffect { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        .swal2-actions { display: flex; flex-wrap: wrap; justify-content: center; }
        .swal2-styled { margin: 5px !important; flex: 1 1 auto; }
        .status-bar-container {
            position: relative;
            width: 100%;
            height: 18px;
            background-color: #333;
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid #555;
            box-shadow: inset 0 0 5px #000;
            display: inline-block;
            vertical-align: middle;
        }
        .status-bar-fill {
            height: 100%;
            border-radius: 10px;
            transition: width 0.4s ease-in-out;
            box-shadow: inset 0 2px 0 rgba(255,255,255,0.3);
        }
        .status-text-overlay {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 0.75em;
            color: #fff;
            text-shadow: 1px 1px 2px #000;
            font-weight: bold;
            white-space: nowrap;
            z-index: 2;
        }
        
        /* ปุ่มสลับโหมด */
        .view-toggle-btn {
            background: linear-gradient(90deg, #6c757d, #495057);
            color: white;
            border: 1px solid #aaa;
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 0.8em;
            cursor: pointer;
            float: right;
            margin-left: 10px;
        }
        .view-toggle-btn:hover {
            background: linear-gradient(90deg, #495057, #6c757d);
        }
    `;
    document.head.appendChild(style);
}

function toggleSectionVisibility(elementId) {
    const body = document.getElementById(elementId);
    const button = body.previousElementSibling.querySelector('.toggle-btn');
    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        button.textContent = 'ซ่อน';
    } else {
        body.classList.add('hidden');
        button.textContent = 'แสดง';
    }
}

function updateCharacterStatsDisplay(charData) {
    if (!charData) return;
    
    const statsKeys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    statsKeys.forEach(key => {
        const el = document.getElementById(key.toLowerCase());
        if(el) {
             const currentValue = parseInt(el.textContent || "0");
             const newValue = calculateTotalStat(charData, key); 
             if (newValue > currentValue) el.className = 'stat-change stat-up';
             else if (newValue < currentValue) el.className = 'stat-change stat-down';
             el.textContent = newValue;
             if (newValue !== currentValue) setTimeout(() => el.className = '', 1500); 
        }
    });

    const finalCon = calculateTotalStat(charData, 'CON');
    const displayMaxHp = calcHPFn(charData.race, charData.classMain, finalCon);
    const currentHp = Math.min(charData.hp || 0, displayMaxHp);
    
    const hpContainer = document.getElementById('hpContainer'); // เปลี่ยนจาก hpEl เป็น hpContainer
    if (hpContainer) {
        hpContainer.innerHTML = getStatusDisplay(currentHp, displayMaxHp, 'HP');
    }
    
    const permanentLevel = charData.level || 1;
    let tempLevel = 0;
    if (Array.isArray(charData.activeEffects)) {
         charData.activeEffects.forEach(effect => {
             if (effect.stat === 'Level' && effect.modType === 'FLAT') tempLevel += (effect.amount || 0);
             if (effect.type === 'TEMP_LEVEL_PERCENT') tempLevel += Math.floor(permanentLevel * (effect.amount / 100));
         });
    }
    
    const levelEl = document.getElementById('level');
    levelEl.textContent = `Lv. ${permanentLevel}`;
    if (tempLevel > 0) levelEl.innerHTML += ` <span style="color: #00ff00;">(+${tempLevel})</span>`;
    else if (tempLevel < 0) levelEl.innerHTML += ` <span style="color: #ff4d4d;">(${tempLevel})</span>`;
    
    document.getElementById('gp').textContent = `${charData.gp || 0} GP`;
    
    const currentExp = charData.exp || 0; 
    const expForNext = charData.expToNextLevel || 300;
    document.getElementById('exp').textContent = currentExp;
    document.getElementById('expToNextLevel').textContent = expForNext;
    document.getElementById('expBar').style.width = `${Math.min(100, (currentExp / expForNext) * 100)}%`;

    const upgradeButton = document.getElementById("goToStatsButton"); 
    const freePoints = charData.freeStatPoints || 0;
    if (upgradeButton) { 
        upgradeButton.style.display = freePoints > 0 ? 'block' : 'none'; 
        if (freePoints > 0) upgradeButton.textContent = `✨ อัปเกรดสถานะ (${freePoints} แต้ม) ✨`; 
    }
}

function displayActiveEffects(charData, combatState) {
    const container = document.getElementById("effectsContainer"); 
    if (!container) return; 
    container.innerHTML = "<h4>สถานะ/คูลดาวน์</h4>"; 
    let hasEffect = false;

    const raceId = charData.raceEvolved || charData.race;
    const racePassives = (typeof RACE_DATA !== 'undefined' && RACE_DATA[raceId]?.passives) ? RACE_DATA[raceId].passives : [];
    racePassives.forEach(passive => {
        container.innerHTML += `<p class="effect-passive" title="${passive.description}"><strong>(เผ่า) ${passive.name}</strong></p>`;
        hasEffect = true;
    });
    
    const classMainId = charData.classMain;
    const classPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classMainId]?.passives) ? CLASS_DATA[classMainId].passives : [];
    classPassives.forEach(passive => {
        if (passive.effect?.type && passive.effect.type.startsWith('AURA')) return;
        container.innerHTML += `<p class="effect-passive" title="${passive.description || ''}"><strong>(อาชีพ) ${passive.name}</strong></p>`;
        hasEffect = true;
    });
    
    const skillPassives = [];
    if (typeof SKILL_DATA !== 'undefined') {
        if(SKILL_DATA[classMainId]) skillPassives.push(...SKILL_DATA[classMainId].filter(s => s.skillTrigger === 'PASSIVE'));
    }
    skillPassives.forEach(skill => {
        if (skill.effect?.type && skill.effect.type.startsWith('AURA')) return; 
        container.innerHTML += `<p class="effect-passive" title="${skill.description}"><strong>(สกิล) ${skill.name}</strong></p>`;
        hasEffect = true;
    });

    const effects = charData.activeEffects || []; 
    if (effects.length > 0) { 
        hasEffect = true; 
        effects.forEach(effect => { 
            const modText = effect.modType === 'PERCENT' ? `${effect.amount}%` : (effect.modType === 'SET_VALUE' ? `= ${effect.amount}` : `${effect.amount >= 0 ? '+' : ''}${effect.amount}`); 
            container.innerHTML += `<p class="effect-buff" title="จากสกิล: ${effect.skillId}"><strong>${effect.name || effect.skillId}</strong>: ${effect.stat} ${modText} (เหลือ ${effect.turnsLeft} เทิร์น)</p>`; 
        }); 
    }

    const cooldowns = charData.skillCooldowns || {}; 
    for (const skillId in cooldowns) {
        const cd = cooldowns[skillId];
        if (!cd) continue;
        if (cd.type === 'PERSONAL' && cd.turnsLeft > 0) {
            hasEffect = true;
            const skillName = SKILL_DATA[charData.classMain]?.find(s=>s.id===skillId)?.name || skillId;
            container.innerHTML += `<p class="effect-cooldown"><strong>(CD) ${skillName}</strong>: (รอ ${cd.turnsLeft} เทิร์น)</p>`;
        }
        else if (cd.type === 'PER_COMBAT' && cd.usesLeft <= 0) { 
             hasEffect = true;
             const skillName = SKILL_DATA[charData.classMain]?.find(s=>s.id===skillId)?.name || skillId;
             container.innerHTML += `<p class="effect-cooldown"><strong>(CD) ${skillName}</strong>: (ใช้ครบโควต้า)</p>`;
        }
    }
    
    if (typeof allPlayersInRoom !== 'undefined') {
        for (const uid in allPlayersInRoom) {
            if (uid === charData.uid || !allPlayersInRoom[uid] || allPlayersInRoom[uid].hp <= 0) continue;
            const teammate = allPlayersInRoom[uid];
            const teammateClassId = teammate.classMain;
            const teammatePassives = (typeof SKILL_DATA !== 'undefined' && SKILL_DATA[teammateClassId]) 
                                     ? SKILL_DATA[teammateClassId].filter(s => s.skillTrigger === 'PASSIVE') : [];
            teammatePassives.forEach(skill => {
                const effects = Array.isArray(skill.effect) ? skill.effect : [skill.effect];
                effects.forEach(p => {
                    if (p && p.type === 'AURA_STAT_PERCENT') {
                         container.innerHTML += `<p class="effect-aura" title="จาก ${teammate.name}"><strong>(ออร่า) ${skill.name}</strong>: (${p.stats.join(', ')} +${p.amount}%)</p>`;
                         hasEffect = true;
                    }
                });
            });
        }
    }
    
    if (!hasEffect) container.innerHTML += "<p><small><em>ไม่มีสถานะหรือคูลดาวน์</em></small></p>";
}

function displayCharacter(character, combatState) {
    const infoPanel = document.getElementById("characterInfoPanel"); 
    if (infoPanel && !infoPanel.querySelector('#name')) {
        infoPanel.innerHTML = CHARACTER_INFO_HTML;
    }

    document.getElementById("name").textContent = character.name || "-"; 
    document.getElementById("race").textContent = character.raceEvolved || character.race || "-"; 
    document.getElementById("classMain").textContent = character.classMain || "-";
    document.getElementById("classSub").textContent = character.classSub || "ยังไม่มี";
    document.getElementById("age").textContent = character.info?.age || "-";
    document.getElementById("gender").textContent = character.gender || "-";
    document.getElementById("height").textContent = character.info?.height || "-";
    document.getElementById("weight").textContent = character.info?.weight || "-";
    document.getElementById("appearance").textContent = character.info?.appearance || "-";
    document.getElementById("personality").textContent = character.info?.personality || "-";
    document.getElementById("likes").textContent = character.info?.likes || "-";
    document.getElementById("dislikes").textContent = character.info?.dislikes || "-";
    document.getElementById("background").textContent = character.background || "-";

    updateCharacterStatsDisplay(character); 
    displayActiveEffects(character, combatState);
}

function displayInventory(inventory = []) { 
    const list = document.getElementById("inventory"); 
    if(!list) return; 
    
    if (inventory.length === 0) {
        list.innerHTML = "<li style='color:#777; text-align:center; padding:10px;'>กระเป๋าว่างเปล่า</li>";
        return; 
    }
    
    list.innerHTML = ""; 

    inventory.forEach((item, index) => { 
        if (!item || !item.name) return; 
        
        const li = document.createElement("li"); 
        li.style.cssText = "background:rgba(0,0,0,0.4); padding:10px; margin-bottom:5px; border-radius:5px; border-left: 3px solid #ffae00;";
        
        // Header
        let headerHtml = `<div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:#ffeb8a; font-size:1em;">${item.name} <span style="color:#aaa; font-weight:normal;">(x${item.quantity})</span></span>`;

        // Durability
        if (item.durability !== undefined) {
             const duraDisplay = getStatusDisplay(item.durability, 100, 'DURA');
             headerHtml += `<span>${duraDisplay}</span>`;
        }
        headerHtml += `</div>`;

        // Details
        let detailsHtml = '<div style="font-size:0.85em; color:#ccc; margin-top:4px; line-height:1.4;">';
        if (item.bonuses && Object.keys(item.bonuses).length > 0) {
            const stats = Object.entries(item.bonuses).map(([k, v]) => `${k}+${v}`).join(', ');
            detailsHtml += `<div style="color:#66b2ff;">⚡ ${stats}</div>`;
        }
        if (item.damageDice) detailsHtml += `<div style="color:#ff6666;">⚔️ ${item.damageDice}</div>`;
        detailsHtml += '</div>';

        // Buttons Group
        let buttonsHtml = `<div style="margin-top:8px; display:flex; gap:5px; justify-content:flex-end;">`;
        
        // 1. ปุ่มใช้งาน/สวมใส่
        if (item.itemType === 'สวมใส่' || item.itemType === 'อาวุธ') {
            if (item.durability === undefined || item.durability > 0) {
                 buttonsHtml += `<button onclick="equipItem(${index})" style="width:auto; padding:4px 10px; font-size:0.8em; border-radius:4px; border:none; color:white; background:#007bff;">สวมใส่</button>`; 
            }
        } else if (item.itemType === 'บริโภค') {
            buttonsHtml += `<button onclick="useConsumableItem(${index})" style="width:auto; padding:4px 10px; font-size:0.8em; border-radius:4px; border:none; color:white; background:#28a745;">ใช้งาน</button>`;
        }

        // 2. [ใหม่] ปุ่มจัดการ (ทิ้ง/ขาย/ส่ง)
        buttonsHtml += `<button onclick="openItemOptions(${index})" style="width:auto; padding:4px 10px; font-size:0.8em; border-radius:4px; border:none; color:white; background:#6c757d;">⚙️ จัดการ</button>`;
        
        buttonsHtml += `</div>`;

        li.innerHTML = headerHtml + detailsHtml + buttonsHtml;
        list.appendChild(li); 
    }); 
}

function displayEquippedItems(equipped = {}) { 
    const slots = ['mainHand', 'offHand', 'head', 'chest', 'legs', 'feet']; 
    slots.forEach(slot => { 
        const item = equipped[slot]; 
        const el = document.getElementById(`eq-${slot}`); 
        const btn = el?.nextElementSibling; 
        
        if (el) {
            let itemText = item?.name || '-';
            if (item && item.durability !== undefined) {
                const duraDisplay = getStatusDisplay(item.durability, 100, 'DURA');
                itemText += ` ${duraDisplay}`;
            }
            el.innerHTML = itemText;
        }
        if (btn) btn.style.display = item ? 'inline-block' : 'none'; 
    }); 
}

function displayTeammates(currentUserUid) {
    const select = document.getElementById('teammateSelect');
    select.innerHTML = '<option value="">-- เลือกดูข้อมูล --</option>';
    
    // 1. ซัมมอนของฉัน (สำคัญ!)
    for (const key in allEnemiesInRoom) {
        const en = allEnemiesInRoom[key];
        // เช็คว่าเป็นซัมมอน และ เจ้าของคือเรา
        if (en.type === 'player_summon' && en.ownerUid === currentUserUid) {
            const status = en.hp > 0 ? '' : ' (ตาย)';
            select.innerHTML += `<option value="${key}" style="color:#00ff00;">🤖 [ซัมมอนของฉัน] ${en.name}${status}</option>`;
        }
    }

    // 2. ผู้เล่นคนอื่น
    for (const uid in allPlayersInRoom) {
        if (uid !== currentUserUid) {
            select.innerHTML += `<option value="${uid}">👤 ${allPlayersInRoom[uid].name} (ผู้เล่น)</option>`;
        }
    }
    
    // 3. ซัมมอนของเพื่อน
    for (const key in allEnemiesInRoom) {
        const en = allEnemiesInRoom[key];
        if (en.type === 'player_summon' && en.ownerUid !== currentUserUid) {
            select.innerHTML += `<option value="${key}">🤖 [ซัมมอนเพื่อน] ${en.name}</option>`;
        }
    }
}

function showTeammateInfo() {
    const id = document.getElementById('teammateSelect').value;
    const infoDiv = document.getElementById('teammateInfo');
    
    if (!id) {
        infoDiv.innerHTML = '<p>เลือกเพื่อนร่วมทีมเพื่อดูข้อมูล</p>';
        return;
    }
    
    let unit = allPlayersInRoom[id];
    let isSummon = false;
    
    // [Logic] ถ้าหาในผู้เล่นไม่เจอ ลองหาในซัมมอน
    if (!unit && allEnemiesInRoom[id]) {
        unit = allEnemiesInRoom[id];
        isSummon = true;
    }
    
    if (unit) {
        // [FIX] สร้าง HTML แสดง HP (รองรับโหมด Toggle)
        const maxHp = unit.maxHp || 100;
        const hpDisplay = getStatusDisplay(unit.hp, maxHp, 'HP');

        if (isSummon) {
            // --- กรณีซัมมอน ---
            const str = calculateTotalStat(unit, 'STR');
            const dex = calculateTotalStat(unit, 'DEX');
            const con = calculateTotalStat(unit, 'CON');
            const int = calculateTotalStat(unit, 'INT');
            
            infoDiv.innerHTML = `
                <div style="border:1px solid #00e676; padding:10px; border-radius:8px; background:rgba(0,0,0,0.4);">
                    <h3 style="margin:0; color:#00e676;">${unit.name}</h3>
                    <p style="font-size:0.9em; color:#ccc;">สถานะ: <strong>ซัมมอนฝ่ายผู้เล่น</strong></p>
                    <p style="margin:5px 0;"><strong>HP:</strong> ${hpDisplay}</p>
                    
                    <hr style="border-color:#555; margin:5px 0;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; font-size:0.9em;">
                        <div>STR: <strong>${str}</strong></div> 
                        <div>DEX: <strong>${dex}</strong></div>
                        <div>CON: <strong>${con}</strong></div>
                        <div>INT: <strong>${int}</strong></div>
                    </div>
                    <div style="margin-top:5px; font-size:0.85em; color:#aaa;">
                        (สเตตัสอ้างอิงจากผู้อัญเชิญ)
                    </div>
                </div>
            `;
        } else {
            // --- กรณีผู้เล่น ---
            const finalCon = calculateTotalStat(unit, 'CON');
            // (จริงๆ ผู้เล่นจะมี maxHp ในตัวอยู่แล้ว แต่คำนวณซ้ำเพื่อความชัวร์ก็ได้ หรือใช้ unit.maxHp เลย)
            
            let statsHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-top:5px; font-size: 0.9em;">`;
            ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(stat => {
                const val = calculateTotalStat(unit, stat);
                statsHtml += `<div style="background:rgba(0,0,0,0.3); padding:2px; text-align:center; border-radius:3px;">${stat}: <strong>${val}</strong></div>`;
            });
            statsHtml += `</div>`;
            
            // แสดงอุปกรณ์ (แบบย่อ)
            let equipHtml = `<ul style="margin-top:10px; padding-left:15px; font-size:0.85em; color:#ddd;">`;
            const slots = { mainHand: '⚔️', offHand: '🛡️', head: '🧢', chest: '👕', legs: '👖', feet: '👢' };
            let hasEquip = false;
            
            if (unit.equippedItems) {
                for (const [key, icon] of Object.entries(slots)) {
                    const item = unit.equippedItems[key];
                    if (item) {
                        hasEquip = true;
                        // [FIX] แสดงความทนทานแบบ Toggle
                        const duraDisplay = item.durability !== undefined ? getStatusDisplay(item.durability, 100, 'DURA') : '';
                        equipHtml += `<li>${icon} ${item.name} <span style="font-size:0.8em">${duraDisplay}</span></li>`;
                    }
                }
            }
            if(!hasEquip) equipHtml += `<li><em>(ตัวเปล่า)</em></li>`;
            equipHtml += `</ul>`;

            infoDiv.innerHTML = `
                <div style="border:1px solid #444; padding:10px; border-radius:8px; background:rgba(0,0,0,0.4);">
                    <h3 style="margin:0 0 5px 0; color:#8be4ff;">${unit.name} <small>(Lv. ${unit.level})</small></h3>
                    <p style="margin:2px 0;"><strong>HP:</strong> ${hpDisplay}</p>
                    <p style="margin:2px 0;"><strong>อาชีพ:</strong> ${unit.classMain} / ${unit.classSub || '-'}</p>
                    <hr style="border-color:#555; margin:5px 0;">
                    <strong>📊 สถานะปัจจุบัน:</strong>
                    ${statsHtml}
                    <hr style="border-color:#555; margin:5px 0;">
                    <strong>🛡️ อุปกรณ์ที่สวมใส่:</strong>
                    ${equipHtml}
                </div>
            `;
        }
    }
}

function displayQuest(quest) {
    const container = document.getElementById('questPanel_body');
    if (!container) return;

    if (!quest || !quest.title) {
        container.innerHTML = `<p style="text-align:center; color:#777; padding:10px;"><em>ยังไม่ได้รับภารกิจ</em></p>`;
        return;
    }

    const isGuild = quest.isGuildQuest === true;
    const badge = isGuild 
        ? `<span style="background:#ffc107; color:#000; padding:2px 8px; border-radius:10px; font-size:0.75em; font-weight:bold; display:inline-block; margin-bottom:5px;">🏆 เควสกิลด์</span>` 
        : `<span style="background:#17a2b8; color:#fff; padding:2px 8px; border-radius:10px; font-size:0.75em; font-weight:bold; display:inline-block; margin-bottom:5px;">📜 เควสทั่วไป</span>`;

    container.innerHTML = `
        <div style="border-bottom:1px dashed #555; padding-bottom:10px; margin-bottom:10px;">
            ${badge}
            <h3 style="margin:5px 0 0 0; color:#ffeb8a; font-size:1.3em;">${quest.title}</h3>
        </div>
        
        <p style="font-size:0.95em; line-height:1.6; color:#ddd; margin-bottom:15px;">${quest.detail || 'ไม่มีรายละเอียด'}</p>
        
        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:5px; border:1px solid #444;">
            <div style="color:#28a745; margin-bottom:5px;"><strong>🎁 รางวัล:</strong> ${quest.reward || '-'}</div>
            ${quest.expReward ? `<div style="color:#00bcd4;"><strong>✨ EXP:</strong> ${quest.expReward}</div>` : ''}
        </div>
    `;
}

function displayStory(story) {
    document.getElementById('story').textContent = story || 'ยังไม่มีเนื้อเรื่อง';
}

function displayEnemies(enemies, currentUserUid) {
    const container = document.getElementById('enemyPanelContainer');
    const targetSelect = document.getElementById('enemyTargetSelect');
    const currentSelection = targetSelect.value;

    container.innerHTML = '';
    targetSelect.innerHTML = '<option value="">-- เลือกเป้าหมาย --</option>';

    // Helper functions
    const badge = (label, val) => `<span style="background:#333; color:#fff; padding:2px 5px; border-radius:3px; margin-right:3px; font-size:0.8em;">${label}:${val}</span>`;
    const createEffectBadges = (effects) => {
        if (!effects || effects.length === 0) return '';
        return effects.map(e => {
            const color = (e.type === 'BUFF' || e.type === 'HOT') ? '#28a745' : '#dc3545';
            return `<span style="color:${color}; font-size:0.8em; margin-right:5px;">[${e.name}]</span>`;
        }).join('');
    };

    // --- กรณี PvP ---
    if (combatState && combatState.isActive && combatState.type === 'PVP') {
        const opponentUnit = combatState.turnOrder.find(u => u.id !== currentUserUid);
        if (opponentUnit) {
            const opponentData = allPlayersInRoom[opponentUnit.id];
            if (opponentData) {
                const isDead = opponentData.hp <= 0;
                
                // [FIX] ใช้ Helper แสดง HP (รองรับโหมดหลอดเลือด)
                const hpDisplay = isDead 
                    ? '<span style="color:red; font-weight:bold;">(พ่ายแพ้)</span>' 
                    : getStatusDisplay(opponentData.hp, opponentData.maxHp, 'HP');
                
                const str = calculateTotalStat(opponentData, 'STR');
                const dex = calculateTotalStat(opponentData, 'DEX');
                const con = calculateTotalStat(opponentData, 'CON');
                const int = calculateTotalStat(opponentData, 'INT');
                const wis = calculateTotalStat(opponentData, 'WIS');
                const cha = calculateTotalStat(opponentData, 'CHA');

                container.innerHTML = `
                    <div style="border: 2px solid #ff4d4d; padding: 10px; border-radius: 5px; background: rgba(100,0,0,0.3);">
                        <h3 style="color: #ff4d4d; margin:0 0 5px 0;">VS คู่ประลอง</h3>
                        <div style="font-size: 1.2em; color: #fff; font-weight:bold;">${opponentData.name}</div>
                        <div style="margin-bottom:5px;">HP: ${hpDisplay}</div>
                        <div style="margin-bottom:8px; display:flex; flex-wrap:wrap; gap:2px;">
                            ${badge('STR', str)} ${badge('DEX', dex)} ${badge('CON', con)}
                            ${badge('INT', int)} ${badge('WIS', wis)} ${badge('CHA', cha)}
                        </div>
                        <div style="font-size:0.85em; color:#ddd;">
                            <strong>สถานะ:</strong> ${createEffectBadges(opponentData.activeEffects)}
                        </div>
                    </div>
                `;

                if (!isDead) {
                    const option = document.createElement('option');
                    option.value = opponentUnit.id;
                    option.textContent = `${opponentData.name} (ผู้เล่น)`;
                    targetSelect.appendChild(option);
                    targetSelect.value = opponentUnit.id;
                } else {
                    targetSelect.innerHTML = '<option>-- การประลองจบลง --</option>';
                }
            }
        } else {
            container.innerHTML = '<p>รอคู่ต่อสู้...</p>';
        }
        return;
    }

    // --- กรณี PvE (มอนสเตอร์) ---
    let hasLiveEnemies = false;

    for (const key in enemies) {
        // ดึงข้อมูลดิบมาก่อน เพื่อเช็ค type ที่แท้จริงจาก Database
        const rawData = enemies[key];
        
        // ถ้า type ใน Database บอกว่าเป็น 'player_summon' ให้ข้ามทันที
        if (rawData.type === 'player_summon') continue;

        // ถ้าไม่ใช่ซัมมอน ค่อยสร้าง object ใหม่และใส่ default type เป็น enemy
        const enemy = { ...rawData };
        if (!enemy.type) enemy.type = 'enemy';

        const isDead = enemy.hp <= 0;
        
        // [FIX] ใช้ Helper แสดง HP
        const hpDisplay = isDead 
            ? '<span style="color:red; text-decoration:line-through;">(ตาย)</span>' 
            : getStatusDisplay(enemy.hp, enemy.maxHp, 'HP');

        const str = calculateTotalStat(enemy, 'STR');
        const dex = calculateTotalStat(enemy, 'DEX');
        const intVal = calculateTotalStat(enemy, 'INT');
        const wis = calculateTotalStat(enemy, 'WIS');
        const con = calculateTotalStat(enemy, 'CON');

        const style = isDead ? "opacity:0.5; filter:grayscale(1);" : "border-left: 3px solid #ff4500;";
        const statusHtml = (enemy.activeEffects || []).map(e => `<span style="color:${e.type.includes('DEBUFF')?'red':'lime'}; font-size:0.8em;">[${e.name}]</span>`).join(' ');

        container.innerHTML += `
            <div style="background:rgba(0,0,0,0.3); padding:8px; margin-bottom:5px; border-radius:4px; ${style}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:#ffc107;">${enemy.name}</strong>
                    <span>HP: ${hpDisplay}</span>
                </div>
                ${!isDead ? `
                <div style="margin-top:5px;">
                    ${badge('STR', str)} ${badge('DEX', dex)} ${badge('CON', con)}
                    ${badge('INT', intVal)} ${badge('WIS', wis)}
                </div>
                <div style="margin-top:3px; color:#ccc; font-size:0.85em;">สถานะ: ${statusHtml || '-'}</div>
                ` : ''}
            </div>
        `;

        if (!isDead) {
            hasLiveEnemies = true;
            targetSelect.innerHTML += `<option value="${key}">${enemy.name} (${enemy.hp} HP)</option>`;
        }
    }
    
    if (!hasLiveEnemies && container.innerHTML === '') {
        container.innerHTML = "<p style='text-align:center; color:#777;'>ไม่มีศัตรู</p>";
    }
    
    // คืนค่า Selection เดิม (ถ้าเป้าหมายยังอยู่และไม่ใช่ซัมมอน)
    if (currentSelection && enemies[currentSelection] && enemies[currentSelection].hp > 0 && enemies[currentSelection].type !== 'player_summon') {
        targetSelect.value = currentSelection;
    }
}

function updateTurnDisplay(combatState, currentUserUid) {
    const indicator = document.getElementById('turnIndicator');
    if (combatState.isActive) {
        const currentUnit = combatState.turnOrder[combatState.currentTurnIndex];
        const isMyTurn = currentUnit.id === currentUserUid;
        
        indicator.textContent = isMyTurn ? '⚔️ เทิร์นของคุณ ⚔️' : `เทิร์นของ: ${currentUnit.name}`;
        indicator.className = isMyTurn ? 'my-turn' : 'other-turn';
        indicator.style.backgroundColor = ''; 
        indicator.style.color = ''; 
        indicator.classList.remove('hidden');
        
        document.getElementById('attackRollButton').disabled = !isMyTurn;
        document.getElementById('skillButton').disabled = !isMyTurn;
        
    } else {
        indicator.classList.add('hidden');
        document.getElementById('attackRollButton').disabled = true;
        document.getElementById('skillButton').disabled = true;
        document.getElementById('damageRollSection').style.display = 'none';
    }
}

async function playerRollDice() {
    const diceType = parseInt(document.getElementById("diceType").value);
    const diceCount = parseInt(document.getElementById("diceCount").value);
    const rollButton = document.querySelector('button[onclick="playerRollDice()"]');
    
    const { results, total } = await showDiceRollAnimation(diceCount, diceType, 'player-dice-animation-area', 'dice-result', rollButton);
    
    const roomId = sessionStorage.getItem('roomId');
    const player = currentCharacterData;
    if (roomId && player) {
        const log = {
            name: player.name,
            type: 'general',
            count: diceCount,
            dice: diceType,
            result: results,
            timestamp: new Date().toISOString()
        };
        db.ref(`rooms/${roomId}/diceLogs`).push(log);
    }
}

// --- Durability Logic ---
function applyDurabilityDamage(updates, equippedItems, type, options = {}) {
    // ป้องกัน equippedItems เป็น null
    if (!equippedItems) equippedItems = {}; 

    // Helper: สุ่มชิ้นส่วนเกราะที่มีอยู่
    const getRandomArmor = (slots) => {
        const availableSlots = slots.filter(s => equippedItems[s] && (equippedItems[s].durability === undefined || equippedItems[s].durability > 0));
        if (availableSlots.length === 0) return null;
        return availableSlots[Math.floor(Math.random() * availableSlots.length)];
    };

    switch (type) {
        case 'BLOCK_SUCCESS':
            const { damageReduced, weaponSlot } = options;
            if (weaponSlot && equippedItems[weaponSlot]) {
                const item = equippedItems[weaponSlot];
                // ลดความทนทานตามความแรงที่รับไว้ (ขั้นต่ำ 1)
                const damageToDura = Math.ceil(damageReduced / 5) || 1; 
                const newDura = Math.max(0, (item.durability || 100) - damageToDura);
                updates[`equippedItems/${weaponSlot}/durability`] = newDura;
            }
            break;

        case 'BLOCK_FAIL':
            const { damageTaken } = options;
            // ลดความทนทานเกราะตามดาเมจที่ทะลุมา
            const duraLossArmor = Math.ceil(damageTaken / 10) || 1; 
            let armorSlots = ['head', 'chest', 'legs', 'feet'];
            
            // สุ่มพังเกราะ 1-2 ชิ้น
            const piecesToDamage = Math.random() > 0.5 ? 2 : 1;
            
            for (let i = 0; i < piecesToDamage; i++) {
                const randomSlot = getRandomArmor(armorSlots); 
                if (randomSlot) {
                    const item = equippedItems[randomSlot];
                    const newDura = Math.max(0, (item.durability || 100) - duraLossArmor);
                    updates[`equippedItems/${randomSlot}/durability`] = newDura;
                    armorSlots = armorSlots.filter(s => s !== randomSlot); 
                }
            }
            break;

        case 'DODGE':
            // หลบสำเร็จ: รองเท้าสึกนิดหน่อย
            if (equippedItems['feet'] && (equippedItems['feet'].durability === undefined || equippedItems['feet'].durability > 0)) {
                const item = equippedItems['feet'];
                const duraLossDodge = 1; 
                const newDura = Math.max(0, (item.durability || 100) - duraLossDodge);
                updates[`equippedItems/feet/durability`] = newDura;
            }
            break;

        case 'TAKE_HIT':
            // รับเต็มๆ: เกราะตัว/ขา สึกหนัก
            const { damageTaken: damageTakenHit } = options; 
            const duraLossHit = Math.ceil(damageTakenHit / 5) || 1; 
            const randomBodySlot = getRandomArmor(['chest', 'legs']); 
            if (randomBodySlot) {
                const item = equippedItems[randomBodySlot];
                const newDura = Math.max(0, (item.durability || 100) - duraLossHit);
                updates[`equippedItems/${randomBodySlot}/durability`] = newDura;
            }
            break;
    }
}

function getRandomWord(wordArray) {
    if (!Array.isArray(wordArray) || wordArray.length === 0) return "";
    return wordArray[Math.floor(Math.random() * wordArray.length)];
}

// [UPDATED] ฟังก์ชันจัดการ Popup (แบบปุ่มมาตรฐาน)
async function handlePendingAttack(attackData, playerRef) {
    if (!attackData || !attackData.attackerName || !attackData.attackRollValue) {
        playerRef.child('pendingAttack').remove();
        return;
    }

    const snapshot = await playerRef.get();
    const playerData = snapshot.val();
    if (!playerData) return;

    const acForDisplay = 10 + getStatBonusFn(calculateTotalStat(playerData, 'DEX'));
    const initialDamage = attackData.initialDamage || 10;

    const cdBlock = playerData.skillCooldowns?.['action_block']?.turnsLeft || 0;
    const cdDodge = playerData.skillCooldowns?.['action_dodge']?.turnsLeft || 0;

    const equippedItems = playerData.equippedItems || {};
    let blockItem = null;
    let blockSlot = null;

    if (equippedItems.offHand && (equippedItems.offHand.durability === undefined || equippedItems.offHand.durability > 0)) {
        blockItem = equippedItems.offHand;
        blockSlot = 'offHand';
    } else if (equippedItems.mainHand && (equippedItems.mainHand.durability === undefined || equippedItems.mainHand.durability > 0)) {
        blockItem = equippedItems.mainHand;
        blockSlot = 'mainHand';
    }

    // [FIX] เพิ่ม Timer 5 วินาที
    const timerDuration = 5000; 

    const swalOptions = {
        title: `⚠️ ถูกโจมตี! (ตัดสินใจใน 5 วิ)`,
        html: `
            <div style="text-align: center;">
                <h3 style="color: #ff4d4d; margin: 0;">${attackData.attackerName}</h3>
                <p>ATK: <strong>${attackData.attackRollValue}</strong> vs AC: <strong>${acForDisplay}</strong></p>
                <p>Dmg: <strong style="color: red; font-size: 1.2em;">${initialDamage}</strong></p>
            </div>
        `,
        icon: 'warning',
        timer: timerDuration, // จับเวลา
        timerProgressBar: true,
        
        showConfirmButton: true,
        confirmButtonText: '🛡️ ป้องกัน',
        confirmButtonColor: '#28a745',

        showDenyButton: true,
        denyButtonText: '🏃 หลบหลีก',
        denyButtonColor: '#6c757d',

        showCancelButton: true,
        cancelButtonText: '😑 รับดาเมจ',
        cancelButtonColor: '#dc3545',

        allowOutsideClick: false,
        allowEscapeKey: false,
        
        didOpen: () => {
            const confirmBtn = Swal.getConfirmButton();
            const denyBtn = Swal.getDenyButton();

            if (cdBlock > 0) {
                confirmBtn.innerText = `🛡️ ติด CD (${cdBlock})`;
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
            } else if (!blockItem) {
                confirmBtn.innerText = `🛡️ มือเปล่า (ไม่ได้)`;
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
            } else {
                confirmBtn.innerText = `🛡️ ป้องกัน (${blockItem.name})`;
            }

            if (cdDodge > 0) {
                denyBtn.innerText = `🏃 ติด CD (${cdDodge})`;
                denyBtn.disabled = true;
                denyBtn.style.opacity = '0.5';
            }
        }
    };

    Swal.fire(swalOptions).then(async (result) => {
        const rollDiceAndAnimate = async (diceType = 20) => {
            const animArea = document.getElementById('player-dice-animation-area');
            if (animArea) animArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const { total } = await showDiceRollAnimation(1, diceType, 'player-dice-animation-area', 'dice-result', null);
            return total;
        };

        let defenseResponse = { 
            defenderUid: playerRef.key, 
            attackerKey: attackData.attackerKey, 
            attackRollValue: attackData.attackRollValue,
            damageTaken: 0 
        };
        
        const roomId = sessionStorage.getItem('roomId');
        const updates = {};
        
        // Logic การเลือก
        if (result.isConfirmed) { 
            // --- กดป้องกัน ---
            const blockRoll = await rollDiceAndAnimate(20);
            const totalCon = calculateTotalStat(playerData, 'CON');
            const conBonus = getStatBonusFn(totalCon);
            const totalBlock = blockRoll + conBonus;
            const damageReduction = Math.floor(totalBlock / 2); 
           
            defenseResponse.choice = 'block';
            defenseResponse.roll = totalBlock;
            defenseResponse.damageReduced = damageReduction;
            
            const damageTaken = Math.max(0, initialDamage - damageReduction);
            defenseResponse.damageTaken = damageTaken; 

            updates[`skillCooldowns/action_block`] = { type: 'PERSONAL', turnsLeft: 2 };

            if (damageTaken <= 0) {
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_SUCCESS', { damageReduced: initialDamage, weaponSlot: blockSlot });
                Swal.fire({ title: '🛡️ ป้องกันสมบูรณ์!', text: `รับไว้ได้ทั้งหมด! (ลด ${damageReduction})`, icon: 'success', timer: 1500, showConfirmButton: false });
            } else {
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_SUCCESS', { damageReduced: damageReduction, weaponSlot: blockSlot });
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_FAIL', { damageTaken });
                Swal.fire({ title: '🛡️ ป้องกันบางส่วน', html: `ลดไป ${damageReduction} (โดน <strong>${damageTaken}</strong>)`, icon: 'warning', timer: 1500, showConfirmButton: false });
            }

        } else if (result.isDenied) { 
            // --- กดหลบหลีก ---
            const dodgeRoll = await rollDiceAndAnimate(20);
            const totalDex = calculateTotalStat(playerData, 'DEX');
            const dexBonus = getStatBonusFn(totalDex);
            const totalDodge = dodgeRoll + dexBonus;
            const isDodgeSuccess = totalDodge > attackData.attackRollValue;

            defenseResponse.choice = 'dodge';
            defenseResponse.roll = totalDodge;
            updates[`skillCooldowns/action_dodge`] = { type: 'PERSONAL', turnsLeft: 2 };
            applyDurabilityDamage(updates, playerData.equippedItems, 'DODGE', {});

            if (isDodgeSuccess) {
                defenseResponse.damageTaken = 0;
                defenseResponse.success = true;
                Swal.fire({ title: '🏃 หลบพ้น!', text: `พริ้วไหว! (${totalDodge} vs ${attackData.attackRollValue})`, icon: 'success', timer: 1500, showConfirmButton: false });
            } else {
                defenseResponse.damageTaken = initialDamage;
                defenseResponse.success = false;
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_FAIL', { damageTaken: initialDamage });
                Swal.fire({ title: '🏃 หลบไม่พ้น!', html: `เสียหลัก! (${totalDodge} vs ${attackData.attackRollValue})<br>โดน <strong>${initialDamage}</strong>`, icon: 'error', timer: 1500, showConfirmButton: false });
            }

        } else { 
            // --- หมดเวลา หรือ กดรับดาเมจ ---
            // (DismissReason.timer หมายถึงหมดเวลา)
            defenseResponse.choice = 'none';
            defenseResponse.damageTaken = initialDamage;
            applyDurabilityDamage(updates, playerData.equippedItems, 'TAKE_HIT', { damageTaken: initialDamage });
            
            const msg = (result.dismiss === Swal.DismissReason.timer) ? 'หมดเวลาตัดสินใจ!' : 'ยืนรับดาเมจ!';
            Swal.fire({ title: '😑 โดนเต็มๆ', html: `${msg}<br>รับความเสียหาย <strong>${initialDamage}</strong>`, icon: 'error', timer: 1500, showConfirmButton: false });
        }
        
        // อัปเดต HP และ DB
        const currentSnap = await playerRef.get();
        const currentData = currentSnap.val();
        const newHp = Math.max(0, (currentData.hp || 0) - defenseResponse.damageTaken);
        updates['hp'] = newHp;

        if (Object.keys(updates).length > 0) await playerRef.update(updates);
        await playerRef.child('pendingAttack').remove();

        // ส่งผลลัพธ์กลับไปให้ DM (ถ้าไม่ใช่ PvP)
        if (!attackData.isPvP) {
            const resolutionData = {
                attackerKey: attackData.attackerKey,
                defenderUid: playerRef.key,
                choice: defenseResponse.choice,
                roll: defenseResponse.roll || 0,
                success: defenseResponse.success || false,
                damageReduced: defenseResponse.damageReduced || 0,
                damageTaken: defenseResponse.damageTaken
            };
            const roomId = sessionStorage.getItem('roomId');
            await db.ref(`rooms/${roomId}/combat/resolution`).set(resolutionData);
        }
        
        // ถ้าเป็น PvP ให้จบเทิร์นฝ่ายโจมตี
        if (attackData.isPvP) {
            const roomId = sessionStorage.getItem('roomId');
            if (typeof advanceCombatTurn === 'function') {
                await advanceCombatTurn(roomId);
            }
        }
    });
}

async function openItemOptions(index) {
    const item = currentCharacterData.inventory[index];
    if (!item) return;

    // ถ้าไม่มีราคา ให้ตั้งเป็น 0
    const itemPrice = parseInt(item.price) || 0;
    const sellPrice = Math.floor(itemPrice / 2);
    
    // แสดง Popup
    const result = await Swal.fire({
        title: `จัดการ: ${item.name}`,
        html: `เลือกสิ่งที่คุณต้องการทำกับไอเทมนี้`,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🎁 ส่งให้เพื่อน',
        denyButtonText: `💰 ขาย (${sellPrice} GP)`,
        cancelButtonText: '🗑️ ทิ้ง', // ปุ่ม Cancel ทำหน้าที่เป็นปุ่มทิ้ง
        confirmButtonColor: '#17a2b8',
        denyButtonColor: '#28a745',
        cancelButtonColor: '#dc3545'
    });

    // [FIX] เช็คผลลัพธ์ให้ถูกต้องตาม SweetAlert2 Documentation
    if (result.isConfirmed) { 
        // กดปุ่ม Confirm (ส่งให้เพื่อน)
        transferItemSelection(index);
    } 
    else if (result.isDenied) {
        // กดปุ่ม Deny (ขาย)
        if (sellPrice === 0) {
            // ถ้าขายได้ 0 ให้ถามย้ำว่าจะทิ้งไหม หรือขายฟรี
            const confirmSell = await Swal.fire({
                title: 'ขายฟรี?',
                text: "ไอเทมนี้ไม่มีราคาขาย คุณจะได้ 0 GP",
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'ขายเลย (ทิ้ง)',
                cancelButtonText: 'ยกเลิก'
            });
            if (confirmSell.isConfirmed) sellItem(index, 0);
        } else {
            sellItem(index, sellPrice);
        }
    } 
    else if (result.dismiss === Swal.DismissReason.cancel) {
        // [FIX] กดปุ่ม Cancel (ทิ้ง) - เช็คแบบนี้ถึงจะถูก
        dropItem(index);
    }
}

async function dropItem(index) {
    const confirm = await Swal.fire({
        title: 'ยืนยันการทิ้ง?',
        text: "ไอเทมจะหายไปถาวร!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ทิ้งเลย',
        confirmButtonColor: '#dc3545'
    });

    if (confirm.isConfirmed) {
        const roomId = sessionStorage.getItem('roomId');
        const uid = localStorage.getItem('currentUserUid');
        const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
        
        await playerRef.transaction(data => {
            if (!data || !data.inventory) return data;
            
            // เช็คว่า Index ยังถูกต้องไหม
            if (!data.inventory[index]) return data;

            const item = data.inventory[index];
            if (item.quantity > 1) {
                item.quantity--;
            } else {
                // ลบออกจาก Array
                data.inventory.splice(index, 1);
            }
            return data;
        });
        showAlert('ทิ้งไอเทมเรียบร้อย', 'success');
    }
}

async function sellItem(index, price) {
    const roomId = sessionStorage.getItem('roomId');
    const uid = localStorage.getItem('currentUserUid');
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);

    await playerRef.transaction(data => {
        if (!data || !data.inventory) return data;
        if (!data.inventory[index]) return data;

        const item = data.inventory[index];
        
        // เพิ่มเงิน
        data.gp = (data.gp || 0) + price;
        
        // ลบของ
        if (item.quantity > 1) {
            item.quantity--;
        } else {
            data.inventory.splice(index, 1);
        }
        
        return data;
    });
    
    showAlert(`ขายไอเทมได้เงิน ${price} GP`, 'success');
}

async function transferItemSelection(index) {
    const options = {};
    const myUid = localStorage.getItem('currentUserUid');
    
    for (const uid in allPlayersInRoom) {
        if (uid !== myUid) {
            options[uid] = allPlayersInRoom[uid].name;
        }
    }

    if (Object.keys(options).length === 0) {
        return showAlert('ไม่พบเพื่อนร่วมทีมในห้อง', 'warning');
    }

    const { value: targetUid } = await Swal.fire({
        title: 'ส่งให้ใคร?',
        input: 'select',
        inputOptions: options,
        inputPlaceholder: 'เลือกผู้รับ',
        showCancelButton: true
    });

    if (targetUid) {
        transferItem(index, targetUid, options[targetUid]);
    }
}

async function transferItem(index, targetUid, targetName) {
    const roomId = sessionStorage.getItem('roomId');
    const myUid = localStorage.getItem('currentUserUid');
    const myRef = db.ref(`rooms/${roomId}/playersByUid/${myUid}`);
    const targetRef = db.ref(`rooms/${roomId}/playersByUid/${targetUid}`);

    showLoading(`กำลังส่งของให้ ${targetName}...`);

    try {
        // 1. ดึงข้อมูลไอเทมจากเราก่อน (Transaction เพื่อความชัวร์ว่ามีของ)
        let itemToSend = null;
        
        await myRef.transaction(data => {
            if (!data || !data.inventory || !data.inventory[index]) return data;
            
            // Clone Item
            itemToSend = JSON.parse(JSON.stringify(data.inventory[index]));
            itemToSend.quantity = 1; // ส่งทีละ 1 ชิ้น

            // ลดจำนวนของในตัวเรา
            if (data.inventory[index].quantity > 1) {
                data.inventory[index].quantity--;
            } else {
                data.inventory.splice(index, 1);
            }
            return data;
        });

        if (!itemToSend) throw new Error("ไม่พบไอเทม หรือเกิดข้อผิดพลาด");

        // 2. เอาของไปใส่ให้เพื่อน
        await targetRef.transaction(data => {
            if (!data) return data;
            if (!data.inventory) data.inventory = [];

            // เช็ค Stack (ถ้าไอเทมเหมือนกันให้รวมกอง)
            // (ต้องไม่มีโบนัสพิเศษ หรือเป็นของใช้ทั่วไป)
            const isStackable = ['ทั่วไป', 'บริโภค'].includes(itemToSend.itemType);
            
            let found = false;
            if (isStackable) {
                const existing = data.inventory.find(i => i.name === itemToSend.name);
                if (existing) {
                    existing.quantity++;
                    found = true;
                }
            }
            
            if (!found) {
                data.inventory.push(itemToSend);
            }
            return data;
        });

        hideLoading();
        showAlert(`ส่ง ${itemToSend.name} ให้ ${targetName} แล้ว!`, 'success');

    } catch (error) {
        hideLoading();
        showAlert('การส่งของล้มเหลว: ' + error.message, 'error');
    }
}

// --- Initializer ---
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        let isInitialLoadComplete = false;
        const currentUserUid = user.uid;
        localStorage.setItem('currentUserUid', currentUserUid); 
        const roomId = sessionStorage.getItem('roomId');
        if (!roomId) { window.location.replace('lobby.html'); return; }

        if (!isInitialLoadComplete) showLoading('กำลังโหลดข้อมูลตัวละคร...');
        injectDashboardStyles();

        const playerRef = db.ref(`rooms/${roomId}/playersByUid/${currentUserUid}`);
        const roomRef = db.ref(`rooms/${roomId}`); // [เพิ่ม] reference ของห้อง

        // [FIX] เพิ่ม Listener สำหรับ Combat Log เพื่อแสดง Toast แจ้งเตือน
        roomRef.child('combatLogs').limitToLast(1).on('child_added', snapshot => {
            const log = snapshot.val();
            // เช็คเวลาว่า Log นี้เพิ่งเกิดหรือเปล่า (ภายใน 5 วินาที) เพื่อไม่ให้แจ้งเตือนเก่าเด้ง
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
                if (log.message.includes('โจมตี')) icon = 'warning'; // สีเหลือง
                if (log.message.includes('พลาด')) icon = 'error'; // สีแดง
                if (log.message.includes('เข้า')) icon = 'success'; // สีเขียว

                Toast.fire({ icon: icon, title: log.message });
            }
        });

        db.ref(`rooms/${roomId}`).on('value', snapshot => {
            const roomData = snapshot.val() || {};
            
            allPlayersInRoom = roomData.playersByUid || {};
            allEnemiesInRoom = roomData.enemies || {};
            combatState = roomData.combat || {};
            currentCharacterData = allPlayersInRoom[currentUserUid]; 
            if (currentCharacterData) currentCharacterData.uid = currentUserUid; 

            if (currentCharacterData) {
                displayCharacter(currentCharacterData, combatState);
                displayInventory(currentCharacterData.inventory);
                displayEquippedItems(currentCharacterData.equippedItems);
                displayQuest(currentCharacterData.quest);
                displayTeammates(currentUserUid); 
                
                // [FIX] ส่งฟังก์ชันกรองซัมมอนไปทำงานใน displayEnemies
                displayEnemies(allEnemiesInRoom, currentUserUid);
                
                updateTurnDisplay(combatState, currentUserUid);
                displayStory(roomData.story);

                if (!isInitialLoadComplete) {
                    hideLoading();
                    isInitialLoadComplete = true;
                }

            } else if (isInitialLoadComplete) {
                 document.getElementById("characterInfoPanel").innerHTML = `<h2>สร้างตัวละคร</h2><p>คุณยังไม่มีตัวละครในห้องนี้</p><a href="PlayerCharecter.html"><button style="width:100%;">สร้างตัวละครใหม่</button></a>`;
                 if (Swal.isVisible() && Swal.isLoading()) hideLoading();

            } else {
                hideLoading();
                document.getElementById("characterInfoPanel").innerHTML = `<h2>สร้างตัวละคร</h2><p>คุณยังไม่มีตัวละครในห้องนี้</p><a href="PlayerCharecter.html"><button style="width:100%;">สร้างตัวละครใหม่</button></a>`;
                isInitialLoadComplete = true;
            }
        });

        playerRef.child('pendingAttack').on('value', s => {
            const titleEl = Swal.getTitle();
            const titleText = titleEl ? titleEl.textContent : "";
            if (s.exists() && !Swal.isVisible() && combatState && combatState.isActive) {
                handlePendingAttack(s.val(), playerRef);
            } else if (!s.exists() && Swal.isVisible() && titleEl && titleEl.textContent.includes('โจมตี')) {
                Swal.close();
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