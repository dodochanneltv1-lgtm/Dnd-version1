

/* ฟังก์ชันสำหรับใช้ไอเทมบริโภค (Consumable) */
async function useConsumableItem(itemIndex) {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!uid || !roomId) return showCustomAlert('ข้อมูลไม่ครบถ้วน!', 'error');

    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
    
    try {
        await playerRef.transaction(currentData => {
            if (!currentData || !currentData.inventory || !currentData.inventory[itemIndex]) return; 

            const oldCon = calculateTotalStat(currentData, 'CON');
            const oldMaxHp = calculateHP(currentData.race, currentData.classMain, oldCon);
            const hpRatio = oldMaxHp > 0 ? ((currentData.hp || 0) / oldMaxHp) : 0;

            const item = currentData.inventory[itemIndex]; 
            const effects = item.effects; 
            
            if (effects && effects.permStats) {
                if (!currentData.stats) currentData.stats = {};
                if (!currentData.stats.investedStats) currentData.stats.investedStats = {};
                effects.permStats.forEach(mod => {
                    currentData.stats.investedStats[mod.stat] = (currentData.stats.investedStats[mod.stat] || 0) + mod.amount;
                });
            }
            if (effects && effects.tempStats) {
                if (!currentData.activeEffects) currentData.activeEffects = [];
                effects.tempStats.forEach(mod => {
                    currentData.activeEffects.push({
                        skillId: `item_${item.name.replace(/\s/g, '_')}`, name: `(ยา) ${item.name}`,
                        type: 'BUFF', stat: mod.stat, modType: 'FLAT', amount: mod.amount, turnsLeft: mod.turns
                    });
                });
            }

            if (item.quantity > 1) item.quantity--;
            else currentData.inventory.splice(itemIndex, 1);

            const newCon = calculateTotalStat(currentData, 'CON');
            const newMaxHp = calculateHP(currentData.race, currentData.classMain, newCon);
            let newHp = Math.floor(newMaxHp * hpRatio);
            
            if (effects && effects.heal && effects.heal > 0) newHp += effects.heal;
            
            currentData.maxHp = newMaxHp;
            if (newHp > newMaxHp) newHp = newMaxHp;
            currentData.hp = newHp;
            
            return currentData;
        });
        showCustomAlert(`ใช้งานไอเทมสำเร็จ!`, 'success');
    } catch (error) {
        console.error(error);
        showCustomAlert(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
    }
}

/* 2. สวมใส่ไอเทม (Equip) - รักษา % HP */
async function equipItem(itemIndex) {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!uid || !roomId) return; 
    
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`); 
    try {
        const res = await playerRef.transaction(charData => {
            if (!charData) return; 
            const oldCon = calculateTotalStat(charData, 'CON');
            const oldMaxHp = calculateHP(charData.race, charData.classMain, oldCon);
            const hpRatio = oldMaxHp > 0 ? ((charData.hp || 0) / oldMaxHp) : 0;

            let { inventory = [], equippedItems = {} } = charData; 
            if (itemIndex < 0 || itemIndex >= inventory.length) return;
            
            const itemToEquip = { ...inventory[itemIndex] };
            let targetSlot = itemToEquip.itemType === 'อาวุธ' ? 
                ((!equippedItems['mainHand'] || equippedItems['mainHand'].durability <= 0) ? 'mainHand' : 'offHand') : itemToEquip.slot;
            if (itemToEquip.itemType !== 'อาวุธ') targetSlot = itemToEquip.slot; 

            if (!targetSlot) return;

            if (equippedItems[targetSlot]) {
                let itemToReturn = { ...equippedItems[targetSlot] };
                itemToReturn = { ...itemToReturn, bonuses: { ...(itemToReturn.originalBonuses || itemToReturn.bonuses) }, quantity: 1 };
                delete itemToReturn.isProficient; delete itemToReturn.isOffHand;
                let existingIdx = inventory.findIndex(i => i.name === itemToReturn.name);
                if (existingIdx > -1) inventory[existingIdx].quantity++;
                else inventory.push(itemToReturn);
            }
            
            equippedItems[targetSlot] = { ...itemToEquip, quantity: 1 };
            if (inventory[itemIndex].quantity > 1) inventory[itemIndex].quantity--;
            else inventory.splice(itemIndex, 1);
            
            charData.inventory = inventory;
            charData.equippedItems = equippedItems;

            const newCon = calculateTotalStat(charData, 'CON');
            const newMaxHp = calculateHP(charData.race, charData.classMain, newCon);
            charData.maxHp = newMaxHp;
            charData.hp = Math.floor(newMaxHp * hpRatio);
            return charData; 
        }); 
        if (res.committed) showCustomAlert(`สวมใส่สำเร็จ!`, 'success'); 
    } catch (error) { console.error(error); }
}

/* 3. ถอดไอเทม (Unequip) - รักษา % HP [แก้บั๊กเลือดเด้ง] */
async function unequipItem(slot) {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!uid || !roomId) return; 
    
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`); 
    await playerRef.transaction(charData => {
        if (!charData) return;
        const oldCon = calculateTotalStat(charData, 'CON');
        const oldMaxHp = calculateHP(charData.race, charData.classMain, oldCon);
        const hpRatio = oldMaxHp > 0 ? ((charData.hp || 0) / oldMaxHp) : 0;

        let { inventory = [], equippedItems = {} } = charData; 
        const itemToUnequip = equippedItems[slot]; 
        if (!itemToUnequip) return; 

        const baseItem = { ...itemToUnequip, bonuses: { ...(itemToUnequip.originalBonuses || itemToUnequip.bonuses) }, quantity: 1 }; 
        delete baseItem.isProficient; delete baseItem.isOffHand; 
        
        let existingIdx = inventory.findIndex(i => i.name === baseItem.name);
        if (existingIdx > -1) inventory[existingIdx].quantity++; 
        else inventory.push(baseItem); 
        
        equippedItems[slot] = null; 
        charData.inventory = inventory;
        charData.equippedItems = equippedItems;

        const newCon = calculateTotalStat(charData, 'CON');
        const newMaxHp = calculateHP(charData.race, charData.classMain, newCon);
        charData.maxHp = newMaxHp;
        charData.hp = Math.floor(newMaxHp * hpRatio);
        return charData;
    });
    showCustomAlert(`ถอดอุปกรณ์แล้ว`, 'info'); 
}


// =================================================================
// ----------------- ตรรกะสกิล (SKILL LOGIC) -----------------
// =================================================================

/* จบเทิร์นผู้เล่น */
async function endPlayerTurn(uid, roomId) {
    try {
        const combatRef = db.ref(`rooms/${roomId}/combat`);
        const snapshot = await combatRef.get();
        const combatState = snapshot.val();
        if (!combatState || !combatState.isActive) return;

        let nextIndex = (combatState.currentTurnIndex + 1) % combatState.turnOrder.length;
        // Logic ข้ามคนที่ตายแล้วจะอยู่ใน dm-combat.js (advanceTurn) 
        // แต่ฝั่งผู้เล่นเราแค่ดัน index ไปข้างหน้าเพื่อให้ DM จัดการต่อ หรือจะข้ามเองก็ได้
        // เพื่อความง่าย ให้แค่ดัน index แล้วให้ DM/System ตรวจสอบคนตาย
        
        await combatRef.child('currentTurnIndex').set(nextIndex);
    } catch (error) { console.error(error); }
}
async function advanceCombatTurn(roomId) {
    const combatRef = db.ref(`rooms/${roomId}/combat`);
    const snapshot = await combatRef.get();
    const combatState = snapshot.val();
    if (!combatState || !combatState.isActive) return;

    let nextIndex = (combatState.currentTurnIndex + 1) % combatState.turnOrder.length;
    const maxSkips = combatState.turnOrder.length;
    let skips = 0;

    // ตรวจสอบคนตายเพื่อข้าม
    const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
    const enemiesSnap = await db.ref(`rooms/${roomId}/enemies`).get();
    const playersData = playersSnap.val() || {};
    const enemiesData = enemiesSnap.val() || {};

    while (skips < maxSkips) {
        const nextUnit = combatState.turnOrder[nextIndex];
        let isDead = false;
        if (nextUnit.type === 'player') isDead = (playersData[nextUnit.id]?.hp || 0) <= 0;
        else if (nextUnit.type === 'enemy') isDead = (enemiesData[nextUnit.id]?.hp || 0) <= 0;

        if (isDead) {
            nextIndex = (nextIndex + 1) % combatState.turnOrder.length;
            skips++;
        } else break;
    }

    if (skips === maxSkips) {
        await db.ref(`rooms/${roomId}/combat`).remove(); // จบการต่อสู้
        return;
    }

    // อัปเดตเทิร์น
    await combatRef.child('currentTurnIndex').set(nextIndex);
}

