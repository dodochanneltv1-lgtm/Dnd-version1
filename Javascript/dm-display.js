
// =================================================================================


function getUidByName(playerName) {
    for (const uid in allPlayersDataByUID) {
        if (allPlayersDataByUID[uid].name === playerName) return uid;
    }
    return null;
}

function resetPlayerEditor() {
    document.getElementById("playerEditor").querySelectorAll('input, select, textarea').forEach(el => {
        if (el.type === 'number') el.value = 0;
        else if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
    });
    document.getElementById("editName").value = '';
    document.getElementById("editLevel").textContent = 'N/A';
    document.getElementById("editFreeStatPoints").textContent = 'N/A';
    displayPlayerSummary(null);
}

function loadPlayer() {
    const selectedPlayerName = document.getElementById("playerSelect").value;
    const uid = getUidByName(selectedPlayerName);
    const player = allPlayersDataByUID[uid];

    if (!selectedPlayerName || !player) {
        resetPlayerEditor();
        return;
    }

    document.getElementById("editName").value = player.name;
    document.getElementById("editRace").value = player.race || "มนุษย์";
    document.getElementById("editRaceEvolved").value = player.raceEvolved || ""; 
    document.getElementById("editGender").value = player.gender || "ไม่ระบุ";
    document.getElementById("editAge").value = player.info?.age || ""; 
    document.getElementById("editClassMain").value = player.classMain || "นักรบ"; 
    document.getElementById("editClassSub").value = player.classSub || ""; 
    document.getElementById("editBackground").value = player.background || "";
    document.getElementById("editGP").value = player.gp || 0; 

    document.getElementById("editHeight").value = player.info?.height || "";
    document.getElementById("editWeight").value = player.info?.weight || "";
    document.getElementById("editAppearance").value = player.info?.appearance || "";
    document.getElementById("editPersonality").value = player.info?.personality || "";
    document.getElementById("editLikes").value = player.info?.likes || "";
    document.getElementById("editDislikes").value = player.info?.dislikes || "";
    
    document.getElementById("editHp").value = player.hp;
    document.getElementById("editLevel").textContent = player.level || 1;
    document.getElementById("editFreeStatPoints").textContent = player.freeStatPoints || 0;
    
    let tempLevel = 0;
    if (Array.isArray(player.activeEffects)) {
         player.activeEffects.forEach(effect => {
             if (effect.stat === 'Level' && effect.modType === 'FLAT') tempLevel += (effect.amount || 0);
         });
    }
    document.getElementById("tempLevelInput").value = tempLevel;

    const statsKeys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'EM'];
    const classMainData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[player.classMain] : null;
    const classSubData = (typeof CLASS_DATA !== 'undefined') ? CLASS_DATA[player.classSub] : null;
            
    statsKeys.forEach(stat => {
        document.getElementById(`edit${stat}Race`).value = player.stats ?.baseRaceStats ?.[stat] || 0;
        let classBonus = 0;
        if (classMainData && classMainData.bonuses) classBonus += (classMainData.bonuses[stat] || 0);
        if (classSubData && classSubData.bonuses) classBonus += (classSubData.bonuses[stat] || 0);
        document.getElementById(`edit${stat}Class`).value = classBonus; 
        document.getElementById(`edit${stat}Invested`).value = player.stats ?.investedStats ?.[stat] || 0;
        document.getElementById(`edit${stat}Temp`).value = player.stats ?.tempStats ?.[stat] || 0;
        updateStatTotals(stat); 
    });

    displayPlayerSummary(player); 
    loadItemLists(player);
}

function updateStatTotals(statKey) {
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    if (!uid || !allPlayersDataByUID[uid]) return;

    const tempPlayer = JSON.parse(JSON.stringify(allPlayersDataByUID[uid]));
    const tempValue = parseInt(document.getElementById(`edit${statKey}Temp`).value) || 0;

    if (!tempPlayer.stats) tempPlayer.stats = {};
    if (!tempPlayer.stats.tempStats) tempPlayer.stats.tempStats = {};
    tempPlayer.stats.tempStats[statKey] = tempValue;
    
    document.getElementById(`edit${statKey}Total`).value = calculateTotalStat(tempPlayer, statKey);
}

