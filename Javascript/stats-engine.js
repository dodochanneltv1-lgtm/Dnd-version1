(function (global) {
  "use strict";

  const DEFAULT_FLAGS = {
    enablePassives: true,
    enableActiveEffects: true,
    enableAuras: true,
    enableEquip: true,
    enableLevelScaling: true
  };

  function toNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function getUpperStatKey(statKey) {
    return String(statKey || "").toUpperCase();
  }

  function getStatBonus(statValue) {
      return Math.floor(statValue * 0.1);
  }

  function getTotalLevel(charData) {
    const permanentLevel = toNumber(charData?.level, 1) || 1;
    let tempLevel = 0;

    if (Array.isArray(charData?.activeEffects)) {
      charData.activeEffects.forEach(effect => {
        if (!effect) return;
        if ((effect.stat === "Level" && effect.modType === "FLAT") || effect.type === "TEMP_LEVEL_PERCENT") {
          if (effect.type === "TEMP_LEVEL_PERCENT") {
            tempLevel += Math.floor(permanentLevel * (toNumber(effect.amount, 0) / 100));
          } else {
            tempLevel += toNumber(effect.amount, 0);
          }
        }
      });
    }
    return Math.max(1, permanentLevel + tempLevel);
  }

  function getGlobals() {
    const RACE_DATA = global.RACE_DATA || {};
    const CLASS_DATA = global.CLASS_DATA || {};
    const SKILL_DATA = global.SKILL_DATA || {};
    return { RACE_DATA, CLASS_DATA, SKILL_DATA };
  }

  function getAllPlayersForAura(ctx) {
    return (ctx?.allPlayers || global.allPlayersDataByUID || global.allPlayersInRoom || {});
  }

  // --- [FIXED] ฟังก์ชันคำนวณ Max HP แบบสมดุล (ป้องกันเลือดระเบิด) ---
  function calculateMaxHp(charData) {
    if (!charData) return 100;

    // 1. ดึงค่า Level ที่แท้จริง (รวมบัฟ)
    const level = getTotalLevel(charData);
    
    // 2. คำนวณ CON โดยปิด Level Scaling (เพื่อไม่ให้คูณซ้อนในสูตร HP)
    const conTotal = calculateTotalStat(charData, 'CON', { 
        flags: { enableLevelScaling: false } 
    });
    const conMod = Math.floor((conTotal - 10) / 2); 
    
    // 3. Base HP ตามอาชีพ (Default 10)
    let baseHp = 10; 
    const { CLASS_DATA } = getGlobals();
    if (CLASS_DATA && charData.classMain) {
        baseHp = CLASS_DATA[charData.classMain]?.baseHp || 10;
    }

    // 4. สูตรคำนวณ: (Base + ConMod) * Level + (CON * 2) + 50 (Flat Bonus เพื่อให้เลือดเริ่มที่หลักร้อย)
    let totalMaxHp = (baseHp + conMod) * level + (conTotal * 2) + 50;

    return Math.max(50, Math.floor(totalMaxHp));
  }

  function computeEnemyBaseStat(charData, upperStatKey) {
    const s = charData?.stats || {};
    const exact = s[upperStatKey];
    if (exact !== undefined) return toNumber(exact);
    const lower = s[upperStatKey.toLowerCase()];
    if (lower !== undefined) return toNumber(lower);
    return 0;
  }

  function applyPassives(baseStat, charData, upperStatKey, ctx) {
    const { RACE_DATA, CLASS_DATA, SKILL_DATA } = getGlobals();
    if (!RACE_DATA || !CLASS_DATA) return baseStat;

    const raceId = charData?.raceEvolved || charData?.race;
    const racePassives = (RACE_DATA?.[raceId]?.passives) ? RACE_DATA[raceId].passives : [];

    const classMainId = charData?.classMain;
    const classSubId = charData?.classSub;
    const classPassives = (CLASS_DATA?.[classMainId]?.passives) ? CLASS_DATA[classMainId].passives : [];
    const subClassPassives = (CLASS_DATA?.[classSubId]?.passives) ? CLASS_DATA[classSubId].passives : [];

    const skillPassives = [];
    if (SKILL_DATA) {
      if (SKILL_DATA[classMainId]) skillPassives.push(...SKILL_DATA[classMainId].filter(s => s?.skillTrigger === "PASSIVE"));
      if (SKILL_DATA[classSubId]) skillPassives.push(...SKILL_DATA[classSubId].filter(s => s?.skillTrigger === "PASSIVE"));
    }

    const allPassives = [...racePassives, ...classPassives, ...subClassPassives, ...skillPassives];

    allPassives.forEach(passiveOrSkill => {
      if (!passiveOrSkill) return;
      let effectObject = (passiveOrSkill.skillTrigger === "PASSIVE") ? passiveOrSkill.effect : (passiveOrSkill.id && passiveOrSkill.effect ? passiveOrSkill.effect : null);
      if (!effectObject) return;

      const effects = Array.isArray(effectObject) ? effectObject : [effectObject];
      effects.forEach(p => {
        if (!p) return;
        if (p.type === "PASSIVE_STAT_PERCENT" && Array.isArray(p.stats) && p.stats.includes(upperStatKey)) {
          baseStat *= (1 + (toNumber(p.amount, 0) / 100));
        }
        if (p.type === "PASSIVE_STAT_FLAT" && Array.isArray(p.stats) && p.stats.includes(upperStatKey)) {
          baseStat += toNumber(p.amount, 0);
        }
      });
    });
    return baseStat;
  }

  function computeActiveBonuses(charData, upperStatKey) {
    let flatBonus = 0;
    let percentBonus = 0;
    if (Array.isArray(charData?.activeEffects)) {
      charData.activeEffects.forEach(effect => {
        if (!effect) return;
        if (effect.stat === upperStatKey || effect.stat === "ALL") {
          if (effect.modType === "FLAT") flatBonus += toNumber(effect.amount, 0);
          else if (effect.modType === "PERCENT") percentBonus += toNumber(effect.amount, 0);
        }
      });
    }
    return { flatBonus, percentBonus };
  }

  function applyAuraPercentBonus(currentPercentBonus, charData, upperStatKey, ctx) {
    const { SKILL_DATA } = getGlobals();
    if (!SKILL_DATA) return currentPercentBonus;
    const allPlayers = getAllPlayersForAura(ctx);
    const selfUid = charData?.uid;
    for (const uid in allPlayers) {
      const teammate = allPlayers[uid];
      if (!teammate || uid === selfUid || toNumber(teammate.hp, 0) <= 0) continue;
      const teammateClassId = teammate.classMain;
      const auraSkills = (SKILL_DATA?.[teammateClassId]) ? SKILL_DATA[teammateClassId].filter(s => s?.skillTrigger === "PASSIVE") : [];
      auraSkills.forEach(skill => {
        const effects = Array.isArray(skill.effect) ? skill.effect : [skill.effect];
        effects.forEach(p => {
          if (!p) return;
          if (p.type === "AURA_STAT_PERCENT" && Array.isArray(p.stats) && (p.stats.includes(upperStatKey) || p.stats.includes("ALL"))) {
            currentPercentBonus += toNumber(p.amount, 0);
          }
        });
      });
    }
    return currentPercentBonus;
  }

  function computeEquipBonus(charData, upperStatKey) {
    let equipBonus = 0;
    const equipped = charData?.equippedItems || null;
    if (!equipped) return 0;
    for (const slot in equipped) {
      const item = equipped[slot];
      if (!item || !item.bonuses) continue;
      if (item.durability !== undefined && toNumber(item.durability, 0) <= 0) continue;
      if (item.bonuses[upperStatKey] === undefined) continue;
      let itemStatBonus = toNumber(item.bonuses[upperStatKey], 0);
      if (item.itemType === "อาวุธ") {
        if (slot === "mainHand" && item.isProficient) itemStatBonus *= 1.015;
        else if (slot === "offHand") itemStatBonus *= 0.70;
      }
      equipBonus += itemStatBonus;
    }
    return equipBonus;
  }

  function calculateTotalStat(charData, statKey, ctx = {}) {
    if (!charData) return 0;
    const flags = { ...DEFAULT_FLAGS, ...(ctx.flags || {}) };
    const upperStatKey = getUpperStatKey(statKey);

    if (charData.race === "โกเลม" && upperStatKey === "DEX") return 0;

    const isEnemy = (charData.type === "enemy") || (charData.stats && !charData.stats.baseRaceStats);
    let baseStat = 0;

    if (isEnemy) {
      baseStat = computeEnemyBaseStat(charData, upperStatKey);
    } else {
      const stats = charData.stats || {};
      baseStat = toNumber(stats.baseRaceStats?.[upperStatKey], 0) + toNumber(stats.investedStats?.[upperStatKey], 0) + toNumber(stats.tempStats?.[upperStatKey], 0);
      
      const { CLASS_DATA } = getGlobals();
      const classMainData = CLASS_DATA ? CLASS_DATA[charData.classMain] : null;
      const classSubData = CLASS_DATA ? CLASS_DATA[charData.classSub] : null;
      if (classMainData?.bonuses) baseStat += toNumber(classMainData.bonuses[upperStatKey], 0);
      if (classSubData?.bonuses) baseStat += toNumber(classSubData.bonuses[upperStatKey], 0);
      
      if (flags.enablePassives) baseStat = applyPassives(baseStat, charData, upperStatKey, ctx);
    }

    let flatBonus = 0;
    let percentBonus = 0;
    if (flags.enableActiveEffects) {
      const bonuses = computeActiveBonuses(charData, upperStatKey);
      flatBonus = bonuses.flatBonus;
      percentBonus = bonuses.percentBonus;
    }
    if (flags.enableAuras) {
      percentBonus = applyAuraPercentBonus(percentBonus, charData, upperStatKey, ctx);
    }
    let equipBonus = 0;
    if (flags.enableEquip) {
      equipBonus = computeEquipBonus(charData, upperStatKey);
    }

    let finalStat = (baseStat * (1 + (percentBonus / 100))) + flatBonus + equipBonus;
    
    // Level Scaling (เฉพาะเมื่อ enableLevelScaling = true)
    if (flags.enableLevelScaling) {
      const totalLevel = getTotalLevel(charData);
      if (finalStat > 0 && totalLevel > 1) {
        finalStat += (finalStat * (totalLevel - 1) * 0.2); // +20% ต่อเลเวล
      }
    }
    return Math.floor(finalStat);
  }

  global.StatsEngine = { calculateTotalStat, calculateMaxHp, getTotalLevel, getStatBonus };
  global.calculateTotalStat = calculateTotalStat;
  global.calculateMaxHp = calculateMaxHp; 
  global.getStatBonus = getStatBonus;

})(window);