function checkCooldown(casterData, skill) {
    if (!skill.cooldown && !skill.successCooldown) return null; 
    const cdData = casterData.skillCooldowns || {};
    const skillName = skill.name;
    if (skill.cooldown && skill.cooldown.type === 'PERSONAL') {
        const cdInfo = cdData[skill.id];
        if (cdInfo && cdInfo.type === 'PERSONAL' && cdInfo.turnsLeft > 0) return `สกิล ${skillName} ยังติดคูลดาวน์! (รอ ${cdInfo.turnsLeft} เทิร์น)`;
    }
    if (skill.cooldown && skill.cooldown.type === 'PER_COMBAT') {
        const cdInfo = cdData[skill.id];
        if (cdInfo && cdInfo.type === 'PER_COMBAT' && cdInfo.usesLeft <= 0) return `สกิล ${skillName} ใช้ได้ ${skill.cooldown.uses} ครั้งต่อการต่อสู้ (ใช้ครบแล้ว)`;
    }
    return null; 
}

async function setCooldown(casterRef, skill, failed = false) {
    if (failed) {
        if (skill.successRoll && skill.successRoll.failCooldown) {
            const turns = skill.successRoll.failCooldown.turns || 3;
            const newCd = { type: 'PERSONAL', turnsLeft: turns };
            await casterRef.child('skillCooldowns').child(skill.id).set(newCd);
        }
        return;
    }
    if (skill.cooldown) {
        if (skill.cooldown.type === 'PERSONAL') {
            const turns = skill.cooldown.turns;
            const newCd = { type: 'PERSONAL', turnsLeft: turns };
            await casterRef.child('skillCooldowns').child(skill.id).set(newCd);
        }
        else if (skill.cooldown.type === 'PER_COMBAT') {
            await casterRef.child('skillCooldowns').child(skill.id).transaction(cdInfo => {
                if (!cdInfo) return { type: 'PER_COMBAT', usesLeft: skill.cooldown.uses - 1 };
                cdInfo.usesLeft = (cdInfo.usesLeft || skill.cooldown.uses) - 1;
                return cdInfo;
            });
        }
    }
}

/* ระบบทอยสำเร็จสกิล (Skill Success Roll) */
async function performSuccessRoll(casterData, targetData, skill, options) {
    if (!skill.successRoll) return { success: true, rollData: {} };
    const diceType = skill.successRoll.check || 'd20';
    const diceSize = parseInt(diceType.replace('d', ''));
    const casterRoll = Math.floor(Math.random() * diceSize) + 1;
    const casterStatVal = calculateTotalStat(casterData, skill.scalingStat || 'WIS');
    const casterBonus = (diceSize === 20) ? getStatBonus(casterStatVal) : 0;
    let totalCasterRoll = casterRoll + casterBonus;
    let dc = skill.successRoll.dc || 10; 
    
    let resultText = `คุณทอย (${diceType}): ${casterRoll} + โบนัส: ${casterBonus} = **${totalCasterRoll}**<br>`;
    if (skill.successRoll.resistStat && targetData) {
        const targetStatVal = (targetData.type === 'enemy') ? (targetData.stats?.[skill.successRoll.resistStat.toUpperCase()] || 10) : calculateTotalStat(targetData, skill.successRoll.resistStat);
        const targetBonus = getStatBonus(targetStatVal);
        dc += targetBonus; 
        resultText += `ค่าความยาก (DC): ${dc} (Resist Bonus ${targetBonus})`;
    } else {
        resultText += `ค่าความยาก (DC): **${dc}**`;
    }
    const success = totalCasterRoll >= dc;
    await Swal.fire({ title: success ? 'สกิลทำงานสำเร็จ!' : 'สกิลล้มเหลว!', html: resultText, icon: success ? 'success' : 'error' });
    return { success, rollData: { casterRoll: casterRoll, dc } };
}

async function useSkillOnTarget(skillId, targetId, options = {}) {
    const casterUid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!casterUid || !roomId) { showAlert('ข้อมูลไม่ครบถ้วน!', 'error'); return; }

    const combatSnap = await db.ref(`rooms/${roomId}/combat`).get();
    const currentCombatState = combatSnap.val() || {};
    
    // เช็คเทิร์น (ถ้าอยู่ใน Combat)
    if (currentCombatState.isActive && currentCombatState.turnOrder[currentCombatState.currentTurnIndex].id !== casterUid) {
        return showAlert('ยังไม่ถึงเทิร์นของคุณ!', 'warning');
    }

    const casterData = (typeof allPlayersInRoom !== 'undefined' && allPlayersInRoom) ? allPlayersInRoom[casterUid] : null; 
    if (!casterData) { showAlert('ไม่พบข้อมูลผู้ใช้ปัจจุบัน!', 'error'); return; } 
    if (!casterData.uid) casterData.uid = casterUid; 
    
    // ค้นหาสกิลจากทุกแหล่ง (Main, Sub, Race)
    let combinedSkills = [];
    if (typeof SKILL_DATA !== 'undefined') {
        if (casterData.classMain && SKILL_DATA[casterData.classMain]) combinedSkills.push(...(SKILL_DATA[casterData.classMain] || []));
        if (casterData.classSub && SKILL_DATA[casterData.classSub]) combinedSkills.push(...(SKILL_DATA[casterData.classSub] || []));
    }
    if (typeof RACE_DATA !== 'undefined') {
        const raceId = casterData.raceEvolved || casterData.race;
        if (RACE_DATA[raceId] && RACE_DATA[raceId].skills) {
            RACE_DATA[raceId].skills.forEach(id => {
                if(SKILL_DATA[id]) combinedSkills.push(SKILL_DATA[id]);
            });
        }
    }

    const skill = combinedSkills.find(s => s.id === skillId);
    if (!skill) { showAlert('ไม่พบสกิล!', 'error'); return; } 
    
    const casterRef = db.ref(`rooms/${roomId}/playersByUid/${casterUid}`); 
    let targetData = null; 
    let targetRef = null;
    let targetType = 'single'; // single, enemy_all, teammate_all

    // -------------------------------------------------------------
    // [แก้ไข Logic การเลือกเป้าหมายให้ถูกต้อง]
    // -------------------------------------------------------------

    // กรณี 1: สกิลหมู่ (AoE / All)
    if (skill.targetType.includes('_all') || skill.targetType.includes('_aoe') || skill.targetType === 'all') { 
         
         Swal.fire({ title: `กำลังร่าย ${skill.name}...`, text: `เป้าหมาย: พื้นที่ทั้งหมด!`, icon: 'info', timer: 1500 });
         
         if (skill.targetType.includes('enemy')) targetType = 'enemy_all';
         else if (skill.targetType.includes('teammate')) targetType = 'teammate_all';
         else targetType = 'all'; // เช่น Demon Lord Skill
    } 
    // กรณี 2: สกิลใส่ตัวเอง
    else if (skill.targetType === 'self' || targetId === casterUid) { 
        targetData = { ...casterData }; 
        if(!targetData.type) targetData.type = 'player'; 
        targetRef = casterRef; 
    }
    // กรณี 3: สกิลใส่ศัตรู (เดี่ยว)
    else if (skill.targetType.includes('enemy')) { 
        if (currentCombatState.type === 'PVP') {
            targetData = (typeof allPlayersInRoom !== 'undefined') ? allPlayersInRoom[targetId] : null;
            if (!targetData) { showAlert('ไม่พบข้อมูลคู่ต่อสู้ (PvP)!', 'error'); return; }
            targetData = { ...targetData, type: 'player' }; 
            targetRef = db.ref(`rooms/${roomId}/playersByUid/${targetId}`); 
        } else {
            targetData = (typeof allEnemiesInRoom !== 'undefined') ? allEnemiesInRoom[targetId] : null; 
            if (!targetData) { showAlert('ไม่พบข้อมูลมอนสเตอร์!', 'error'); return; } 
            targetData = { ...targetData, type: 'enemy' }; 
            targetRef = db.ref(`rooms/${roomId}/enemies/${targetId}`); 
        }
    }
    // กรณี 4: สกิลใส่เพื่อน (เดี่ยว)
    else if (skill.targetType.includes('teammate')) {
        targetData = (typeof allPlayersInRoom !== 'undefined') ? allPlayersInRoom[targetId] : null;
        if (!targetData) { showAlert('ไม่พบข้อมูลเพื่อนร่วมทีม!', 'error'); return; }
        targetData = { ...targetData, type: 'player' };
        targetRef = db.ref(`rooms/${roomId}/playersByUid/${targetId}`);
    }
    
    // ตรวจสอบ Cooldown
    const cdError = checkCooldown(casterData, skill); 
    if (cdError) { showAlert(cdError, 'warning'); return; }

    try {
        // ทอยความสำเร็จ (Success Roll) ถ้ามี
        const { success, rollData } = await performSuccessRoll(casterData, targetData, skill, options); 
        if (!success) { 
            await setCooldown(casterRef, skill, true); 
            await endPlayerTurn(casterUid, roomId); 
            return; 
        }

        let skillOutcome = null;
        const effectOptions = { ...options, rollData: rollData };
        
        // -------------------------------------------------------------
        // [แก้ไข Logic การ Apply Effect]
        // -------------------------------------------------------------

        // ถ้าเป็นสกิลหมู่ -> วนลูปใส่ทุกคน
        if (targetType === 'enemy_all' || targetType === 'teammate_all' || targetType === 'all') {
            const targetsToHit = [];
            
            // รวมเป้าหมายตามประเภท
            if (targetType === 'enemy_all' || targetType === 'all') {
                if (currentCombatState.type === 'PVP') {
                    // PvP AoE: ศัตรูคือทุกคนที่ไม่ใช่เรา
                    for (const pid in allPlayersInRoom) {
                        if (pid !== casterUid) targetsToHit.push({ id: pid, type: 'player', refPath: 'playersByUid' });
                    }
                } else {
                    // PvE AoE: ศัตรูคือมอนสเตอร์
                    for (const eid in allEnemiesInRoom) {
                        targetsToHit.push({ id: eid, type: 'enemy', refPath: 'enemies' });
                    }
                }
            }
            if (targetType === 'teammate_all' || targetType === 'all') {
                for (const pid in allPlayersInRoom) {
                    if (skill.targetType === 'teammate_all' && pid === casterUid) continue; // บางสกิลไม่รวมตัวเอง
                    targetsToHit.push({ id: pid, type: 'player', refPath: 'playersByUid' });
                }
            }

            // วนลูปยิง Effect
            for (const t of targetsToHit) {
                const tData = (t.type === 'player' ? allPlayersInRoom[t.id] : allEnemiesInRoom[t.id]);
                const tRef = db.ref(`rooms/${roomId}/${t.refPath}/${t.id}`);
                await applyEffect(casterRef, tRef, casterData, { ...tData, type: t.type }, skill, effectOptions);
            }
            skillOutcome = { statusApplied: `ส่งผลต่อเป้าหมายทั้งหมด (${targetsToHit.length} ตัว)` };
            
        } else if (targetRef) {
            // สกิลเดี่ยว -> ยิงใส่เป้าหมายเดียว
            skillOutcome = await applyEffect(casterRef, targetRef, casterData, targetData, skill, effectOptions);
        }

        // Effect เสริมใส่ตัวเอง (เช่น ลดเลือดคนร่าย)
        if (skill.selfEffect) {
            await applyEffect(casterRef, casterRef, casterData, casterData, { ...skill, effect: skill.selfEffect }, effectOptions);
        }
        
        // แสดงผลลัพธ์
        const isSelfBuff = (skill.targetType === 'self' && (skill.skillType === 'BUFF' || skill.skillType === 'BUFF_DEBUFF'));

        Swal.fire({
            title: `ใช้สกิล ${skill.name} สำเร็จ!`,
            text: isSelfBuff ? "คุณได้รับบัฟแล้ว และยังสามารถโจมตีต่อได้!" : (skillOutcome?.statusApplied || `ผลลัพธ์: สำเร็จ`),
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });
        
        // ติด Cooldown
        await setCooldown(casterRef, skill, false);

        // จบเทิร์น (ยกเว้นสกิลบัฟตัวเอง)
        if (isSelfBuff) {
            const indicator = document.getElementById('turnIndicator');
            if(indicator) {
                indicator.textContent = "⚡ ใช้บัฟแล้ว! ยังโจมตีได้! ⚡";
                indicator.style.backgroundColor = "#ffc107";
                indicator.style.color = "#000";
            }
        } else {
            await endPlayerTurn(casterUid, roomId); 
        }
         
    } catch (error) { 
        console.error("Error applying skill effect:", error); 
        showAlert('เกิดข้อผิดพลาดร้ายแรง: ' + error.message, 'error'); 
        // await endPlayerTurn(casterUid, roomId); // เอาออกเผื่ออยากลองใหม่
    }
}


