(function (global) {

  const EMPTY = 0;

  // ---- 1. Element IDs (New 1-12) ----
  const ELEMENT = Object.freeze({
    NONE: 0,
    PHYSICAL: 0,

    FIRE: 1,
    WATER: 2,
    ELECTRIC: 3,
    EARTH: 4,
    WIND: 5,
    ICE: 6,
    LIGHT: 7,
    DARK: 8,
    WOOD: 9,
    POISON: 10,
    HOLY: 11,
    SHADOW: 12
  });

  // Reverse map (id -> name) สำหรับแสดงผล
  const ELEMENT_NAME = Object.freeze(Object.fromEntries(
    Object.entries(ELEMENT)
      .filter(([k, v]) => k !== 'NONE' && k !== 'PHYSICAL')
      .map(([k, v]) => [v, k])
  ));

  // ---- 2. Helper Functions ----

  // แปลง input (string/int) -> int
  function toId(x) {
    if (x === null || x === undefined) return 0;
    if (typeof x === 'number') return (x | 0);

    const s = String(x).trim().toUpperCase();
    if (!s) return 0;

    const ALIAS = {
        // none / physical
        'NONE': 0, 'PHYSICAL': 0, 'ทั่วไป': 0, 'กายภาพ': 0,

        // ไทย
        'ไฟ': ELEMENT.FIRE,
        'น้ำ': ELEMENT.WATER,
        'สายฟ้า': ELEMENT.ELECTRIC, 'ไฟฟ้า': ELEMENT.ELECTRIC,
        'ดิน': ELEMENT.EARTH,
        'ลม': ELEMENT.WIND,
        'น้ำแข็ง': ELEMENT.ICE,
        'แสง': ELEMENT.LIGHT,
        'มืด': ELEMENT.DARK, 'ความมืด': ELEMENT.DARK,
        'ไม้': ELEMENT.WOOD,
        'พิษ': ELEMENT.POISON,
        'ศักดิ์สิทธิ์': ELEMENT.HOLY,
        'เงา': ELEMENT.SHADOW,

        // อังกฤษเผื่อสะกด
        'LIGHTNING': ELEMENT.ELECTRIC,
        'THUNDER': ELEMENT.ELECTRIC
    };

    if (ALIAS[s] !== undefined) return ALIAS[s];
    if (ELEMENT[s] !== undefined) return ELEMENT[s];

    return 0;
  }

  function fmt(x) {
    const id = toId(x);
    if (id === 0) return 'PHYSICAL';
    
    const name = ELEMENT_NAME[id] || `#${id}`;
    const icons = {
      FIRE: '🔥', WATER: '💧', ELECTRIC: '⚡', EARTH: '🪨',
      WIND: '🌪️', ICE: '❄️', LIGHT: '✨', DARK: '🌑',
      WOOD: '🌿', POISON: '☠️', HOLY: '✝️', SHADOW: '👻'
    };
    return (icons[name] || '') + name;
  }

  function ensureSlots(unit) {
    if (!unit) return;
    if (!unit.elementSlots) {
        unit.elementSlots = { e1: EMPTY, e2: EMPTY, e3: EMPTY }; // เพิ่ม e3
    } else {
        if (unit.elementSlots.e1 == null) unit.elementSlots.e1 = EMPTY;
        if (unit.elementSlots.e2 == null) unit.elementSlots.e2 = EMPTY;
        if (unit.elementSlots.e3 == null) unit.elementSlots.e3 = EMPTY; // เพิ่ม e3
    }
  }

  // ---- 3. Core Process Logic ----
  function process(targetUnit, attackerEM, t1, t2, baseDamage) {
    ensureSlots(targetUnit);

    let slots = { ...targetUnit.elementSlots };
    let finalDamageTotal = 0;
    let logs = [];
    let hasReactionGlobal = false;
    
    // โบนัส EM (ใช้สูตร Stat * 0.1)
    const emBonus = Math.floor((attackerEM || 0) * 0.1);
    const damageWithEM = baseDamage + emBonus;

    // กรองเอาเฉพาะธาตุที่มีการโจมตีเข้ามา (ตัด 0 ทิ้ง)
    const elementsToApply = [toId(t1), toId(t2)].filter(e => e !== 0);

    // ถ้าตีเป็นกายภาพธรรมดา (ไม่มี t1, t2)
    if (elementsToApply.length === 0) {
      return { hasReaction: false, finalDamage: baseDamage, log: null, updatedSlots: slots, specialEffects: {} };
    }

    let specialEffects = { aoeDamageAll: 0, selfDamage: 0, addDot: null };

    // วนลูปยัดธาตุ t1 และ t2 ทีละตัวเข้าสู่เป้าหมาย
    for (let inc of elementsToApply) {
        // ยัดลงช่อง e1, e2, e3
        if (slots.e1 === EMPTY) slots.e1 = inc;
        else if (slots.e2 === EMPTY) slots.e2 = inc;
        else slots.e3 = inc;

        let reactionOccurred = null;
        let isTriple = false;
        let reactionKey = 0;

        // เช็ค 3 ธาตุก่อน
        if (slots.e1 && slots.e2 && slots.e3) {
            reactionKey = (slots.e1 * 10000) + (slots.e2 * 100) + slots.e3;
            if (global.ELEMENT_REACTIONS && global.ELEMENT_REACTIONS[reactionKey]) {
                reactionOccurred = global.ELEMENT_REACTIONS[reactionKey];
            } else {
                // กรณีไม่มีในตาราง -> มหาปฏิกิริยา 3 ธาตุ
                reactionOccurred = {
                    name: 'มหาปฏิกิริยา 3 ธาตุ',
                    multiplier: 3.0,
                    isGreatAOE: true,
                    clears: true
                };
            }
            isTriple = true;
        } 
        // เช็ค 2 ธาตุ
        else if (slots.e1 && slots.e2) {
            reactionKey = (slots.e1 * 100) + slots.e2;
            if (global.ELEMENT_REACTIONS && global.ELEMENT_REACTIONS[reactionKey]) {
                reactionOccurred = global.ELEMENT_REACTIONS[reactionKey];
            }
        }

        if (reactionOccurred) {
            hasReactionGlobal = true;
            // คำนวณ (ความเสียหายเดิม + โบนัส EM) * ตัวคูณ
            let rDamage = Math.floor(damageWithEM * (reactionOccurred.multiplier || 1));
            let logText = `💥 [${reactionOccurred.name}] ดาเมจ ${rDamage}`;

            // --- เงื่อนไขพิเศษตามที่ระบุในตาราง ---
            if (reactionKey === 102) {
                if (Math.random() < 0.5) {
                    logText += ` <br><span style="color:#00aaff">(💧 ไฟดับ! ติดสถานะน้ำทะลวงและล้างเกจ)</span>`;
                    slots.e1 = ELEMENT.WATER; slots.e2 = EMPTY; slots.e3 = EMPTY; // เปลี่ยนให้ติดน้ำแทน
                    reactionOccurred.clears = false; // ยกเลิกการล้างเกจปกติเพราะทำไปแล้ว
                }
            } 
            else if (reactionKey === 201) {
                if (Math.random() < 0.5) {
                    rDamage = 0;
                    logText += ` <br><span style="color:gray">(💨 ไฟดับ! การโจมตีไร้ผล ดาเมจ = 0)</span>`;
                }
            } 
            else if (reactionKey === 103 || reactionKey === 301) {
                if (Math.random() < 0.5) {
                    specialEffects.selfDamage += rDamage;
                    logText += ` <br><span style="color:#ff4d4d">(⚠️ โอเวอร์โหลดรุนแรง ระเบิดใส่ตนเองด้วย!)</span>`;
                }
            }

            // มหาปฏิกิริยา 3 ธาตุ (AOE ใส่ทุกคน)
            if (reactionOccurred.isGreatAOE) {
                specialEffects.aoeDamageAll = rDamage;
                logText = `💥💥💥 <b style="color:#ff00ea">[มหาปฏิกิริยา 3 ธาตุ!]</b> ระเบิดล้างบางใส่ทุกคน ${rDamage} หน่วย!`;
            }

            // จัดการสถานะต่อเนื่อง (ไฟช็อต)
            if (reactionOccurred.dotElement) {
                specialEffects.addDot = {
                    element: reactionOccurred.dotElement,
                    damageFormula: reactionOccurred.damageDice || `d10+${emBonus}`, // d10 + EM 
                    multiplier: reactionOccurred.dotMultiplier || 1.0,
                    turns: reactionOccurred.turns || 6
                };
            }

            finalDamageTotal += rDamage;
            logs.push(logText);

            // ล้างเกจถ้าปฏิกิริยาระบุไว้ (ส่วนใหญ่ระบุ)
            if (reactionOccurred.clears !== false) {
                slots.e1 = EMPTY; slots.e2 = EMPTY; slots.e3 = EMPTY;
            }
        }
    }

    // ถ้าไม่มีปฏิกิริยาเลย ให้ใช้ดาเมจพื้นฐาน
    if (!hasReactionGlobal) {
        finalDamageTotal = baseDamage;
    }

    return {
        hasReaction: hasReactionGlobal,
        finalDamage: finalDamageTotal,
        log: logs.length > 0 ? logs.join('<br>') : null,
        updatedSlots: slots,
        specialEffects: specialEffects,
        reactionName: logs.length > 0 ? "ผสมธาตุ" : ""
    };
  }
//----------------- คำนวนเกราะ -----------------//
  function applyDamageWithShield(unitData, incomingDamage, isPierce = false) {
    let remainingDamage = incomingDamage;
    let logMessages = [];
    let shieldBroken = false;
    let isChanged = false; // เช็คว่ามีการเปลี่ยนแปลงข้อมูลไหม

    // 1. ตรวจสอบว่ามีเกราะไหม?
    if (unitData.activeEffects && unitData.activeEffects.length > 0) {
        // วนลูปหา Effect ประเภท SHIELD
        unitData.activeEffects.forEach(eff => {
            if (eff.type === 'SHIELD' && eff.amount > 0 && remainingDamage > 0) {
                
                // --- Logic เจาะเกราะ (Pierce) ---
                // ถ้าเป็น Pierce: ดาเมจเข้าเกราะ x2 (เกราะแตกไวขึ้น) 
                let damageToShield = remainingDamage;
                if (isPierce) {
                    damageToShield = Math.floor(damageToShield * 2.0);
                    logMessages.push(`<small style="color:#ffc107">(เจาะเกราะ! Dmg x2 ใส่เกราะ)</small>`);
                }

                if (eff.amount >= damageToShield) {
                    // กรณี 1: เกราะหนากว่าดาเมจ (รับได้หมด)
                    eff.amount -= damageToShield;
                    logMessages.push(`🛡️ <b>[${eff.name}]</b> รับดาเมจแทน ${damageToShield} หน่วย (เหลือ ${eff.amount})`);
                    remainingDamage = 0; // ดาเมจหมดแล้ว (เข้าเนื้อ 0)
                } else {
                    // กรณี 2: เกราะบางกว่า (เกราะแตก)
                    const absorbed = eff.amount;
                    // คำนวณดาเมจจริงที่ถูกกันไป (ถ้า Pierce ต้องหารกลับมาเป็นดาเมจปกติ)
                    const realAbsorbed = isPierce ? Math.ceil(absorbed / 2.0) : absorbed;
                    
                    remainingDamage -= realAbsorbed; 
                    eff.amount = 0;
                    eff.turnsLeft = 0; // ลบเกราะทิ้ง
                    shieldBroken = true;
                    logMessages.push(`🛡️💥 <b>[${eff.name}]</b> แตกกระจาย! (กันได้ ${realAbsorbed})`);
                }
                isChanged = true;
            }
        });
        
        // กรองเกราะที่แตกออก (amount <= 0)
        if (isChanged) {
            unitData.activeEffects = unitData.activeEffects.filter(e => !(e.type === 'SHIELD' && e.amount <= 0));
        }
    }

    // 2. ดาเมจที่เหลือเข้า HP
    let damageTaken = remainingDamage;
    let finalHp = (unitData.hp || 0) - damageTaken;
    if (finalHp < 0) finalHp = 0;

    return {
        finalHp: finalHp,
        damageTaken: damageTaken, // ดาเมจที่เข้าเนื้อจริงๆ
        activeEffects: unitData.activeEffects, // บัฟที่อัปเดตแล้ว
        logs: logMessages,
        shieldBroken: shieldBroken
    };
  }

  // Export ฟังก์ชันนี้ออกไปใช้ข้างนอก
  global.ElementalEngine = {
    process,
    ensureSlots,
    applyDamageWithShield, // <--- เพิ่มบรรทัดนี้
    ELEMENT,
    toId,
    fmt
  };


})(window);