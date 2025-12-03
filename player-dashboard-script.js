// Javascript/player-dashboard-script.js (v3.7 - Fix MaxHP Sync)

// --- Global State ---
let allPlayersInRoom = {};
let allEnemiesInRoom = {};
let combatState = {};
let currentCharacterData = null; 

// --- Utility Functions ---
const calcHPFn = typeof calculateHP === 'function' ? calculateHP : () => { console.error("calculateHP not found!"); return 10; };
const getStatBonusFn = typeof getStatBonus === 'function' ? getStatBonus : () => { console.error("getStatBonus not found!"); return 0; };
const showAlert = typeof showCustomAlert === 'function' ? showCustomAlert : (msg, type) => { console.log(type + ':', msg); };

/**
 * คำนวณสเตตัสรวม (Final Stat)
 */
function calculateTotalStat(charData, statKey) {
    if (!charData || !charData.stats) return 0;
    
    const stats = charData.stats;
    const upperStatKey = statKey.toUpperCase();
    
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

    let baseStat = (stats.baseRaceStats?.[upperStatKey] || 0) +
                   (stats.investedStats?.[upperStatKey] || 0) +
                   (stats.tempStats?.[upperStatKey] || 0);

    const classMainData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charData.classMain] : null;
    const classSubData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[charData.classSub] : null;
    
    if (classMainData && classMainData.bonuses) baseStat += (classMainData.bonuses[upperStatKey] || 0);
    if (classSubData && classSubData.bonuses) baseStat += (classSubData.bonuses[upperStatKey] || 0);

    const raceId = charData.raceEvolved || charData.race;
    const racePassives = (typeof RACE_DATA !== 'undefined' && RACE_DATA[raceId]?.passives) ? RACE_DATA[raceId].passives : [];
    
    const classMainId = charData.classMain;
    const classPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classMainId]?.passives) ? CLASS_DATA[classMainId].passives : [];
    
    const classSubId = charData.classSub;
    const subClassPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classSubId]?.passives) ? CLASS_DATA[classSubId].passives : [];
    
    const skillPassives = [];
    if (typeof SKILL_DATA !== 'undefined') {
        if(classMainId && SKILL_DATA[classMainId]) skillPassives.push(...SKILL_DATA[classMainId].filter(s => s.skillTrigger === 'PASSIVE'));
        if(classSubId && SKILL_DATA[classSubId]) skillPassives.push(...SKILL_DATA[classSubId].filter(s => s.skillTrigger === 'PASSIVE'));
    }

    const allPassives = [...racePassives, ...classPassives, ...subClassPassives, ...skillPassives];
    
    allPassives.forEach(passiveOrSkill => {
        let effectObject = null;
        if (passiveOrSkill.skillTrigger === 'PASSIVE') effectObject = passiveOrSkill.effect;
        else if (passiveOrSkill.id && passiveOrSkill.effect) effectObject = passiveOrSkill.effect;
        
        if (effectObject) {
            const effects = Array.isArray(effectObject) ? effectObject : [effectObject];
            effects.forEach(p => {
                if (p && p.type === 'PASSIVE_STAT_PERCENT' && p.stats?.includes(upperStatKey)) baseStat *= (1 + (p.amount / 100));
                if (p && p.type === 'PASSIVE_STAT_FLAT' && p.stats?.includes(upperStatKey)) baseStat += p.amount;
            });
        }
    });

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
                    if (p && p.type === 'AURA_STAT_PERCENT' && (p.stats?.includes(upperStatKey) || p.stats?.includes('ALL'))) percentBonus += p.amount;
                });
            });
        }
    }

    let equipBonus = 0;
    if (charData.equippedItems) {
        for (const slot in charData.equippedItems) {
            const item = charData.equippedItems[slot];
            if (!item || !item.bonuses || item.bonuses[upperStatKey] === undefined || (item.durability !== undefined && item.durability <= 0)) continue;
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

    let finalStat = (baseStat * (1 + (percentBonus / 100))) + flatBonus + equipBonus;
    if (finalStat > 0 && totalLevel > 1) {
         const levelBonus = finalStat * (totalLevel - 1) * 0.2;
         finalStat += levelBonus;
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
        
        <p><strong>พลังชีวิต:</strong> <span id="hp"></span></p>
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

    // [FIXED] คำนวณ MaxHP สดๆ จาก CON เสมอ เพื่อให้ตรงกับ Stat ที่เปลี่ยนไป
    const finalCon = calculateTotalStat(charData, 'CON');
    const displayMaxHp = calcHPFn(charData.race, charData.classMain, finalCon);
    
    const hpEl = document.getElementById('hp');
    if (hpEl) {
        const currentHp = Math.min(charData.hp || 0, displayMaxHp);
        hpEl.textContent = `${currentHp} / ${displayMaxHp}`;
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
    list.innerHTML = inventory.length === 0 ? "<li>ยังไม่มีไอเทม</li>" : ""; 
    
    inventory.forEach((item, index) => { 
        if (!item || !item.name) return; 
        const li = document.createElement("li"); 
        let itemText = `${item.name} (x${item.quantity})`;
        
        if (item.durability !== undefined) {
             if (item.durability <= 0) itemText += ` <span style="color: #dc3545; font-weight: bold;">[พัง 0%]</span>`;
             else itemText += ` [${item.durability}%]`;
        }
        
        if (item.itemType === 'สวมใส่' || item.itemType === 'อาวุธ') {
            if (item.durability === undefined || item.durability > 0) {
                 itemText += ` <button onclick="equipItem(${index})" style="margin-left: 10px; padding: 2px 8px; font-size: 0.8em;">สวมใส่</button>`; 
            }
        } else if (item.itemType === 'บริโภค') {
            itemText += ` <button onclick="useConsumableItem(${index})" style="margin-left: 10px; padding: 2px 8px; font-size: 0.8em; background-color: #28a745;">ใช้</button>`;
        }
        li.innerHTML = itemText; 
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
                if (item.durability <= 0) itemText += ` <span style="color: #dc3545; font-weight: bold;">[พัง 0%]</span>`;
                else {
                    let color = item.durability > 30 ? '#00ff00' : (item.durability > 10 ? '#ffc107' : '#dc3545');
                    itemText += ` <span style="color: ${color}; font-weight: bold;">[${item.durability}%]</span>`;
                }
            }
            el.innerHTML = itemText;
        }
        if (btn) btn.style.display = item ? 'inline-block' : 'none'; 
    }); 
}

function displayTeammates(currentUserUid) {
    const select = document.getElementById('teammateSelect');
    select.innerHTML = '<option value="">-- เลือกดูข้อมูล --</option>';
    for (const uid in allPlayersInRoom) {
        if (uid !== currentUserUid) {
            select.innerHTML += `<option value="${uid}">${allPlayersInRoom[uid].name}</option>`;
        }
    }
}

function showTeammateInfo() {
    const uid = document.getElementById('teammateSelect').value;
    const infoDiv = document.getElementById('teammateInfo');
    if (!uid) {
        infoDiv.innerHTML = '<p>เลือกเพื่อนร่วมทีมเพื่อดูข้อมูล</p>';
        return;
    }
    const player = allPlayersInRoom[uid];
    if (player) {
        const finalCon = calculateTotalStat(player, 'CON');
        const maxHp = calcHPFn(player.race, player.classMain, finalCon);
        infoDiv.innerHTML = `
            <p><strong>${player.name} (Lv. ${player.level})</strong></p>
            <p><strong>HP:</strong> ${player.hp} / ${maxHp}</p>
            <p><strong>เผ่า:</strong> ${player.raceEvolved || player.race}</p>
            <p><strong>อาชีพ:</strong> ${player.classMain}</p>
        `;
    }
}

function displayQuest(quest) {
    document.getElementById('questTitle').textContent = quest?.title || '-';
    document.getElementById('questDetail').textContent = quest?.detail || '-';
    document.getElementById('questReward').textContent = quest?.reward || '-';
}

function displayStory(story) {
    document.getElementById('story').textContent = story || 'ยังไม่มีเนื้อเรื่อง';
}

function displayEnemies(enemies, currentUserUid) {
    const container = document.getElementById('enemyPanelContainer');
    const targetSelect = document.getElementById('enemyTargetSelect');
    
    // จำค่าที่เลือกอยู่ปัจจุบันไว้ (กัน List เด้งแล้ว selection หาย)
    const currentSelection = targetSelect.value;

    container.innerHTML = '';
    targetSelect.innerHTML = '';
    
    let hasEnemies = false;
    let hasLiveEnemies = false;

    for (const key in enemies) {
        const enemy = enemies[key];
        hasEnemies = true;

        // [FIX] แสดงสถานะ (ตาย) และเปลี่ยนสี
        const isDead = enemy.hp <= 0;
        const hpText = isDead ? `<span style="color:red; font-weight:bold;">(ตาย)</span>` : `(HP: ${enemy.hp})`;
        const nameStyle = isDead ? `color: #888; text-decoration: line-through;` : `color: #ffc107;`;
        
        // 1. แสดงใน Panel รายชื่อ
        container.innerHTML += `
            <div style="margin-bottom: 5px; ${isDead ? 'opacity: 0.6;' : ''}">
                <span style="${nameStyle}">${enemy.name}</span> ${hpText}
            </div>
        `;

        // 2. แสดงใน Dropdown เลือกเป้าหมาย (เฉพาะตัวเป็น)
        if (!isDead) {
            hasLiveEnemies = true;
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${enemy.name} (HP: ${enemy.hp})`;
            targetSelect.appendChild(option);
        }
    }
    
    if (!hasEnemies) {
        container.innerHTML = '<p><em>ไม่มีศัตรูในฉาก</em></p>';
        targetSelect.innerHTML = '<option value="">-- ไม่มีเป้าหมาย --</option>';
    } else if (!hasLiveEnemies) {
        targetSelect.innerHTML = '<option value="">-- ศัตรูตายหมดแล้ว --</option>';
    } else {
        // พยายามเลือกตัวเดิมที่เคยเลือกไว้
        if (currentSelection && enemies[currentSelection] && enemies[currentSelection].hp > 0) {
            targetSelect.value = currentSelection;
        }
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
    console.log(`[Durability] Applying damage type: ${type}`, options);
    
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
                const newDura = Math.max(0, (item.durability || 100) - damageReduced);
                updates[`equippedItems/${weaponSlot}/durability`] = newDura;
            }
            break;

        case 'BLOCK_FAIL':
            const { damageTaken } = options;
            const duraLossArmor = Math.ceil(damageTaken / 2); 
            let armorSlots = ['head', 'chest', 'legs', 'feet'];
            const piecesToDamage = (armorSlots.filter(s => equippedItems[s] && (equippedItems[s].durability === undefined || equippedItems[s].durability > 0)).length >= 2) ? 2 : 1;
            
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
            if (equippedItems['feet'] && (equippedItems['feet'].durability === undefined || equippedItems['feet'].durability > 0)) {
                const item = equippedItems['feet'];
                const duraLossDodge = 3; 
                const newDura = Math.max(0, (item.durability || 100) - duraLossDodge);
                updates[`equippedItems/feet/durability`] = newDura;
            }
            break;

        case 'TAKE_HIT':
            const { damageTaken: damageTakenHit } = options; 
            const duraLossHit = Math.ceil(damageTakenHit / 2); 
            const randomBodySlot = getRandomArmor(['chest', 'legs']); 
            if (randomBodySlot) {
                const item = equippedItems[randomBodySlot];
                const newDura = Math.max(0, (item.durability || 100) - duraLossHit);
                updates[`equippedItems/${randomBodySlot}/durability`] = newDura;
            }
            break;
    }

    if (equippedItems) {
       Object.keys(updates).forEach(path => {
           const parts = path.split('/'); 
           if(parts.length === 3 && parts[0] === 'equippedItems') {
               const slot = parts[1];
               if(equippedItems[slot]) equippedItems[slot].durability = updates[path];
           }
       });
       displayEquippedItems(equippedItems);
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

    const swalOptions = {
        title: `⚠️ คุณถูกโจมตี!`,
        html: `
            <div style="text-align: center;">
                <h3 style="color: #ff4d4d; margin: 0;">${attackData.attackerName}</h3>
                <p>ค่าโจมตี: <strong>${attackData.attackRollValue}</strong> <small>(AC คุณ: ${acForDisplay})</small></p>
                <p>ความเสียหาย: <strong style="color: red; font-size: 1.2em;">${initialDamage}</strong></p>
            </div>
        `,
        icon: 'warning',
        
        showConfirmButton: true,
        confirmButtonText: '🛡️ ป้องกัน',
        confirmButtonColor: '#28a745',

        showDenyButton: true,
        denyButtonText: '🏃 หลบหลีก',
        denyButtonColor: '#6c757d',

        showCancelButton: true,
        cancelButtonText: '😑 ไม่ทำอะไร',
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

            const dodgeSuccessTitles = ['🏃 หลบพ้น!', '✨ พริ้วมาก!', '💨 วูบเดียว!', '😎 ชิลๆ!'];
            const dodgeSuccessDescs = ['พริ้วไหว!', 'มองแทบไม่ทัน', 'อ่านทางออกหมด', 'ศัตรูงงเลย'];
            const dodgeFailTitles = ['🏃 หลบไม่พ้น!', '🤕 โอ๊ย!', '🐌 ช้าไปนิด!', '🦶 สะดุด!'];
            const dodgeFailDescs = ['เสียหลัก!', 'เต็มๆ เลย', 'ขาตายซะงั้น', 'เกือบพ้นแล้วเชียว'];
            const blockPerfectTitles = ['🛡️ ป้องกันสมบูรณ์!', '🛡️ เทพแห่งการป้องกัน!', '🛡️ สุดยอดบล็อกเกอร์!', '🛡️ บล็อกได้อย่างแม่นยำ!','🛡️อุ้ย! เหมือนว่าจะโจมตีไม่เข้านะ'];
            const blockPartialTitles = ['🛡️ ป้องกันได้บางส่วน', '🛡️ โล่เกือบแตก', '🛡️ รับแรงกระแทก', '🛡️ กันได้ไม่หมด','🛡️ อุ้ย! เบาจัง'];
            const isnoneblock = ['😑 โดนเต็มๆ','😵 ถูกโจมตีไม่ยั้ง','😖 ถูกโจมตีโดยไม่ทันตั้งตัว','🫣 โดนโจมตีทีเผลอ','😯 ยืนรับการโจมตีอย่างองอาจ'];


        let defenseResponse = { 
            defenderUid: playerRef.key, 
            attackerKey: attackData.attackerKey, 
            attackRollValue: attackData.attackRollValue,
            damageTaken: 0 
        };
        let feedbackTitle = '', feedbackHtml = '';
        const roomId = sessionStorage.getItem('roomId');
        const updates = {};
        
        if (result.isConfirmed) { 
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
                feedbackTitle = getRandomWord(blockPerfectTitles);
                feedbackHtml = `รับไว้ได้ทั้งหมด! (ลด ${damageReduction})`;
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_SUCCESS', { damageReduced: initialDamage, weaponSlot: blockSlot });
            } else {
                feedbackTitle = getRandomWord(blockPartialTitles);
                feedbackHtml = `ลดไป ${damageReduction} (โดน <strong>${damageTaken}</strong>)`;
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_SUCCESS', { damageReduced: damageReduction, weaponSlot: blockSlot });
                applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_FAIL', { damageTaken });
            }

        } else if (result.isDenied) { 
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
            // สุ่มหัวข้อและคำบรรยาย
            feedbackTitle = getRandomWord(dodgeSuccessTitles);
            const randomDesc = getRandomWord(dodgeSuccessDescs);

            // นำคำที่สุ่มได้ มาต่อกับค่าตัวเลขเดิม
            feedbackHtml = `${randomDesc} (${totalDodge} vs ${attackData.attackRollValue})`;
            
            defenseResponse.damageTaken = 0;
            defenseResponse.success = true;

        } else {
            // สุ่มหัวข้อและคำบรรยาย
            feedbackTitle = getRandomWord(dodgeFailTitles);
            const randomDesc = getRandomWord(dodgeFailDescs);

            // นำคำที่สุ่มได้ มาต่อกับค่าตัวเลขและความเสียหาย
            feedbackHtml = `${randomDesc} (${totalDodge} vs ${attackData.attackRollValue})<br>โดน <strong>${initialDamage}</strong>`;
            
            defenseResponse.damageTaken = initialDamage;
            defenseResponse.success = false;
            applyDurabilityDamage(updates, playerData.equippedItems, 'BLOCK_FAIL', { damageTaken: initialDamage });
        }

        } else { 
            defenseResponse.choice = 'none';
            feedbackTitle = getRandomWord(isnoneblock);
            feedbackHtml = `รับความเสียหาย <strong>${initialDamage}</strong>`;
            defenseResponse.damageTaken = initialDamage;
            applyDurabilityDamage(updates, playerData.equippedItems, 'TAKE_HIT', { damageTaken: initialDamage });
        }

        Swal.fire({ title: feedbackTitle, html: feedbackHtml, icon: 'info', timer: 3500, showConfirmButton: false });
        
        await db.ref(`rooms/${roomId}/combat/resolution`).set(defenseResponse);
        if (Object.keys(updates).length > 0) await playerRef.update(updates);
        await playerRef.child('pendingAttack').remove();
    });
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
            if (s.exists() && !Swal.isVisible() && combatState && combatState.isActive) {
                 handlePendingAttack(s.val(), playerRef);
            } else if (!s.exists() && Swal.isVisible() && Swal.getTitle() && Swal.getTitle().includes('โจมตี')) {
                Swal.close();
            }
        });

    } else {
        window.location.replace('login.html');
    }
});