/* ฟังก์ชันหลักในการใช้สกิล (Apply Skill Effect) */
async function applyEffect(casterRef, targetRef, casterData, targetData, skill, options = {}) {
    // [FIX] ประกาศ roomId ด้านนอกเพื่อให้มั่นใจว่ามีค่า
    const roomId = sessionStorage.getItem('roomId');
    const effect = skill.effect;
    let outcome = { damageDealt: 0, healAmount: 0, statusApplied: null };

    await targetRef.transaction(currentData => {
        if (currentData === null) return;
         
         // (ส่วน Init Data คงเดิม...)
         if (!currentData.type) currentData.type = targetData.type;
         if (!currentData.race && targetData.type === 'player') currentData.race = targetData.race;
         if (!currentData.classMain && targetData.type === 'player') currentData.classMain = targetData.classMain;
         if (!currentData.stats) currentData.stats = { ...(targetData.stats || {}) };
         if (!currentData.activeEffects) currentData.activeEffects = [];

        // (ส่วนกำหนด duration/amount คงเดิม...)
        const duration = effect.duration || (effect.durationDice ? (Math.floor(Math.random() * parseInt(effect.durationDice.replace('d', ''))) + 1) : 3);
        const amount = effect.amount || (effect.amountDice ? (Math.floor(Math.random() * parseInt(effect.amountDice.replace('d', ''))) + 1) : 0);
        
        // (ส่วนคำนวณ HP Ratio คงเดิม...)
        let oldMaxHp = 0;
        let hpRatio = 0;
        let conChangedInTransaction = false; 

        if (currentData.type === 'player') {
            const currentFinalCon_Before = calculateTotalStat(currentData, 'CON');
            oldMaxHp = calculateHP(currentData.race, currentData.classMain, currentFinalCon_Before);
            hpRatio = oldMaxHp > 0 ? ((currentData.hp || 0) / oldMaxHp) : 0;
        } else {
            oldMaxHp = currentData.maxHp || 100;
        }

        // [Sub-functions]
        function applyBuffDebuff() { /* ... โค้ดเดิม ... */ 
            // (ใส่โค้ด applyBuffDebuff เดิมของคุณตรงนี้ หรือใช้ของเดิมในไฟล์ได้เลย ไม่ต้องแก้)
            // เพื่อความกระชับ ผมละไว้ฐานที่เข้าใจว่าเหมือนเดิม
            switch(effect.type) {
                case 'ALL_TEMP_STAT_PERCENT': 
                case 'MULTI_TEMP_STAT_PERCENT':
                    let statsToApply = [];
                    if (effect.type === 'ALL_TEMP_STAT_PERCENT') statsToApply = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'EM'].map(s => ({ stat: s, amount: effect.amount || amount }));
                    else statsToApply = effect.stats; 

                    let buffDesc = [];
                    statsToApply.forEach(mod => {
                        currentData.activeEffects.push({ 
                            skillId: skill.id, name: skill.name, type: effect.isDebuff ? 'DEBUFF' : 'BUFF', 
                            stat: mod.stat, modType: 'PERCENT', amount: mod.amount, 
                            turnsLeft: duration 
                        });
                        buffDesc.push(`${mod.stat} ${mod.amount >= 0 ? '+' : ''}${mod.amount}%`);
                        if (mod.stat === 'CON') conChangedInTransaction = true;
                    });
                    outcome.statusApplied = `${effect.isDebuff ? 'ลด' : 'เพิ่ม'} ${buffDesc.join(', ')} (${duration} เทิร์น)`;
                    break;
                case 'TEMP_LEVEL_PERCENT': 
                    currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'TEMP_LEVEL_PERCENT', stat: 'Level', modType: 'PERCENT', amount: amount, turnsLeft: duration });
                    outcome.statusApplied = `เพิ่มเลเวล +${amount}% (${duration} เทิร์น)`;
                    conChangedInTransaction = true; 
                    break;
                case 'STATUS': 
                    if(effect.status === 'INVISIBILE') {
                        currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'BUFF', stat: 'Visibility', modType: 'SET_VALUE', amount: 'Invisible', turnsLeft: duration });
                        outcome.statusApplied = `หายตัว (${duration} เทิร์น)`; 
                    }
                    break;
                case 'WEAPON_BUFF':
                case 'WEAPON_BUFF_ELEMENTAL': {
                    const chosen =
                        (options.selectedElement && options.selectedElement[0])
                            ? options.selectedElement[0]
                            : null;

                    currentData.activeEffects.push({
                        skillId: skill.id,
                        name: skill.name,
                        type: 'WEAPON_BUFF_ELEMENTAL',   // ✅ สำคัญ: ให้ตรงชนิดจริง
                        stat: 'WeaponAttack',
                        modType: 'FORMULA',
                        buffId: effect.buffId,
                        element: chosen,                 // ✅ สำคัญ: ใส่ element ลงไป
                        turnsLeft: duration
                    });

                    outcome.statusApplied = `เคลือบอาวุธธาตุ (${chosen || '?'}) (${duration} เทิร์น)`;
                    break;
                }

                case 'ELEMENT_SELECT':
                    currentData.activeEffects = currentData.activeEffects.filter(e => e.type !== 'ELEMENTAL_BUFF');
                    (options.selectedElement || []).forEach(element => {
                        currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'ELEMENTAL_BUFF', stat: 'Element', modType: 'SET_VALUE', amount: element, turnsLeft: 999 });
                    });
                    outcome.statusApplied = `เปลี่ยนธาตุเป็น ${options.selectedElement ? options.selectedElement.join(', ') : '?'}`;
                    break;
            }
        }
        function applyHealing() { /* ... โค้ดเดิม ... */ 
             // (Heal ใช้ CurrentHP เดิม + ฮีล ไม่สน Ratio)
            const currentTheoreticalMaxHp = currentData.maxHp || oldMaxHp;
            const isUndead = currentData.race === 'อันเดด';
            const wisBonus = getStatBonus(calculateTotalStat(casterData, 'WIS'));
            let healAmount = 0;
            switch(effect.formula) {
                case 'CLERIC_HEAL_V1': healAmount = Math.floor(currentTheoreticalMaxHp * ((Math.floor(Math.random()*4)+1 + wisBonus) / 100)); break;
                case 'SAGE_HEAL_V1': healAmount = Math.floor(currentTheoreticalMaxHp * ((Math.floor(Math.random()*6)+1 + wisBonus) / 100)); break;
                case 'ARCHSAGE_HEAL_V1': 
                    const casterCon = calculateTotalStat(casterData, 'CON');
                    const casterMaxHp = calculateHP(casterData.race, casterData.classMain, casterCon);
                    healAmount = Math.floor(currentTheoreticalMaxHp * ((Math.floor(Math.random()*8)+1 + wisBonus) / 100)) + (casterMaxHp * 0.25);
                    break;
            }
            if (isUndead) {
                currentData.hp = (currentData.hp || 0) - healAmount;
                outcome.damageDealt = healAmount;
            } else {
                const healedHp = Math.min(currentTheoreticalMaxHp, (currentData.hp || 0) + healAmount) - (currentData.hp || 0); 
                currentData.hp += healedHp; 
                outcome.healAmount = healedHp; 
            }
        }
        function applyFormulaDamage() { /* ... โค้ดเดิม ... */ 
            let damage = 0;
            const targetCurrentHp = currentData.hp || 0;
            const targetMaxHp = currentData.maxHp || oldMaxHp;
            const casterRoll = options.rollData?.casterRoll || Math.floor(Math.random()*20)+1; 
            const casterSTR = getStatBonus(calculateTotalStat(casterData, 'STR'));
            const casterINT = getStatBonus(calculateTotalStat(casterData, 'INT'));
            const casterDEX = getStatBonus(calculateTotalStat(casterData, 'DEX'));
            const casterWIS = getStatBonus(calculateTotalStat(casterData, 'WIS'));

            switch(effect.formula) {
                case 'GOD_JUDGMENT': damage = (targetCurrentHp < targetMaxHp * 0.50) ? targetCurrentHp : Math.floor(targetMaxHp); outcome.statusApplied = "การพิพากษาแห่งพระเจ้า!"; break;
                case 'ARCHSAGE_JUDGMENT': damage = targetCurrentHp; outcome.statusApplied = `พิพากษาต้องห้าม (ทอย ${casterRoll})!`; options.selfEffect = { type: 'PERMANENT_MAXHP_LOSS_PERCENT', amount: 5 }; break;
                case 'HOLY_LADY_JUDGMENT': damage = Math.floor(targetCurrentHp * 0.50); outcome.statusApplied = "การพิพากษาสตรีศักดิ์สิทธิ์ (ลดเลือด 50%)"; break;
                case 'DL_DARK_WAVE': 
                    const dlBase = (Math.floor(Math.random()*20)+1) + (Math.max(casterINT, casterSTR) * 2);
                    damage = dlBase + Math.floor(targetCurrentHp * 0.20); 
                    outcome.statusApplied = `คลื่นความมืดมรณะ (${dlBase} + 20%HP)`;
                    break;
                case 'MS_MANA_BURST_V1': 
                    const msBase = casterSTR + casterINT;
                    damage = msBase + Math.floor(targetCurrentHp * 0.15);
                    outcome.statusApplied = `ระเบิดมานา (${msBase} + 15%HP)`;
                    break;
                case 'MS_ARCANE_SLASH_V3': damage = (Math.floor(Math.random()*20)+1 + casterSTR + casterINT) + Math.floor(targetCurrentHp * 0.12); break;
                case 'BOW_MASTER_RAIN': damage = casterDEX + (Math.floor(Math.random()*6)+1); outcome.statusApplied = "ฝนธนูตกลงมาใส่!"; break;
                case 'BOW_MASTER_EXECUTE': 
                    const percent = Math.min(20, casterRoll + casterDEX + casterWIS);
                    damage = (Math.floor(Math.random()*20)+1 + casterDEX) + Math.floor(targetCurrentHp * (percent/100));
                    outcome.statusApplied = `เนตรสังหาร (ลด ${percent}% HP)`;
                    break;
                case 'HERO_JUSTICE_SWORD': damage = (Math.floor(Math.random()*20)+1 + casterSTR + casterWIS) + Math.floor(targetCurrentHp * 0.10); break;
                case 'GOD_FINGER_LOGIC': damage = targetCurrentHp; outcome.statusApplied = "☠️ ถูกลบตัวตน! (ตายทันที)"; break;
                case 'DEATH_FINGER_LOGIC':
                    const threshold = Math.floor(targetMaxHp * 0.30); 
                    if (targetCurrentHp <= threshold) { damage = targetCurrentHp; outcome.statusApplied = "☠️ นิ้วสั่งตาย! (ประหารชีวิต)"; } 
                    else { damage = Math.floor(targetMaxHp * 0.50); outcome.statusApplied = "☠️ นิ้วสั่งตาย! (บาดเจ็บ 50% MaxHP)"; }
                    break;
            }
            currentData.hp = (currentData.hp || 0) - damage; 
            if (effect.formula === 'GOD_JUDGMENT') {
                currentData.hp = 0;
            }
            outcome.damageDealt = damage;
        }

        function applySpecialLogic() {
            // [FIX] ดึง roomId จากตัวแปร scope ด้านบนโดยตรง (ปลอดภัยกว่า)
            switch(effect.type) {
                case 'CONTROL': case 'CONTROL_BUFF':
                    if (effect.status === 'TAUNT') { currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'TAUNT', taunterUid: casterData.uid, turnsLeft: duration }); outcome.statusApplied = `ยั่วยุ (${duration} เทิร์น)`; } break;
                case 'DOT': case 'DOT_AREA':
                    currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'DEBUFF_DOT', stat: 'HP', modType: 'DOT_PERCENT_CURRENT', amount: amount, turnsLeft: duration }); outcome.statusApplied = `ติดสถานะต่อเนื่อง (${duration} เทิร์น)`; break;
                case 'SUMMON': 
                    outcome.statusApplied = `อัญเชิญ ${skill.effect.unitId || 'อสูร'} สำเร็จ!`; 
                    // [FIX] เรียก spawnSummon โดยส่ง roomId ที่ประกาศไว้
                    spawnSummon(skill.effect.unitId, casterData, roomId);
                    break;
            }
        }

        switch(effect.type) {
            case 'ALL_TEMP_STAT_PERCENT': case 'MULTI_TEMP_STAT_PERCENT': case 'ALL_TEMP_STAT_DEBUFF_PERCENT': case 'TEMP_LEVEL_PERCENT': case 'STATUS': case 'WEAPON_BUFF': case 'WEAPON_BUFF_ELEMENTAL': case 'ELEMENT_SELECT': applyBuffDebuff(); break;
            case 'FORMULA_HEAL': applyHealing(); break;
            case 'FORMULA': case 'FORMULA_AOE': applyFormulaDamage(); break;
            case 'CONTROL': case 'CONTROL_BUFF': case 'DOT': case 'DOT_AREA': case 'SUMMON': applySpecialLogic(); break;
            default: console.warn(`[TRANSACTION] Unhandled effect type: ${effect.type}`);
        }

        // [FIX] Update HP % after Buffs
        if (conChangedInTransaction && currentData.type === 'player') {
            const finalConAfter = calculateTotalStat(currentData, 'CON'); 
            const newMaxHp = calculateHP(currentData.race, currentData.classMain, finalConAfter); 
            currentData.maxHp = newMaxHp;
            currentData.hp = Math.floor(newMaxHp * hpRatio);
        }
        
        if (currentData.hp < 0) currentData.hp = 0;
        const ceilingHp = currentData.maxHp || oldMaxHp; 
        if (currentData.hp > ceilingHp) currentData.hp = ceilingHp;

        return currentData; 
    });

    if (options.selfEffect && options.selfEffect.type === 'PERMANENT_MAXHP_LOSS_PERCENT') {
         await casterRef.transaction(casterCurrentData => {
             if (casterCurrentData) { 
                 const currentCon = calculateTotalStat(casterCurrentData, 'CON');
                 const currentMax = casterCurrentData.maxHp || calculateHP(casterCurrentData.race, casterCurrentData.classMain, currentCon);
                 const lossAmount = Math.floor(currentMax * (options.selfEffect.amount / 100)); 
                 casterCurrentData.maxHp = Math.max(1, currentMax - lossAmount); 
                 casterCurrentData.hp = Math.min(casterCurrentData.maxHp, casterCurrentData.hp || 0); 
             } 
             return casterCurrentData;
         });
     }
     return outcome;
}

