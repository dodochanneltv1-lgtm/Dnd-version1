// Javascript/player-dashboard-script.js (v3.8 - Fix AFK Restore)

// --- Global State ---
let allPlayersInRoom = {};
let allEnemiesInRoom = {};
let combatState = {};
let currentCharacterData = null; 

// let useVisualBars = localStorage.getItem('useVisualBars') === 'true';
let visualMode = parseInt(localStorage.getItem('visualMode')) || 0;

// --- ฟังชั่นตรวจสอบสถานะออนไลน์ของผู้เล่นในห้อง ---
function registerRoomPresence(roomId) {
  const user = firebase.auth().currentUser;
  if (!user || !roomId) return;

  const presRef = db.ref(`rooms/${roomId}/presence/${user.uid}`);

  // online ทันที
  presRef.set({
    status: 'online',
    lastActive: firebase.database.ServerValue.TIMESTAMP
  });

  // ตอนหลุด/ปิดแท็บ -> offline
  presRef.onDisconnect().set({
    status: 'offline',
    lastActive: firebase.database.ServerValue.TIMESTAMP
  });

  // (optional) อัปเดต lastActive ทุก 20 วิ กันคนค้างแปลกๆ
  setInterval(() => {
    presRef.update({ lastActive: firebase.database.ServerValue.TIMESTAMP });
  }, 20000);
}