function displayPlayerSummary(player) {
    const output = document.getElementById("playerSummaryPanel");
    if (!output) return;

    if (!player) {
        output.innerHTML = "<h3>สรุปข้อมูลตัวละคร</h3><p>โปรดเลือกผู้เล่นเพื่อดูสรุปข้อมูล</p>";
        return;
    }

    // const finalCon = calculateTotalStat(player, 'CON');
    const maxHpNew = calculateMaxHp(player);
    let currentHp = player.hp;

    let htmlContent = `<h3>สรุปข้อมูลตัวละคร: ${player.name}</h3><hr>`;
    htmlContent += `<p><strong>เผ่า:</strong> ${player.raceEvolved || player.race}</p>`;
    htmlContent += `<p><strong>อาชีพหลัก:</strong> ${player.classMain}</p>`;
    htmlContent += `<p><strong>อาชีพรอง:</strong> ${player.classSub || '-'}</p><hr>`;
    
    const permanentLevel = player.level || 1;
    let tempLevel = 0;
    if (Array.isArray(player.activeEffects)) {
         player.activeEffects.forEach(effect => {
             if (effect.stat === 'Level' && effect.modType === 'FLAT') tempLevel += (effect.amount || 0);
         });
    }
    const levelDisplay = tempLevel > 0 ? `${permanentLevel} <span style="color: #00ff00;">(+${tempLevel})</span>` : permanentLevel;
    htmlContent += `<p><strong>ระดับ (Level):</strong> ${levelDisplay}</p>`;
    htmlContent += `<p><strong>GP:</strong> ${player.gp || 0}</p><hr>`;
    
    const hpColor = currentHp <= 0 ? 'red' : 'inherit';
    const hpText = currentHp <= 0 ? 'เสียชีวิต (0)' : currentHp;
    htmlContent += `<p style="color:${hpColor}; font-weight:bold;"><strong>HP:</strong> ${hpText} / ${maxHpNew}</p>`;
    
    // แสดง Stats
    htmlContent += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:10px;">`;
    for (const stat of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'EM']) {
        const val = calculateTotalStat(player, stat);
        htmlContent += `<div><strong>${stat}:</strong> ${val}</div>`;
    }
    htmlContent += `</div>`;

    // --- [เพิ่ม] แสดงอุปกรณ์สวมใส่ ---
    htmlContent += `<hr><h4>🛡️ อุปกรณ์สวมใส่</h4><ul style="font-size: 0.9em; padding-left: 20px;">`;
    const slots = { mainHand: 'มือหลัก', offHand: 'มือรอง', head: 'หัว', chest: 'ตัว', legs: 'ขา', feet: 'เท้า' };
    let hasEquip = false;
    if (player.equippedItems) {
        for (const [key, label] of Object.entries(slots)) {
            const item = player.equippedItems[key];
            if (item) {
                hasEquip = true;
                const duraText = item.durability !== undefined ? ` [${item.durability}%]` : '';
                htmlContent += `<li><strong>${label}:</strong> ${item.name}${duraText}</li>`;
            }
        }
    }
    if (!hasEquip) htmlContent += `<li><em>ตัวเปล่า</em></li>`;
    htmlContent += `</ul>`;

    // --- [เพิ่ม] แสดงกระเป๋า ---
    htmlContent += `<hr><h4>🎒 กระเป๋า</h4><ul style="font-size: 0.9em; padding-left: 20px; max-height: 100px; overflow-y: auto;">`;
    if (player.inventory && player.inventory.length > 0) {
        player.inventory.forEach(item => {
            htmlContent += `<li>${item.name} (x${item.quantity})</li>`;
        });
    } else {
        htmlContent += `<li><em>กระเป๋าว่างเปล่า</em></li>`;
    }
    htmlContent += `</ul>`;

    // แสดง Active Effects (เดิม)
    const effects = player.activeEffects || [];
    if(effects.length > 0) {
        htmlContent += `<hr><h4>Active Effects:</h4><ul>`;
        effects.forEach(effect => {
             const modText = effect.modType === 'PERCENT' ? `${effect.amount}%` : `${effect.amount}`;
             htmlContent += `<li>${effect.name}: ${effect.stat} ${modText} (${effect.turnsLeft} เทิร์น)</li>`;
        });
        htmlContent += `</ul>`;
    }

    if (player.quest && player.quest.title) {
        htmlContent += `<div style="border: 1px solid #ffc107; padding: 10px; margin-top: 15px; border-radius: 5px; background-color: #ffc1071a;">
            <h4>📜 เควสปัจจุบัน: ${player.quest.title}</h4>
            <button onclick="completeQuest()" style="background-color: #28a745; width: 49%;">🏆 สำเร็จ</button>
            <button onclick="cancelQuest()" style="background-color: #dc3545; width: 49%; margin-left: 2%;">❌ ยกเลิก</button>
        </div>`;
    }
    
    output.innerHTML = htmlContent;
}