/* แสดงโมดัลสกิล (Show Skill Modal) */
async function showSkillModal() {
    const currentUserUid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!currentUserUid || !roomId) return;
    
    showLoading("กำลังโหลดข้อมูลสกิล..."); 
    let currentUser; 
    let currentCombatStateForCheck;
    
    try {
        const roomSnap = await db.ref(`rooms/${roomId}`).get(); 
        if (!roomSnap.exists()) { hideLoading(); return showAlert('ไม่พบข้อมูลห้อง!', 'error'); } 
        const roomData = roomSnap.val();
        currentUser = roomData.playersByUid?.[currentUserUid]; 
        currentCombatStateForCheck = roomData.combat || {};
        if (!currentUser) { hideLoading(); return showAlert('ไม่พบข้อมูลตัวละคร!', 'error'); }
         currentUser.uid = currentUserUid; 
    } catch (error) { hideLoading(); return showAlert('เกิดข้อผิดพลาดในการโหลดข้อมูลสกิล', 'error'); } 
    
    hideLoading();
    
    if (currentCombatStateForCheck.isActive && currentCombatStateForCheck.turnOrder[currentCombatStateForCheck.currentTurnIndex].id !== currentUserUid) {
        return showAlert('ยังไม่ถึงเทิร์นของคุณ!', 'warning');
    }

    let allSkills = [];
    if (typeof SKILL_DATA !== 'undefined') {
        if (currentUser.classMain && SKILL_DATA[currentUser.classMain]) allSkills.push(...(SKILL_DATA[currentUser.classMain] || []));
        if (currentUser.classSub && SKILL_DATA[currentUser.classSub]) allSkills.push(...(SKILL_DATA[currentUser.classSub] || []));
    }
    if (typeof RACE_DATA !== 'undefined') {
        const raceId = currentUser.raceEvolved || currentUser.race;
        if (RACE_DATA[raceId] && RACE_DATA[raceId].skills) {
            RACE_DATA[raceId].skills.forEach(id => {
                if(SKILL_DATA[id]) allSkills.push(SKILL_DATA[id]);
            });
        }
    }

    const availableSkills = allSkills.filter(skill => skill.skillTrigger === 'ACTIVE');

    if (!availableSkills || availableSkills.length === 0) return showAlert('คุณไม่มีสกิลที่สามารถใช้ได้', 'info');
    
    let skillButtonsHtml = '';
    availableSkills.forEach(skill => {
        const cdError = checkCooldown(currentUser, skill);
        const isDisabled = cdError !== null; 
        const title = isDisabled ? cdError : (skill.description || 'ไม่มีคำอธิบาย');
        
        skillButtonsHtml += `<button class="swal2-styled" onclick="selectSkillTarget('${skill.id}')" 
            style="margin: 5px; ${isDisabled ? 'background-color: #6c757d; cursor: not-allowed;' : ''}" 
            title="${title}" ${isDisabled ? 'disabled' : ''}>
            ${skill.name}
        </button>`;
    });
    
    Swal.fire({ 
        title: 'เลือกสกิล', 
        html: `<div>${skillButtonsHtml}</div>`, 
        showConfirmButton: false, 
        showCancelButton: true, 
        cancelButtonText: 'ปิด' 
    });
}