function toggleVisualMode() {
    visualMode = (visualMode + 1) % 5; // วนลูป 0, 1, 2, 3, 4
    localStorage.setItem('visualMode', visualMode);
    
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
            <li style="grid-column: 1 / -1; background: rgba(138, 43, 226, 0.4); border: 1px solid #a855f7;">EM (ชำนาญธาตุ): <span id="em"></span></li>
        </div>

        <div id="effectsContainer" style="margin-top: 15px;"></div>
    </div>
`;

function createDetailedEffectBadges(effects) {
    if (!effects) return '';
    const list = Array.isArray(effects) ? effects : Object.values(effects);
    if (!list || list.length === 0) return '<span style="color:#666; font-size:0.8em; font-style:italic;">- ปกติ -</span>';
    
    return list.map(e => {
        const isGood = ['BUFF', 'HOT', 'SHIELD', 'ELEMENTAL_BUFF', 'WEAPON_BUFF_ELEMENTAL'].includes(e.type);
        const bgColor = isGood ? 'rgba(40, 167, 69, 0.2)' : 'rgba(220, 53, 69, 0.2)';
        const borderColor = isGood ? '#28a745' : '#dc3545';
        const textColor = isGood ? '#75b798' : '#ea868f';

        let detail = '';
        if (e.type === 'SHIELD') {
            const max = e.maxAmount || e.amount;
            detail = ` <b style="color:#fff;">(${e.amount}/${max})</b>`;
        } 
        else if (e.element) {
            let icon = e.element;
            if (typeof ElementalEngine !== 'undefined') {
                 const text = ElementalEngine.fmt(e.element);
                 const match = text.match(/[\p{Emoji}\u200d]+/gu);
                 icon = match ? match[0] : text;
            }
            detail = ` ${icon}`;
        }
        else if (e.damageDice) {
            detail = ` <span style="font-size:0.8em">(${e.damageDice})</span>`;
        }

        return `
            <span style="
                display: inline-block;
                background: ${bgColor}; 
                border: 1px solid ${borderColor}; 
                color: ${textColor}; 
                padding: 2px 6px; 
                border-radius: 10px; 
                font-size: 0.8em; 
                margin: 2px;
            ">
                ${e.name}${detail}
            </span>
        `;
    }).join('');
}

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
    
    // อัปเดต Stat ตัวเลข (STR, DEX, etc.)
    const statsKeys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'EM'];
    statsKeys.forEach(key => {
        const el = document.getElementById(key.toLowerCase());
        if(el) {
             const currentValue = parseInt(el.textContent || "0");
             // ใช้ StatsEngine คำนวณค่า Stat รวม (Level Scaling ฯลฯ)
             const newValue = (typeof StatsEngine !== 'undefined') 
                ? StatsEngine.calculateTotalStat(charData, key) 
                : 0;
                
             if (newValue > currentValue) el.className = 'stat-change stat-up';
             else if (newValue < currentValue) el.className = 'stat-change stat-down';
             el.textContent = newValue;
             if (newValue !== currentValue) setTimeout(() => el.className = '', 1500); 
        }
    });

    // =================================================================================
    // [FIX] แก้ไขการแสดงผล Max HP ให้ตรงกับ DM/Database
    // 1. ลองดึงค่า 'maxHp' จาก Database โดยตรงก่อน (แม่นยำที่สุด)
    // 2. ถ้าไม่มี ให้ดึงจาก 'stats.maxHp'
    // 3. ถ้าไม่มีจริงๆ ค่อยให้ StatsEngine คำนวณ (Fallback)
    // =================================================================================
    let dbMaxHp = 0;
    if (charData.maxHp !== undefined) dbMaxHp = parseInt(charData.maxHp);
    else if (charData.stats && charData.stats.maxHp !== undefined) dbMaxHp = parseInt(charData.stats.maxHp);

    const displayMaxHp = (dbMaxHp > 0) 
        ? dbMaxHp 
        : ((typeof StatsEngine !== 'undefined' && StatsEngine.calculateMaxHp) 
            ? StatsEngine.calculateMaxHp(charData) 
            : 100);

    // =================================================================================

    const currentHp = Math.min(charData.hp || 0, displayMaxHp);
    
    const hpContainer = document.getElementById('hpContainer'); 
    if (hpContainer) {
        hpContainer.innerHTML = getStatusDisplay(currentHp, displayMaxHp, 'HP');
    }
    
    // ... (ส่วนแสดง Level และ EXP คงเดิม) ...
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

function getElementIcon(element) {
    if (!element) return '';
    if (typeof element === 'string') {
        const k = element.trim().toUpperCase();
        const mapStr = {
            FIRE: '🔥', WATER: '💧', ELECTRIC: '⚡', EARTH: '🪨',
            WIND: '🌪️', ICE: '❄️', LIGHT: '✨', DARK: '🌑'
        };
        return mapStr[k] || element;
    }
    const mapInt = {
        1: '🔥', 2: '💧', 3: '⚡', 4: '🪨', 5: '🌪️', 6: '❄️', 7: '✨', 8: '🌑'
    };
    return mapInt[element] || String(element);
}

function displayActiveEffects(charData, combatState) {
    const container = document.getElementById("effectsContainer"); 
    if (!container) return; 
    container.innerHTML = "<h4>สถานะ/คูลดาวน์</h4>"; 
    let hasEffect = false;

    if (charData.elementSlots) {
        const { e1, e2, e3 } = charData.elementSlots;
        if (e1 || e2 || e3) {
            let html = `<div style="background:rgba(0,0,0,0.5); padding:5px; border-radius:5px; margin-bottom:5px; border:1px solid #ffb700;">`;
            html += `<div style="font-size:0.9em; color:#ddd; margin-bottom:3px;">ธาตุเกาะติด:</div>`;
            html += `<div style="display:flex; gap:10px; justify-content:center;">`;
            
            const renderSlot = (val) => val 
                ? `<div style="font-size:1.5em; animation: pulse 2s infinite;">${getElementIcon(val)}</div>` 
                : `<div style="width:25px; height:25px; border:1px dashed #555; border-radius:50%;"></div>`;

            html += renderSlot(e1);
            html += renderSlot(e2);
            html += renderSlot(e3);
            
            html += `</div></div>`;
            container.innerHTML += html;
            hasEffect = true;
        }
    }

    if (charData.activeEffects && charData.activeEffects.length > 0) {
        const showList = charData.activeEffects.filter(e => e.type !== 'ELEMENTAL_STATUS');
        if (showList.length > 0) {
            container.innerHTML += `<div>${createDetailedEffectBadges(showList)}</div>`;
            hasEffect = true;
        }
    }

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
        container.innerHTML += `<p class="effect-passive" title="${passive.description}"><strong>(อาชีพ) ${passive.name}</strong></p>`;
        hasEffect = true;
    });

    if (!hasEffect) container.innerHTML += "<p style='color:#666;'>- ปกติ -</p>";
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
        
        let headerHtml = `<div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:#ffeb8a; font-size:1em;">${item.name} <span style="color:#aaa; font-weight:normal;">(x${item.quantity})</span></span>`;

        if (item.durability !== undefined) {
             const duraDisplay = getStatusDisplay(item.durability, 100, 'DURA');
             headerHtml += `<span>${duraDisplay}</span>`;
        }
        headerHtml += `</div>`;

        let detailsHtml = '<div style="font-size:0.85em; color:#ccc; margin-top:4px; line-height:1.4;">';
        if (item.bonuses && Object.keys(item.bonuses).length > 0) {
            const stats = Object.entries(item.bonuses).map(([k, v]) => `${k}+${v}`).join(', ');
            detailsHtml += `<div style="color:#66b2ff;">⚡ ${stats}</div>`;
        }
        if (item.damageDice) detailsHtml += `<div style="color:#ff6666;">⚔️ ${item.damageDice}</div>`;
        detailsHtml += '</div>';

        let buttonsHtml = `<div style="margin-top:8px; display:flex; gap:5px; justify-content:flex-end;">`;
        
        if (item.itemType === 'สวมใส่' || item.itemType === 'อาวุธ') {
            if (item.durability === undefined || item.durability > 0) {
                 buttonsHtml += `<button onclick="equipItem(${index})" style="width:auto; padding:4px 10px; font-size:0.8em; border-radius:4px; border:none; color:white; background:#007bff;">สวมใส่</button>`; 
            }
        } else if (item.itemType === 'บริโภค') {
            buttonsHtml += `<button onclick="useConsumableItem(${index})" style="width:auto; padding:4px 10px; font-size:0.8em; border-radius:4px; border:none; color:white; background:#28a745;">ใช้งาน</button>`;
        }
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
    
    for (const key in allEnemiesInRoom) {
        const en = allEnemiesInRoom[key];
        if (en.type === 'player_summon' && en.ownerUid === currentUserUid) {
            const status = en.hp > 0 ? '' : ' (ตาย)';
            select.innerHTML += `<option value="${key}" style="color:#00ff00;">🤖 [ซัมมอนของฉัน] ${en.name}${status}</option>`;
        }
    }

    for (const uid in allPlayersInRoom) {
        if (uid !== currentUserUid) {
            select.innerHTML += `<option value="${uid}">👤 ${allPlayersInRoom[uid].name} (ผู้เล่น)</option>`;
        }
    }
    
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
    
    if (!unit && allEnemiesInRoom[id]) {
        unit = allEnemiesInRoom[id];
        isSummon = true;
    }
    
    if (unit) {
        const maxHp = unit.maxHp || 100;
        const hpDisplay = getStatusDisplay(unit.hp, maxHp, 'HP');

        if (isSummon) {
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
                </div>
            `;
        } else {
            let statsHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-top:5px; font-size: 0.9em;">`;
            ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(stat => {
                const val = calculateTotalStat(unit, stat);
                statsHtml += `<div style="background:rgba(0,0,0,0.3); padding:2px; text-align:center; border-radius:3px;">${stat}: <strong>${val}</strong></div>`;
            });
            statsHtml += `</div>`;
            
            let equipHtml = `<ul style="margin-top:10px; padding-left:15px; font-size:0.85em; color:#ddd;">`;
            const slots = { mainHand: '⚔️', offHand: '🛡️', head: '🧢', chest: '👕', legs: '👖', feet: '👢' };
            let hasEquip = false;
            
            if (unit.equippedItems) {
                for (const [key, icon] of Object.entries(slots)) {
                    const item = unit.equippedItems[key];
                    if (item) {
                        hasEquip = true;
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

    const createEffectBadges = (effects) => {
        if (!effects) return '';
        const list = Array.isArray(effects) ? effects : Object.values(effects);
        if (!list || list.length === 0) return '<span style="color:#666; font-size:0.8em; font-style:italic;">- ปกติ -</span>';
        
        return list.map(e => {
            const isBuff = (e.type === 'BUFF' || e.type === 'HOT' || e.type === 'SHIELD' || e.type === 'ELEMENTAL_BUFF' || e.type === 'WEAPON_BUFF_ELEMENTAL');
            const bgColor = isBuff ? 'rgba(40, 167, 69, 0.2)' : 'rgba(220, 53, 69, 0.2)';
            const borderColor = isBuff ? '#28a745' : '#dc3545';
            const textColor = isBuff ? '#75b798' : '#ea868f';
            
            let detail = '';
            if (e.type === 'SHIELD' && e.amount !== undefined) {
                const max = e.maxAmount || e.amount;
                detail = ` <b style="color:#fff; font-size:0.9em;">(${e.amount}/${max})</b>`;
            } 
            else if (e.element) {
                const elName = (typeof ElementalEngine !== 'undefined') 
                    ? ElementalEngine.fmt(e.element) 
                    : e.element;
                detail = ` <span style="color:#fff;">[${elName}]</span>`;
            }
            else if (e.damageDice) {
                detail = ` <span style="font-size:0.85em;">(${e.damageDice})</span>`;
            }

            return `
                <span style="
                    display: inline-block;
                    background: ${bgColor};
                    border: 1px solid ${borderColor};
                    color: ${textColor};
                    padding: 1px 6px;
                    border-radius: 10px;
                    font-size: 0.75em;
                    margin-right: 4px;
                    margin-bottom: 2px;
                    white-space: nowrap;
                ">
                    ${e.name}${detail}
                </span>`;
        }).join('');
    };

    const createElementSlotsBadge = (unit) => {
        if (!unit || !unit.elementSlots) return '';
        const e1 = unit.elementSlots.e1 || 0;
        const e2 = unit.elementSlots.e2 || 0;
        if (!e1 && !e2) return '';

        const s1 = e1 ? getElementIcon(e1) : '<span style="opacity:0.3">⚪</span>';
        const s2 = e2 ? getElementIcon(e2) : '<span style="opacity:0.3">⚪</span>';

        return `
            <div style="
                display:inline-flex; 
                background:rgba(0,0,0,0.6); 
                border:1px solid #555; 
                border-radius:12px; 
                padding:2px 8px; 
                gap: 5px;
                font-size:0.8em; 
                vertical-align: middle;
                margin-left: 5px;
            " title="Reaction Slots (ช่องธาตุ)">
                ${s1} <span style="color:#444">|</span> ${s2}
            </div>`;
    };

    const createStatsGrid = (enemy) => {
        const stats = {
            STR: { val: calculateTotalStat(enemy, 'STR'), color: '#ff4d4d', bg: '#3a1c1c' },
            DEX: { val: calculateTotalStat(enemy, 'DEX'), color: '#28a745', bg: '#1c3a25' },
            CON: { val: calculateTotalStat(enemy, 'CON'), color: '#ffc107', bg: '#3a331c' },
            INT: { val: calculateTotalStat(enemy, 'INT'), color: '#17a2b8', bg: '#1c333a' },
            WIS: { val: calculateTotalStat(enemy, 'WIS'), color: '#6f42c1', bg: '#2d1c3a' }
        };

        let html = `<div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; margin-top: 8px;">`;
        for (const [key, data] of Object.entries(stats)) {
            html += `
                <div style="
                    background: ${data.bg}; 
                    border: 1px solid ${data.color}44; 
                    color: ${data.color}; 
                    text-align: center; 
                    border-radius: 4px; 
                    padding: 2px 0;
                    font-size: 0.75em;
                    font-weight: bold;
                ">
                    <div style="font-size:0.7em; opacity:0.8;">${key}</div>
                    <div>${data.val}</div>
                </div>
            `;
        }
        html += `</div>`;
        return html;
    };

    // 1. กรณี PvP
    if (combatState && combatState.isActive && combatState.type === 'PVP') {
        const opponentUnit = combatState.turnOrder.find(u => u.id !== currentUserUid);
        if (opponentUnit) {
            const opponentData = allPlayersInRoom[opponentUnit.id];
            if (opponentData) {
                const isDead = (opponentData.hp || 0) <= 0;
                const hpDisplay = isDead
                    ? '<span style="color:red; font-weight:bold;">(พ่ายแพ้)</span>'
                    : getStatusDisplay(opponentData.hp, opponentData.maxHp, 'HP');

                container.innerHTML = `
                    <div style="border: 2px solid #ff4d4d; padding: 12px; border-radius: 8px; background: linear-gradient(135deg, rgba(50,0,0,0.8), rgba(20,0,0,0.9)); box-shadow: 0 0 10px rgba(255, 0, 0, 0.2);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <h3 style="color: #ff4d4d; margin:0; font-size:1.1em;">⚔️ VS คู่ประลอง</h3>
                            ${createElementSlotsBadge(opponentData)}
                        </div>

                        <div style="font-size: 1.2em; color: #fff; font-weight:bold; margin-bottom:5px;">
                            ${opponentData.name}
                        </div>

                        <div style="margin-bottom:10px;">${hpDisplay}</div>

                        ${createStatsGrid(opponentData)}

                        <div style="margin-top:8px; border-top:1px solid #444; padding-top:5px;">
                            <div style="font-size:0.8em; color:#aaa; margin-bottom:3px;">สถานะ:</div>
                            ${createEffectBadges(opponentData.activeEffects)}
                        </div>
                    </div>
                `;

                if (!isDead) {
                    targetSelect.innerHTML += `<option value="${opponentUnit.id}" selected>${opponentData.name} (ผู้เล่น)</option>`;
                } else {
                    targetSelect.innerHTML = '<option>-- การประลองจบลง --</option>';
                }
            }
        } else {
            container.innerHTML = '<p style="color:#aaa; text-align:center;">กำลังรอคู่ต่อสู้...</p>';
        }
        return;
    }

    // 2. กรณี PvE
    let hasLiveEnemies = false;

    for (const key in enemies) {
        const rawData = enemies[key];
        if (rawData.type === 'player_summon') continue; 

        const enemy = { ...rawData };
        const isDead = (enemy.hp || 0) <= 0;
        const maxHpVal = parseInt(enemy.maxHp) || parseInt(enemy.hp) || (isDead ? 100 : 1);
        
        const hpDisplay = isDead
            ? '<span style="color:#888; text-decoration:line-through;">(จัดการแล้ว)</span>'
            : getStatusDisplay(enemy.hp, maxHpVal, 'HP');

        const cardStyle = isDead 
            ? "opacity: 0.6; filter: grayscale(1); border: 1px solid #444;" 
            : "border-left: 4px solid #ff4500; border-top: 1px solid #444; border-right: 1px solid #444; border-bottom: 1px solid #444; box-shadow: 0 2px 5px rgba(0,0,0,0.3);";

        const isSelected = (window.selectedTargetId === key);
        const selectionStyle = isSelected ? 'border-color: #ffc107; background-color: rgba(255, 193, 7, 0.1);' : '';

        container.innerHTML += `
            <div onclick="selectTargetAndSync('${key}')" 
                 style="background:rgba(20, 20, 20, 0.8); padding:10px; margin-bottom:8px; border-radius:6px; cursor:pointer; transition:all 0.2s; ${cardStyle} ${selectionStyle}">
                
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div style="font-weight:bold; color:${isDead ? '#aaa' : '#ffc107'}; font-size:1.05em;">
                            ${enemy.name}
                        </div>
                        ${createElementSlotsBadge(enemy)}
                    </div>
                    <div style="text-align:right; min-width:80px;">
                        ${hpDisplay}
                    </div>
                </div>

                ${!isDead ? `
                    ${createStatsGrid(enemy)}
                    
                    <div style="margin-top:8px; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                        <span style="font-size:0.75em; color:#888;">สถานะ:</span>
                        ${createEffectBadges(enemy.activeEffects)}
                    </div>
                ` : ''}
            </div>
        `;

        if (!isDead) {
            hasLiveEnemies = true;
            targetSelect.innerHTML += `<option value="${key}">${enemy.name} (${enemy.hp}/${maxHpVal})</option>`;
        }
    }

    if (!hasLiveEnemies && container.innerHTML === '') {
        container.innerHTML = "<p style='text-align:center; color:#666; padding:20px;'>ยังไม่มีศัตรูในระยะ</p>";
    }

    if (currentSelection && enemies[currentSelection] && (enemies[currentSelection].hp || 0) > 0) {
        targetSelect.value = currentSelection;
    }
}

window.selectTargetAndSync = function(enemyId, shouldRefresh = true) {
    if (window.selectedTargetId === enemyId) {
        window.selectedTargetId = null; 
    } else {
        window.selectedTargetId = enemyId; 
    }

    const dropdown = document.getElementById('enemyTargetSelect');
    if (dropdown) {
        dropdown.value = window.selectedTargetId || "";
    }

    if (shouldRefresh && typeof displayEnemies === 'function' && window.allEnemiesInRoom) {
        displayEnemies(window.allEnemiesInRoom, window.currentCharacterData?.uid);
    }
};

function updateTurnDisplay(combatState, currentUserUid) {
    const indicator = document.getElementById('turnIndicator');
    const attackBtn = document.getElementById('attackRollButton');
    const skillBtn  = document.getElementById('skillButton');
    const dmgSection = document.getElementById('damageRollSection');

    if (!combatState || !combatState.isActive || !Array.isArray(combatState.turnOrder)) {
        if (indicator) indicator.classList.add('hidden');
        if (attackBtn) attackBtn.disabled = true;
        if (skillBtn) skillBtn.disabled = true;
        if (dmgSection) dmgSection.style.display = 'none';
        return;
    }

    const currentUnit = combatState.turnOrder[combatState.currentTurnIndex];
    const isMyTurn = currentUnit && currentUnit.id === currentUserUid;

    if (indicator) {
        indicator.textContent = isMyTurn ? '⚔️ เทิร์นของคุณ ⚔️' : `เทิร์นของ: ${currentUnit?.name || '-'}`;
        indicator.className = isMyTurn ? 'my-turn' : 'other-turn';
        indicator.style.backgroundColor = '';
        indicator.style.color = '';
        indicator.classList.remove('hidden');
    }

    if (attackBtn) attackBtn.disabled = !isMyTurn;
    if (skillBtn)  skillBtn.disabled = !isMyTurn;

    if (dmgSection) {
        if (!isMyTurn) {
            dmgSection.style.display = 'none';
            dmgSection.removeAttribute('data-attack-val');
        }
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

function applyDurabilityDamage(updates, equippedItems, type, options = {}) {
    if (!equippedItems) return; // ถ้าไม่มีข้อมูลของสวมใส่ ให้จบเลย

    // ฟังก์ชันช่วยสุ่ม: คืนค่า true ถ้า "ดวงซวย" (ของจะพัง)
    const checkChance = (percent) => Math.random() * 100 < percent;

    // ฟังก์ชันช่วยหาของ: สุ่มหาชิ้นส่วนที่มีอยู่ใน Slots ที่ระบุ
    const getRandomItemSlot = (slots) => {
        // กรองเอาเฉพาะช่องที่มีของใส่ และของชิ้นนั้นยังไม่พัง (durability > 0)
        const validSlots = slots.filter(s => 
            equippedItems[s] && 
            equippedItems[s].name && 
            (equippedItems[s].durability === undefined || equippedItems[s].durability > 0)
        );
        
        if (validSlots.length === 0) return null;
        // สุ่มมา 1 ช่อง
        return validSlots[Math.floor(Math.random() * validSlots.length)];
    };

    // กำหนดค่าความเสียหายพื้นฐาน (Default)
    let damageAmount = 1; 
    
    // คำนวณตามสถานการณ์
    switch (type) {
        case 'BLOCK_SUCCESS':
            // รับดาเมจด้วยอาวุธ/โล่: ลดแน่นอน 100%
            // ยิ่งกันดาเมจได้เยอะ ยิ่งพังเร็ว (ทุกๆ 10 ดาเมจ ลดเพิ่ม 1 หน่วย)
            const { damageReduced, weaponSlot } = options;
            if (weaponSlot && equippedItems[weaponSlot]) {
                const extraWear = Math.floor((damageReduced || 0) / 10);
                damageAmount = 1 + extraWear;
                
                const currentDura = equippedItems[weaponSlot].durability || 100;
                const newDura = Math.max(0, currentDura - damageAmount);
                
                // อัปเดตข้อมูล
                updates[`equippedItems/${weaponSlot}/durability`] = newDura;
                console.log(`🛡️ Block Success: ${weaponSlot} durability -${damageAmount}`);
            }
            break;

        case 'BLOCK_FAIL':
            // กันพลาด: โล่รับไปส่วนหนึ่ง (50% โอกาส) และเกราะรับไปส่วนหนึ่ง (50% โอกาส)
            const { damageTaken } = options;
            
            // 1. ลองลดอาวุธที่ใช้กันก่อน (โอกาส 50%)
            if (checkChance(50)) {
                let blockSlot = equippedItems.offHand ? 'offHand' : 'mainHand';
                if (equippedItems[blockSlot]) {
                    const current = equippedItems[blockSlot].durability || 100;
                    updates[`equippedItems/${blockSlot}/durability`] = Math.max(0, current - 1);
                }
            }

            // 2. ส่วนที่กันไม่อยู่ เข้าเกราะ (โอกาส 50%)
            if (checkChance(50)) {
                const armorSlot = getRandomItemSlot(['head', 'chest', 'legs', 'feet']);
                if (armorSlot) {
                    const extraWearArmor = Math.floor((damageTaken || 0) / 20); // ดาเมจทะลุเยอะ เกราะยิ่งพัง
                    const current = equippedItems[armorSlot].durability || 100;
                    updates[`equippedItems/${armorSlot}/durability`] = Math.max(0, current - (1 + extraWearArmor));
                    console.log(`🛡️ Block Fail: ${armorSlot} durability damaged`);
                }
            }
            break;

        case 'DODGE':
            // หลบ: รองเท้าทำงานหนัก (โอกาสลด 30%)
            if (checkChance(30)) {
                if (equippedItems.feet && (equippedItems.feet.durability === undefined || equippedItems.feet.durability > 0)) {
                    const current = equippedItems.feet.durability || 100;
                    updates[`equippedItems/feet/durability`] = Math.max(0, current - 1);
                    console.log(`🏃 Dodge: Feet durability -1`);
                }
            }
            break;

        case 'TAKE_HIT':
            // ยืนรับดาเมจ: เกราะรับเต็มๆ (โอกาสลด 40% ต่อชิ้น)
            // สุ่มโดน 1 ชิ้น
            if (checkChance(40)) {
                const hitSlot = getRandomItemSlot(['head', 'chest', 'legs', 'feet']);
                
                if (hitSlot) {
                    // คำนวณความเสียหายตามความแรงดาเมจ
                    const { damageTaken: dmg } = options;
                    const wear = 1 + Math.floor((dmg || 0) / 15); // ทุก 15 ดาเมจ ลดเพิ่ม 1
                    
                    const current = equippedItems[hitSlot].durability || 100;
                    updates[`equippedItems/${hitSlot}/durability`] = Math.max(0, current - wear);
                    console.log(`🤕 Take Hit: ${hitSlot} durability -${wear}`);
                }
            }
            break;
    }
}

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
    if (equippedItems.offHand && (!equippedItems.offHand.durability || equippedItems.offHand.durability > 0)) {
        blockItem = equippedItems.offHand; blockSlot = 'offHand';
    } else if (equippedItems.mainHand && (!equippedItems.mainHand.durability || equippedItems.mainHand.durability > 0)) {
        blockItem = equippedItems.mainHand; blockSlot = 'mainHand';
    }

    const timerDuration = 5000; 

    const swalOptions = {
        title: `⚠️ ถูกโจมตี! (ตัดสินใจใน 5 วิ)`,
        html: `
            <div style="text-align: center;">
                <h3 style="color: #ff4d4d; margin: 0;">${attackData.attackerName}</h3>
                <p>ATK: <strong>${attackData.attackRollValue}</strong> vs AC: <strong>${acForDisplay}</strong></p>
                <p>Dmg: <strong style="color: red; font-size: 1.2em;">${initialDamage}</strong></p>
                ${attackData.isPierce ? '<small style="color:orange;">(ทะลวงเกราะ!)</small>' : ''}
            </div>
        `,
        icon: 'warning',
        timer: timerDuration,
        timerProgressBar: true,
        showConfirmButton: true, confirmButtonText: '🛡️ ป้องกัน', confirmButtonColor: '#28a745',
        showDenyButton: true, denyButtonText: '🏃 หลบหลีก', denyButtonColor: '#6c757d',
        showCancelButton: true, cancelButtonText: '😑 รับดาเมจ', cancelButtonColor: '#dc3545',
        allowOutsideClick: false, allowEscapeKey: false,
        didOpen: () => {
            const confirmBtn = Swal.getConfirmButton();
            const denyBtn = Swal.getDenyButton();
            if (cdBlock > 0) { confirmBtn.innerText = `🛡️ ติด CD (${cdBlock})`; confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5'; }
            else if (!blockItem) { confirmBtn.innerText = `🛡️ มือเปล่า (ไม่ได้)`; confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5'; }
            else { confirmBtn.innerText = `🛡️ ป้องกัน (${blockItem.name})`; }
            
            if (cdDodge > 0) { denyBtn.innerText = `🏃 ติด CD (${cdDodge})`; denyBtn.disabled = true; denyBtn.style.opacity = '0.5'; }
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
        let rawDamageTaken = initialDamage;

        if (result.isConfirmed) { 
            const blockRoll = await rollDiceAndAnimate(20);
            const totalCon = calculateTotalStat(playerData, 'CON');
            const totalBlock = blockRoll + getStatBonusFn(totalCon);
            const damageReduction = Math.floor(totalBlock / 2); 
            
            defenseResponse.choice = 'block';
            defenseResponse.roll = totalBlock;
            defenseResponse.damageReduced = damageReduction;
            
            rawDamageTaken = Math.max(0, initialDamage - damageReduction);
            updates[`skillCooldowns/action_block`] = { type: 'PERSONAL', turnsLeft: 2 };

            if (rawDamageTaken <= 0) {
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_SUCCESS', { damageReduced: initialDamage, weaponSlot: blockSlot });
                Swal.fire({ title: '🛡️ ป้องกันสมบูรณ์!', text: `รับไว้ได้ทั้งหมด!`, icon: 'success', timer: 1500, showConfirmButton: false });
            } else {
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_SUCCESS', { damageReduced: damageReduction, weaponSlot: blockSlot });
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_FAIL', { damageTaken: rawDamageTaken });
                Swal.fire({ title: '🛡️ ป้องกันบางส่วน', html: `ลดไป ${damageReduction} (เหลือ <strong>${rawDamageTaken}</strong>)`, icon: 'warning', timer: 1500, showConfirmButton: false });
            }

        } else if (result.isDenied) { 
            const dodgeRoll = await rollDiceAndAnimate(20);
            const totalDex = calculateTotalStat(playerData, 'DEX');
            const totalDodge = dodgeRoll + getStatBonusFn(totalDex);
            const isDodgeSuccess = totalDodge > attackData.attackRollValue;

            defenseResponse.choice = 'dodge';
            defenseResponse.roll = totalDodge;
            updates[`skillCooldowns/action_dodge`] = { type: 'PERSONAL', turnsLeft: 2 };
            applyDurabilityDamage(updates, playerData.equippedItems, 'DODGE', {});

            if (isDodgeSuccess) {
                rawDamageTaken = 0;
                defenseResponse.success = true;
                Swal.fire({ title: '🏃 หลบพ้น!', text: `พริ้วไหว! (${totalDodge} vs ${attackData.attackRollValue})`, icon: 'success', timer: 1500, showConfirmButton: false });
            } else {
                defenseResponse.success = false;
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_FAIL', { damageTaken: rawDamageTaken });
                Swal.fire({ title: '🏃 หลบไม่พ้น!', html: `เสียหลัก! โดน <strong>${rawDamageTaken}</strong>`, icon: 'error', timer: 1500, showConfirmButton: false });
            }

        } else { 
            defenseResponse.choice = 'none';
            applyDurabilityDamage(updates, playerData.equippedItems, 'TAKE_HIT', { damageTaken: rawDamageTaken });
            const msg = (result.dismiss === Swal.DismissReason.timer) ? 'หมดเวลาตัดสินใจ!' : 'ยืนรับดาเมจ!';
            Swal.fire({ title: '😑 โดนเต็มๆ', html: `${msg}<br>รับความเสียหาย <strong>${rawDamageTaken}</strong>`, icon: 'error', timer: 1500, showConfirmButton: false });
        }
        
        let finalResult = { finalHp: playerData.hp, damageTaken: rawDamageTaken, logs: [] };
        
        if (rawDamageTaken > 0 && typeof ElementalEngine !== 'undefined' && ElementalEngine.applyDamageWithShield) {
            const isPierce = attackData.isPierce || false; 
            const tempUnit = { 
                hp: playerData.hp, 
                activeEffects: playerData.activeEffects ? [...playerData.activeEffects] : [] 
            };
            finalResult = ElementalEngine.applyDamageWithShield(tempUnit, rawDamageTaken, isPierce);
            updates['activeEffects'] = finalResult.activeEffects;
            
            if (finalResult.logs.length > 0) {
                const roomId = sessionStorage.getItem('roomId');
                await db.ref(`rooms/${roomId}/combatLogs`).push({
                    message: `🛡️ <b>${playerData.name}</b> ใช้เกราะรับความเสียหาย:<br>${finalResult.logs.join('<br>')}`,
                    timestamp: Date.now()
                });
            }
        } else {
            finalResult.finalHp = Math.max(0, (playerData.hp || 0) - rawDamageTaken);
            finalResult.damageTaken = rawDamageTaken;
        }

        updates['hp'] = finalResult.finalHp;
        defenseResponse.damageTaken = finalResult.damageTaken; 

        if (Object.keys(updates).length > 0) await playerRef.update(updates);
        await playerRef.child('pendingAttack').remove();

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

    const itemPrice = parseInt(item.price) || 0;
    const sellPrice = Math.floor(itemPrice / 2);
    
    const result = await Swal.fire({
        title: `จัดการ: ${item.name}`,
        html: `เลือกสิ่งที่คุณต้องการทำกับไอเทมนี้`,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🎁 ส่งให้เพื่อน',
        denyButtonText: `💰 ขาย (${sellPrice} GP)`,
        cancelButtonText: '🗑️ ทิ้ง',
        confirmButtonColor: '#17a2b8',
        denyButtonColor: '#28a745',
        cancelButtonColor: '#dc3545'
    });

    if (result.isConfirmed) { 
        transferItemSelection(index);
    } 
    else if (result.isDenied) {
        if (sellPrice === 0) {
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
            if (!data.inventory[index]) return data;

            const item = data.inventory[index];
            if (item.quantity > 1) {
                item.quantity--;
            } else {
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
        data.gp = (data.gp || 0) + price;
        
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
        let itemToSend = null;
        
        await myRef.transaction(data => {
            if (!data || !data.inventory || !data.inventory[index]) return data;
            itemToSend = JSON.parse(JSON.stringify(data.inventory[index]));
            itemToSend.quantity = 1;

            if (data.inventory[index].quantity > 1) {
                data.inventory[index].quantity--;
            } else {
                data.inventory.splice(index, 1);
            }
            return data;
        });

        if (!itemToSend) throw new Error("ไม่พบไอเทม หรือเกิดข้อผิดพลาด");

        await targetRef.transaction(data => {
            if (!data) return data;
            if (!data.inventory) data.inventory = [];

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

                // ย้ายกลับเข้าห้อง
                const updates = {};
                updates[`rooms/${roomId}/playersByUid/${currentUserUid}`] = afkData;
                updates[`rooms/${roomId}/afkPlayersByUid/${currentUserUid}`] = null;
                
                // สั่งอัปเดต Firebase ทันที
                db.ref().update(updates);
                
                // หลอกระบบว่ามีตัวละครแล้ว (เพื่อให้เรนเดอร์ทันทีไม่ต้องรอ Firebase ตอบกลับ)
                allPlayersInRoom[currentUserUid] = afkData;
            }

            currentCharacterData = allPlayersInRoom[currentUserUid]; 
            if (currentCharacterData) currentCharacterData.uid = currentUserUid; 

            if (currentCharacterData) {
                displayCharacter(currentCharacterData, combatState);
                displayInventory(currentCharacterData.inventory);
                displayEquippedItems(currentCharacterData.equippedItems);
                displayQuest(currentCharacterData.quest);
                displayTeammates(currentUserUid); 
                
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

window.selectTarget = function(enemyId) {
    console.log("Selecting target:", enemyId); 
    
    if (window.selectedTargetId === enemyId) {
        window.selectedTargetId = null; 
    } else {
        window.selectedTargetId = enemyId; 
    }
    
    if (typeof allEnemiesInRoom !== 'undefined') {
        displayEnemies(allEnemiesInRoom, currentCharacterData?.uid);
    }
};