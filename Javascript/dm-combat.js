
// =================================================================================

async function advanceTurn() {
    const roomId = sessionStorage.getItem('roomId');
    const combatRef = db.ref(`rooms/${roomId}/combat`);

    const snapshot = await combatRef.get();
    const currentCombatState = snapshot.val() || {};
    if (!currentCombatState.isActive) return;

    // 1. Process Global Effects (DoT/HoT)
    try {
        await processGlobalEffects(roomId);
    } catch (err) {
        console.error("Error processing global effects:", err);
    }

    // 2. Find Next Unit
    let nextIndex = (currentCombatState.currentTurnIndex + 1) % currentCombatState.turnOrder.length;
    const maxSkips = currentCombatState.turnOrder.length;
    let skips = 0;

    // วนหาคนที่ยังไม่ตาย
    while (skips < maxSkips) {
        const nextUnit = currentCombatState.turnOrder[nextIndex];
        let isDead = false;

        if (nextUnit.type === 'player') {
            isDead = (allPlayersDataByUID[nextUnit.id]?.hp || 0) <= 0;
        } else if (nextUnit.type === 'enemy') {
            isDead = (allEnemies[nextUnit.id]?.hp || 0) <= 0;
        }

        if (isDead) {
            console.log(`Skipping turn for dead unit: ${nextUnit.name}`);
            nextIndex = (nextIndex + 1) % currentCombatState.turnOrder.length;
            skips++;
        } else break;
    }

    if (skips === maxSkips) {
        endCombat(); 
        return;
    }

    const nextUnit = currentCombatState.turnOrder[nextIndex];
    let unitRef;

    // 3. Cooldown Reduction logic
    if (nextUnit.type === 'player') {
        unitRef = db.ref(`rooms/${roomId}/playersByUid/${nextUnit.id}`);
    } else { 
        unitRef = db.ref(`rooms/${roomId}/enemies/${nextUnit.id}`);
    }

    if (unitRef) {
        await unitRef.transaction(unitData => {
            if (!unitData) return unitData; 

            // ลด Active Effects
            if (Array.isArray(unitData.activeEffects)) {
                unitData.activeEffects.forEach(effect => {
                    if (effect.turnsLeft > 0) effect.turnsLeft--;
                });
                unitData.activeEffects = unitData.activeEffects.filter(effect => effect.turnsLeft > 0);
            }
            
            // ลด Skill Cooldowns
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

    lastProcessedTurnIndex = -1;
    await combatRef.child('currentTurnIndex').set(nextIndex);
    await combatRef.child('lastUpdated').set(Date.now());

    const display = document.getElementById('dm-roll-result-display');
    if (display) display.innerHTML = 'รอการดำเนินการ...';
}

async function endCombat() {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;

    showLoading("กำลังจบการต่อสู้...");

    try {
        const updates = {};
        updates[`rooms/${roomId}/combat`] = null;
        
        // จัดการศัตรู/ซัมมอน
        Object.keys(allEnemies).forEach(key => {
            const enemy = allEnemies[key];
            // ลบซัมมอนฝ่ายผู้เล่น
            if (enemy.type === 'player_summon') {
                updates[`rooms/${roomId}/enemies/${key}`] = null;
            } 
            else {
                // รีเซ็ตมอนสเตอร์
                updates[`rooms/${roomId}/enemies/${key}/activeEffects`] = [];
                updates[`rooms/${roomId}/enemies/${key}/skillCooldowns`] = {};
            }
        });

        // รีเซ็ตผู้เล่น
        Object.keys(allPlayersDataByUID).forEach(uid => {
            updates[`rooms/${roomId}/playersByUid/${uid}/activeEffects`] = [];
            updates[`rooms/${roomId}/playersByUid/${uid}/skillCooldowns`] = {};
        });

        lastProcessedTurnIndex = -1;
        await db.ref().update(updates);

        hideLoading();
        showCustomAlert('การต่อสู้จบลงแล้ว', 'info');
        
    } catch (error) {
        hideLoading();
        console.error("Error ending combat:", error);
        showCustomAlert('เกิดข้อผิดพลาดในการจบการต่อสู้', 'error');
    }
}

function calculateThreatScore(target, attacker) {
    let score = 0;
    
    // 1. ตรวจสอบสถานะ TAUNT (ยั่วยุ)
    const tauntEffect = target.activeEffects?.find(e => e.type === 'TAUNT');
    if (tauntEffect) {
        // ถ้าคนนี้ยั่วยุเรา หรือยั่วยุรวม -> ให้คะแนนมหาศาล
        if (tauntEffect.taunterUid === target.id || !tauntEffect.taunterUid) {
            return 10000; 
        }
    }

    // ข้อมูลพื้นฐาน
    const hp = target.hp || 0;
    const maxHp = target.maxHp || 100;
    const hpPercent = (hp / maxHp) * 100;
    
    // 2. Kill Secure: ถ้า HP ต่ำมาก (เช่น < 15) มีโอกาสตายในทีเดียว -> เล็งก่อน
    if (hp <= 15) score += 500;
    
    // 3. Focus Weakness: เล็งคน HP % น้อยๆ
    if (hpPercent < 30) score += 200;
    else if (hpPercent < 50) score += 100;

    // 4. Class Priority: เล็งอาชีพตัวบาง หรือ ฮีลเลอร์ (ถ้าเป็นผู้เล่น)
    if (target.type === 'player') {
        const priorityClasses = ['นักเวท', 'นักบวช', 'โจร', 'เรนเจอร์', 'จอมเวท', 'สตรีศักดิ์สิทธิ์'];
        if (priorityClasses.includes(target.classMain)) score += 50;
        
        // ลดความสนใจ Tank
        if (target.classMain === 'แทงค์' || target.classMain === 'Tank Master') score -= 50;
    }

    // 5. Random Factor: สุ่มคะแนนเล็กน้อย (0-30) เพื่อไม่ให้บอทเดาทางง่ายเกินไป
    score += Math.floor(Math.random() * 30);

    return score;
}

async function processAutoTurn(currentUnit, combatState) {
    const roomId = sessionStorage.getItem('roomId');

    // ป้องกันการรันซ้ำ
    if (combatState.currentTurnIndex === lastProcessedTurnIndex) return; 
    lastProcessedTurnIndex = combatState.currentTurnIndex;
    
    const unitData = allEnemies[currentUnit.id];
    if (!unitData) return;

    const isPlayerSummon = unitData.type === 'player_summon';
    const display = document.getElementById('dm-roll-result-display');
    
    if (display) {
        const color = isPlayerSummon ? '#00e676' : '#ff4d4d';
        display.innerHTML = `<span style="color:${color};">🤖 ${currentUnit.name} กำลังคำนวณเป้าหมาย...</span>`;
    }

    setTimeout(async () => {
        // 1. ระบุทีมและหาเป้าหมายทั้งหมดที่เป็นไปได้
        let potentialTargets = [];
        const latestEnemiesSnap = await db.ref(`rooms/${roomId}/enemies`).get();
        const latestEnemies = latestEnemiesSnap.val() || {};

        if (isPlayerSummon) {
            // ซัมมอนฝ่ายผู้เล่น: ตีศัตรู (Enemy) ที่ไม่ใช่ซัมมอนฝ่ายเดียวกัน
            potentialTargets = Object.keys(latestEnemies)
                .filter(k => k !== currentUnit.id && latestEnemies[k].type !== 'player_summon' && latestEnemies[k].hp > 0)
                .map(id => ({ id, ...latestEnemies[id], targetType: 'enemy' }));
        } else {
            // มอนสเตอร์/ศัตรู: ตีผู้เล่น + ซัมมอนฝ่ายผู้เล่น
            for (const uid in allPlayersDataByUID) {
                if ((allPlayersDataByUID[uid].hp || 0) > 0) {
                    potentialTargets.push({ id: uid, ...allPlayersDataByUID[uid], targetType: 'player' });
                }
            }
            for (const key in latestEnemies) {
                if (latestEnemies[key].type === 'player_summon' && latestEnemies[key].hp > 0) {
                    potentialTargets.push({ id: key, ...latestEnemies[key], targetType: 'summon' });
                }
            }
        }

        // กรณีไม่เหลือเป้าหมาย
        if (potentialTargets.length === 0) {
            if(display) display.innerHTML = `<span>...ไม่พบเป้าหมาย ข้ามเทิร์น...</span>`;
            setTimeout(() => advanceTurn(), 1000);
            return;
        }

        // 2. คำนวณคะแนน (Scoring) เพื่อหาเป้าหมายที่ดีที่สุด
        potentialTargets.forEach(t => {
            t.threatScore = calculateThreatScore(t, unitData);
        });

        // เรียงลำดับจากคะแนนมากไปน้อย
        potentialTargets.sort((a, b) => b.threatScore - a.threatScore);

        // เลือกตัวที่มีคะแนนสูงสุด (Best Target)
        const bestTarget = potentialTargets[0];
        
        // Debug Log (ดูใน Console ว่าบอทคิดอะไร)
        console.log(`[AI] ${currentUnit.name} chose target: ${bestTarget.name} (Score: ${bestTarget.threatScore})`);

        // 3. สั่งโจมตี
        await executeAttack(currentUnit.id, bestTarget.id, true);

    }, 1500); // หน่วงเวลาเล็กน้อยให้ผู้เล่นเห็นว่าบอทกำลังคิด
}

async function executeAttack(attackerId, targetId, isAuto = false) {
  const roomId = sessionStorage.getItem('roomId');
  const display = document.getElementById('dm-roll-result-display');

  // ดึงข้อมูล Attacker
  const attackerData = allEnemies[attackerId];
  if (!attackerData) return; // ถ้าคนตีตายหรือหายไปแล้ว ให้จบ

  // ดึงข้อมูล Target (รองรับทั้ง Player และ Enemy/Summon)
  let targetData = allPlayersDataByUID[targetId];
  let targetType = 'player';

  if (!targetData && allEnemies[targetId]) {
    targetData = allEnemies[targetId];
    targetType = 'summon'; // หรือ enemy
  }

  if (!targetData) {
    if (!isAuto) showCustomAlert('ไม่พบข้อมูลเป้าหมาย!', 'error');
    // ถ้าบอทหาไม่เจอ ให้ข้ามเทิร์นไปเลย
    if (isAuto) setTimeout(() => advanceTurn(), 1000);
    return;
  }

  if (!isAuto && display) display.innerHTML = 'กำลังคำนวณการโจมตี...';

  // 1. Attack Roll (d20 + STR/DEX Bonus)
  const strStat = (attackerData.stats && attackerData.stats.STR) ? attackerData.stats.STR : 10;
  const strBonus = Math.floor((strStat - 10) / 2);

  let rollResult = 0;
  if (isAuto) {
    rollResult = Math.floor(Math.random() * 20) + 1;
  } else {
    // ถ้า DM กดเอง ให้มี Animation
    const animObj = await showDiceRollAnimation(1, 20, 'dm-dice-animation-area', 'dmDiceResult', null);
    rollResult = animObj.total;
  }
  
  const totalAttack = rollResult + strBonus;
  const isCrit = (rollResult === 20); // Critical Hit

  // 2. Target AC Calculation
  let targetDex = 10;
  let targetCon = 10; // ใช้ CON แทน AC ชั่วคราวสำหรับมอนสเตอร์

  if (targetType === 'player') {
    targetDex = calculateTotalStat(targetData, 'DEX');
    targetCon = calculateTotalStat(targetData, 'CON');
  } else {
    targetDex = (targetData.stats?.DEX || 10);
    targetCon = (targetData.stats?.CON || 10);
  }

  const targetAC = 10 + Math.floor((targetDex - 10) / 2);

  // 3. Damage Calculation
  const damageDice = attackerData.damageDice || 'd6';
  const diceSize = parseInt(String(damageDice).replace('d', ''), 10) || 6;
  
  // ทอยดาเมจ (ถ้า Crit ทอย 2 เท่า)
  let dmgRoll = Math.floor(Math.random() * diceSize) + 1;
  if (isCrit) dmgRoll += Math.floor(Math.random() * diceSize) + 1;
  
  const initialDamage = Math.max(1, dmgRoll + strBonus);
  const attackElement = ElementalEngine.toId(attackerData.element || 0);

  // เตรียมตัวแปรสำหรับ Log
  let logMsg = '';
  let reactionText = '';
  let elementalLog = '';
  let actionChosen = 'none';
  let finalDamage = 0;
  let realDamageTaken = 0;
  let shieldLogs = [];

  // 4. Hit Check (Attack vs AC)
  if (totalAttack >= targetAC || isCrit) {
    let damageAfterDefense = initialDamage;

    // --- Auto Defense Logic (เฉพาะผู้เล่น) ---
    // บอทจะพยายาม Dodge/Block ให้ผู้เล่นอัตโนมัติถ้า DM เปิดใช้ หรือผู้เล่นไม่อยู่
    // (ในที่นี้เราจำลองว่าผู้เล่นไม่ได้กดปุ่ม Reaction ทันที)
    
    // **หมายเหตุ:** ปกติระบบ Player Reaction จะอยู่ใน player-dashboard 
    // โค้ดส่วนนี้คือ Fallback กรณีผู้เล่น AFK หรือเป็นซัมมอน
    if (targetType === 'player' && isAuto) {
         // (ละไว้: ให้ผู้เล่นกดเองผ่าน Popup ดีกว่า แต่ถ้าต้องการ Auto จริงๆ ให้ใส่ Logic ตรงนี้)
         // ปัจจุบัน: ยืนรับดาเมจไปก่อนเพื่อให้เกมไหลลื่น
    }

    // 5. Transaction Update
    const dbPath = (targetType === 'player') ? `playersByUid/${targetId}` : `enemies/${targetId}`;
    const targetRef = db.ref(`rooms/${roomId}/${dbPath}`);

    await targetRef.transaction(unit => {
      if (!unit) return unit;

      ElementalEngine.ensureSlots(unit);

      // คำนวณธาตุ (Elemental Engine)
      const eResult = ElementalEngine.process(unit, attackElement, damageAfterDefense);
      finalDamage = eResult.finalDamage;

      if (eResult.hasReaction) {
        elementalLog = `<br>💥 <b>[${eResult.reactionName}]</b> รุนแรงขึ้น!`;
      } else if (attackElement !== 0) {
        elementalLog = `<br>💧 ติดสถานะธาตุ: ${ElementalEngine.fmt(attackElement)}`;
      }

      // ตรวจสอบชนิดอาวุธ (เจาะเกราะ)
      const isPierce = attackerData.weaponType && (['หอก', 'มีด', 'ปืน', 'เจาะเกราะ'].includes(attackerData.weaponType));

      // คำนวณเกราะ (Shield Engine)
      if (typeof ElementalEngine.applyDamageWithShield === 'function') {
        const sResult = ElementalEngine.applyDamageWithShield(unit, finalDamage, isPierce);
        unit.hp = sResult.finalHp;
        unit.activeEffects = sResult.activeEffects || [];
        realDamageTaken = sResult.damageTaken || 0;
        shieldLogs = sResult.logs || [];
      } else {
        // Fallback
        unit.hp = (unit.hp || 0) - finalDamage;
        if (unit.hp <= 0) {
            unit.hp = 0;
        setTimeout(() => handleEnemyDeath(roomId, targetId, unit, attackerId), 100);
        }
      }

      // อัปเดตธาตุ
      unit.elementSlots = eResult.updatedSlots;

      return unit;
    });

    /* ================================================================================================================================*/

// ================= [NEW] ระบบจัดการเมื่อศัตรูตาย (Drops & Quests) =================

async function handleEnemyDeath(roomId, enemyKey, enemyData, killerId) {
    console.log(`💀 Enemy Died: ${enemyData.name} by ${killerId}`);
    
    // 1. แจก EXP (ถ้ามี)
    if (enemyData.expReward > 0) {
        // แจกทุกคนในห้อง หรือ เฉพาะคนฆ่า? -> เอาแบบหารเท่า หรือ แจกทุกคนดีกว่าเพื่อความง่าย
        // ในที่นี้แจกทุกคนที่อยู่ในห้อง (Party Share)
        const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
        if (playersSnap.exists()) {
            const updates = {};
            playersSnap.forEach(p => {
                const pData = p.val();
                let newExp = (pData.exp || 0) + enemyData.expReward;
                // เช็ค Level Up (Basic logic)
                // ... (ใส่ Logic Level Up ที่นี่ถ้าต้องการ) ...
                updates[`rooms/${roomId}/playersByUid/${p.key}/exp`] = newExp;
            });
            await db.ref().update(updates);
            
            // Log
            db.ref(`rooms/${roomId}/combatLogs`).push({
                message: `✨ <b>${enemyData.name}</b> ถูกกำจัด! ปาร์ตี้ได้รับ ${enemyData.expReward} EXP!`,
                timestamp: Date.now()
            });
        }
    }

    // 2. ระบบ Drop ไอเทม
    if (enemyData.drops && Array.isArray(enemyData.drops)) {
        let dropLogs = [];
        
        // ดึงข้อมูลคนฆ่า (เพื่อยัดของใส่กระเป๋า)
        // ถ้าคนฆ่าเป็น Monster/Summon ให้หา Owner หรือสุ่มผู้เล่น
        let realKillerId = killerId;
        // (Simplified: ให้คนฆ่าได้ของ ถ้าหาไม่เจอให้คนที่ 1 ในห้อง)
        
        const killerRef = db.ref(`rooms/${roomId}/playersByUid/${realKillerId}`);
        const killerSnap = await killerRef.get();
        
        if (killerSnap.exists()) {
            const killerInv = killerSnap.val().inventory || [];
            let invChanged = false;

            enemyData.drops.forEach(drop => {
                const roll = Math.random() * 100;
                if (roll <= drop.chance) {
                    // Drop Success!
                    // สร้างไอเทม
                    const newItem = {
                        name: drop.name,
                        quantity: 1,
                        itemType: 'ทั่วไป', // หรือจะระบุประเภทถ้าทำได้
                        price: drop.price || 0,
                        durability: 100, // ✅ เพิ่มบรรทัดนี้ เพื่อให้เหมือนไอเทมที่เสกจาก DM
                        maxDurability: 100, // ✅ และอันนี้ด้วย (ถ้ามีระบบซ่อม)
                        droppedFrom: enemyData.name
                    };

                    // Stack Logic (Simplified)
                    const existing = killerInv.find(i => i.name === newItem.name);
                    if (existing) existing.quantity++;
                    else killerInv.push(newItem);
                    
                    invChanged = true;
                    dropLogs.push(drop.name);
                }
            });

            if (invChanged) {
                await killerRef.child('inventory').set(killerInv);
                if (dropLogs.length > 0) {
                    db.ref(`rooms/${roomId}/combatLogs`).push({
                        message: `🎁 <b>${enemyData.name}</b> ดรอป: ${dropLogs.join(', ')} (เข้าตัว ${killerSnap.val().name})`,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    // 3. ระบบ Quest Auto-Update & Complete
    // วนลูปผู้เล่นทุกคน เช็คว่ามีเควสล่าตัวนี้ไหม
    const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
    playersSnap.forEach(async (pSnap) => {
        const uid = pSnap.key;
        const pData = pSnap.val();
        
        if (pData.activeQuest && pData.activeQuest.targetName === enemyData.name) {
            // ชื่อตรง!
            const q = pData.activeQuest;
            
            // เพิ่มจำนวน
            // (ใช้ Transaction เพื่อความชัวร์ หรือ update ดื้อๆ ก็ได้)
            const qRef = db.ref(`rooms/${roomId}/playersByUid/${uid}/activeQuest`);
            
            // อัปเดต +1
            let newCount = (q.currentCount || 0) + 1;
            await qRef.update({ currentCount: newCount });

            // เช็คว่าครบยัง?
            if (newCount >= q.targetCount) {
                // --- ภารกิจสำเร็จ! ---
                completePlayerQuest(roomId, uid, pData, q);
            }
        }
    });
}

// ฟังก์ชันจบเควสและแจกรางวัล
async function completePlayerQuest(roomId, uid, pData, quest) {
    const updates = {};
    const logs = [];

    // 1. รางวัลพื้นฐาน
    if (quest.rewardGP) {
        updates[`gp`] = (pData.gp || 0) + quest.rewardGP;
        logs.push(`${quest.rewardGP} GP`);
    }
    if (quest.rewardEXP) {
        updates[`exp`] = (pData.exp || 0) + quest.rewardEXP;
        logs.push(`${quest.rewardEXP} EXP`);
    }
    
    // 2. รางวัล Rank EXP (สำหรับเควสทั่วไป)
    if (quest.rewardRankExp) {
        updates[`rankExp`] = (pData.rankExp || 0) + quest.rewardRankExp;
        logs.push(`${quest.rewardRankExp} Rank EXP`);
    }

    // 3. รางวัลไอเทม
    if (quest.rewardItem) {
        const inv = pData.inventory || [];
        inv.push({ name: quest.rewardItem, quantity: 1, itemType: 'รางวัล' });
        updates[`inventory`] = inv;
        logs.push(`ไอเทม [${quest.rewardItem}]`);
    }

    // 4. รางวัลพิเศษ: เลื่อนขั้นอาชีพ (Promotion)
    if (quest.type === 'promotion' && quest.rewardClass) {
        updates[`classMain`] = quest.rewardClass;
        // อาจจะรีเซ็ต Level หรือเพิ่ม Stat Bonus ก็ได้ แล้วแต่ดีไซน์
        logs.push(`🎉 เลื่อนขั้นเป็น [${quest.rewardClass}]`);
    }

    // 5. รางวัลพิเศษ: เลื่อนขั้นแรงค์ (Rank Up)
    if (quest.type === 'rankup' && quest.rewardRank) {
        updates[`adventurerRank`] = quest.rewardRank;
        updates[`rankExp`] = 0; // รีเซ็ตแต้มแรงค์เมื่อขึ้นขั้นใหม่
        logs.push(`🏆 เลื่อนระดับนักผจญภัยเป็น Rank [${quest.rewardRank}]`);
    }

    // 6. ลบ Active Quest
    updates[`activeQuest`] = null;

    // Apply Updates
    await db.ref(`rooms/${roomId}/playersByUid/${uid}`).update(updates);

    // ประกาศ
    Swal.fire({
        title: 'ภารกิจสำเร็จ!',
        html: `คุณสำเร็จภารกิจ <b>${quest.title}</b><br>ได้รับ: ${logs.join(', ')}`,
        icon: 'success'
    });
    
    db.ref(`rooms/${roomId}/combatLogs`).push({
        message: `📜 <b>${pData.name}</b> สำเร็จภารกิจ [${quest.title}]! ได้รับรางวัล: ${logs.join(', ')}`,
        timestamp: Date.now()
    });
}


/* ================================================================================================================================*/

    // 6. สร้าง Log Message
    const color = (targetType === 'player' || targetData.type === 'player_summon') ? '#ff4d4d' : '#00ff00';
    const shieldTxt = (shieldLogs && shieldLogs.length) ? `<br>${shieldLogs.join('<br>')}` : '';
    const critTxt = isCrit ? ' <b style="color:red">CRITICAL!</b>' : '';
    
    logMsg = `<span style="color:${color};">⚔️ ${attackerData.name} โจมตีโดน${critTxt} <b>${realDamageTaken}</b>! ${reactionText} ${elementalLog}${shieldTxt}</span>`;

  } else {
    logMsg = `<span style="color:#aaa;">💨 ${attackerData.name} โจมตีพลาด! (Roll ${rollResult} vs AC ${targetAC})</span>`;
  }

  if (display) display.innerHTML = logMsg;

  const cleanMsg = logMsg.replace(/<br>/g, ' ').replace(/<[^>]*>?/gm, '');
  await db.ref(`rooms/${roomId}/combatLogs`).push({ message: cleanMsg, timestamp: Date.now() });

  // 7. จบเทิร์น
  if (!isAuto) {
    // ถ้า DM กดเอง ให้จบ Action แล้วรอ DM กด Next Turn เอง (หรือจะ Auto ก็ได้แล้วแต่ดีไซน์)
    setTimeout(() => db.ref(`rooms/${roomId}/combat/actionComplete`).set(attackerId), 1500);
  } else {
    // ถ้าเป็น Auto ให้ข้ามเทิร์นไปเลย
    setTimeout(() => advanceTurn(), 2000);
  }

  const attackButton = document.getElementById('enemy-attack-button');
  if (attackButton) attackButton.disabled = false;
}


async function dmPerformEnemyAttack() {
    const attackButton = document.getElementById('enemy-attack-button');
    if(attackButton) attackButton.disabled = true;

    if (!combatState || !combatState.turnOrder) return;
    
    const attackerUnit = combatState.turnOrder[combatState.currentTurnIndex];
    const targetId = document.getElementById('enemy-attack-target-select').value;

    if (!attackerUnit || !targetId) {
        showCustomAlert("กรุณาเลือกเป้าหมาย", "warning");
        if(attackButton) attackButton.disabled = false;
        return;
    }

    await executeAttack(attackerUnit.id, targetId, false);
}

function calculateRawDamage(attacker) {
    // ดึงค่าเต๋า เช่น "2d6" หรือ "d8"
    const diceString = attacker.damageDice || "d4"; 
    const strBonus = parseInt(attacker.stats?.STR || 0);
    
    // แปลง "2d6" -> count=2, type=6
    const parts = diceString.toLowerCase().split('d');
    let count = 1;
    let type = 6;
    
    if (parts.length === 2) {
        count = parseInt(parts[0]) || 1; // ถ้าเป็น "d6" parts[0] จะว่างหรือเป็น ""
        if (parts[0] === "") count = 1;
        type = parseInt(parts[1]) || 6;
    }
    
    let totalRoll = 0;
    for (let i = 0; i < count; i++) {
        totalRoll += Math.floor(Math.random() * type) + 1;
    }
    
    return totalRoll + strBonus; // อาจจะบวกโบนัสอื่นๆ เพิ่มตรงนี้ได้
}

async function handleDefenseResolution(resolution) {
    if (!resolution || Swal.isVisible()) return;

    const roomId = sessionStorage.getItem('roomId');
    const display = document.getElementById('dm-roll-result-display');
    const attackerUnit = combatState.turnOrder[combatState.currentTurnIndex];

    const defenderData = allPlayersDataByUID[resolution.defenderUid];
    const attackerData = allEnemies[resolution.attackerKey];
    if (!defenderData || !attackerData) return;
    
    const finalDamage = resolution.damageTaken || 0;
    
    let finalHtml = display.innerHTML.replace('<p style="color: #ffc107;">...กำลังรอการตอบสนองจากผู้เล่น (15 วินาที)...</p>', '');

    switch (resolution.choice) {
        case 'dodge':
            if (resolution.success) {
                finalHtml += `<p style="color: #00ff00;">🏃 <strong>${defenderData.name} หลบได้สำเร็จ!</strong> (ทอย ${resolution.roll})</p>`;
            } else {
                finalHtml += `<p style="color: #ff4d4d;">🏃 <strong>${defenderData.name} หลบไม่พ้น!</strong> (ทอย ${resolution.roll})</p>`;
            }
            break;
        case 'block':
            finalHtml += `<p style="color: #17a2b8;">🛡️ <strong>${defenderData.name} ป้องกัน!</strong> (ทอย ${resolution.roll})</p><p>ลดความเสียหาย ${resolution.damageReduced} หน่วย</p>`;
            break;
        case 'none':
            finalHtml += `<p style="color: #aaa;">😑 <strong>${defenderData.name} ไม่ป้องกัน!</strong></p>`;
            break;
    }
    
    finalHtml += `<p><strong>รับความเสียหายสุดท้าย ${finalDamage} หน่วย!</strong></p>`;

    const newHp = Math.max(0, defenderData.hp - finalDamage);
    await db.ref(`rooms/${roomId}/playersByUid/${resolution.defenderUid}/hp`).set(newHp);

    display.innerHTML = finalHtml;
    await db.ref(`rooms/${roomId}/combat/resolution`).remove();

    setTimeout(async () => {
        await db.ref(`rooms/${roomId}/combat/actionComplete`).set(attackerUnit.id);
    }, 3000);
}

function displayCombatState(state) {
    const inactiveView = document.getElementById('combat-inactive-view');
    const activeView = document.getElementById('combat-active-view');
    const turnOrderList = document.getElementById('turnOrderDisplay');
    const currentTurnActionPanel = document.getElementById('current-turn-action-panel');
    const playerTurnView = document.getElementById('player-turn-view');
    const enemyTurnView = document.getElementById('enemy-turn-view');
    const currentTurnUnitName = document.getElementById('current-turn-unit-name');
    const enemyAttackTargetSelect = document.getElementById('enemy-attack-target-select');
    const enemyAttackButton = document.getElementById('enemy-attack-button');

    if (!state || !state.isActive) {
        inactiveView.classList.remove('hidden');
        activeView.classList.add('hidden');
        currentTurnActionPanel.classList.add('hidden');
        return;
    }

    inactiveView.classList.add('hidden');
    activeView.classList.remove('hidden');
    currentTurnActionPanel.classList.remove('hidden');

    turnOrderList.innerHTML = '';
    state.turnOrder.forEach((unit, index) => {
        const li = document.createElement('li');
        li.textContent = `${unit.name} (DEX: ${unit.dex})`;
        if (index === state.currentTurnIndex) li.className = 'current-turn';
        turnOrderList.appendChild(li);
    });

    const currentUnit = state.turnOrder[state.currentTurnIndex];
    
    // ตรวจสอบชนิด
    const isSummon = currentUnit.isSummon === true || (currentUnit.type === 'enemy' && allEnemies[currentUnit.id]?.type === 'player_summon');
    const isNormalEnemy = currentUnit.type === 'enemy' && !isSummon;
    
    // ตรวจสอบโหมด Auto ของศัตรู
    const enemyData = allEnemies[currentUnit.id];
    const isAutoMode = enemyData?.isAuto === true;

    if (currentUnit.type === 'player') {
        currentTurnUnitName.textContent = `เทิร์นของ: ${currentUnit.name}`;
        playerTurnView.classList.remove('hidden');
        enemyTurnView.classList.add('hidden');
    } else {
        playerTurnView.classList.add('hidden');
        enemyTurnView.classList.remove('hidden');

        // --- ส่วนแสดงชื่อและปุ่ม Auto ---
        let autoBtnHtml = '';
        if (isNormalEnemy) {
            const btnColor = isAutoMode ? '#28a745' : '#6c757d';
            const btnText = isAutoMode ? '🤖 Auto: ON' : '👤 Manual';
            autoBtnHtml = `<button onclick="toggleEnemyAuto('${currentUnit.id}')" style="margin-left:10px; width:auto; padding:2px 8px; font-size:0.7em; background-color:${btnColor};">${btnText}</button>`;
        }
        
        if (isSummon) {
            currentTurnUnitName.innerHTML = `เทิร์นของ: <span style="color:#00e676;">${currentUnit.name} (ฝ่ายผู้เล่น)</span>`;
        } else {
            currentTurnUnitName.innerHTML = `เทิร์นของ: <span style="color:#ff4d4d;">${currentUnit.name}</span> ${autoBtnHtml}`;
        }

        // --- Logic การทำงาน ---
        if (isSummon || (isNormalEnemy && isAutoMode)) {
            // โหมด AI (ซัมมอน หรือ ศัตรูเปิดบอท)
            enemyAttackTargetSelect.innerHTML = '<option>🤖 กำลังทำงานอัตโนมัติ...</option>';
            enemyAttackTargetSelect.disabled = true;
            enemyAttackButton.disabled = true; 
            
            // เรียก AI รวม (ใช้ได้ทั้งซัมมอนและศัตรู)
            if (typeof processAutoTurn === 'function') processAutoTurn(currentUnit, state);
            
        } else {
            // โหมด Manual (DM คุมเอง)
            enemyAttackButton.disabled = false;
            enemyAttackTargetSelect.disabled = false;
            enemyAttackTargetSelect.innerHTML = '';
            
            // ใส่รายชื่อเป้าหมาย (ผู้เล่น + ซัมมอน)
            for (const uid in allPlayersDataByUID) {
                if ((allPlayersDataByUID[uid].hp || 0) > 0) {
                    enemyAttackTargetSelect.innerHTML += `<option value="${uid}">${allPlayersDataByUID[uid].name} (ผู้เล่น)</option>`;
                }
            }
            for (const key in allEnemies) {
                const en = allEnemies[key];
                if (en.type === 'player_summon' && (en.hp || 0) > 0) {
                    enemyAttackTargetSelect.innerHTML += `<option value="${key}">[ซัมมอน] ${en.name}</option>`;
                }
            }
            
            // เช็ค Taunt
            const tauntEffect = enemyData?.activeEffects?.find(e => e.type === 'TAUNT');
            if (tauntEffect) {
               enemyAttackTargetSelect.value = tauntEffect.taunterUid;
               enemyAttackTargetSelect.disabled = true; 
            }
        }
    }
}

async function startCombat() {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;

    const playerUpdates = {};
    for (const uid in allPlayersDataByUID) {
        playerUpdates[`/rooms/${roomId}/playersByUid/${uid}/skillCooldowns`] = {};
        playerUpdates[`/rooms/${roomId}/playersByUid/${uid}/activeEffects`] = [];
    }
    await db.ref().update(playerUpdates);
    
    const units = [];
    for (const uid in allPlayersDataByUID) {
        const player = allPlayersDataByUID[uid];
        if ((player.hp || 0) > 0) {
            units.push({
                id: uid,
                name: player.name,
                dex: calculateTotalStat(player, 'DEX'), 
                type: 'player'
            });
        }
    }
    for (const key in allEnemies) {
        const enemy = allEnemies[key];
        if ((enemy.hp || 0) > 0) {
            units.push({
                id: key,
                name: enemy.name,
                dex: enemy.stats ?.DEX || 10,
                type: 'enemy'
            });
        }
    }

    if (units.length < 2) {
        showCustomAlert('ต้องมีผู้เข้าร่วมต่อสู้อย่างน้อย 2 ฝ่าย!', 'warning');
        return;
    }

    units.sort((a, b) => b.dex - a.dex);

    const initialCombatState = {
        isActive: true,
        turnOrder: units,
        currentTurnIndex: 0
    };

    db.ref(`rooms/${roomId}/combat`).set(initialCombatState)
        .then(() => showCustomAlert('เริ่มการต่อสู้!', 'success'));
    
    if (state.isActive) {
        const currentUnit = state.turnOrder[state.currentTurnIndex];
        checkAndRunSummonAI(currentUnit, state);
    }
}

function forceAdvanceTurn() {
    Swal.fire({
        title: 'บังคับข้ามเทิร์น?',
        text: "คุณต้องการข้ามเทิร์นของผู้เล่นคนนี้ใช่หรือไม่?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ใช่, ข้ามเลย'
    }).then((result) => {
        if (result.isConfirmed) {
            const roomId = sessionStorage.getItem('roomId');
            const currentUnit = combatState.turnOrder[combatState.currentTurnIndex];
            db.ref(`rooms/${roomId}/combat/actionComplete`).set(currentUnit.id);
        }
    });
}

// =================================================================================
// 4. Write Functions (Player Management)
// =================================================================================

async function saveBasicInfo() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    if (!roomId || !uid) return;
    
    const currentPlayer = allPlayersDataByUID[uid];
    const newClassMain = document.getElementById("editClassMain").value;
    const newClassSub = document.getElementById("editClassSub").value || null; 
    const newRaceName = document.getElementById("editRace").value;
    
    const updates = {
        hp: parseInt(document.getElementById("editHp").value),
        gp: parseInt(document.getElementById("editGP").value) || 0,
        gender: document.getElementById("editGender").value,
        background: document.getElementById("editBackground").value,
        classMain: newClassMain,
        classSub: newClassSub,
        race: newRaceName,
        raceEvolved: document.getElementById("editRaceEvolved").value || null,
        info: {
            age: parseInt(document.getElementById("editAge").value) || 1,
            height: document.getElementById("editHeight").value || "",
            weight: document.getElementById("editWeight").value || "",
            appearance: document.getElementById("editAppearance").value || "",
            personality: document.getElementById("editPersonality").value || "",
            likes: document.getElementById("editLikes").value || "",
            dislikes: document.getElementById("editDislikes").value || ""
        }
    };

    if (newClassMain !== currentPlayer.classMain || newRaceName !== currentPlayer.race || newClassSub !== currentPlayer.classSub) {
        
        const newRaceStats = (typeof RACE_DATA !== 'undefined') ? (RACE_DATA[newRaceName]?.bonuses || {}) : {};
        const newClassStats = (typeof CLASS_DATA !== 'undefined') ? (CLASS_DATA[newClassMain]?.bonuses || {}) : {};
        
        updates['stats/baseRaceStats'] = newRaceStats;
        updates['stats/baseClassStats'] = newClassStats;

        const tempPlayer = { 
            ...currentPlayer, 
            classMain: newClassMain, 
            classSub: newClassSub, 
            race: newRaceName,
            stats: { 
                ...currentPlayer.stats, 
                baseRaceStats: newRaceStats,
                baseClassStats: newClassStats
            }
        };
        
        const hpUpdates = getHpUpdatePayload(tempPlayer);
        updates['maxHp'] = hpUpdates.maxHp;
        updates['hp'] = hpUpdates.hp; 
    }
    
    db.ref(`rooms/${roomId}/playersByUid/${uid}`).update(updates).then(() => {
        showCustomAlert("บันทึกข้อมูลทั่วไปเรียบร้อย!", 'success');
    });
}

async function saveStats() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    if (!roomId || !uid) return;

    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
    
    const tempStats = {
        STR: parseInt(document.getElementById('editSTRTemp').value) || 0,
        DEX: parseInt(document.getElementById('editDEXTemp').value) || 0,
        CON: parseInt(document.getElementById('editCONTemp').value) || 0,
        INT: parseInt(document.getElementById('editINTTemp').value) || 0,
        WIS: parseInt(document.getElementById('editWISTemp').value) || 0,
        CHA: parseInt(document.getElementById('editCHATemp').value) || 0,
    };

    try {
        await playerRef.transaction(playerData => {
            if (!playerData) return;

            // 1. คำนวณ Ratio เดิม
            const oldCon = calculateTotalStat(playerData, 'CON');
            const oldMaxHp = calculateHP(playerData.race, playerData.classMain, oldCon);
            const currentHp = playerData.hp || 0;
            const hpRatio = oldMaxHp > 0 ? (currentHp / oldMaxHp) : 0;

            // 2. อัปเดต Stats
            if (!playerData.stats) playerData.stats = {};
            playerData.stats.tempStats = tempStats;

            // 3. คำนวณ MaxHP ใหม่
            const newCon = calculateTotalStat(playerData, 'CON');
            const newMaxHp = calculateHP(playerData.race, playerData.classMain, newCon);

            // 4. [FIX] ปรับ HP ตาม % เดิม
            playerData.maxHp = newMaxHp;
            playerData.hp = Math.floor(newMaxHp * hpRatio);

            return playerData;
        });

        showCustomAlert(`บันทึกสถานะเรียบร้อย!`, 'success');

    } catch (error) { console.error(error); }
}
async function changeLevel(change) {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    if (!roomId || !uid) return;

    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);

    try {
        const snapshot = await playerRef.get();
        const player = snapshot.val();
        
        let newLevel = (player.level || 1) + change;
        if (newLevel < 1) newLevel = 1;

        let newFreePoints = player.freeStatPoints || 0;
        if (change > 0) newFreePoints += (change * 2);
        else if (change < 0 && player.level > 1) newFreePoints = Math.max(0, newFreePoints + (change * 2));
        
        const newExpToNext = getExpForNextLevel(newLevel);

        // จำลองข้อมูลเพื่อคำนวณ MaxHP ใหม่
        const tempPlayer = { ...player, level: newLevel };
        const finalCon = calculateTotalStat(tempPlayer, 'CON');
        const newMaxHp = calculateHP(tempPlayer.race, tempPlayer.classMain, finalCon);

        await playerRef.update({
            level: newLevel,
            freeStatPoints: newFreePoints,
            expToNextLevel: newExpToNext,
            maxHp: newMaxHp,
            hp: newMaxHp // [FIX] เลือดเต็มทันที (HP = MaxHP)
        });
        
        document.getElementById("editLevel").textContent = newLevel;
        document.getElementById("editFreeStatPoints").textContent = newFreePoints;

    } catch (error) {
        console.error(error);
    }
}

function applyTempLevel() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    if (!roomId || !uid) return;
    const tempLevel = parseInt(document.getElementById("tempLevelInput").value) || 0;
    
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);

    playerRef.transaction(player => {
        if (!player) return;
        
        // 1. Ratio เดิม
        const oldCon = calculateTotalStat(player, 'CON');
        const oldMaxHp = calculateHP(player.race, player.classMain, oldCon);
        const currentHp = player.hp || 0;
        const hpRatio = oldMaxHp > 0 ? (currentHp / oldMaxHp) : 0;

        // 2. ใส่บัฟ
        if (!player.activeEffects) player.activeEffects = [];
        player.activeEffects = player.activeEffects.filter(e => e.skillId !== 'dm_temp_level_buff');
        if (tempLevel !== 0) { 
            player.activeEffects.push({
                skillId: 'dm_temp_level_buff', name: 'DM Level Adjust', type: tempLevel > 0 ? 'BUFF' : 'DEBUFF',
                stat: 'Level', modType: 'FLAT', amount: tempLevel, turnsLeft: 999 
            });
        }

        // 3. MaxHP ใหม่
        const newCon = calculateTotalStat(player, 'CON');
        const newMaxHp = calculateHP(player.race, player.classMain, newCon);

        // 4. [FIX] ปรับ HP ตาม % เดิม
        player.maxHp = newMaxHp;
        player.hp = Math.floor(newMaxHp * hpRatio);

        return player;
    }).then(() => {
        showCustomAlert("ใช้บัฟเลเวลเรียบร้อย!", 'success');
    });
}
function clearTempLevel() { 
    document.getElementById("tempLevelInput").value = 0; 
    applyTempLevel();
}
function deletePlayer() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    if (!roomId || !uid) return;
    Swal.fire({
        title: 'ยืนยันการลบ?', text: `ต้องการลบ "${name}"?`, icon: 'warning',
        showCancelButton: true, confirmButtonText: 'ใช่, ลบเลย!'
    }).then((result) => {
        if (result.isConfirmed) db.ref(`rooms/${roomId}/playersByUid/${uid}`).remove();
    });
}

function awardExp() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    const awardExpAmountEl = document.getElementById("awardExpAmount");
    const amount = parseInt(awardExpAmountEl.value);
    
    if (!uid || !awardExpAmountEl || isNaN(amount) || amount <= 0) return showCustomAlert('กรุณาเลือกผู้เล่นและใส่ค่า EXP!', 'warning');
    
    const playerRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
    
    playerRef.transaction((player) => {
        if (player) {
            player.exp = (player.exp || 0) + amount;
            let levelUpCount = 0;
            
            while (player.exp >= player.expToNextLevel) {
                levelUpCount++;
                player.exp -= player.expToNextLevel;
                player.level = (player.level || 1) + 1;
                player.freeStatPoints = (player.freeStatPoints || 0) + 2;
                player.expToNextLevel = getExpForNextLevel(player.level);
            }
            
            if (levelUpCount > 0) {
                const currentCon = calculateTotalStat(player, 'CON'); 
                const newMaxHp = calculateHP(player.race, player.classMain, currentCon);
                
                player.maxHp = newMaxHp;
                // Level Up: Heal full or cap
                if (player.hp > newMaxHp) player.hp = newMaxHp;
                else player.hp = newMaxHp; 
            }
        }
        return player;
    }).then((result) => {
        if (result.committed) {
            showCustomAlert(`มอบ EXP ${amount} ให้ ${name} สำเร็จ!`, 'success');
            awardExpAmountEl.value = '';
        }
    }).catch(error => showCustomAlert('เกิดข้อผิดพลาดในการมอบ EXP!', 'error'));
}

// =================================================================================
//

async function processGlobalEffects(roomId) {
    const updates = {};
    const logs = [];

    // 1. ดึงข้อมูลทั้งหมดมาเช็ค (Players + Enemies)
    const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
    const enemiesSnap = await db.ref(`rooms/${roomId}/enemies`).get();

    const allUnits = [];
    
    if (playersSnap.exists()) {
        playersSnap.forEach(child => { allUnits.push({ type: 'player', id: child.key, data: child.val() }); });
    }
    if (enemiesSnap.exists()) {
        enemiesSnap.forEach(child => { allUnits.push({ type: 'enemy', id: child.key, data: child.val() }); });
    }

    // 2. วนลูปเช็คทุกคน
    for (const unit of allUnits) {
        let uData = unit.data;
        if (!uData.activeEffects || uData.activeEffects.length === 0) continue;

        let hpChanged = false;
        let effectsChanged = false;

        // เช็ค Effect ทีละตัว
        uData.activeEffects.forEach(eff => {
            // เงื่อนไข: เป็น DOT/HOT และทำงานแบบ GLOBAL
            if ((eff.type === 'DOT' || eff.type === 'HOT') && eff.tickOn === 'GLOBAL') {
                
                // คำนวณความแรง (รองรับ 'd4', 'd6' หรือตัวเลขเพียวๆ)
                let amount = 0;
                if (typeof eff.damageDice === 'string' && eff.damageDice.startsWith('d')) {
                    const die = parseInt(eff.damageDice.replace('d', '')) || 4;
                    amount = Math.floor(Math.random() * die) + 1;
                } else {
                    amount = parseInt(eff.amount || eff.damage) || 1;
                }

                // Apply ผลลัพธ์
                if (eff.type === 'DOT') {
                    uData.hp = (uData.hp || 0) - amount;
                    if (uData.hp < 0) uData.hp = 0;
                    logs.push(`⚡ <b>${uData.name}</b> โดน <b>${eff.name}</b> เสียหาย ${amount}`);
                } else if (eff.type === 'HOT') {
                    uData.hp = (uData.hp || 0) + amount;
                    if (uData.hp > uData.maxHp) uData.hp = uData.maxHp;
                    logs.push(`💚 <b>${uData.name}</b> ได้รับ <b>${eff.name}</b> ฟื้นฟู ${amount}`);
                }

                // ลดจำนวนเทิร์น
                eff.turnsLeft = (eff.turnsLeft || 0) - 1;
                
                hpChanged = true;
                effectsChanged = true;
            }
        });

        // 3. ลบ Effect ที่หมดเวลา (turnsLeft <= 0)
        if (effectsChanged) {
            const oldLen = uData.activeEffects.length;
            uData.activeEffects = uData.activeEffects.filter(e => e.turnsLeft > 0);
            
            if (uData.activeEffects.length < oldLen) {
                // มีบาง effect หายไป (หมดเวลา)
                effectsChanged = true; 
            }
        }

        // 4. เตรียมข้อมูลสำหรับอัปเดต Database
        if (hpChanged || effectsChanged) {
            const path = unit.type === 'player' 
                ? `rooms/${roomId}/playersByUid/${unit.id}` 
                : `rooms/${roomId}/enemies/${unit.id}`;
            
            updates[`${path}/hp`] = uData.hp;
            updates[`${path}/activeEffects`] = uData.activeEffects;
        }
    }

    // 5. บันทึกและแจ้งเตือน
    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }
    
    if (logs.length > 0) {
        // ส่ง Log ทีเดียวเพื่อประหยัดเน็ต
        await db.ref(`rooms/${roomId}/combatLogs`).push({
            message: logs.join('<br>'),
            timestamp: Date.now()
        });
    }
}

async function removeUnitFromTurnOrder(roomId, unitId, unitType) {
  const combatRef = db.ref(`rooms/${roomId}/combat`);
  const snap = await combatRef.get();
  if (!snap.exists()) return;

  const combat = snap.val();
  if (!combat.isActive || !Array.isArray(combat.turnOrder)) return;

  const oldOrder = combat.turnOrder;
  const idx = oldOrder.findIndex(u => u.id === unitId && u.type === unitType);
  if (idx === -1) return;

  const newOrder = oldOrder.filter((u, i) => i !== idx);

  let newIndex = combat.currentTurnIndex || 0;
  // ถ้าลบตัวก่อนหน้าดัชนีปัจจุบัน ต้องลด index ลง 1 กันชี้เพี้ยน
  if (idx < newIndex) newIndex = Math.max(0, newIndex - 1);

  // ถ้าลบ “คนที่กำลังจะเล่น” และคิวเหลือ ให้ดันเทิร์นต่อทันทีด้วยการ set index เดิม
  if (newOrder.length === 0) {
    await combatRef.set(null);
    return;
  }

  await combatRef.update({
    turnOrder: newOrder,
    currentTurnIndex: Math.min(newIndex, newOrder.length - 1),
    lastUpdated: Date.now()
  });
}



async function handleEnemyDeath(roomId, enemyKey, enemyData, killerId) {
    console.log(`💀 Enemy Died: ${enemyData.name} by ${killerId}`);
    
    // 1. แจก EXP (ถ้ามี)
    if (enemyData.expReward > 0) {
        // แจกทุกคนในห้อง หรือ เฉพาะคนฆ่า? -> เอาแบบหารเท่า หรือ แจกทุกคนดีกว่าเพื่อความง่าย
        // ในที่นี้แจกทุกคนที่อยู่ในห้อง (Party Share)
        const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
        if (playersSnap.exists()) {
            const updates = {};
            playersSnap.forEach(p => {
                const pData = p.val();
                let newExp = (pData.exp || 0) + enemyData.expReward;
                // เช็ค Level Up (Basic logic)
                // ... (ใส่ Logic Level Up ที่นี่ถ้าต้องการ) ...
                updates[`rooms/${roomId}/playersByUid/${p.key}/exp`] = newExp;
            });
            await db.ref().update(updates);
            
            // Log
            db.ref(`rooms/${roomId}/combatLogs`).push({
                message: `✨ <b>${enemyData.name}</b> ถูกกำจัด! ปาร์ตี้ได้รับ ${enemyData.expReward} EXP!`,
                timestamp: Date.now()
            });
        }
    }

    // 2. ระบบ Drop ไอเทม
    if (enemyData.drops && Array.isArray(enemyData.drops)) {
        let dropLogs = [];
        
        // ดึงข้อมูลคนฆ่า (เพื่อยัดของใส่กระเป๋า)
        // ถ้าคนฆ่าเป็น Monster/Summon ให้หา Owner หรือสุ่มผู้เล่น
        let realKillerId = killerId;
        // (Simplified: ให้คนฆ่าได้ของ ถ้าหาไม่เจอให้คนที่ 1 ในห้อง)
        
        const killerRef = db.ref(`rooms/${roomId}/playersByUid/${realKillerId}`);
        const killerSnap = await killerRef.get();
        
        if (killerSnap.exists()) {
            const killerInv = killerSnap.val().inventory || [];
            let invChanged = false;

            enemyData.drops.forEach(drop => {
                const roll = Math.random() * 100;
                if (roll <= drop.chance) {
                    // Drop Success!
                    // สร้างไอเทม
                    const newItem = {
                        name: drop.name,
                        quantity: 1,
                        itemType: 'ทั่วไป', // หรือจะระบุประเภทถ้าทำได้
                        price: drop.price || 0,
                        durability: 100, // ✅ เพิ่มบรรทัดนี้ เพื่อให้เหมือนไอเทมที่เสกจาก DM
                        maxDurability: 100, // ✅ และอันนี้ด้วย (ถ้ามีระบบซ่อม)
                        droppedFrom: enemyData.name
                    };

                    // Stack Logic (Simplified)
                    const existing = killerInv.find(i => i.name === newItem.name);
                    if (existing) existing.quantity++;
                    else killerInv.push(newItem);
                    
                    invChanged = true;
                    dropLogs.push(drop.name);
                }
            });

            if (invChanged) {
                await killerRef.child('inventory').set(killerInv);
                if (dropLogs.length > 0) {
                    db.ref(`rooms/${roomId}/combatLogs`).push({
                        message: `🎁 <b>${enemyData.name}</b> ดรอป: ${dropLogs.join(', ')} (เข้าตัว ${killerSnap.val().name})`,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    // 3. ระบบ Quest Auto-Update & Complete
    // วนลูปผู้เล่นทุกคน เช็คว่ามีเควสล่าตัวนี้ไหม
    const playersSnap = await db.ref(`rooms/${roomId}/playersByUid`).get();
    playersSnap.forEach(async (pSnap) => {
        const uid = pSnap.key;
        const pData = pSnap.val();
        
        if (pData.activeQuest && pData.activeQuest.targetName === enemyData.name) {
            // ชื่อตรง!
            const q = pData.activeQuest;
            
            // เพิ่มจำนวน
            // (ใช้ Transaction เพื่อความชัวร์ หรือ update ดื้อๆ ก็ได้)
            const qRef = db.ref(`rooms/${roomId}/playersByUid/${uid}/activeQuest`);
            
            // อัปเดต +1
            let newCount = (q.currentCount || 0) + 1;
            await qRef.update({ currentCount: newCount });

            // เช็คว่าครบยัง?
            if (newCount >= q.targetCount) {
                // --- ภารกิจสำเร็จ! ---
                completePlayerQuest(roomId, uid, pData, q);
            }
        }
    });
}

async function completePlayerQuest(roomId, uid, pData, quest) {
    const updates = {};
    const logs = [];

    // 1. รางวัลพื้นฐาน
    if (quest.rewardGP) {
        updates[`gp`] = (pData.gp || 0) + quest.rewardGP;
        logs.push(`${quest.rewardGP} GP`);
    }
    if (quest.rewardEXP) {
        updates[`exp`] = (pData.exp || 0) + quest.rewardEXP;
        logs.push(`${quest.rewardEXP} EXP`);
    }
    
    // 2. รางวัล Rank EXP (สำหรับเควสทั่วไป)
    if (quest.rewardRankExp) {
        updates[`rankExp`] = (pData.rankExp || 0) + quest.rewardRankExp;
        logs.push(`${quest.rewardRankExp} Rank EXP`);
    }

    // 3. รางวัลไอเทม
    if (quest.rewardItem) {
        const inv = pData.inventory || [];
        inv.push({ name: quest.rewardItem, quantity: 1, itemType: 'รางวัล' });
        updates[`inventory`] = inv;
        logs.push(`ไอเทม [${quest.rewardItem}]`);
    }

    // 4. รางวัลพิเศษ: เลื่อนขั้นอาชีพ (Promotion)
    if (quest.type === 'promotion' && quest.rewardClass) {
        updates[`classMain`] = quest.rewardClass;
        // อาจจะรีเซ็ต Level หรือเพิ่ม Stat Bonus ก็ได้ แล้วแต่ดีไซน์
        logs.push(`🎉 เลื่อนขั้นเป็น [${quest.rewardClass}]`);
    }

    // 5. รางวัลพิเศษ: เลื่อนขั้นแรงค์ (Rank Up)
    if (quest.type === 'rankup' && quest.rewardRank) {
        updates[`adventurerRank`] = quest.rewardRank;
        updates[`rankExp`] = 0; // รีเซ็ตแต้มแรงค์เมื่อขึ้นขั้นใหม่
        logs.push(`🏆 เลื่อนระดับนักผจญภัยเป็น Rank [${quest.rewardRank}]`);
    }

    // 6. ลบ Active Quest
    updates[`activeQuest`] = null;

    // Apply Updates
    await db.ref(`rooms/${roomId}/playersByUid/${uid}`).update(updates);

    // ประกาศ
    Swal.fire({
        title: 'ภารกิจสำเร็จ!',
        html: `คุณสำเร็จภารกิจ <b>${quest.title}</b><br>ได้รับ: ${logs.join(', ')}`,
        icon: 'success'
    });
    
    db.ref(`rooms/${roomId}/combatLogs`).push({
        message: `📜 <b>${pData.name}</b> สำเร็จภารกิจ [${quest.title}]! ได้รับรางวัล: ${logs.join(', ')}`,
        timestamp: Date.now()
    });
}