/* เลือกเป้าหมายสกิล (Select Skill Target) */
async function selectSkillTarget(skillId) {
    const currentUserUid = firebase.auth().currentUser?.uid;
    const currentUser = currentCharacterData; 
    if (!currentUser) return showAlert('ไม่พบข้อมูลผู้เล่น', 'error');

    let allSkills = [];
    if (typeof SKILL_DATA !== 'undefined') {
        if (currentUser.classMain && SKILL_DATA[currentUser.classMain]) allSkills.push(...(SKILL_DATA[currentUser.classMain] || []));
        if (currentUser.classSub && SKILL_DATA[currentUser.classSub]) allSkills.push(...(SKILL_DATA[currentUser.classSub] || []));
    }
    if (typeof RACE_DATA !== 'undefined') {
        const raceId = currentUser.raceEvolved || currentUser.race;
        if (RACE_DATA[raceId] && RACE_DATA[raceId].skills) {
            RACE_DATA[raceId].skills.forEach(id => {
                if(SKILL_DATA[id]) allSkills.push(SKILL_DATA[id]);
            });
        }
    }
    
    const skill = allSkills.find(s => s.id === skillId); 
    if (!skill) return;
    
    let targetOptions = {}; 
    let options = {};

    if (skill.targetType === 'self') {
    } else if (skill.targetType.includes('teammate')) {
         for (const uid in allPlayersInRoom) {
             if (allPlayersInRoom[uid].hp > 0) { 
                targetOptions[uid] = allPlayersInRoom[uid].name;
             }
         }
    } else if (skill.targetType.includes('enemy')) {
        const enemySelect = document.getElementById('enemyTargetSelect');
        for(const option of enemySelect.options) {
            if(option.value) targetOptions[option.value] = option.text;
        }
        if (Object.keys(targetOptions).length === 0) return showAlert('ไม่มีศัตรูให้เลือก!', 'warning');
    }

    if (skill.effect.type === 'ELEMENT_SELECT') {
        const elementOptions = {};
        skill.effect.elements.forEach(el => { elementOptions[el] = el; });
        
        const { value: selectedElement } = await Swal.fire({ 
            title: `เลือกธาตุสำหรับ ${skill.name}`, 
            input: 'select', 
            inputOptions: elementOptions,
            inputPlaceholder: 'เลือกธาตุ',
            showCancelButton: true 
        });
        if (!selectedElement) return; 
        options.selectedElement = [selectedElement]; 
        
        if (skill.effect.selectCount === 2) {
             const { value: selectedElement2 } = await Swal.fire({ 
                title: `เลือกธาตุที่ 2`, 
                input: 'select', 
                inputOptions: elementOptions,
                showCancelButton: true 
            });
            if (selectedElement2) options.selectedElement.push(selectedElement2);
        }
    }

    let targetIds = [];
    if (skill.targetType.includes('_all') || skill.targetType.includes('_aoe') || skill.targetType.includes('_self')) { 
         Swal.fire({ title: `กำลังร่าย ${skill.name}...`, text: `ส่งผลต่อ${skill.targetType.includes('teammate') ? 'เพื่อนร่วมทีม' : 'ศัตรู'}ทั้งหมด!`, icon: 'info', timer: 1500 });
         targetIds = Object.keys(skill.targetType.includes('teammate') ? allPlayersInRoom : allEnemiesInRoom); 
    
    } else if (skill.targetType !== 'self') { 
        const { value: selectedUid } = await Swal.fire({ 
            title: `เลือกเป้าหมายสำหรับ "${skill.name}"`, 
            input: 'select', 
            inputOptions: targetOptions, 
            inputPlaceholder: 'เลือกเป้าหมาย', 
            showCancelButton: true 
        }); 
        if (!selectedUid) return; 
        targetIds.push(selectedUid);
    
    } else { 
        targetIds.push(currentUserUid);
    }

    if (targetIds.length > 0) {
        Swal.close(); 
        
        if (targetIds.length > 1) {
             useSkillOnTarget(skillId, 'all', options);
        } else {
             useSkillOnTarget(skillId, targetIds[0], options);
        }
    }
}


// =================================================================
// ----------------- ตรรกะการโจมตี (ATTACK LOGIC) -----------------
// =================================================================

