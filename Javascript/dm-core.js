// --- Global State ---
let allPlayersDataByUID = {};
let allEnemies = {};
let combatState = {};
let previousPlayerHps = {};
let previousEnemyHps = {};
let currentShopListener = null;
let lastProcessedTurnIndex = -1;

// Consts
const ALL_CLASSES = (typeof CLASS_DATA !== 'undefined') ? Object.keys(CLASS_DATA) : [];
const ALL_RACES = (typeof RACE_DATA !== 'undefined') ? Object.keys(RACE_DATA) : [];
const ALL_WEAPON_TYPES = (typeof CLASS_WEAPON_PROFICIENCY !== 'undefined') ? 
    [...new Set(Object.values(CLASS_WEAPON_PROFICIENCY).flat())] : 
    ['ดาบ', 'ขวาน', 'ดาบใหญ่', 'หอก', 'มีด', 'ธนู', 'หน้าไม้', 'ดาบสั้น', 'อาวุธซัด', 'คทา', 'ไม้เท้า', 'หนังสือเวท', 'ค้อน', 'กระบอง', 'โล่', 'อาวุธทื่อ'];

// =================================================================================
// 1. Utility Functions
// =================================================================================

function showCustomAlert(message, iconType = 'info') {
    // เรียก SweetAlert โดยตรง ไม่ต้องเช็คเงื่อนไขอื่น
    Swal.fire({
        title: iconType === 'success' ? 'สำเร็จ!' : iconType === 'error' ? 'ข้อผิดพลาด!' : 'แจ้งเตือน',
        text: message,
        icon: iconType,
        timer: 2000,
        showConfirmButton: false
    });
}

function getStatBonusFn(statValue) {
    const value = Number(statValue);
    const validValue = isNaN(value) ? 10 : value;
    return Math.floor((validValue - 10) / 2);
}

// [HELPER] ฟังก์ชันช่วยคำนวณและ Cap HP
function getHpUpdatePayload(playerData, newCon, newLevel) {
    const finalCon = newCon !== undefined ? newCon : calculateTotalStat(playerData, 'CON');
    
    // จำลองข้อมูลเพื่อคำนวณ HP
    const tempPlayer = { ...playerData };
    if (newLevel !== undefined) tempPlayer.level = newLevel;
    
    // เรียกใช้ calculateHP (จาก charector.js)
    const newMaxHp = calculateHP(tempPlayer.race, tempPlayer.classMain, finalCon);
    let currentHp = playerData.hp || 0;
    
    // ตัดเลือดส่วนเกิน
    if (currentHp > newMaxHp) {
        currentHp = newMaxHp;
    } 

    return { maxHp: newMaxHp, hp: currentHp };
}

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
    
    if (classMainData && classMainData.bonuses) {
        baseStat += (classMainData.bonuses[upperStatKey] || 0);
    }
    if (classSubData && classSubData.bonuses) {
        baseStat += (classSubData.bonuses[upperStatKey] || 0);
    }

    const raceId = charData.raceEvolved || charData.race;
    const racePassives = (typeof RACE_DATA !== 'undefined' && RACE_DATA[raceId]?.passives) ? RACE_DATA[raceId].passives : [];
    const classMainId = charData.classMain;
    const classPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classMainId]?.passives) ? CLASS_DATA[classMainId].passives : [];
    const classSubId = charData.classSub;
    const subClassPassives = (typeof CLASS_DATA !== 'undefined' && CLASS_DATA[classSubId]?.passives) ? CLASS_DATA[classSubId].passives : [];
    
    const skillPassives = [];
    if (typeof SKILL_DATA !== 'undefined') {
        if(SKILL_DATA[classMainId]) skillPassives.push(...SKILL_DATA[classMainId].filter(s => s.skillTrigger === 'PASSIVE'));
        if(SKILL_DATA[classSubId]) skillPassives.push(...SKILL_DATA[classSubId].filter(s => s.skillTrigger === 'PASSIVE'));
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
    
    if (typeof allPlayersDataByUID !== 'undefined') {
        for (const uid in allPlayersDataByUID) {
            const teammate = allPlayersDataByUID[uid];
            if (uid === charData.uid || !teammate || (teammate.hp || 0) <= 0) continue;

            const teammateClassId = teammate.classMain;
            const skillPassives = [];
            if (typeof SKILL_DATA !== 'undefined' && SKILL_DATA[teammateClassId]) {
                skillPassives.push(...SKILL_DATA[teammateClassId].filter(s => s.skillTrigger === 'PASSIVE'));
            }
            
            skillPassives.forEach(skill => {
                const effects = Array.isArray(skill.effect) ? skill.effect : [skill.effect];
                effects.forEach(p => {
                    if (p && p.type === 'AURA_STAT_PERCENT' && (p.stats?.includes(upperStatKey) || p.stats?.includes('ALL'))) {
                        percentBonus += p.amount;
                    }
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

// [FIX] ลบฟังก์ชัน calculateHP ที่ซ้ำซ้อนออก เพื่อใช้ของ charector.js

function calculateDamage(damageDice, strBonus) {
    const diceType = parseInt((damageDice || 'd6').replace('d', ''));
    if (isNaN(diceType) || diceType < 1) return 1;
    const damageRoll = Math.floor(Math.random() * diceType) + 1;
    return Math.max(1, damageRoll + strBonus);
}

function getExpForNextLevel(level) {
    return Math.floor(300 * Math.pow(1.8, level - 1));
}

// =================================================================================
//
