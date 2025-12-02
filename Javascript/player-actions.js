

/* ฟังก์ชันสำหรับใช้ไอเทมบริโภค (Consumable) */
async function useConsumableItem(itemIndex) {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!uid || !roomId) return showAlert('ข้อมูลไม่ครบถ้วน!', 'error');

    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
    
    try {
        await playerRef.transaction(currentData => {
            if (!currentData) return; 
            if (!currentData.inventory || !currentData.inventory[itemIndex]) return; 

            // 1. คำนวณ Ratio ก่อนใช้
            const oldCon = calculateTotalStat(currentData, 'CON');
            const oldMaxHp = calculateHP(currentData.race, currentData.classMain, oldCon);
            const currentHp = currentData.hp || 0;
            const hpRatio = oldMaxHp > 0 ? (currentHp / oldMaxHp) : 0;

            const item = currentData.inventory[itemIndex]; 
            const effects = item.effects; 
            
            // 2. ใช้ไอเทม
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

            // 3. คำนวณ MaxHP ใหม่
            const newCon = calculateTotalStat(currentData, 'CON');
            const newMaxHp = calculateHP(currentData.race, currentData.classMain, newCon);
            
            // 4. ปรับ HP ตาม % เดิม (Base HP)
            let newHp = Math.floor(newMaxHp * hpRatio);
            
            // 5. ถ้ามีฮีล ให้บวกเพิ่มทีหลัง
            if (effects && effects.heal && effects.heal > 0) {
                newHp += effects.heal;
            }
            
            // Cap HP
            currentData.maxHp = newMaxHp;
            if (newHp > newMaxHp) newHp = newMaxHp;
            currentData.hp = newHp;
            
            return currentData;
        });
        
        showAlert(`ใช้งานไอเทมสำเร็จ!`, 'success');

    } catch (error) {
        console.error(error);
        showAlert(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
    }
}