/* ทำการทอยโจมตี (Perform Attack Roll) */
async function performAttackRoll() {
    const uid = firebase.auth().currentUser?.uid; 
    
    // เช็คเทิร์น
    if (!uid || !combatState || !combatState.isActive || combatState.turnOrder[combatState.currentTurnIndex].id !== uid) {
        return showAlert("ยังไม่ถึงเทิร์นของคุณ!", 'warning');
    }
    
    const selectedTargetKey = document.getElementById('enemyTargetSelect').value; 
    if (!selectedTargetKey) return showAlert("กรุณาเลือกเป้าหมาย!", 'warning'); 
    
    const roomId = sessionStorage.getItem('roomId');
    
    // [Logic PvP] เลือกข้อมูลเป้าหมายให้ถูกประเภท
    let targetData;
    if (combatState.type === 'PVP') {
        targetData = allPlayersInRoom[selectedTargetKey]; // เป้าหมายคือผู้เล่น
    } else {
        targetData = allEnemiesInRoom[selectedTargetKey]; // เป้าหมายคือมอนสเตอร์
    }
    
    const playerData = currentCharacterData; 
    if (!targetData || !playerData) return showAlert("ไม่พบข้อมูลเป้าหมายหรือผู้เล่น!", 'error');

    // ปิดปุ่มชั่วคราว
    document.getElementById('attackRollButton').disabled = true; 
    document.getElementById('skillButton').disabled = true;

    // เลื่อนจอไปที่ลูกเต๋า
    const animArea = document.getElementById('player-dice-animation-area');
    if(animArea) animArea.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // เริ่มทอยเต๋า D20
    const { total: roll } = await showDiceRollAnimation(1, 20, 'player-dice-animation-area', 'dice-result', null);

    // [Logic PvP] คำนวณ AC เป้าหมาย
    let targetAC;
    if (combatState.type === 'PVP') {
        // สูตร AC ผู้เล่น: 10 + (DEX - 10)/2
        targetAC = 10 + getStatBonusFn(calculateTotalStat(targetData, 'DEX'));
    } else {
        // สูตร AC มอนสเตอร์
        targetAC = 10 + getStatBonusFn(targetData.stats?.DEX || 10);
    }

    // คำนวณ Attack Bonus ของเรา
    const mainWeapon = playerData.equippedItems?.mainHand;
    let attackStat = 'STR';
    // เช็คอาวุธที่ใช้ DEX (มีด, ธนู, หน้าไม้)
    if (mainWeapon && (
        (mainWeapon.weaponType === 'มีด' && (playerData.classMain === 'โจร' || playerData.classMain === 'นักฆ่า')) ||
        (mainWeapon.weaponType === 'ธนู' && (playerData.classMain === 'เรนเจอร์' || playerData.classMain === 'อาเชอร์')) ||
        (mainWeapon.weaponType === 'หน้าไม้')
    )) { attackStat = 'DEX'; }
    
    const attackBonus = getStatBonus(calculateTotalStat(playerData, attackStat));
    const totalAttack = roll + attackBonus;
    
    // แสดงผลลัพธ์ (Card)
    const resultCard = document.getElementById('rollResultCard'); 
    resultCard.classList.remove('hidden'); 
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const isHit = totalAttack >= targetAC;
    const outcomeText = isHit ? '✅ โจมตีโดน!' : '💥 โจมตีพลาด!';
    let rollText = `ทอย (d20): ${roll} + ${attackStat} Bonus: ${attackBonus} = <strong>${totalAttack}</strong>`;
    
    resultCard.innerHTML = `<h4>ผลการโจมตี: ${targetData.name}</h4><p>${rollText}</p><p>AC เป้าหมาย: ${targetAC}</p><p class="outcome">${outcomeText}</p>`; 
    resultCard.className = `result-card ${isHit ? 'hit' : 'miss'}`;
    
    if (isHit) { 
        // ถ้าโดน -> เปิดปุ่มทอย Damage
        document.getElementById('damageWeaponName').textContent = mainWeapon?.name || "มือเปล่า"; 
        document.getElementById('damageDiceInfo').textContent = mainWeapon?.damageDice || "d4"; 

        const damageSection = document.getElementById('damageRollSection');

        damageSection.setAttribute('data-attack-val', totalAttack);
        damageSection.style.display = 'block';
    } else { 
        // ถ้าพลาด -> จบเทิร์นอัตโนมัติ
        setTimeout(async () => { 
            await endPlayerTurn(uid, roomId); 
            resultCard.classList.add('hidden'); 
        }, 2000); 
    }
}
// =================================================================
// ส่วนคำนวณดาเมจและโจมตี (ฝั่งผู้เล่น) - รองรับระบบธาตุ v3
// =================================================================

