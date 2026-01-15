

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
        // ❌ เดิม: ส่งสัญญาณไปให้ DM ทำงาน (ถ้า DM ไม่อยู่คือค้าง)
        // await db.ref(`rooms/${roomId}/combat/actionComplete`).set(uid);
        
        // ✅ ใหม่: สั่งเปลี่ยนเทิร์นเองเลย
        await advanceCombatTurn(roomId);
        
    } catch (error) { console.error(error); }
}
async function advanceCombatTurn(roomId) {
    const combatRef = db.ref(`rooms/${roomId}/combat`);
    const snapshot = await combatRef.get();
    const combatState = snapshot.val();

    if (!combatState || !combatState.isActive) return;

    // 1. หาคนถัดไป (ข้ามคนที่ตาย)
    let nextIndex = (combatState.currentTurnIndex + 1) % combatState.turnOrder.length;
    const maxSkips = combatState.turnOrder.length;
    let skips = 0;

    // ดึงข้อมูล HP ล่าสุดมาเช็คว่าใครตายบ้าง
    const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
    const enemiesSnap = await db.ref(`rooms/${roomId}/enemies`).get();
    const playersData = playersSnap.val() || {};
    const enemiesData = enemiesSnap.val() || {};

    while (skips < maxSkips) {
        const nextUnit = combatState.turnOrder[nextIndex];
        let isDead = false;

        if (nextUnit.type === 'player') {
            isDead = (playersData[nextUnit.id]?.hp || 0) <= 0;
        } else if (nextUnit.type === 'enemy') {
            isDead = (enemiesData[nextUnit.id]?.hp || 0) <= 0;
        }

        if (isDead) {
            nextIndex = (nextIndex + 1) % combatState.turnOrder.length;
            skips++;
        } else {
            break; // เจอคนเป็นแล้ว
        }
    }

    if (skips === maxSkips) {
        // ทุกคนตายหมด? (จบการต่อสู้)
        await db.ref(`rooms/${roomId}/combat`).remove();
        return;
    }

    // 2. ลดคูลดาวน์/บัฟ ของคนถัดไป (Next Unit Logic)
    const nextUnit = combatState.turnOrder[nextIndex];
    let unitRef;
    if (nextUnit.type === 'player') unitRef = db.ref(`rooms/${roomId}/playersByUid/${nextUnit.id}`);
    else unitRef = db.ref(`rooms/${roomId}/enemies/${nextUnit.id}`);

    if (unitRef) {
        await unitRef.transaction(unitData => {
            if (!unitData) return unitData;
            
            // ลดเทิร์นบัฟ
            if (Array.isArray(unitData.activeEffects)) {
                unitData.activeEffects.forEach(effect => {
                    if (effect.turnsLeft > 0) effect.turnsLeft--;
                });
                // ลบบัฟที่หมดเวลา
                unitData.activeEffects = unitData.activeEffects.filter(effect => effect.turnsLeft > 0);
            }
            // ลดคูลดาวน์สกิล (PERSONAL)
            if (unitData.skillCooldowns) {
                for (const skillId in unitData.skillCooldowns) {
                    const cd = unitData.skillCooldowns[skillId];
                    if (cd && cd.type === 'PERSONAL' && cd.turnsLeft > 0) {
                        cd.turnsLeft--;
                        if (cd.turnsLeft === 0) unitData.skillCooldowns[skillId] = null;
                    }
                }
            }
            return unitData;
        });
    }

    // 3. อัปเดต Index เพื่อเปลี่ยนเทิร์นจริง
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
        targetAC = 10 + Math.floor(((targetData.stats?.DEX || 10) - 10) / 2);
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
async function performDamageRoll() {
    const uid = firebase.auth().currentUser?.uid; 
    const roomId = sessionStorage.getItem('roomId'); 
    const selectedTargetKey = document.getElementById('enemyTargetSelect').value; 
    
    // Check Data
    if (!uid || !roomId || !selectedTargetKey) return;
    
    // ซ่อนปุ่มทอยดาเมจหลังจากกดแล้ว
    document.getElementById('damageRollSection').style.display = 'none';
    
    // [Logic PvP] เลือก Ref เป้าหมายให้ถูก (คน หรือ มอนสเตอร์)
    let targetRef;
    if (combatState.type === 'PVP') {
        targetRef = db.ref(`rooms/${roomId}/playersByUid/${selectedTargetKey}`);
    } else {
        targetRef = db.ref(`rooms/${roomId}/enemies/${selectedTargetKey}`);
    }
    
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`); 
    
    // ดึงข้อมูลล่าสุด
    const targetSnapshot = await targetRef.get(); 
    const playerSnapshot = await playerRef.get(); 
    
    if (!targetSnapshot.exists() || !playerSnapshot.exists()) return; 
    
    const targetData = targetSnapshot.val();
    let playerData = playerSnapshot.val(); 
    
    const mainWeapon = playerData.equippedItems?.mainHand;

    // =========================================================
    // ส่วนที่ 1: ระบบความทนทาน (Durability System)
    // =========================================================
    if (mainWeapon) {
        const newDurability = (mainWeapon.durability || 100) - 1;
        
        if (newDurability <= 0) {
            // กรณีอาวุธพัง
            showAlert(`อาวุธ [${mainWeapon.name}] พัง!`, 'error');
            
            const updates = {}; 
            updates[`equippedItems/mainHand`] = null; // ถอดออกจากตัว
            
            // สร้างไอเทมพังเพื่อคืนเข้ากระเป๋า
            const itemToReturn = { ...mainWeapon, durability: 0, quantity: 1 };
            delete itemToReturn.isProficient; 
            delete itemToReturn.isOffHand;
            
            let inventory = playerData.inventory || [];
            // เช็คว่ามีซากเดิมอยู่ไหม จะได้ stack
            const existingIdx = inventory.findIndex(i => i.name === itemToReturn.name && i.durability === 0);
            
            if(existingIdx > -1) inventory[existingIdx].quantity++; 
            else inventory.push(itemToReturn);
            
            updates[`inventory`] = inventory;
            
            await playerRef.update(updates);
            
            // จบเทิร์นทันทีเพราะอาวุธพังโจมตีต่อไม่ได้
            await endPlayerTurn(uid, roomId); 
            document.getElementById('rollResultCard').classList.add('hidden');
            return; 
        } else {
            // ลดความทนทานปกติ
            await playerRef.child('equippedItems/mainHand/durability').set(newDurability);
            playerData.equippedItems.mainHand.durability = newDurability;
        }
    }

    // =========================================================
    // ส่วนที่ 2: คำนวณความเสียหาย (Damage Calculation)
    // =========================================================
    
    const diceTypeString = mainWeapon?.damageDice || 'd4';
    const diceType = parseInt(diceTypeString.replace('d', ''));
    
    // เลื่อนจอไปหาลูกเต๋า
    const animArea = document.getElementById('player-dice-animation-area');
    if(animArea) animArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // เริ่มอนิเมชันทอยเต๋า
    const { total: damageRoll } = await showDiceRollAnimation(1, diceType, 'player-dice-animation-area', 'dice-result', null);

    // เลือก Stat ที่ใช้คำนวณ (STR หรือ DEX)
    let damageStat = 'STR';
    const magicClasses = ['นักเวท', 'จอมเวท', 'มหาจอมเวท', 'Mage Master', 'นักบวช', 'นักปราชญ์', 'มหาปราชญ์', 'สตรีศักดิ์สิทธิ์'];
    const magicWeapons = ['คทา', 'ไม้เท้า', 'หนังสือเวท'];
    
    if (magicClasses.includes(playerData.classMain) || (mainWeapon && magicWeapons.includes(mainWeapon.weaponType))) {
        // ใช้ค่าที่มากกว่าระหว่าง INT หรือ WIS
        const intVal = calculateTotalStat(playerData, 'INT');
        const wisVal = calculateTotalStat(playerData, 'WIS');
        damageStat = intVal > wisVal ? 'INT' : 'WIS';
    }
    else if (mainWeapon && ( 
        (mainWeapon.weaponType === 'มีด' && (playerData.classMain === 'โจร' || playerData.classMain === 'นักฆ่า')) || 
        (mainWeapon.weaponType === 'ธนู' && (playerData.classMain === 'เรนเจอร์' || playerData.classMain === 'อาเชอร์')) ||
        (mainWeapon.weaponType === 'หน้าไม้')
    )) damageStat = 'DEX';

    let damageBonus = getStatBonus(calculateTotalStat(playerData, damageStat));
    
    let totalDamage = Math.max(1, damageRoll + damageBonus);
    let damageExplanation = `ทอย (${diceTypeString}): ${damageRoll} + ${damageStat} Bonus: ${damageBonus}`;

    const elementBuff = playerData.activeEffects?.find(e => e.type === 'WEAPON_BUFF_ELEMENTAL' || e.type === 'ELEMENTAL_BUFF');
    let attackElement = 'PHYSICAL';

    if (elementBuff) {
        attackElement = elementBuff.amount || 'MAGIC'; // เช่น 'FIRE'
        // (Optional) เพิ่มดาเมจธาตุ? หรือแค่เปลี่ยนประเภท
        damageExplanation += ` [ธาตุ: ${attackElement}]`;
    } else if (mainWeapon && mainWeapon.element) { // กรณีอาวุธมีธาตุในตัว
        attackElement = mainWeapon.element;
    }
    
    // --- ตรวจสอบ Passive พิเศษ (Override Formula) ---
    const formulaOverrideEffect = (playerData.activeEffects || []).find(e => e.stat === 'WeaponAttack' && e.modType === 'FORMULA' && e.buffId);
    let formulaPassive = null;
    
    // เช็ค Passive จากอาชีพหลัก/รอง
    if (playerData.classMain && SKILL_DATA[playerData.classMain]) {
        formulaPassive = SKILL_DATA[playerData.classMain].find(s => s.skillTrigger === 'PASSIVE' && s.effect?.type === 'FORMULA_ATTACK_OVERRIDE');
    }
    if (!formulaPassive && playerData.classSub && SKILL_DATA[playerData.classSub]) {
        formulaPassive = SKILL_DATA[playerData.classSub].find(s => s.skillTrigger === 'PASSIVE' && s.effect?.type === 'FORMULA_ATTACK_OVERRIDE');
    }

    const formulaSource = formulaOverrideEffect || (formulaPassive ? formulaPassive.effect : null);

    // ถ้ามีสูตรพิเศษ (เช่น ดาบเวทย์, ตีเป็น %HP) ให้คำนวณใหม่
    if (formulaSource) {
        const formulaId = formulaSource.buffId || formulaSource.formula;
        const targetCurrentHp = targetData.hp || 0;
        const intBonus = getStatBonus(calculateTotalStat(playerData, 'INT'));
        const wisBonus = getStatBonus(calculateTotalStat(playerData, 'WIS'));
        const strBonus = getStatBonus(calculateTotalStat(playerData, 'STR'));
        
        switch (formulaId) {
            case 'HOLY_LIGHT_FORMULA_ATTACK': 
                totalDamage = (damageRoll + damageBonus) + Math.floor(targetCurrentHp * 0.05); 
                damageExplanation = `[ดาบแห่งแสง] Base + 5%HP`; 
                break;
            case 'MAGE_PASSIVE_V1': 
                totalDamage = (damageRoll + intBonus) + Math.floor(targetCurrentHp * 0.03); 
                damageExplanation = `[เวทย์ติดตัว] Base + 3%HP`; 
                break;
            case 'MAGE_PASSIVE_V2': totalDamage = (damageRoll + intBonus + wisBonus) + Math.floor(targetCurrentHp * 0.05); break;
            case 'MAGE_PASSIVE_V3': totalDamage = (damageRoll + intBonus + wisBonus) + Math.floor(targetCurrentHp * 0.08); break;
            case 'MAGE_PASSIVE_V4': totalDamage = (damageRoll + intBonus + wisBonus) + Math.floor(targetCurrentHp * 0.10); break;
            
            case 'MS_RUNE_BLADE_V1': totalDamage = (damageRoll + intBonus) + Math.floor(targetCurrentHp * 0.05); break;
            case 'MS_ARCANE_SLASH_V1': totalDamage = (damageRoll + strBonus + intBonus) + Math.floor(targetCurrentHp * 0.08); break;
            case 'MS_ARCANE_SLASH_V2': totalDamage = (damageRoll + strBonus + intBonus) + Math.floor(targetCurrentHp * 0.10); break;
            case 'MS_ARCANE_SLASH_V3': totalDamage = (damageRoll + strBonus + intBonus) + Math.floor(targetCurrentHp * 0.12); break;
            
            case 'DL_PASSIVE_V1': 
                const demonStatBonus = Math.max(strBonus, intBonus); 
                totalDamage = (damageRoll + demonStatBonus) + Math.floor(targetCurrentHp * 0.10); 
                break;
            
            case 'HOLY_LADY_JUDGMENT': 
                totalDamage = Math.floor(targetCurrentHp * 0.50); 
                damageExplanation = `[การพิพากษา] 50% ของเลือดปัจจุบัน`; 
                break;
                
            case 'BOW_MASTER_EXECUTE': 
                const dex = getStatBonus(calculateTotalStat(playerData, 'DEX'));
                const wis = getStatBonus(calculateTotalStat(playerData, 'WIS'));
                const roll = Math.floor(Math.random()*20)+1;
                const percent = Math.min(20, (roll + dex + wis)); 
                totalDamage = (damageRoll + damageBonus) + Math.floor(targetCurrentHp * (percent / 100));
                damageExplanation = `[เนตรสังหาร] Base + ${percent}%HP`;
                break;
        }
        // ดาเมจต้องไม่ต่ำกว่า 1
        totalDamage = Math.max(1, totalDamage);
    }

    if (attackElement !== 'PHYSICAL') {
        const reactionResult = checkElementalReaction(targetData, attackElement);
        if (reactionResult) {
            totalDamage = Math.floor(totalDamage * reactionResult.multiplier);
            damageExplanation += ` <br>🔥 <strong>${reactionResult.name}!</strong> (x${reactionResult.multiplier})`;
            // ส่ง Effect เพิ่มเติมถ้ามี (เช่น แช่แข็ง)
            if (reactionResult.status) {
                // ต้องส่งคำสั่งติดสถานะเพิ่ม (ซับซ้อนหน่อย แต่ทำได้โดยการเรียก applyEffect แบบเงียบๆ หรือฝากไปกับ pendingAttack)
                showAlert(`เกิดปฏิกิริยา: ${reactionResult.name}!`, 'success');
            }
        }
        
        // แปะสถานะธาตุใส่ศัตรู (ถ้ายังไม่ติด)
        applyElementalStatusToTarget(roomId, selectedTargetKey, combatState.type, attackElement);
    }

    // แสดงการ์ดผลลัพธ์
    const resultCard = document.getElementById('rollResultCard'); 
    resultCard.innerHTML = `<h4>ผลความเสียหาย: ${targetData.name}</h4><p>${damageExplanation} = <strong>${totalDamage}</strong></p><p class="outcome">🔥 สร้างความเสียหาย ${totalDamage} หน่วย! 🔥</p>`; 
    resultCard.className = 'result-card hit';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // =========================================================
    // ส่วนที่ 3: ส่งข้อมูล (PvP vs PvE)
    // =========================================================
    
    if (combatState.type === 'PVP') {
        // ⭐ [PvP] ดึงค่า Attack Roll จริงๆ ที่ฝากไว้ใน attribute
        let realAttackRoll = parseInt(document.getElementById('damageRollSection').getAttribute('data-attack-val'));
        
        // (กันเหนียว: ถ้าหาไม่เจอ ให้ใช้ค่ากลางๆ เพื่อให้ระบบไม่พัง)
        if (isNaN(realAttackRoll)) realAttackRoll = 15;

        const pendingAttackData = {
            attackerKey: uid,
            attackerName: playerData.name,
            attackRollValue: realAttackRoll, // ใช้ค่าจริงที่ดึงมา
            initialDamage: totalDamage,
            isPvP: true 
        };

        // ส่งข้อมูลไปให้ฝ่ายตรงข้าม
        await targetRef.child('pendingAttack').set(pendingAttackData);
        
        // แจ้งเตือนฝั่งคนตี
        resultCard.innerHTML += `<p style="color:#ffc107; font-size:0.9em; margin-top:5px;">⏳ รอฝ่ายตรงข้ามตอบสนอง...</p>`;
        
    } else {
        // ⭐ [PvE] ตีมอนสเตอร์ (ตัดเลือดเลย)
        const newHp = (targetData.hp || 0) - totalDamage;
        setTimeout(async () => {
            const finalHp = Math.max(0, newHp);
            await targetRef.child('hp').set(finalHp);
            await endPlayerTurn(uid, roomId);
            resultCard.classList.add('hidden');
        }, 2500); 
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