function loadItemLists(player) {
    const items = player ?.inventory || [];
    const itemSelect = document.getElementById("itemSelect");
    itemSelect.innerHTML = "";
    if (items.length === 0) {
        itemSelect.innerHTML = "<option disabled>ไม่มีไอเทม</option>";
        return;
    }
    items.forEach((item, index) => {
        itemSelect.innerHTML += `<option value="${index}">${item.name} (x${item.quantity})</option>`;
    });
}
function displayDiceLog(logs, logElementId) {
    const logList = document.getElementById(logElementId);
    logList.innerHTML = `<li>ไม่มีบันทึก</li>`;
    if (!logs) return;
    const logArray = Object.values(logs).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (logArray.length > 0) logList.innerHTML = "";
    logArray.slice(0, 15).forEach(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('th-TH');
        let message = `[${time}] ${log.name}: ${log.message}`;
        if (log.type === 'general' || !log.type) {
            const total = log.result.reduce((a, b) => a + b, 0);
            message = `[${time}] ${log.name} ทอย ${log.count}d${log.dice}: [${log.result.join(', ')}] รวม: ${total}`;
        }
        const color = log.type === 'damage' ? '#ff4d4d' : (log.type === 'attack' ? '#17a2b8' : '#fff');
        logList.innerHTML += `<li style="color:${color};">${message}</li>`;
    });
}
function displayAllEnemies(enemies) {
    const container = document.getElementById('enemyListContainer');
    container.innerHTML = '';

    if (!enemies || Object.keys(enemies).length === 0) {
        container.innerHTML = '<p>ยังไม่มีคู่ต่อสู้ในฉากนี้</p>';
        return;
    }

    // ✅ รองรับทั้ง string (ของเก่า) และ int (ของใหม่)
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
            1: '🔥',
            2: '💧',
            4: '⚡',
            8: '🪨',
            16: '🌪️',
            32: '❄️',
            64: '✨',
            128: '🌑'
        };
        return mapInt[element] || String(element);
    }

    const createEffectBadges = (effects) => {
        if (!effects) return '';
        const list = Array.isArray(effects) ? effects : Object.values(effects);
        if (!list || list.length === 0) return '';
        return list.map(e => {
            const color = (e.type === 'BUFF' || e.type === 'HOT') ? '#28a745' : '#dc3545';
            return `<span style="color:${color}; font-size:0.8em; margin-right:5px;">[${e.name}]</span>`;
        }).join('');
    };

    for (const key in enemies) {
        const enemy = enemies[key];

        const isDead = (enemy.hp || 0) <= 0;
        const opacityStyle = isDead ? 'opacity:0.5; filter:grayscale(1);' : '';

        const target = allPlayersDataByUID?.[enemy.targetUid] ? allPlayersDataByUID[enemy.targetUid] : null;

        // ===== elementSlots =====
        let elementHtml = '';
        if (enemy.elementSlots && (enemy.elementSlots.e1 || enemy.elementSlots.e2)) {
            const e1 = enemy.elementSlots.e1 ? getElementIcon(enemy.elementSlots.e1) : '⚪';
            const e2 = enemy.elementSlots.e2 ? getElementIcon(enemy.elementSlots.e2) : '⚪';
            elementHtml = `
                <span style="background:rgba(0,0,0,0.6); border:1px solid #555; border-radius:4px; padding:2px 6px; margin-left:8px; font-size:0.85em; cursor:help; vertical-align: middle;"
                      title="Reaction Slots (ช่องธาตุ)">
                    ${e1} <span style="color:#666">|</span> ${e2}
                </span>
            `;
        }

        // ===== activeEffects =====
        const effectsHtml = createEffectBadges(enemy.activeEffects);

        const enemyDiv = document.createElement('div');
        enemyDiv.className = 'enemy-list-item';
        enemyDiv.style.cssText = `border-bottom: 1px solid #444; padding: 8px; ${opacityStyle}`;

        enemyDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:bold; color:#ffc107;">
                        ${enemy.name || 'Enemy'} ${elementHtml}
                    </div>

                    <div style="font-size:0.9em; color:#ddd; margin-top:2px;">
                        <strong>HP:</strong> ${(enemy.hp ?? 0)} / ${(enemy.maxHp ?? enemy.hp ?? 0)}
                    </div>

                    <div style="font-size:0.85em; color:#ccc; margin-top:2px;">
                        <strong>สถานะ:</strong> ${effectsHtml || '-'}
                    </div>

                    ${target ? `
                        <div style="font-size:0.85em; color:#bbb; margin-top:2px;">
                            <strong>กำลังเล็ง:</strong> ${target.name || enemy.targetUid}
                        </div>
                    ` : ''}
                </div>

                <div style="display:flex; gap:6px; align-items:center;">
                    <button onclick="moveEnemy('${key}')" style="background-color:#fd7e14; padding:4px 8px; font-size:0.8em; width:auto; border-radius:4px;">ย้าย</button>
                    <button onclick="deleteEnemy('${key}')" style="background-color:#c82333; padding:4px 8px; font-size:0.8em; width:auto; border-radius:4px;">ลบ</button>
                </div>
            </div>
        `;

        container.appendChild(enemyDiv);
    }
}

// =================================================================================
//