async function performDamageRoll() {
    // 1. ตรวจสอบความพร้อมและสิทธิ์
    const uid = firebase.auth().currentUser?.uid;
    
    // ตรวจสอบ State การต่อสู้
    if (!uid || !combatState || !combatState.isActive) {
         return Swal.fire('ไม่ได้อยู่ในการต่อสู้', '', 'warning');
    }
    
    // เช็คเทิร์น
    const currentTurnID = combatState.turnOrder[combatState.currentTurnIndex]?.id;
    if (currentTurnID !== uid) {
        return Swal.fire("ยังไม่ถึงเทิร์นของคุณ!", "กรุณารอเทิร์น", 'warning');
    }
    
    // เช็คเป้าหมาย
    const targetId = document.getElementById('enemyTargetSelect')?.value;
    if (!targetId) return Swal.fire('ลืมเลือกเป้าหมาย', 'กรุณาเลือกศัตรูที่จะโจมตี', 'warning');

    if (!currentCharacterData) return;
    const roomId = sessionStorage.getItem('roomId');

    try {
        // 2. ดึงข้อมูลศัตรู
        const enemySnap = await db.ref(`rooms/${roomId}/enemies/${targetId}`).get();
        let enemyData = enemySnap.val();
        let isPlayerTarget = false;
        
        // (เผื่อกรณี PvP เป้าหมายเป็นผู้เล่น)
        if (!enemyData) {
             const playerTargetSnap = await db.ref(`rooms/${roomId}/playersByUid/${targetId}`).get();
             enemyData = playerTargetSnap.val();
             isPlayerTarget = true;
        }

        if (!enemyData) return Swal.fire('ไม่พบเป้าหมาย', 'เป้าหมายนี้หายไปแล้ว', 'error');

        // 3. เตรียมข้อมูลการโจมตี
        const mainHand = currentCharacterData?.equippedItems?.mainHand || null;

        // --- [NEW] 3.1 อ่านค่า EM และ ธาตุ (t1, t2) ระบบใหม่ ---
        const emVal = calculateTotalStat(currentCharacterData, 'EM') || 0; // ดึงค่าความชำนาญธาตุ

        let t1 = mainHand?.element1 || mainHand?.element || 0;
        let t2 = mainHand?.element2 || 0;

        // ตรวจสอบบัฟเคลือบธาตุ (ถ้ามีจะแทรกเป็น t1 หรือ t2)
        const effects = currentCharacterData.activeEffects || [];
        const elementalBuffs = effects.filter(e => 
            e && (e.type === 'ELEMENTAL_BUFF' || e.type === 'WEAPON_BUFF_ELEMENTAL')
        );
        if (elementalBuffs.length > 0) {
            t1 = elementalBuffs[0].element || elementalBuffs[0].amount || t1;
            if (elementalBuffs.length > 1) {
                t2 = elementalBuffs[1].element || elementalBuffs[1].amount || t2;
            }
        }

        const attackE1_Id = ElementalEngine.toId(t1);
        const attackE2_Id = ElementalEngine.toId(t2);

        // --- 3.2 เลือก Stat (STR/INT/DEX) ---
        let scalingStat = 'STR';
        let statSourceTxt = 'STR';

        if (attackE1_Id !== 0 || attackE2_Id !== 0) {
            scalingStat = 'INT';
            statSourceTxt = 'INT (เวทย์)';
        } else {
            if (mainHand && (mainHand.weaponType === 'ธนู' || mainHand.weaponType === 'มีด' || mainHand.weaponType === 'หน้าไม้' || mainHand.weaponType === 'ปืน')) {
                scalingStat = 'DEX';
                statSourceTxt = 'DEX (อาวุธเบา)';
            }
        }

        const statVal = calculateTotalStat(currentCharacterData, scalingStat);
        const statBonus = getStatBonus(statVal); 

        // 4. ทอยความแม่นยำ (Hit Roll) & Damage
        const diceSize = 20;
        const roll = Math.floor(Math.random() * diceSize) + 1;
        const totalHit = roll + statBonus; 
        const isAutoMiss = roll === 1;
        const isCritical = roll === 20;

        const damageDice = mainHand?.damageDice || currentCharacterData?.damageDice || 'd6';
        const dmgDie = parseInt(String(damageDice).replace('d', ''), 10) || 6;

        let dmgRoll = Math.floor(Math.random() * dmgDie) + 1;
        if (isCritical) dmgRoll += Math.floor(Math.random() * dmgDie) + 1;

        let baseDamage = dmgRoll + statBonus;
        if (mainHand?.bonuses?.damage) baseDamage += (parseInt(mainHand.bonuses.damage) || 0);
        if (baseDamage < 1) baseDamage = 1;

        // 6. Transaction (หัวใจสำคัญ)
        const enemyRef = db.ref(`rooms/${roomId}/${isPlayerTarget ? 'playersByUid' : 'enemies'}/${targetId}`);
        
        let finalResultLog = {
            baseDamage: baseDamage,
            finalDamage: 0,
            reactionName: null,
            hasReaction: false,
            shieldLogs: [],
            realDamageTaken: 0,
            reactionLogsText: null, 
            specialEffects: null,
            isDead: false,         // [ใหม่] เช็คการตายเพื่อแจก EXP
            expToGive: 0           // [ใหม่] ค่า EXP ที่จะแจก
        };

        const txResult = await enemyRef.transaction(enemy => {
            if (!enemy) return enemy;
            ElementalEngine.ensureSlots(enemy);

            if (isAutoMiss) {
                enemy._lastAttackLog = { ts: Date.now(), result: 'MISS' };
                return enemy;
            }

            // --- A. คำนวณธาตุระบบใหม่ (ส่ง EM, t1, t2 เข้าไป) ---
            const eResult = ElementalEngine.process(enemy, emVal, attackE1_Id, attackE2_Id, baseDamage);
            
            finalResultLog.hasReaction = eResult.hasReaction;
            finalResultLog.reactionName = eResult.reactionName;
            finalResultLog.finalDamage = eResult.finalDamage;
            finalResultLog.reactionLogsText = eResult.log; 
            finalResultLog.specialEffects = eResult.specialEffects; 

            // B. คำนวณเกราะ (Shield)
            const isPierce = mainHand && (['หอก', 'มีด', 'ปืน', 'เจาะเกราะ'].includes(mainHand.weaponType));
            
            let shieldResult;
            if (typeof ElementalEngine.applyDamageWithShield === 'function') {
                shieldResult = ElementalEngine.applyDamageWithShield(enemy, eResult.finalDamage, isPierce);
            } else {
                shieldResult = {
                    finalHp: (enemy.hp || 0) - eResult.finalDamage,
                    damageTaken: eResult.finalDamage,
                    activeEffects: enemy.activeEffects || [],
                    logs: []
                };
                if (shieldResult.finalHp < 0) shieldResult.finalHp = 0;
            }

            // --- [กู้คืน] เช็คการตายและดึง EXP ---
            if (shieldResult.finalHp <= 0 && (enemy.hp || 0) > 0) {
                finalResultLog.isDead = true;
                finalResultLog.expToGive = enemy.expReward || 0;
            }

            // C. อัปเดตค่ากลับลง DB
            enemy.hp = shieldResult.finalHp;
            enemy.activeEffects = shieldResult.activeEffects || []; 
            enemy.elementSlots = eResult.updatedSlots;

            // D. จัดการ DoT ตามผลของ Engine (เช่น ไฟช็อต)
            if (eResult.specialEffects && eResult.specialEffects.addDot) {
                const dot = eResult.specialEffects.addDot;
                const dotEffect = {
                    id: `reaction_dot_${Date.now()}`,
                    name: `สถานะผิดปกติ (${dot.element})`,
                    type: 'DOT',
                    element: dot.element,
                    damageDice: dot.damageFormula,
                    multiplier: dot.multiplier,
                    tickOn: 'GLOBAL',
                    duration: dot.turns,
                    turnsLeft: dot.turns
                };
                enemy.activeEffects.push(dotEffect);
            }

            finalResultLog.shieldLogs = shieldResult.logs;
            finalResultLog.realDamageTaken = shieldResult.damageTaken;

            return enemy;
        });

        // หาก Transaction ทำงานไม่สำเร็จ
        if (!txResult.committed) {
            return Swal.fire('เกิดข้อผิดพลาด', 'โจมตีไม่สำเร็จ เป้าหมายอาจมีการเปลี่ยนแปลง', 'error');
        }

        // --- 6.5 จัดการผลกระทบพิเศษ (ย้อนดาเมจเข้าตัวเอง / ระเบิดหมู่) ---
        if (!isAutoMiss && finalResultLog.specialEffects) {
            const fx = finalResultLog.specialEffects;
            
            // 1. ดาเมจย้อนเข้าตัวเอง (Overload)
            if (fx.selfDamage > 0) {
                const myRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
                await myRef.child('hp').transaction(hp => {
                    let newHp = (hp || 0) - fx.selfDamage;
                    return newHp < 0 ? 0 : newHp;
                });
            }

            // 2. มหาปฏิกิริยา (ระเบิดหมู่ใส่ทุกคนในห้อง ยกเว้นเป้าหมายหลักที่โดนไปแล้ว)
            if (fx.aoeDamageAll > 0) {
                const updates = {};
                const aoeDmg = fx.aoeDamageAll;
                
                // ถล่มศัตรูตัวอื่น
                if (typeof allEnemiesInRoom !== 'undefined') {
                    Object.keys(allEnemiesInRoom).forEach(eId => {
                        if (eId !== targetId) {
                            let currentHp = allEnemiesInRoom[eId].hp || 0;
                            updates[`rooms/${roomId}/enemies/${eId}/hp`] = Math.max(0, currentHp - aoeDmg);
                        }
                    });
                }
                // ถล่มผู้เล่นทุกคน (ตัวเองด้วย)
                if (typeof allPlayersInRoom !== 'undefined') {
                    Object.keys(allPlayersInRoom).forEach(pId => {
                        let currentHp = allPlayersInRoom[pId].hp || 0;
                        updates[`rooms/${roomId}/playersByUid/${pId}/hp`] = Math.max(0, currentHp - aoeDmg);
                    });
                }
                
                // บันทึกระเบิดหมู่รวดเดียว
                if (Object.keys(updates).length > 0) {
                    await db.ref().update(updates);
                }
            }
        }

        // 7. แสดงผล Log
        let logHtml = `⚔️ <b>${currentCharacterData.name}</b> โจมตี <b>${enemyData.name}</b> `;

        if (isAutoMiss) {
            logHtml += `<span style="color:gray">วืด! (ออก 1)</span>`;
            Swal.fire({ title: 'วืด!', text: 'พลาดเป้าอย่างน่าเสียดาย', icon: 'error', timer: 1000, showConfirmButton: false });
        } else {
            const critTxt = isCritical ? ' <b style="color:red">CRITICAL!</b>' : '';
            const hitDetail = `(ทอย ${roll} + ${statSourceTxt} ${statBonus} = ${totalHit})`;
            
            if (isCritical) logHtml += `${critTxt}`;
            logHtml += `<br><span style="font-size:0.85em; color:#aaa;">${hitDetail}</span>`;

            // แทรก Log สวยๆ จาก Engine ถ้ามีการผสมธาตุเกิดขึ้น
            if (finalResultLog.hasReaction && finalResultLog.reactionLogsText) {
                logHtml += `<br>${finalResultLog.reactionLogsText}`; 
                
                Swal.fire({ 
                    title: `เกิดปฏิกิริยาธาตุ!`, 
                    html: finalResultLog.reactionLogsText, 
                    icon: 'success', 
                    timer: 2500,
                    showConfirmButton: false
                });
            } else {
                logHtml += `<br>💢 พลังโจมตี: <b>${finalResultLog.finalDamage ?? baseDamage}</b>`;
                if (attackE1_Id !== 0) {
                    logHtml += ` <span style="color:#8fd3ff;">(ธาตุ: ${ElementalEngine.fmt(attackE1_Id)}${attackE2_Id !== 0 ? ' & ' + ElementalEngine.fmt(attackE2_Id) : ''})</span>`;
                }
                Swal.fire({ title: 'โจมตีสำเร็จ', text: `สร้างความเสียหาย ${finalResultLog.finalDamage} หน่วย`, icon: 'success', timer: 1000, showConfirmButton: false });
            }

            if (finalResultLog.shieldLogs && finalResultLog.shieldLogs.length > 0) {
                logHtml += `<br>${finalResultLog.shieldLogs.join('<br>')}`;
            }
            if (finalResultLog.realDamageTaken === 0) {
                logHtml += ` <span style="color:#28a745; font-weight:bold;">(เกราะรับไว้หมด!)</span>`;
            } else {
                logHtml += ` <span style="color:#ff4d4d; font-weight:bold;">(เข้าเนื้อ: ${finalResultLog.realDamageTaken})</span>`;
            }
        }

        // 🌟🌟🌟 [NEW] แจ้งเตือนมอนสเตอร์ตาย และเช็คความคืบหน้าเควสกิลด์ 🌟🌟🌟
        if (finalResultLog.isDead && !isPlayerTarget) {
             logHtml += `<br>💀 <b style="color:#ff4d4d;">${enemyData.name} ถูกสังหาร!</b>`;

             // ระบบเควสเลื่อนขั้น (กระดานกิลด์)
             if (currentCharacterData.activeQuest) {
                 let quest = currentCharacterData.activeQuest;
                 // เช็คชื่อมอนสเตอร์เป้าหมาย (ใช้ includes เพื่อรองรับชื่อที่ DM อาจจะตั้งยาวๆ เช่น "สไลม์ไฟคลั่ง")
                 if (enemyData.name.includes(quest.targetMonster)) {
                     if (quest.currentCount < quest.requiredCount) {
                         quest.currentCount++;
                         // อัปเดตความคืบหน้าขึ้น Firebase
                         db.ref(`rooms/${roomId}/playersByUid/${uid}/activeQuest/currentCount`).set(quest.currentCount);
                         
                         // เช็คว่าล่าครบหรือยัง
                         if (quest.currentCount >= quest.requiredCount) {
                             Swal.fire('ภารกิจลุล่วง!', `คุณกำจัด ${quest.targetMonster} ครบแล้ว! เดินทางกลับไปที่กิลด์เพื่อส่งเควสและเลื่อนขั้นได้เลย`, 'success');
                         } else {
                             // ถ้ายังไม่ครบ เด้ง Toast เบาๆ มุมจอ
                             Swal.fire({
                                 toast: true, position: 'top-end', icon: 'info',
                                 title: `เควส: ${quest.targetMonster} (${quest.currentCount}/${quest.requiredCount})`,
                                 showConfirmButton: false, timer: 3000
                             });
                         }
                     }
                 }
             }
        }

        await db.ref(`rooms/${roomId}/combatLogs`).push({
            message: logHtml.replace(/<br>/g, ' ').replace(/<[^>]*>?/gm, ''),
            html: logHtml,
            timestamp: Date.now()
        });

        // --- แจก EXP หากเป้าหมายตาย ---
        if (finalResultLog.isDead && finalResultLog.expToGive > 0 && typeof distributeExpToRoom === 'function') {
            await distributeExpToRoom(finalResultLog.expToGive, enemyData.name);
        }

        setTimeout(() => endPlayerTurn(uid, roomId), 1500);

    } catch (err) {
        console.error("Attack Error:", err);
        Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
    }
}