/* 2. สวมใส่ไอเทม (Equip) - รักษา % HP */
async function equipItem(itemIndex) {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    if (!uid || !roomId) return; 
    
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`); 
    
    try {
        const transactionResult = await playerRef.transaction(charData => {
            if (!charData) return; 

            // 1. คำนวณ Ratio ก่อนใส่
            const oldCon = calculateTotalStat(charData, 'CON');
            const oldMaxHp = calculateHP(charData.race, charData.classMain, oldCon);
            const currentHp = charData.hp || 0;
            const hpRatio = oldMaxHp > 0 ? (currentHp / oldMaxHp) : 0;

            let { inventory = [], equippedItems = {} } = charData; 
            if (itemIndex < 0 || itemIndex >= inventory.length) return;
            
            const itemToEquip = { ...inventory[itemIndex] };
            let targetSlot = null;
            if (itemToEquip.itemType === 'อาวุธ') {
                if (!equippedItems['mainHand'] || equippedItems['mainHand'].durability <= 0) targetSlot = 'mainHand';
                else if (!equippedItems['offHand'] || equippedItems['offHand'].durability <= 0) targetSlot = 'offHand';
                else targetSlot = 'mainHand';
            } else targetSlot = itemToEquip.slot;

            if (!targetSlot) return;

            if (equippedItems[targetSlot]) {
                let itemToReturn = { ...equippedItems[targetSlot] };
                itemToReturn = { ...itemToReturn, bonuses: { ...(itemToReturn.originalBonuses || itemToReturn.bonuses) }, quantity: 1 };
                delete itemToReturn.isProficient; delete itemToReturn.isOffHand;
                let existingIdx = inventory.findIndex(i => i.name === itemToReturn.name && JSON.stringify(i.bonuses) === JSON.stringify(itemToReturn.bonuses));
                if (existingIdx > -1) inventory[existingIdx].quantity++;
                else inventory.push(itemToReturn);
            }
            
            if (itemToEquip.itemType === 'อาวุธ') {
                const proficiencies = (typeof CLASS_WEAPON_PROFICIENCY !== 'undefined' && CLASS_WEAPON_PROFICIENCY[charData.classMain]) || [];
                itemToEquip.isProficient = (targetSlot === 'mainHand' && proficiencies.includes(itemToEquip.weaponType));
                itemToEquip.isOffHand = (targetSlot === 'offHand');
            }
            equippedItems[targetSlot] = { ...itemToEquip, quantity: 1 };

            if (inventory[itemIndex].quantity > 1) inventory[itemIndex].quantity--;
            else inventory.splice(itemIndex, 1);
            
            charData.inventory = inventory;
            charData.equippedItems = equippedItems;

            // 2. คำนวณ MaxHP หลังใส่
            const newCon = calculateTotalStat(charData, 'CON');
            const newMaxHp = calculateHP(charData.race, charData.classMain, newCon);

            // 3. ปรับ HP ตาม % เดิม
            charData.maxHp = newMaxHp;
            charData.hp = Math.floor(newMaxHp * hpRatio);
            
            return charData; 
        }); 

        if (transactionResult.committed) showAlert(`สวมใส่สำเร็จ!`, 'success'); 

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

        // 1. คำนวณ Ratio ก่อนถอด
        const oldCon = calculateTotalStat(charData, 'CON');
        const oldMaxHp = calculateHP(charData.race, charData.classMain, oldCon);
        const currentHp = charData.hp || 0;
        const hpRatio = oldMaxHp > 0 ? (currentHp / oldMaxHp) : 0;

        let { inventory = [], equippedItems = {} } = charData; 
        const itemToUnequip = equippedItems[slot]; 
        if (!itemToUnequip) return; 

        const baseItem = { ...itemToUnequip, bonuses: { ...(itemToUnequip.originalBonuses || itemToUnequip.bonuses) }, quantity: 1 }; 
        delete baseItem.isProficient; delete baseItem.isOffHand; 
        
        let existingIdx = inventory.findIndex(i => i.name === baseItem.name && JSON.stringify(i.bonuses) === JSON.stringify(baseItem.bonuses));
        if (existingIdx > -1) inventory[existingIdx].quantity++; 
        else inventory.push(baseItem); 
        
        equippedItems[slot] = null; 
        charData.inventory = inventory;
        charData.equippedItems = equippedItems;

        // 2. คำนวณ MaxHP หลังถอด
        const newCon = calculateTotalStat(charData, 'CON');
        const newMaxHp = calculateHP(charData.race, charData.classMain, newCon);

        // 3. ปรับ HP ตาม % เดิม (ไม่ใช้การตัด Cap)
        charData.maxHp = newMaxHp;
        charData.hp = Math.floor(newMaxHp * hpRatio);

        return charData;
    });
    
    showAlert(`ถอดอุปกรณ์แล้ว`, 'info'); 
}


// =================================================================
// ----------------- ตรรกะสกิล (SKILL LOGIC) -----------------
// =================================================================

/* จบเทิร์นผู้เล่น */
async function endPlayerTurn(uid, roomId) {
    try {
        const combatSnap = await db.ref(`rooms/${roomId}/combat`).get();
        if (combatSnap.exists() && combatSnap.val().isActive) {
            const currentCombatState = combatSnap.val();
            if (currentCombatState.turnOrder && currentCombatState.turnOrder[currentCombatState.currentTurnIndex].id === uid) {
                await db.ref(`rooms/${roomId}/combat/actionComplete`).set(uid);
            } 
        } 
    } catch (error) { console.error(error); }
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
    if (currentCombatState.isActive && currentCombatState.turnOrder[currentCombatState.currentTurnIndex].id !== casterUid) {
        return showAlert('ยังไม่ถึงเทิร์นของคุณ!', 'warning');
    }

    const casterData = (typeof allPlayersInRoom !== 'undefined' && allPlayersInRoom) ? allPlayersInRoom[casterUid] : null; 
    if (!casterData) { showAlert('ไม่พบข้อมูลผู้ใช้ปัจจุบัน!', 'error'); return; } 
    if (!casterData.uid) casterData.uid = casterUid; 
    
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
    let targetType = 'single';

    if (skill.targetType === 'self' || targetId === casterUid) { 
        targetData = { ...casterData }; if(!targetData.type) targetData.type = 'player'; 
        targetRef = casterRef; 
    }
    else if (skill.targetType.includes('enemy')) { 
        if(skill.targetType.includes('_all')) targetType = 'enemy_all';
        targetData = (typeof allEnemiesInRoom !== 'undefined' && allEnemiesInRoom) ? allEnemiesInRoom[targetId] : null; 
        if (!targetData && targetType === 'single') { showAlert('ไม่พบข้อมูลเป้าหมายศัตรู!', 'error'); return; } 
        if(targetData) {
             targetData = { ...targetData }; if(!targetData.type) targetData.type = 'enemy'; 
             targetRef = db.ref(`rooms/${roomId}/enemies/${targetId}`); 
        }
    }
    else if (skill.targetType.includes('teammate')) { 
        if(skill.targetType.includes('_all')) targetType = 'teammate_all';
        if (skill.id.includes('cleric_heal') && targetId === casterUid) {
            return showAlert('นักบวช/นักบุญหญิง ไม่สามารถฮีลตัวเองได้!', 'warning');
        }
        targetData = (typeof allPlayersInRoom !== 'undefined' && allPlayersInRoom) ? allPlayersInRoom[targetId] : null; 
        if (!targetData && targetType === 'single') { showAlert('ไม่พบข้อมูลเป้าหมายเพื่อนร่วมทีม!', 'error'); return; } 
        if(targetData) {
            targetData = { ...targetData }; if(!targetData.type) targetData.type = 'player'; 
            targetRef = db.ref(`rooms/${roomId}/playersByUid/${targetId}`); 
        }
    }
    
    const cdError = checkCooldown(casterData, skill); 
    if (cdError) { showAlert(cdError, 'warning'); return; }

    try {
        const { success, rollData } = await performSuccessRoll(casterData, targetData, skill, options); 
        if (!success) { 
            await setCooldown(casterRef, skill, true); 
            await endPlayerTurn(casterUid, roomId); 
            return; 
        }

        let skillOutcome = null;
        const effectOptions = { ...options, rollData: rollData };
        
        if (targetType === 'enemy_all' || targetType === 'teammate_all' || skill.targetType === 'teammate_all_self') {
            const allTargets = (targetType === 'enemy_all') ? allEnemiesInRoom : allPlayersInRoom;
            for (const tId in allTargets) {
                if (targetType.includes('teammate') && tId === casterUid && skill.id.includes('cleric_heal')) continue;
                if (skill.targetType === 'teammate_all' && tId === casterUid) continue;
                
                const tData = { ...allTargets[tId], type: (targetType === 'enemy_all' ? 'enemy' : 'player') };
                const loopTargetRef = db.ref(`rooms/${roomId}/${targetType === 'enemy_all' ? 'enemies' : 'playersByUid'}/${tId}`);
                await applyEffect(casterRef, loopTargetRef, casterData, tData, skill, effectOptions);
            }
            skillOutcome = { statusApplied: `ส่งผลต่อเป้าหมายทั้งหมด` };
            
        } else if (targetRef) {
            skillOutcome = await applyEffect(casterRef, targetRef, casterData, targetData, skill, effectOptions);
        }

        if (skill.selfEffect) {
            await applyEffect(casterRef, casterRef, casterData, casterData, { ...skill, effect: skill.selfEffect }, effectOptions);
        }
        
        const isSelfBuff = (skill.targetType === 'self' && (skill.skillType === 'BUFF' || skill.skillType === 'BUFF_DEBUFF'));

        Swal.fire({
            title: `ใช้สกิล ${skill.name} สำเร็จ!`,
            text: isSelfBuff ? "คุณได้รับบัฟแล้ว และยังสามารถโจมตีต่อได้!" : (skillOutcome?.statusApplied || `ผลลัพธ์: สำเร็จ`),
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });
        
        await setCooldown(casterRef, skill, false);

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
        await endPlayerTurn(casterUid, roomId); 
    }
}

/* ฟังก์ชันหลักในการใช้สกิล (Apply Skill Effect) */
async function applyEffect(casterRef, targetRef, casterData, targetData, skill, options = {}) {
    const effect = skill.effect;
    let outcome = { damageDealt: 0, healAmount: 0, statusApplied: null };

    await targetRef.transaction(currentData => {
        if (currentData === null) return;
         
         if (!currentData.type) currentData.type = targetData.type;
         if (!currentData.race && targetData.type === 'player') currentData.race = targetData.race;
         if (!currentData.classMain && targetData.type === 'player') currentData.classMain = targetData.classMain;
         if (!currentData.stats) currentData.stats = { ...(targetData.stats || {}) };
         if (!currentData.activeEffects) currentData.activeEffects = [];

        const duration = effect.duration || (effect.durationDice ? (Math.floor(Math.random() * parseInt(effect.durationDice.replace('d', ''))) + 1) : 3);
        const amount = effect.amount || (effect.amountDice ? (Math.floor(Math.random() * parseInt(effect.amountDice.replace('d', ''))) + 1) : 0);
        
        // 1. คำนวณ HP Ratio ก่อนบัฟ
        let oldMaxHp = 0;
        let hpRatio = 0;
        let conChangedInTransaction = false; 

        if (currentData.type === 'player') {
            const currentFinalCon_Before = calculateTotalStat(currentData, 'CON');
            oldMaxHp = calculateHP(currentData.race, currentData.classMain, currentFinalCon_Before);
            hpRatio = oldMaxHp > 0 ? ((currentData.hp || 0) / oldMaxHp) : 0;
        } else {
            oldMaxHp = currentData.maxHp || 100; // (Enemy)
        }

        function applyBuffDebuff() {
            switch(effect.type) {
                case 'ALL_TEMP_STAT_PERCENT': 
                case 'MULTI_TEMP_STAT_PERCENT':
                    let statsToApply = [];
                    if (effect.type === 'ALL_TEMP_STAT_PERCENT') statsToApply = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(s => ({ stat: s, amount: effect.amount || amount }));
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
                case 'WEAPON_BUFF_ELEMENTAL':
                    currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'BUFF', stat: 'WeaponAttack', modType: 'FORMULA', buffId: effect.buffId, turnsLeft: duration });
                    outcome.statusApplied = `เคลือบอาวุธ (${duration} เทิร์น)`;
                    break;
                case 'ELEMENT_SELECT':
                    currentData.activeEffects = currentData.activeEffects.filter(e => e.type !== 'ELEMENTAL_BUFF');
                    (options.selectedElement || []).forEach(element => {
                        currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'ELEMENTAL_BUFF', stat: 'Element', modType: 'SET_VALUE', amount: element, turnsLeft: 999 });
                    });
                    outcome.statusApplied = `เปลี่ยนธาตุเป็น ${options.selectedElement ? options.selectedElement.join(', ') : '?'}`;
                    break;
            }
        }
        
        function applyHealing() {
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
        
        function applyFormulaDamage() {
            let damage = 0;
            const targetCurrentHp = currentData.hp || 0;
            const targetMaxHp = currentData.maxHp || oldMaxHp;
            const casterRoll = options.rollData?.casterRoll || Math.floor(Math.random()*20)+1; 
            const casterSTR = getStatBonus(calculateTotalStat(casterData, 'STR'));
            const casterINT = getStatBonus(calculateTotalStat(casterData, 'INT'));
            const casterDEX = getStatBonus(calculateTotalStat(casterData, 'DEX'));
            const casterWIS = getStatBonus(calculateTotalStat(casterData, 'WIS'));

            switch(effect.formula) {
                case 'GOD_JUDGMENT': damage = (targetCurrentHp < targetMaxHp * 0.50) ? targetCurrentHp : Math.floor(targetMaxHp * 0.75); outcome.statusApplied = "การพิพากษาแห่งพระเจ้า!"; break;
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
            outcome.damageDealt = damage;
        }

        function applySpecialLogic() {
            switch(effect.type) {
                case 'CONTROL': case 'CONTROL_BUFF':
                    if (effect.status === 'TAUNT') { currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'TAUNT', taunterUid: casterData.uid, turnsLeft: duration }); outcome.statusApplied = `ยั่วยุ (${duration} เทิร์น)`; } break;
                case 'DOT': case 'DOT_AREA':
                    currentData.activeEffects.push({ skillId: skill.id, name: skill.name, type: 'DEBUFF_DOT', stat: 'HP', modType: 'DOT_PERCENT_CURRENT', amount: amount, turnsLeft: duration }); outcome.statusApplied = `ติดสถานะต่อเนื่อง (${duration} เทิร์น)`; break;
                case 'SUMMON': outcome.statusApplied = `อัญเชิญ ${skill.effect.unitId || 'อสูร'} สำเร็จ!`; break;
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
            // ปรับ HP ตาม Ratio เดิม
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
    if (!uid || !combatState || !combatState.isActive || combatState.turnOrder[combatState.currentTurnIndex].id !== uid) return showAlert("ยังไม่ถึงเทิร์นของคุณ!", 'warning');
    
    const selectedEnemyKey = document.getElementById('enemyTargetSelect').value; 
    if (!selectedEnemyKey) return showAlert("กรุณาเลือกเป้าหมาย!", 'warning'); 
    
    const roomId = sessionStorage.getItem('roomId');
    const enemyData = allEnemiesInRoom[selectedEnemyKey];
    const playerData = currentCharacterData; 
    if (!enemyData || !playerData) return showAlert("ไม่พบข้อมูลเป้าหมายหรือผู้เล่น!", 'error');

    document.getElementById('attackRollButton').disabled = true; 
    document.getElementById('skillButton').disabled = true;

    const animArea = document.getElementById('player-dice-animation-area');
    if(animArea) animArea.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const { total: roll } = await showDiceRollAnimation(1, 20, 'player-dice-animation-area', 'dice-result', null);

    const enemyAC = 10 + Math.floor(((enemyData.stats?.DEX || 10) - 10) / 2); 
    const mainWeapon = playerData.equippedItems?.mainHand;
    let attackStat = 'STR';
    if (mainWeapon && (
        (mainWeapon.weaponType === 'มีด' && (playerData.classMain === 'โจร' || playerData.classMain === 'นักฆ่า')) ||
        (mainWeapon.weaponType === 'ธนู' && (playerData.classMain === 'เรนเจอร์' || playerData.classMain === 'อาเชอร์'))
    )) { attackStat = 'DEX'; }
    
    const attackBonus = getStatBonus(calculateTotalStat(playerData, attackStat));
    const totalAttack = roll + attackBonus;
    
    document.getElementById('rollResultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const resultCard = document.getElementById('rollResultCard'); 
    resultCard.classList.remove('hidden'); 
    const outcomeText = totalAttack >= enemyAC ? '✅ โจมตีโดน!' : '💥 โจมตีพลาด!';
    let rollText = `ทอย (d20): ${roll} + ${attackStat} Bonus: ${attackBonus} = <strong>${totalAttack}</strong>`;
    
    resultCard.innerHTML = `<h4>ผลการโจมตี: ${enemyData.name}</h4><p>${rollText}</p><p>AC ศัตรู: ${enemyAC}</p><p class="outcome">${outcomeText}</p>`; 
    resultCard.className = `result-card ${totalAttack >= enemyAC ? 'hit' : 'miss'}`;
    
    if (totalAttack >= enemyAC) { 
        document.getElementById('damageWeaponName').textContent = mainWeapon?.name || "มือเปล่า"; 
        document.getElementById('damageDiceInfo').textContent = mainWeapon?.damageDice || "d4"; 
        document.getElementById('damageRollSection').style.display = 'block'; 
    } else { 
        setTimeout(async () => { await endPlayerTurn(uid, roomId); resultCard.classList.add('hidden'); }, 2000); 
    }
}

/**
 * [ย้ายมา] คำนวณความเสียหาย
 */
async function performDamageRoll() {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    const selectedEnemyKey = document.getElementById('enemyTargetSelect').value; 
    if (!uid || !roomId || !selectedEnemyKey) return;
    
    document.getElementById('damageRollSection').style.display = 'none';
    
    const enemyRef = db.ref(`rooms/${roomId}/enemies/${selectedEnemyKey}`); 
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`); 
    
    const enemySnapshot = await enemyRef.get(); 
    const playerSnapshot = await playerRef.get(); 
    
    if (!enemySnapshot.exists() || !playerSnapshot.exists()) return; 
    
    const enemyData = enemySnapshot.val();
    let playerData = playerSnapshot.val(); 
    
    const mainWeapon = playerData.equippedItems?.mainHand;

    // Durability
    if (mainWeapon) {
        const newDurability = (mainWeapon.durability || 100) - 1;
        if (newDurability <= 0) {
            showAlert(`อาวุธ [${mainWeapon.name}] พัง!`, 'error');
            const updates = {}; updates[`equippedItems/mainHand`] = null;
            const itemToReturn = { ...mainWeapon, durability: 0, quantity: 1 };
            delete itemToReturn.isProficient; delete itemToReturn.isOffHand;
            let inventory = playerData.inventory || [];
            const existingIdx = inventory.findIndex(i => i.name === itemToReturn.name && i.durability === 0);
            if(existingIdx > -1) inventory[existingIdx].quantity++; else inventory.push(itemToReturn);
            updates[`inventory`] = inventory;
            await playerRef.update(updates);
            await endPlayerTurn(uid, roomId); document.getElementById('rollResultCard').classList.add('hidden');
            return; 
        } else {
            await playerRef.child('equippedItems/mainHand/durability').set(newDurability);
            playerData.equippedItems.mainHand.durability = newDurability;
        }
    }

    const diceTypeString = mainWeapon?.damageDice || 'd4';
    const diceType = parseInt(diceTypeString.replace('d', ''));
    const animArea = document.getElementById('player-dice-animation-area');
    if(animArea) animArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const { total: damageRoll } = await showDiceRollAnimation(1, diceType, 'player-dice-animation-area', 'dice-result', null);

    let damageStat = 'STR';
    if (mainWeapon && ( (mainWeapon.weaponType === 'มีด' && (playerData.classMain === 'โจร' || playerData.classMain === 'นักฆ่า')) || (mainWeapon.weaponType === 'ธนู' && (playerData.classMain === 'เรนเจอร์' || playerData.classMain === 'อาเชอร์')) )) damageStat = 'DEX';
    
    let damageBonus = getStatBonus(calculateTotalStat(playerData, damageStat));
    let totalDamage = Math.max(1, damageRoll + damageBonus);
    let damageExplanation = `ทอย (${diceTypeString}): ${damageRoll} + ${damageStat} Bonus: ${damageBonus}`;
    
    const formulaOverrideEffect = (playerData.activeEffects || []).find(e => e.stat === 'WeaponAttack' && e.modType === 'FORMULA' && e.buffId);
    let formulaPassive = null;
    if (playerData.classMain && SKILL_DATA[playerData.classMain]) formulaPassive = SKILL_DATA[playerData.classMain].find(s => s.skillTrigger === 'PASSIVE' && s.effect?.type === 'FORMULA_ATTACK_OVERRIDE');
    if (!formulaPassive && playerData.classSub && SKILL_DATA[playerData.classSub]) formulaPassive = SKILL_DATA[playerData.classSub].find(s => s.skillTrigger === 'PASSIVE' && s.effect?.type === 'FORMULA_ATTACK_OVERRIDE');

    const formulaSource = formulaOverrideEffect || (formulaPassive ? formulaPassive.effect : null);

    if (formulaSource) {
        const formulaId = formulaSource.buffId || formulaSource.formula;
        const targetCurrentHp = enemyData.hp || 0;
        const intBonus = getStatBonus(calculateTotalStat(playerData, 'INT'));
        const wisBonus = getStatBonus(calculateTotalStat(playerData, 'WIS'));
        const strBonus = getStatBonus(calculateTotalStat(playerData, 'STR'));
        
        // Updated Balanced Formulas (v3.5)
        switch (formulaId) {
            case 'HOLY_LIGHT_FORMULA_ATTACK': totalDamage = (damageRoll + damageBonus) + Math.floor(targetCurrentHp * 0.05); damageExplanation = `[ดาบแห่งแสง] Base + 5%HP`; break;
            case 'MAGE_PASSIVE_V1': totalDamage = (damageRoll + intBonus) + Math.floor(targetCurrentHp * 0.03); damageExplanation = `[เวทย์ติดตัว] Base + 3%HP`; break;
            case 'MAGE_PASSIVE_V2': totalDamage = (damageRoll + intBonus + wisBonus) + Math.floor(targetCurrentHp * 0.05); break;
            case 'MAGE_PASSIVE_V3': totalDamage = (damageRoll + intBonus + wisBonus) + Math.floor(targetCurrentHp * 0.08); break;
            case 'MAGE_PASSIVE_V4': totalDamage = (damageRoll + intBonus + wisBonus) + Math.floor(targetCurrentHp * 0.10); break;
            case 'MS_RUNE_BLADE_V1': totalDamage = (damageRoll + intBonus) + Math.floor(targetCurrentHp * 0.05); break;
            case 'MS_ARCANE_SLASH_V1': totalDamage = (damageRoll + strBonus + intBonus) + Math.floor(targetCurrentHp * 0.08); break;
            case 'MS_ARCANE_SLASH_V2': totalDamage = (damageRoll + strBonus + intBonus) + Math.floor(targetCurrentHp * 0.10); break;
            case 'MS_ARCANE_SLASH_V3': totalDamage = (damageRoll + strBonus + intBonus) + Math.floor(targetCurrentHp * 0.12); break;
            case 'DL_PASSIVE_V1': const demonStatBonus = Math.max(strBonus, intBonus); totalDamage = (damageRoll + demonStatBonus) + Math.floor(targetCurrentHp * 0.10); break;
            case 'HOLY_LADY_JUDGMENT': totalDamage = Math.floor(targetCurrentHp * 0.50); damageExplanation = `[การพิพากษา] 50% ของเลือดปัจจุบัน`; break;
            case 'BOW_MASTER_EXECUTE': 
                const dex = getStatBonus(calculateTotalStat(playerData, 'DEX'));
                const wis = getStatBonus(calculateTotalStat(playerData, 'WIS'));
                const roll = Math.floor(Math.random()*20)+1;
                const percent = Math.min(20, (roll + dex + wis)); 
                totalDamage = (damageRoll + damageBonus) + Math.floor(targetCurrentHp * (percent / 100));
                damageExplanation = `[เนตรสังหาร] Base + ${percent}%HP`;
                break;
        }
        totalDamage = Math.max(1, totalDamage);
    }

    document.getElementById('rollResultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const resultCard = document.getElementById('rollResultCard'); 
    resultCard.innerHTML = `<h4>ผลความเสียหาย: ${enemyData.name}</h4><p>${damageExplanation} = <strong>${totalDamage}</strong></p><p class="outcome">🔥 สร้างความเสียหาย ${totalDamage} หน่วย! 🔥</p>`; 
    resultCard.className = 'result-card hit';
    
    const newHp = (enemyData.hp || 0) - totalDamage;
    setTimeout(async () => {
        const finalHp = Math.max(0, newHp);
        await enemyRef.child('hp').set(finalHp);
        await endPlayerTurn(uid, roomId);
        resultCard.classList.add('hidden');
    }, 2500); 
}