function checkElementalReaction(targetData, incomingElement) {
    if (!targetData.activeEffects) return null;
    
    // หาธาตุที่ติดอยู่กับเป้าหมาย
    const existingElementEffect = targetData.activeEffects.find(e => e.type === 'ELEMENTAL_STATUS');
    if (!existingElementEffect) return null;

    const currentElement = existingElementEffect.amount; // เช่น 'FIRE'
    
    // ดึงตาราง Reaction จาก skills-data.js (ต้องแน่ใจว่าโหลดไฟล์นั้นแล้ว)
    if (typeof ELEMENT_REACTIONS === 'undefined') return null;

    // เช็ค Reaction
    const reaction = ELEMENT_REACTIONS[currentElement]?.[incomingElement] || ELEMENT_REACTIONS[incomingElement]?.[currentElement];
    
    if (reaction) {
        return {
            name: reaction.effect,
            multiplier: reaction.multiplier || 1.0,
            status: reaction.status
        };
    }
    return null;
}

async function applyElementalStatusToTarget(roomId, targetKey, combatType, element) {
    let targetRef;
    if (combatType === 'PVP') targetRef = db.ref(`rooms/${roomId}/playersByUid/${targetKey}`);
    else targetRef = db.ref(`rooms/${roomId}/enemies/${targetKey}`);

    await targetRef.transaction(data => {
        if (!data) return;
        if (!data.activeEffects) data.activeEffects = [];
        
        // ถ้าเกิด Reaction ไปแล้ว (ใน checkElementalReaction) อาจจะลบธาตุเก่าออก
        // แต่ในที่นี้เราจะแปะธาตุใหม่เข้าไป หรือ ทับธาตุเดิม
        // (Logic อย่างง่าย: ธาตุใหม่ทับธาตุเก่าเสมอ)
        
        // ลบสถานะธาตุเก่าออก
        data.activeEffects = data.activeEffects.filter(e => e.type !== 'ELEMENTAL_STATUS');
        
        // ใส่ธาตุใหม่ (อยู่ 3 เทิร์น)
        data.activeEffects.push({
            name: `ติดธาตุ: ${element}`,
            type: 'ELEMENTAL_STATUS',
            amount: element,
            turnsLeft: 3
        });
        
        return data;
    });
}

async function spawnSummon(unitId, casterData, roomId) {
    if (!roomId) roomId = sessionStorage.getItem('roomId');

    // 1. ดึงสเตตัสของผู้อัญเชิญ
    const casterLevel = casterData.level || 1;
    const casterStr = calculateTotalStat(casterData, 'STR');
    const casterDex = calculateTotalStat(casterData, 'DEX');
    const casterCon = calculateTotalStat(casterData, 'CON');
    const casterInt = calculateTotalStat(casterData, 'INT');
    
    // 2. กำหนด % การสืบทอดสเตตัส (เช่น 60%)
    const scalingFactor = 0.60;
    const levelBonus = casterLevel * 2; // เลเวลละ 2 แต้ม

    // 3. ฐานสเตตัสของซัมมอน
    const summonBaseStats = {
        'mercenary': { name: 'ทหารรับจ้าง', baseHp: 30, bonusType: 'STR' },
        'royal_guard': { name: 'อัศวินองครักษ์', baseHp: 50, bonusType: 'CON' },
        'abyss_servant': { name: 'อสูรรับใช้แห่งขุมนรก', baseHp: 40, bonusType: 'INT' }
    };

    const template = summonBaseStats[unitId] || { name: 'Summon', baseHp: 20, bonusType: 'STR' };
    const summonName = `${template.name} (${casterData.name})`;

    // 4. คำนวณสเตตัสจริง
    const newStr = Math.floor(10 + levelBonus + (casterStr * scalingFactor));
    const newDex = Math.floor(10 + levelBonus + (casterDex * scalingFactor));
    const newCon = Math.floor(10 + levelBonus + (casterCon * scalingFactor));
    const newInt = Math.floor(10 + levelBonus + (casterInt * scalingFactor));
    
    // HP = Base + (Con * 2) + (Level * 5)
    const newMaxHp = template.baseHp + (newCon * 2) + (casterLevel * 5);

    const summonData = {
        name: summonName,
        hp: newMaxHp, 
        maxHp: newMaxHp, 
        damageDice: 'd8',
        stats: { STR: newStr, DEX: newDex, CON: newCon, INT: newInt, WIS: 10, CHA: 10 },
        type: 'player_summon',
        ownerUid: casterData.uid, 
        activeEffects: []
    };

    const newRef = await db.ref(`rooms/${roomId}/enemies`).push(summonData);
    const newSummonId = newRef.key;

    // แทรกคิวต่อสู้ (ถ้ามี)
    const combatRef = db.ref(`rooms/${roomId}/combat`);
    const combatSnap = await combatRef.get();
    
    if (combatSnap.exists()) {
        const combatState = combatSnap.val();
        if (combatState.isActive) {
            let turnOrder = combatState.turnOrder;
            if (!Array.isArray(turnOrder)) turnOrder = [];
            
            const newUnit = {
                id: newSummonId,
                name: summonName,
                dex: newDex,
                type: 'enemy', 
                isSummon: true 
            };

            turnOrder.push(newUnit);
            // เรียงลำดับเทิร์นใหม่ตาม DEX
            turnOrder.sort((a, b) => b.dex - a.dex);
            
            await combatRef.child('turnOrder').set(turnOrder);
            showAlert(`อัญเชิญ ${summonName} (HP:${newMaxHp}) สำเร็จ!`, 'success');
        }
    } else {
        showAlert(`อัญเชิญ ${summonName} แล้ว!`, 'success');
    }
}

/**
 * ฟังก์ชันแจก EXP ให้ผู้เล่นทุกคนในห้องเมื่อสังหารมอนสเตอร์สำเร็จ
 */
async function distributeExpToRoom(expAmount, monsterName) {
    if (expAmount <= 0) return;

    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;

    const playersRef = db.ref(`rooms/${roomId}/playersByUid`);
    const snap = await playersRef.once('value');
    const players = snap.val();

    if (!players) return;

    const updates = {};
    let playerCount = Object.keys(players).length;
    
    // (ทางเลือก) ถ้าอยากให้ "หารเฉลี่ย" ตามจำนวนคนในปาร์ตี้ ให้ใช้บรรทัดนี้:
    // const expPerPlayer = Math.floor(expAmount / playerCount) || 1;
    
    // แบบ "ได้เต็มจำนวน" ทุกคน:
    const expPerPlayer = expAmount;

    for (let uid in players) {
        const currentExp = players[uid].exp || 0;
        updates[`rooms/${roomId}/playersByUid/${uid}/exp`] = currentExp + expPerPlayer;
    }

    // อัปเดต EXP เข้า Firebase
    await db.ref().update(updates);

    // ส่ง Log แจ้งเตือนเข้าหน้าต่าง Combat
    await db.ref(`rooms/${roomId}/combatLogs`).push({
        message: `🌟 <b>ปาร์ตี้สังหาร [${monsterName}] สำเร็จ!</b> ได้รับ <b>${expPerPlayer} EXP</b> (ต่อคน)`,
        timestamp: Date.now()
    });
}
