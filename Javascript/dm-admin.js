function addUnstackFromOrder() {
    console.warn("addUnstackFromOrder ถูกเรียก แต่ยังไม่มีการใช้งานจริง");
}
// =================================================================================

function addItem() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    const itemName = document.getElementById("itemName").value.trim();
    if (!roomId || !uid || !itemName) return;
    const itemQty = parseInt(document.getElementById("itemQty").value) || 1;
    const player = allPlayersDataByUID[uid];
    const inventory = player.inventory || [];
    const existingItem = inventory.find(i => i.name === itemName && !i.bonuses);
    if (existingItem) existingItem.quantity += itemQty;
    else inventory.push({ name: itemName, quantity: itemQty, itemType: 'ทั่วไป', durability: 100 });
    db.ref(`rooms/${roomId}/playersByUid/${uid}/inventory`).set(inventory);
}
function removeItem() {
    const roomId = sessionStorage.getItem('roomId');
    const name = document.getElementById("playerSelect").value;
    const uid = getUidByName(name);
    const selectedIndex = document.getElementById("itemSelect").value;
    if (!roomId || !uid || selectedIndex === null || selectedIndex === "") return showCustomAlert("กรุณาเลือกผู้เล่นและไอเทมที่ต้องการลบ", "warning");
    const itemIndex = parseInt(selectedIndex);
    const qtyToRemove = parseInt(document.getElementById("removeQty").value) || 1;
    const player = allPlayersDataByUID[uid];
    let inventory = player.inventory || [];
    if (itemIndex < 0 || itemIndex >= inventory.length) return showCustomAlert("ไม่พบไอเทมที่ต้องการลบ (Invalid Index)", "error");
    if (inventory[itemIndex].quantity <= qtyToRemove) inventory.splice(itemIndex, 1);
    else inventory[itemIndex].quantity -= qtyToRemove;
    db.ref(`rooms/${roomId}/playersByUid/${uid}/inventory`).set(inventory).then(() => showCustomAlert(`ลบไอเทมจาก ${name} สำเร็จ`, 'success'));
}

function sendCustomItem(sendToAll = false) { 
    const roomId = sessionStorage.getItem('roomId');
    const itemName = document.getElementById("customItemName").value.trim();
    if (!roomId || !itemName) return showCustomAlert("กรุณาใส่ชื่อไอเทม", 'warning');

    const itemQty = parseInt(document.getElementById("customItemQty").value) || 1;
    const durability = parseInt(document.getElementById("customItemDurability").value) || 100; 
    
    const bonuses = {};
    ['HP', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(stat => {
        const value = parseInt(document.getElementById(`itemBonus${stat}`).value);
        if (!isNaN(value) && value !== 0) bonuses[stat.toUpperCase()] = value;
    });
    
    const itemType = document.getElementById('customItemType').value;
    let newItem = { 
        name: itemName, 
        quantity: itemQty, 
        bonuses: bonuses, 
        originalBonuses: { ...bonuses }, 
        itemType: itemType,
        durability: durability 
    };
    
    if (itemType === 'บริโภค') {
        newItem.effects = {
            heal: parseInt(document.getElementById('itemEffectHeal').value) || 0,
            permStats: [],
            tempStats: []
        };
        for (let i = 1; i <= 6; i++) {
            const permStat = document.getElementById(`itemPermStat${i}`).value;
            const permAmount = parseInt(document.getElementById(`itemPermAmount${i}`).value);
            if (permStat && permAmount) newItem.effects.permStats.push({ stat: permStat, amount: permAmount });
            const tempStat = document.getElementById(`itemTempStat${i}`).value;
            const tempAmount = parseInt(document.getElementById(`itemTempAmount${i}`).value);
            const tempTurns = parseInt(document.getElementById(`itemTempTurns${i}`).value);
            if (tempStat && tempAmount && tempTurns) newItem.effects.tempStats.push({ stat: tempStat, amount: tempAmount, turns: tempTurns });
        }
        
    } else if (itemType === 'สวมใส่') {
        newItem.slot = document.getElementById('customItemSlot').value;
    } else if (itemType === 'อาวุธ') {
        newItem.damageDice = document.getElementById('customDamageDice').value || 'd6';
        newItem.weaponType = document.getElementById('customWeaponType').value;
        newItem.recommendedClass = [];
        document.querySelectorAll('#recommendedClassCheckboxes input:checked').forEach(cb => {
            newItem.recommendedClass.push(cb.value);
        });
    }

    const processSend = (uid, playerName) => {
        const player = allPlayersDataByUID[uid];
        const inventory = player.inventory || [];
        
        const isStackable = (itemType === 'ทั่วไป' || itemType === 'บริโภค') && 
                            JSON.stringify(bonuses) === '{}' &&
                            (!newItem.effects || (newItem.effects.permStats.length === 0 && newItem.effects.tempStats.length === 0 && newItem.effects.heal === 0));

        const existingItemIndex = inventory.findIndex(i => 
            i.name === itemName && 
            ( (isStackable && i.itemType === itemType) || 
              (!isStackable && JSON.stringify(i.originalBonuses || {}) === JSON.stringify(newItem.originalBonuses || {})) 
            )
        );

        if (existingItemIndex > -1 && isStackable) {
            inventory[existingItemIndex].quantity += itemQty;
        } else {
            inventory.push(JSON.parse(JSON.stringify(newItem))); 
        }
        
        return db.ref(`rooms/${roomId}/playersByUid/${uid}/inventory`).set(inventory);
    };

    if (sendToAll) { 
        const allPromises = [];
        for (const uid in allPlayersDataByUID) {
            allPromises.push(processSend(uid, allPlayersDataByUID[uid].name));
        }
        Promise.all(allPromises).then(() => showCustomAlert(`ส่งไอเทม "${itemName}" ให้ผู้เล่นทุกคนสำเร็จ`, 'success'));
    } else {
        const name = document.getElementById("playerSelect").value;
        const uid = getUidByName(name);
        if (!uid) return showCustomAlert("กรุณาเลือกผู้เล่น", 'warning');
        processSend(uid, name).then(() => showCustomAlert(`ส่งไอเทม "${itemName}" ให้ ${name} สำเร็จ`, 'success'));
    }
}

const monsterTemplates = { 'Goblin': { hp: 5, str: 8, dex: 14, con: 10, int: 8, wis: 10, cha: 6, damageDice: 'd6' }, 'Orc': { hp: 15, str: 16, dex: 12, con: 14, int: 7, wis: 10, cha: 8, damageDice: 'd8' }, 'Dragon (Young)': { hp: 50, str: 20, dex: 10, con: 18, int: 14, wis: 12, cha: 16, damageDice: 'd12' } };
function populateMonsterTemplates() {
    const select = document.getElementById("monsterTemplateSelect");
    select.innerHTML = '<option value="">--- เลือกมอนสเตอร์ ---</option>';
    for (const name in monsterTemplates) select.innerHTML += `<option value="${name}">${name}</option>`;
}
function loadMonsterTemplate() {
    const selectedName = document.getElementById("monsterTemplateSelect").value;
    const template = monsterTemplates[selectedName];
    if (template) {
        document.getElementById("monsterHp").value = template.hp;
        document.getElementById("monsterStr").value = template.str;
        document.getElementById("monsterDex").value = template.dex;
        document.getElementById("monsterCon").value = template.con || 10;
        document.getElementById("monsterInt").value = template.int || 10;
        document.getElementById("monsterWis").value = template.wis || 10;
        document.getElementById("monsterCha").value = template.cha || 10;
        document.getElementById("monsterDamageDice").value = template.damageDice || 'd6';
    }
}
function addMonster(addPerPlayer) {
    const roomId = sessionStorage.getItem('roomId');
    const monsterName = document.getElementById("monsterTemplateSelect").value;
    if (!monsterName) return showCustomAlert("กรุณาเลือกมอนสเตอร์จาก Template ก่อน", 'warning');

    // 🌟 1. ดึงค่า EXP จากช่องกรอก (ถ้าไม่ได้กรอกให้เป็น 0)
    const expReward = parseInt(document.getElementById("monsterExp").value) || 0;

    const createEnemyObject = () => {
        const hp = parseInt(document.getElementById("monsterHp").value) || 10;
        return {
            name: monsterName, 
            hp: hp, 
            maxHp: hp, 
            damageDice: document.getElementById("monsterDamageDice").value || 'd6',
            expReward: expReward,  // 🌟 2. อัปเดตบรรทัดนี้เพื่อเก็บค่า EXP
            stats: { 
                STR: parseInt(document.getElementById("monsterStr").value) || 10, 
                DEX: parseInt(document.getElementById("monsterDex").value) || 10, 
                CON: parseInt(document.getElementById("monsterCon").value) || 10, 
                INT: parseInt(document.getElementById("monsterInt").value) || 10, 
                WIS: parseInt(document.getElementById("monsterWis").value) || 10, 
                CHA: parseInt(document.getElementById("monsterCha").value) || 10, 
            },
            targetUid: document.getElementById('enemyInitialTarget').value,
            abilities: { canDefend: false } 
        };
    };

    const enemiesRef = db.ref(`rooms/${roomId}/enemies`);
    
    if (addPerPlayer) {
        let playerIndex = 1;
        Object.keys(allPlayersDataByUID).forEach(uid => {
            const enemyData = createEnemyObject();
            enemyData.targetUid = uid;
            enemyData.name = `${monsterName} #${playerIndex++}`
            enemiesRef.push(enemyData);
        });
        showCustomAlert(`เพิ่ม ${monsterName} ตามจำนวนผู้เล่นสำเร็จ!`, 'success');
    } else {
        enemiesRef.push(createEnemyObject());
        showCustomAlert(`เพิ่ม ${monsterName} 1 ตัว สำเร็จ!`, 'success');
    }
}
async function addCustomEnemy() {
  const roomId = sessionStorage.getItem('roomId');
  if (!roomId) return showCustomAlert("ไม่พบรหัสห้อง!", "error");

  const name = document.getElementById("customEnemyName").value.trim();
  const hp = parseInt(document.getElementById("customEnemyHp").value) || 0;
  const str = parseInt(document.getElementById("customEnemyStr").value) || 10;
  const dex = parseInt(document.getElementById("customEnemyDex").value) || 10;
  const con = parseInt(document.getElementById("customEnemyCon").value) || 10;
  const intt = parseInt(document.getElementById("customEnemyInt").value) || 10;
  const wis = parseInt(document.getElementById("customEnemyWis").value) || 10;
  const cha = parseInt(document.getElementById("customEnemyCha").value) || 10;
  const damageDice = document.getElementById("customEnemyDamageDice").value.trim() || "d6";
  
  // 🌟 3. ดึงค่า EXP สำหรับมอนสเตอร์ที่สร้างเอง
  const expReward = parseInt(document.getElementById("customEnemyExp").value) || 0;
  
  if (!name || hp <= 0) return showCustomAlert("กรุณาใส่ชื่อและ HP ให้ครบถ้วน!", "warning");
  
  const enemyData = { 
      name, 
      hp, 
      maxHp: hp, 
      damageDice, 
      expReward, // 🌟 4. ยัดค่า EXP เข้าไปในก้อนข้อมูล
      stats: { STR: str, DEX: dex, CON: con, INT: intt, WIS: wis, CHA: cha }, 
      type: "enemy", 
      targetUid: document.getElementById('enemyInitialTarget').value, 
      createdAt: Date.now(),
  };

  try {
    await db.ref(`rooms/${roomId}/enemies`).push(enemyData);
    showCustomAlert(`เพิ่มศัตรู "${name}" สำเร็จ!`, "success");
    
    // (ทางเลือก) เคลียร์ช่องให้ว่างหลังจากสร้างเสร็จ
    document.getElementById("customEnemyName").value = '';
    document.getElementById("customEnemyHp").value = '';
    document.getElementById("customEnemyExp").value = '';
    
  } catch (error) { 
      showCustomAlert("เกิดข้อผิดพลาดในการเพิ่มศัตรู", "error"); 
  }
}
function moveEnemy(enemyKey) {
    const roomId = sessionStorage.getItem('roomId');
    let options = { 'shared': 'ยังไม่กำหนดเป้าหมาย (ศัตรูร่วม)' };
    for (const uid in allPlayersDataByUID) options[uid] = allPlayersDataByUID[uid].name;
    Swal.fire({
        title: 'ย้ายเป้าหมาย', input: 'select', inputOptions: options,
        inputPlaceholder: 'เลือกเป้าหมายใหม่', showCancelButton: true, confirmButtonText: 'ย้าย'
    }).then((result) => {
        if (result.isConfirmed && result.value) db.ref(`rooms/${roomId}/enemies/${enemyKey}`).update({ targetUid: result.value });
    });
}
function deleteEnemy(enemyKey) {
    const roomId = sessionStorage.getItem('roomId');
    Swal.fire({
        title: 'ยืนยันการลบ?', text: `ต้องการลบ "${allEnemies[enemyKey].name}" ออกจากฉาก?`, icon: 'warning',
        showCancelButton: true, confirmButtonText: 'ใช่, ลบเลย!', confirmButtonColor: '#c82333'
    }).then((result) => {
        if (result.isConfirmed) db.ref(`rooms/${roomId}/enemies/${enemyKey}`).remove();
    });
}
function clearAllEnemies() {
    const roomId = sessionStorage.getItem('roomId');
    Swal.fire({
        title: 'ยืนยันการล้างบาง?', text: "ต้องการลบคู่ต่อสู้ทั้งหมดในฉากหรือไม่?", icon: 'error',
        showCancelButton: true, confirmButtonText: 'ใช่, ล้างทั้งหมด!', confirmButtonColor: '#c82333'
    }).then((result) => {
        if (result.isConfirmed) db.ref(`rooms/${roomId}/enemies`).remove().then(() => showCustomAlert('ล้างคู่ต่อสู้ทั้งหมดเรียบร้อย!', 'success'));
    });
}
function saveStory() {
    const roomId = sessionStorage.getItem('roomId');
    const storyText = document.getElementById("story").value;
    if (roomId) db.ref(`rooms/${roomId}/story`).set(storyText);
}

function sendQuest(sendToAll = false) {
    const roomId = sessionStorage.getItem('roomId');
    const quest = {
        title: document.getElementById("questTitle").value,
        detail: document.getElementById("questDetail").value,
        reward: document.getElementById("questReward").value,
        expReward: parseInt(document.getElementById("questExpReward").value) || 0
    };
    if (!quest.title.trim()) return showCustomAlert("กรุณาระบุชื่อเควส", 'warning');

    if (sendToAll) { 
        const updates = {};
        for (const uid in allPlayersDataByUID) {
            updates[`/rooms/${roomId}/playersByUid/${uid}/quest`] = quest;
        }
        db.ref().update(updates).then(() => showCustomAlert("ส่งเควสให้ผู้เล่นทุกคนแล้ว!", "success"));
    } else {
        const playerName = document.getElementById("playerSelect").value;
        const uid = getUidByName(playerName);
        if (!uid) return showCustomAlert("กรุณาเลือกผู้เล่น", 'warning');
        db.ref(`rooms/${roomId}/playersByUid/${uid}/quest`).set(quest).then(() => showCustomAlert(`ส่งเควสให้ ${playerName} แล้ว!`, "success"));
    }
}
function completeQuest() {
    const roomId = sessionStorage.getItem('roomId');
    const playerName = document.getElementById("playerSelect").value;
    const uid = getUidByName(playerName);
    if (roomId && uid) db.ref(`rooms/${roomId}/playersByUid/${uid}/quest`).remove().then(() => showCustomAlert("ยืนยันเควสสำเร็จแล้ว (อย่าลืมมอบ EXP!)", "success"));
}
function cancelQuest() {
    const roomId = sessionStorage.getItem('roomId');
    const playerName = document.getElementById("playerSelect").value;
    const uid = getUidByName(playerName);
    if (roomId && uid) db.ref(`rooms/${roomId}/playersByUid/${uid}/quest`).remove().then(() => showCustomAlert("ยกเลิกเควสแล้ว", "info"));
}

function changeRoomPassword() {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;
    Swal.fire({ title: '🔑 เปลี่ยนรหัสเข้าห้อง', input: 'password', showCancelButton: true }).then((result) => {
        if (result.isConfirmed && result.value) db.ref(`rooms/${roomId}/password`).set(result.value);
    });
}
function changeDMPassword() {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;
    Swal.fire({ title: '🔒 เปลี่ยนรหัส DM Panel', input: 'password', showCancelButton: true }).then((result) => {
        if (result.isConfirmed && result.value) db.ref(`rooms/${roomId}/dmPassword`).set(result.value);
    });
}
function deleteRoom() {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;
    Swal.fire({
        title: '💣 ยืนยันการลบห้องถาวร?', text: "การกระทำนี้ไม่สามารถย้อนกลับได้!", icon: 'error',
        showCancelButton: true, confirmButtonText: 'ใช่, ลบห้องเลย!'
    }).then((result) => {
        if (result.isConfirmed) db.ref(`rooms/${roomId}`).remove().then(() => {
            sessionStorage.removeItem('roomId');
            window.location.replace('lobby.html');
        });
    });
}
async function rollDmDice() {
    const diceType = parseInt(document.getElementById("dmDiceType").value);
    const diceCount = parseInt(document.getElementById("dmDiceCount").value);
    const rollButton = document.querySelector('button[onclick="rollDmDice()"]');
    if (typeof showDiceRollAnimation === 'function') {
        await showDiceRollAnimation(diceCount, diceType, 'dm-dice-animation-area', 'dmDiceResult', rollButton);
    } else {
        showCustomAlert("ฟังก์ชันทอยเต๋าไม่พร้อมใช้งาน", 'error');
    }
}
function clearDiceLogs() { const roomId = sessionStorage.getItem('roomId'); if (roomId) db.ref(`rooms/${roomId}/diceLogs`).set(null); }
function clearCombatLogs() { const roomId = sessionStorage.getItem('roomId'); if (roomId) db.ref(`rooms/${roomId}/combatLogs`).set(null); }

// =================================================================================
// ส่วนที่ 6: Write Functions (Shop & Guild)
// =================================================================================

async function addShopItemToDB() {
    const roomId = sessionStorage.getItem('roomId');
    const shopId = document.getElementById("shopIdSelect").value;
    if (!roomId || !shopId) return showCustomAlert("กรุณาเลือกประเภทร้านค้า", 'warning');

    const itemName = document.getElementById("shopItemName").value.trim();
    const price = parseInt(document.getElementById("shopItemPrice").value);
    const durability = parseInt(document.getElementById("shopItemDurability").value) || 100;
    if (!itemName || isNaN(price) || price < 0) return showCustomAlert("กรุณากรอก ชื่อ, ราคา, และความทนทาน ให้ถูกต้อง", 'warning');
    
    const bonuses = {};
    ['HP', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(stat => {
        const value = parseInt(document.getElementById(`itemBonus${stat}`).value);
        if (!isNaN(value) && value !== 0) bonuses[stat.toUpperCase()] = value;
    });
    const itemType = document.getElementById('customItemType').value;
    
    const newItem = { 
        name: itemName, 
        price: price,
        durability: durability,
        bonuses: bonuses, 
        originalBonuses: { ...bonuses }, 
        itemType: itemType,
    };
    
    if (itemType === 'บริโภค') {
        newItem.effects = {
            heal: parseInt(document.getElementById('itemEffectHeal').value) || 0,
            permStats: [],
            tempStats: []
        };
        for (let i = 1; i <= 6; i++) {
            const permStat = document.getElementById(`itemPermStat${i}`).value;
            const permAmount = parseInt(document.getElementById(`itemPermAmount${i}`).value);
            if (permStat && permAmount) {
                newItem.effects.permStats.push({ stat: permStat, amount: permAmount });
            }
            const tempStat = document.getElementById(`itemTempStat${i}`).value;
            const tempAmount = parseInt(document.getElementById(`itemTempAmount${i}`).value);
            const tempTurns = parseInt(document.getElementById(`itemTempTurns${i}`).value);
            if (tempStat && tempAmount && tempTurns) {
                newItem.effects.tempStats.push({ stat: tempStat, amount: tempAmount, turns: tempTurns });
            }
        }
    } else if (itemType === 'สวมใส่') {
        newItem.slot = document.getElementById('customItemSlot').value;
    } else if (itemType === 'อาวุธ') {
        newItem.damageDice = document.getElementById('customDamageDice').value || 'd6';
        newItem.weaponType = document.getElementById('customWeaponType').value;
        newItem.recommendedClass = [];
        document.querySelectorAll('#recommendedClassCheckboxes input:checked').forEach(cb => {
            newItem.recommendedClass.push(cb.value);
        });
    }

    const shopRef = db.ref(`rooms/${roomId}/shops/${shopId}`);
    try {
        await shopRef.push(newItem);
        showCustomAlert(`เพิ่ม '${itemName}' ในร้านค้า '${shopId}' สำเร็จ!`, 'success');
        document.getElementById("shopItemName").value = '';
        document.getElementById("shopItemPrice").value = '';
    } catch (error) {
        showCustomAlert("ล้มเหลวในการเพิ่มไอเทมเข้าร้าน: " + error.message, 'error');
    }
}

async function addGuildQuestToDB() {
    const roomId = sessionStorage.getItem('roomId');

    const job = document.getElementById('guildQuestJob').value;
    const lvl = parseInt(document.getElementById('guildQuestLevel').value, 10);
    const title = document.getElementById('guildQuestTitle').value.trim();
    const description = document.getElementById('guildQuestDescription').value.trim();

    if (!job || isNaN(lvl) || !title) {
        return Swal.fire('ผิดพลาด', 'กรุณากรอกข้อมูลให้ครบ (อาชีพ / เลเวล / ชื่อเควส)', 'warning');
    }

    const questId = `promote_${job}_${lvl}_${Date.now()}`;

    const questData = {
        title,
        description,
        requiredClass: job,
        requiredLevel: lvl
    };

    try {
        await db.ref(`rooms/${roomId}/guildQuests/${questId}`).set(questData);
        Swal.fire('สำเร็จ', 'เพิ่มเควสเลื่อนขั้นแล้ว', 'success');
    } catch (error) {
        Swal.fire('ผิดพลาด', error.message, 'error');
    }
}
async function createGuildBoardQuest() {
  const roomId = sessionStorage.getItem('roomId');
  if (!roomId) return Swal.fire('ผิดพลาด', 'ไม่พบ roomId', 'error');

  // ✅ ใช้ id ชุดนี้ให้ตรงกับฟอร์มในรูปของมึง
  const titleEl = document.getElementById("questTitle");
  const targetEl = document.getElementById("questTarget");
  const countEl = document.getElementById("questCount");
  const rewardClassEl = document.getElementById("questRewardClass");

  if (!titleEl || !targetEl || !countEl || !rewardClassEl) {
    console.error("GuildBoardQuest: element not found", {
      titleEl, targetEl, countEl, rewardClassEl
    });
    return Swal.fire('ผิดพลาด', 'โครงสร้างหน้า HTML ไม่ครบ (ID input ไม่ตรง)', 'error');
  }

  const title = titleEl.value.trim();
  const targetMonster = targetEl.value.trim();
  const requiredCount = parseInt(countEl.value, 10) || 0;
  const rewardClass = rewardClassEl.value.trim();

  if (!title || !targetMonster || requiredCount <= 0 || !rewardClass) {
    return Swal.fire('ผิดพลาด', 'กรุณากรอกข้อมูลให้ครบ (ชื่อ/เป้าหมาย/จำนวน/รางวัล)', 'warning');
  }

  const questId = `board_${Date.now()}`;
  const questData = {
    id: questId,
    title,
    targetMonster,
    requiredCount,
    rewardClass,
    createdAt: Date.now()
  };

  try {
    // ✅ สำคัญ: เก็บลง guildBoardQuests (ไม่ใช่ guildQuests)
    await db.ref(`rooms/${roomId}/guildBoardQuests/${questId}`).set(questData);

    Swal.fire('สำเร็จ', 'แปะเควสบอร์ดเรียบร้อย!', 'success');

    // เคลียร์ฟอร์ม
    titleEl.value = '';
    targetEl.value = '';
    countEl.value = '1';
    rewardClassEl.value = '';

  } catch (err) {
    console.error("createGuildBoardQuest error:", err);
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}

function monitorShopItems() {
    const roomId = sessionStorage.getItem('roomId');
    const shopId = document.getElementById("shopIdSelect").value;
    const listDiv = document.getElementById("currentShopItemsList");
    const countSpan = document.getElementById("shopItemCount");
    
    if (!roomId || !shopId) return;

    // 1. ปิด Listener เก่าก่อน (ถ้ามี) เพื่อไม่ให้ทำงานซ้ำซ้อน
    if (currentShopListener) {
        db.ref(`rooms/${roomId}/shops/${currentShopListener}`).off();
    }
    currentShopListener = shopId;

    // 2. สร้าง Listener ใหม่สำหรับร้านที่เลือก
    db.ref(`rooms/${roomId}/shops/${shopId}`).on('value', (snapshot) => {
        const items = snapshot.val() || {};
        const itemCount = Object.keys(items).length;
        
        // อัปเดตตัวเลขจำนวนสินค้า
        if(countSpan) countSpan.textContent = itemCount;
        
        if (itemCount === 0) {
            listDiv.innerHTML = '<p style="color:#aaa; text-align:center;">ไม่มีสินค้าในร้านนี้</p>';
            return;
        }

        let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
        for (const key in items) {
            const item = items[key];
            const stats = item.bonuses ? Object.keys(item.bonuses).join(',') : '-';
            
            html += `
                <li style="border-bottom: 1px solid #444; padding: 8px 0; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="color: #ffeb8a;">${item.name}</strong> 
                        <span style="color: #28a745;">(${item.price} GP)</span>
                        <div style="font-size: 0.8em; color: #bbb;">Type: ${item.itemType} | Stat: ${stats}</div>
                    </div>
                    <button onclick="deleteShopItem('${shopId}', '${key}', '${item.name}')" 
                        style="width: auto; padding: 4px 10px; font-size: 0.8em; background-color: #dc3545; border: none; border-radius: 4px; color: white; cursor: pointer;">
                        ลบ
                    </button>
                </li>
            `;
        }
        html += '</ul>';
        listDiv.innerHTML = html;
    });
}
function deleteShopItem(shopId, itemId, itemName) {
    const roomId = sessionStorage.getItem('roomId');
    
    Swal.fire({
        title: 'ลบสินค้า?',
        text: `ต้องการลบ "${itemName}" ออกจากร้านค้าใช่หรือไม่?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ลบเลย',
        confirmButtonColor: '#d33',
        cancelButtonText: 'ยกเลิก'
    }).then((result) => {
        if (result.isConfirmed) {
            db.ref(`rooms/${roomId}/shops/${shopId}/${itemId}`).remove()
                .then(() => {
                    // ไม่ต้อง Alert ก็ได้ เพราะรายการจะหายไปเองแบบ Realtime
                    const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
                    Toast.fire({ icon: 'success', title: 'ลบเรียบร้อย' });
                })
                .catch(err => Swal.fire('Error', err.message, 'error'));
        }
    });
}

// ✅ ใช้อันนี้แทน "ฟังก์ชันสร้างเควส" ตัวเก่าที่มั่ว node
async function createQuest() {
  return createGuildBoardQuest();
}

function monitorGuildQuests() {
    const roomId = sessionStorage.getItem('roomId');
    const listDiv = document.getElementById("currentGuildQuestsList");
    const countSpan = document.getElementById("guildQuestCount");
    
    if (!roomId) return;

    db.ref(`rooms/${roomId}/guildQuests`).on('value', (snapshot) => {
        const quests = snapshot.val() || {};
        const questCount = Object.keys(quests).length;
        
        if(countSpan) countSpan.textContent = questCount;

        if (questCount === 0) {
            listDiv.innerHTML = '<p style="color:#aaa; text-align:center;">ยังไม่มีเควสเลื่อนขั้น</p>';
            return;
        }

        let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
        for (const key in quests) {
            const quest = quests[key];
            html += `
                <li style="border-bottom: 1px solid #444; padding: 8px 0; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="color: #007bff;">${quest.title}</strong>
                        <div style="font-size: 0.8em; color: #bbb;">
                            สำหรับ: <span style="color: #ffc107;">${quest.requiredClass}</span> (Lv.${quest.requiredLevel})
                        </div>
                    </div>
                    <button onclick="deleteGuildQuest('${key}', '${quest.title}')" 
                        style="width: auto; padding: 4px 10px; font-size: 0.8em; background-color: #dc3545; border: none; border-radius: 4px; color: white; cursor: pointer;">
                        ลบ
                    </button>
                </li>
            `;
        }
        html += '</ul>';
        listDiv.innerHTML = html;
    });
}
function deleteGuildQuest(questId, questTitle) {
    const roomId = sessionStorage.getItem('roomId');
    
    Swal.fire({
        title: 'ลบเควส?',
        text: `ต้องการลบเควส "${questTitle}" ใช่หรือไม่?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ลบเลย',
        confirmButtonColor: '#d33'
    }).then((result) => {
        if (result.isConfirmed) {
            db.ref(`rooms/${roomId}/guildQuests/${questId}`).remove()
                .then(() => {
                    const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
                    Toast.fire({ icon: 'success', title: 'ลบเรียบร้อย' });
                });
        }
    });
}

// =================================================================================
// ส่วนที่ 7: Initial Load & Real-time Listeners
// =================================================================================

function listenForActionComplete() {
  const roomId = sessionStorage.getItem('roomId');
  const actionRef = db.ref(`rooms/${roomId}/combat/actionComplete`);

  actionRef.on('value', async (snap) => {
    const uidOrKey = snap.val(); // ID ของคนที่เพิ่งเล่นจบ
    if (!uidOrKey) return;

    // ⭐ [แก้] ดึงข้อมูล Combat ล่าสุดจาก Firebase โดยตรง (กันเหนียว)
    const combatSnap = await db.ref(`rooms/${roomId}/combat`).get();
    const liveCombatState = combatSnap.val();

    if (!liveCombatState || !liveCombatState.isActive) return;

    const currentUnit = liveCombatState.turnOrder[liveCombatState.currentTurnIndex];

    // เช็คว่าคนที่ส่งสัญญาณมา คือเจ้าของเทิร์นจริงๆ ใช่ไหม?
    if (currentUnit && uidOrKey === currentUnit.id) {
        console.log(`[DM] ได้รับ Signal จบเทิร์นจาก ${uidOrKey} -> เปลี่ยนเทิร์น!`);
        
        // ลบสัญญาณทิ้งก่อน (กันรวน)
        await actionRef.remove(); 
        
        // สั่งเปลี่ยนเทิร์น
        await advanceTurn(); 
    } else {
        console.warn(`[DM] ได้รับ Signal จาก ${uidOrKey} แต่ตอนนี้เทิร์นของ ${currentUnit?.id} (ข้อมูลอาจไม่ตรงกัน)`);
        // ถ้าค้างนานๆ ให้ลบทิ้งไปเลย
        // await actionRef.remove(); 
    }
  });
}

function listenForDefenseResolution() {
    const roomId = sessionStorage.getItem('roomId');
    const resolutionRef = db.ref(`rooms/${roomId}/combat/resolution`);
    resolutionRef.on('value', (snapshot) => {
        if (snapshot.exists() && snapshot.val() !== null) {
            handleDefenseResolution(snapshot.val());
        }
    });
}

function populateConsumableInputs() {
    const permContainer = document.getElementById('permStatContainer');
    const tempContainer = document.getElementById('tempStatContainer');
    const statOptions = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'HP', 'MaxHP'];
    let permHtml = '';
    let tempHtml = '';

    for (let i = 1; i <= 6; i++) {
        permHtml += `<label>ช่องที่ ${i}:</label>
            <select id="itemPermStat${i}" style="grid-column: 1 / 2;">
                <option value="">--เลือกค่า--</option>
                ${statOptions.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <input type="number" id="itemPermAmount${i}" placeholder="+ จำนวน" style="grid-column: 2 / 3;">
        `;
        
        tempHtml += `<label>ช่องที่ ${i}:</label>
            <select id="itemTempStat${i}" style="grid-column: 1 / 2;">
                <option value="">--เลือกค่า--</option>
                ${statOptions.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <input type="number" id="itemTempAmount${i}" placeholder="+ จำนวน" style="grid-column: 2 / 3;">
            <input type="number" id="itemTempTurns${i}" placeholder="เทิร์น" style="grid-column: 3 / 4;">
        `;
    }
    permContainer.innerHTML = permHtml;
    tempContainer.innerHTML = tempHtml;
}

window.onload = function() {
    if (typeof getRaceStatBonus === 'function') {
        window.calculateHP_CORE = calculateHP; 
    }
    if (typeof showCustomAlert === 'function') {
         window.showCustomAlert_UI = showCustomAlert;
    }

    const roomId = sessionStorage.getItem('roomId');
    initAfkSystem(roomId);
    if (!roomId) {
        window.location.replace('lobby.html');
        return;
    }

    listenForActionComplete(); 
    listenForDefenseResolution();

    const playersRef = db.ref(`rooms/${roomId}/playersByUid`);
    
    playersRef.on('value', (snapshot) => {
        allPlayersDataByUID = snapshot.val() || {};

        const select = document.getElementById("playerSelect");
        const enemyTargetSelect = document.getElementById("enemyInitialTarget");
        const previouslySelectedName = select.value;

        select.innerHTML = '<option value="">--- เลือกผู้เล่น ---</option>';
        enemyTargetSelect.innerHTML = '<option value="shared">ยังไม่กำหนดเป้าหมาย (ศัตรูร่วม)</option>';

        let foundSelected = false;
        for (let uid in allPlayersDataByUID) {
            const player = allPlayersDataByUID[uid];
            
            // Check HP 0
            if (previousPlayerHps[uid] !== undefined && previousPlayerHps[uid] > 0 && player.hp <= 0) {
                showCustomAlert(`${player.name} ถูกกำจัด! (HP หมด)`, 'error');
            }
            previousPlayerHps[uid] = player.hp;

            select.innerHTML += `<option value="${player.name}">${player.name}</option>`;
            enemyTargetSelect.innerHTML += `<option value="${uid}">${player.name}</option>`;
            if (player.name === previouslySelectedName) foundSelected = true;
        }

        if (foundSelected) {
            select.value = previouslySelectedName;
            loadPlayer(); 
        } else {
            resetPlayerEditor();
        }
        displayCombatState(combatState); 

        if (typeof updatePvPSelects === 'function') {
            updatePvPSelects();
        }
    });

    const enemiesRef = db.ref(`rooms/${roomId}/enemies`);
    enemiesRef.on('value', (snapshot) => {
        allEnemies = snapshot.val() || {};
        
        // Check Enemy HP 0
        for (const key in allEnemies) {
            const enemy = allEnemies[key];
            if (previousEnemyHps[key] !== undefined && previousEnemyHps[key] > 0 && enemy.hp <= 0) {
                showCustomAlert(`${enemy.name} ถูกกำจัด!`, 'success');
            }
            previousEnemyHps[key] = enemy.hp;
        }

        displayAllEnemies(allEnemies);
        displayCombatState(combatState);
    });

    const combatRef = db.ref(`rooms/${roomId}/combat`);
    combatRef.on('value', (snapshot) => {
        combatState = snapshot.val() || {};
        displayCombatState(combatState); 
    });

    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.child('diceLogs').on('value', s => displayDiceLog(s.val(), 'playerDiceLog'));
    roomRef.child('combatLogs').on('value', s => displayDiceLog(s.val(), 'playerCombatLog'));
    roomRef.child('story').on('value', s => {
        const storyEl = document.getElementById("story");
        if(storyEl) storyEl.value = s.val() || "";
    });

    populateMonsterTemplates();
    populateClassCheckboxes(); 
    populateWeaponTypes(); 
    populateRaceAndClassDropdowns(); 
    populateConsumableInputs(); 

    document.getElementById("playerSelect").addEventListener('change', loadPlayer);

    monitorShopItems();
    document.getElementById("shopIdSelect").addEventListener('change', monitorShopItems);
    monitorGuildQuests();

    function updatePvPSelects() {
        const p1Select = document.getElementById('pvpPlayer1');
        const p2Select = document.getElementById('pvpPlayer2');
        if(!p1Select || !p2Select) return;

        // เก็บค่าเดิมไว้ก่อน (กันรีเฟรชแล้วหาย)
        const sel1 = p1Select.value;
        const sel2 = p2Select.value;

        p1Select.innerHTML = '<option value="">-- เลือก --</option>';
        p2Select.innerHTML = '<option value="">-- เลือก --</option>';

        let count = 0;

        for (const uid in allPlayersDataByUID) {
            const p = allPlayersDataByUID[uid];
            
            // ⭐ [เพิ่มเงื่อนไข] แสดงเฉพาะคนที่อยู่ที่ 'colosseum_lobby' ⭐
            if (p.location === 'colosseum_lobby') {
                const status = p.hp > 0 ? '' : ' (บาดเจ็บ)';
                const optionHTML = `<option value="${uid}">${p.name} (Lv.${p.level})${status}</option>`;
                
                p1Select.innerHTML += optionHTML;
                p2Select.innerHTML += optionHTML;
                count++;
            }
        }
        
        // พยายามเลือกค่าเดิม (ถ้าเขายังอยู่ในล็อบบี้)
        if (p1Select.querySelector(`option[value="${sel1}"]`)) p1Select.value = sel1;
        if (p2Select.querySelector(`option[value="${sel2}"]`)) p2Select.value = sel2;

        // (Optional) ถ้าไม่มีใครลงทะเบียนเลย อาจจะใส่ข้อความแจ้งเตือนใน Console หรือ UI
        if (count === 0) {
            const emptyOpt = '<option disabled>-- ยังไม่มีผู้ลงทะเบียน --</option>';
            p1Select.innerHTML += emptyOpt;
            p2Select.innerHTML += emptyOpt;
        }
    }
};

async function startPvPMatch() {
    const p1Uid = document.getElementById('pvpPlayer1').value;
    const p2Uid = document.getElementById('pvpPlayer2').value;
    const roomId = sessionStorage.getItem('roomId');

    if (!p1Uid || !p2Uid) return showCustomAlert('กรุณาเลือกผู้เล่นทั้ง 2 ฝ่าย', 'warning');
    if (p1Uid === p2Uid) return showCustomAlert('ไม่สามารถเลือกคนเดียวกันได้', 'error');

    const p1 = allPlayersDataByUID[p1Uid];
    const p2 = allPlayersDataByUID[p2Uid];

    // รีเซ็ตสถานะเก่า
    const playerUpdates = {};
    playerUpdates[`/rooms/${roomId}/playersByUid/${p1Uid}/activeEffects`] = [];
    playerUpdates[`/rooms/${roomId}/playersByUid/${p2Uid}/activeEffects`] = [];
    playerUpdates[`/rooms/${roomId}/playersByUid/${p1Uid}/skillCooldowns`] = {};
    playerUpdates[`/rooms/${roomId}/playersByUid/${p2Uid}/skillCooldowns`] = {};
    await db.ref().update(playerUpdates);

    // สร้าง Turn Order
    const units = [
        { id: p1Uid, name: p1.name, dex: calculateTotalStat(p1, 'DEX'), type: 'player' },
        { id: p2Uid, name: p2.name, dex: calculateTotalStat(p2, 'DEX'), type: 'player' }
    ];
    units.sort((a, b) => b.dex - a.dex); // เรียงตาม DEX

    const pvpState = {
        isActive: true,
        type: 'PVP', // ⭐ สำคัญ: ระบุว่าเป็น PvP
        turnOrder: units,
        currentTurnIndex: 0,
        participants: { [p1Uid]: true, [p2Uid]: true }
    };

    await db.ref(`rooms/${roomId}/combat`).set(pvpState);
    showCustomAlert(`เริ่มประลอง! ${p1.name} VS ${p2.name}`, 'success');
}

function populateClassCheckboxes() {
    const container = document.getElementById('recommendedClassCheckboxes');
    if (!container) return;
    container.innerHTML = '';
    ALL_CLASSES.forEach(className => {
        container.innerHTML += `
            <div style="display: flex; align-items: center;">
                <input type="checkbox" id="cb-${className}" value="${className}" style="width: auto; margin-top: 0;">
                <label for="cb-${className}" style="margin: 0 5px;">${className}</label>
            </div>
        `;
    });
}
function populateWeaponTypes() {
    const select = document.getElementById('customWeaponType');
    if (!select) return;
    select.innerHTML = '';
    ALL_WEAPON_TYPES.forEach(type => {
        select.innerHTML += `<option value="${type}">${type}</option>`;
    });
}
function toggleItemFields() {
    const type = document.getElementById('customItemType').value;
    document.getElementById('equipmentFields').classList.toggle('hidden', type !== 'สวมใส่');
    document.getElementById('weaponFields').classList.toggle('hidden', type !== 'อาวุธ');
    document.getElementById('consumableFields').classList.toggle('hidden', type !== 'บริโภค');
}

function populateRaceAndClassDropdowns() {
    const raceSelect = document.getElementById('editRace');
    if (raceSelect) {
        raceSelect.innerHTML = '';
        ALL_RACES.forEach(raceName => {
            raceSelect.innerHTML += `<option value="${raceName}">${raceName}</option>`;
        });
    }
    const classMainSelect = document.getElementById('editClassMain');
    const classSubSelect = document.getElementById('editClassSub');
    if (classMainSelect && classSubSelect) {
        classMainSelect.innerHTML = '';
        classSubSelect.innerHTML = '<option value="">-- ไม่มี --</option>';
        ALL_CLASSES.forEach(className => {
            classMainSelect.innerHTML += `<option value="${className}">${className}</option>`;
            classSubSelect.innerHTML += `<option value="${className}">${className}</option>`;
        });
    }
    const guildClassSelect = document.getElementById('guildQuestForClass');
    if (guildClassSelect) {
        guildClassSelect.innerHTML = '';
        ALL_CLASSES.forEach(className => {
            guildClassSelect.innerHTML += `<option value="${className}">${className}</option>`;
        });
    }
}

function toggleEnemyAuto(enemyId) {
    const roomId = sessionStorage.getItem('roomId');
    const enemyRef = db.ref(`rooms/${roomId}/enemies/${enemyId}`);
    
    enemyRef.transaction(data => {
        if (!data) return data;
        data.isAuto = !data.isAuto; // สลับค่า true/false
        return data;
    });
}

// ฟังก์ชัน AI ประมวลผลเทิร์น (ใช้แทน checkAndRunSummonAI)
async function processAutoTurn(currentUnit, combatState) {
    const roomId = sessionStorage.getItem('roomId');

    // ป้องกันการรันซ้ำในเทิร์นเดิม
    if (combatState.currentTurnIndex === lastProcessedTurnIndex) return; 
    lastProcessedTurnIndex = combatState.currentTurnIndex;
    
    const unitData = allEnemies[currentUnit.id];
    if (!unitData) return;

    const isPlayerSummon = unitData.type === 'player_summon';
    const display = document.getElementById('dm-roll-result-display');
    
    if (display) {
        const color = isPlayerSummon ? '#00e676' : '#ff4d4d';
        display.innerHTML = `<span style="color:${color};">🤖 ${currentUnit.name} กำลังคิด...</span>`;
    }

    setTimeout(async () => {
        // 1. ระบุทีมและหาเป้าหมาย
        let validTargets = [];
        const latestEnemiesSnap = await db.ref(`rooms/${roomId}/enemies`).get();
        const latestEnemies = latestEnemiesSnap.val() || {};

        if (isPlayerSummon) {
            // ซัมมอน: ตีศัตรู
            validTargets = Object.keys(latestEnemies).filter(k => 
                k !== currentUnit.id && latestEnemies[k].type !== 'player_summon' && latestEnemies[k].hp > 0
            ).map(id => ({ id, ...latestEnemies[id], targetType: 'enemy' }));
        } else {
            // ศัตรู: ตีผู้เล่น + ซัมมอน
            for (const uid in allPlayersDataByUID) {
                if ((allPlayersDataByUID[uid].hp || 0) > 0) {
                    validTargets.push({ id: uid, ...allPlayersDataByUID[uid], targetType: 'player' });
                }
            }
            for (const key in latestEnemies) {
                if (latestEnemies[key].type === 'player_summon' && latestEnemies[key].hp > 0) {
                    validTargets.push({ id: key, ...latestEnemies[key], targetType: 'summon' });
                }
            }
            
            // Chekc Taunt (ยั่วยุ)
            const tauntEffect = unitData.activeEffects?.find(e => e.type === 'TAUNT');
            if (tauntEffect && allPlayersDataByUID[tauntEffect.taunterUid]?.hp > 0) {
                validTargets = [{ id: tauntEffect.taunterUid, ...allPlayersDataByUID[tauntEffect.taunterUid], targetType: 'player' }];
            }
        }

        if (validTargets.length === 0) {
            if(display) display.innerHTML = `<span>...ไม่พบเป้าหมาย ข้ามเทิร์น...</span>`;
            setTimeout(() => advanceTurn(), 1000);
            return;
        }

        const target = validTargets[Math.floor(Math.random() * validTargets.length)];

        // 2. [FIX] เรียกใช้ฟังก์ชันกลาง (isAuto = true)
        // ฟังก์ชันนี้จะจัดการเรื่อง Pending Attack และหยุดรอผู้เล่นให้เอง
        await executeAttack(currentUnit.id, target.id, true);

    }, 1000);
}

// =================================================================================
// ส่วนที่ 8: AFK System
// =================================================================================
let _afkRoomId = null;
let _roomPresence = {};     // rooms/{roomId}/presence/{uid}
let _afkPlayers = {};       // rooms/{roomId}/afkPlayersByUid/{uid}
let _roomPlayers = {};    // rooms/{roomId}/playersByUid/{uid}

async function movePlayerToAfk(roomId, uid, reason = 'offline') {
  const fromRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);
  const toRef = db.ref(`rooms/${roomId}/afkPlayersByUid/${uid}`);

  const snap = await fromRef.get();
  if (!snap.exists()) return; // ไม่มีในห้องอยู่แล้ว

  const data = snap.val();
  data.__afk = true;
  data.__afkReason = reason;
  data.__afkAt = firebase.database.ServerValue.TIMESTAMP;

  // multi-location update แบบ atomic-ish
  const updates = {};
  updates[`rooms/${roomId}/afkPlayersByUid/${uid}`] = data;
  updates[`rooms/${roomId}/playersByUid/${uid}`] = null;

  await db.ref().update(updates);

  // ถ้ามี combat อยู่: เอาออกจาก turnOrder กันเทิร์นตกหลุม
  await removeUnitFromTurnOrder(roomId, uid, 'player');
}

async function restorePlayerFromAfk(roomId, uid) {
  const fromRef = db.ref(`rooms/${roomId}/afkPlayersByUid/${uid}`);
  const toRef = db.ref(`rooms/${roomId}/playersByUid/${uid}`);

  const snap = await fromRef.get();
  if (!snap.exists()) return;

  const data = snap.val();
  delete data.__afk;
  delete data.__afkReason;

  const updates = {};
  updates[`rooms/${roomId}/playersByUid/${uid}`] = data;
  updates[`rooms/${roomId}/afkPlayersByUid/${uid}`] = null;

  await db.ref().update(updates);

  // ถ้ามี combat อยู่: ใส่กลับ turnOrder (เรียงใหม่ตาม DEX)
  await addUnitBackToTurnOrder(roomId, uid, data);
}

function initAfkSystem(roomId) {
  _afkRoomId = roomId;
  if (!roomId) return;

  // 1) ผู้เล่นในห้อง (ดึงตรงจาก RTDB)
  db.ref(`rooms/${roomId}/playersByUid`).on('value', snap => {
    _roomPlayers = snap.val() || {};
    refreshAfkUi();
    autoSyncAfkFromPresence();
  });

  // 2) presence ของห้อง (ออนไลน์/ออฟไลน์)  ← ตัวนี้ฝั่งผู้เล่นยิงไว้ด้วย registerRoomPresence :contentReference[oaicite:2]{index=2}
  db.ref(`rooms/${roomId}/presence`).on('value', snap => {
    _roomPresence = snap.val() || {};
    refreshAfkUi();
    autoSyncAfkFromPresence();
  });

  // 3) คลัง AFK
  db.ref(`rooms/${roomId}/afkPlayersByUid`).on('value', snap => {
    _afkPlayers = snap.val() || {};
    refreshAfkUi();
    autoSyncAfkFromPresence();
  });

  refreshAfkUi();
}

// --- UI helpers ---
function refreshAfkUi() {
  renderAfkSelect();
  renderPresenceList();
  renderAfkList();
}

function renderAfkSelect() {
  const sel = document.getElementById('afkPlayerSelect');
  if (!sel) return;

  const prev = sel.value;
  sel.innerHTML = '<option value="">--- เลือกผู้เล่น ---</option>';

  const players = _roomPlayers || {};
  const pres = _roomPresence || {};
  const afk = _afkPlayers || {};

  Object.keys(players).forEach(uid => {
    if (afk[uid]) return; // คนที่อยู่ AFK ไม่ต้องอยู่ใน list "ผู้เล่นในห้อง"

    const p = players[uid] || {};
    const st = pres[uid]?.status || 'offline';
    const icon = (st === 'online') ? '🟢' : '⚪';

    const opt = document.createElement('option');
    opt.value = uid;
    opt.textContent = `${icon} ${p.name || uid}`;
    sel.appendChild(opt);
  });

  if (sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
}

function renderPresenceList() {
  const el = document.getElementById('presenceList');
  if (!el) return;

  const players = _roomPlayers || {};
  const pres = _roomPresence || {};
  const afk = _afkPlayers || {};

  const uids = new Set([...Object.keys(players), ...Object.keys(pres)]);

  if (uids.size === 0) {
    el.innerHTML = `<p style="color:#aaa; text-align:center;">ยังไม่มีข้อมูล</p>`;
    return;
  }

  const rows = [];
  uids.forEach(uid => {
    const p = players[uid] || {};
    const st = pres[uid]?.status || 'offline';
    const isAfk = !!afk[uid];

    const icon = (st === 'online') ? '🟢' : '⚪';
    const afkTag = isAfk ? ' <span style="color:#ffcc00;">[AFK]</span>' : '';
    const name = p.name || uid;

    rows.push(`<div style="padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.08);">
      ${icon} <b>${name}</b> <span style="color:#aaa; font-size:0.9em;">(${st})</span>${afkTag}
    </div>`);
  });

  el.innerHTML = rows.join('');
}

function renderAfkList() {
  const el = document.getElementById('afkList');
  if (!el) return;

  const afk = _afkPlayers || {};
  const uids = Object.keys(afk);

  if (uids.length === 0) {
    el.innerHTML = `<p style="color:#aaa; text-align:center;">ไม่มีใครอยู่ AFK</p>`;
    return;
  }

  el.innerHTML = uids.map(uid => {
    const p = afk[uid] || {};
    const name = p.name || uid;
    const reason = p.__afkReason || 'unknown';
    return `<div style="padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.08);">
      💤 <b>${name}</b> <span style="color:#aaa; font-size:0.9em;">(${reason})</span>
    </div>`;
  }).join('');
}

// --- Core move/restore ---
async function movePlayerToAfkByUid(uid, reason = 'offline') {
  if (!_afkRoomId || !uid) return;

  const roomId = _afkRoomId;
  const fromPath = `rooms/${roomId}/playersByUid/${uid}`;
  const toPath   = `rooms/${roomId}/afkPlayersByUid/${uid}`;

  const snap = await db.ref(fromPath).get();
  if (!snap.exists()) return;

  const data = snap.val();
  data.__afk = true;
  data.__afkReason = reason;
  data.__afkAt = firebase.database.ServerValue.TIMESTAMP;

  const updates = {};
  updates[toPath] = data;
  updates[fromPath] = null;

  await db.ref().update(updates);

  // กันเทิร์นตกหลุม
  await removeUnitFromTurnOrderSafe(roomId, uid, 'player');

  refreshAfkUi();
}


async function restorePlayerFromAfkByUid(uid) {
  if (!_afkRoomId || !uid) return;

  const roomId = _afkRoomId;
  const fromPath = `rooms/${roomId}/afkPlayersByUid/${uid}`;
  const toPath   = `rooms/${roomId}/playersByUid/${uid}`;

  const snap = await db.ref(fromPath).get();
  if (!snap.exists()) return;

  const data = snap.val();
  delete data.__afk;
  delete data.__afkReason;

  const updates = {};
  updates[toPath] = data;
  updates[fromPath] = null;

  await db.ref().update(updates);

  // ใส่กลับเทิร์นถ้ากำลังสู้
  await addUnitBackToTurnOrderSafe(roomId, uid, data);

  refreshAfkUi();
}

// --- Manual buttons (UI) ---
async function moveSelectedPlayerToAfk() {
  const sel = document.getElementById('afkPlayerSelect');
  const uid = sel?.value;
  if (!uid) return showCustomAlert?.('เลือกผู้เล่นก่อน', 'error');
  await movePlayerToAfkByUid(uid, 'manual');
}

async function restoreSelectedPlayerFromAfk() {
  const sel = document.getElementById('afkPlayerSelect');
  const uid = sel?.value;
  if (!uid) return showCustomAlert?.('เลือกผู้เล่นก่อน (หรือกดดึงกลับจากรายการ AFK)', 'info');
  if (!_afkPlayers?.[uid]) return showCustomAlert?.('คนนี้ไม่ได้อยู่ AFK', 'info');
  await restorePlayerFromAfkByUid(uid);
}


// --- Auto sync from presence ---

async function autoSyncAfkFromPresence() {
  const roomId = _afkRoomId;
  if (!roomId) return;

  const pres = _roomPresence || {};
  const players = _roomPlayers || {};
  const afk = _afkPlayers || {};

  // 1) ผู้เล่นในห้องที่ offline -> ย้ายไป AFK
  for (const uid of Object.keys(players)) {
    const st = pres[uid]?.status || 'offline';
    if (st !== 'online' && !afk[uid]) {
      await movePlayerToAfk(roomId, uid, 'offline');
    }
  }

  // 2) คนที่อยู่ AFK แต่กลับมา online -> restore
  for (const uid of Object.keys(afk)) {
    const st = pres[uid]?.status || 'offline';
    if (st === 'online') {
      await restorePlayerFromAfk(roomId, uid);
    }
  }
}

// --- Combat turn-order helpers (safe) ---
async function removeUnitFromTurnOrderSafe(roomId, unitId, unitType) {
  // ถ้าคุณมีฟังก์ชัน removeUnitFromTurnOrder ใน dm-combat.js แล้ว ให้ใช้ตัวนั้น
  if (typeof window.removeUnitFromTurnOrder === 'function') {
    return window.removeUnitFromTurnOrder(roomId, unitId, unitType);
  }

  const combatRef = db.ref(`rooms/${roomId}/combat`);
  const snap = await combatRef.get();
  if (!snap.exists()) return;

  const combat = snap.val();
  if (!combat?.isActive || !Array.isArray(combat.turnOrder)) return;

  const oldOrder = combat.turnOrder;
  const idx = oldOrder.findIndex(u => u.id === unitId && u.type === unitType);
  if (idx === -1) return;

  const newOrder = oldOrder.filter((_, i) => i !== idx);

  let newIndex = combat.currentTurnIndex || 0;
  if (idx < newIndex) newIndex = Math.max(0, newIndex - 1);

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

async function addUnitBackToTurnOrderSafe(roomId, uid, playerData) {
  if (typeof window.addUnitBackToTurnOrder === 'function') {
    return window.addUnitBackToTurnOrder(roomId, uid, playerData);
  }

  const combatRef = db.ref(`rooms/${roomId}/combat`);
  const snap = await combatRef.get();
  if (!snap.exists()) return;

  const combat = snap.val();
  if (!combat?.isActive || !Array.isArray(combat.turnOrder)) return;

  if (combat.turnOrder.some(u => u.id === uid && u.type === 'player')) return;

  // หา DEX แบบกันพัง
  let dex = 10;
  try {
    if (typeof calculateTotalStat === 'function') dex = calculateTotalStat(playerData, 'DEX');
    else dex = playerData?.stats?.DEX || 10;
  } catch (_) {}

  const newUnit = { id: uid, name: playerData.name || uid, dex, type: 'player' };
  const newOrder = [...combat.turnOrder, newUnit];
  newOrder.sort((a, b) => (b.dex || 0) - (a.dex || 0));

  const cur = combat.turnOrder[combat.currentTurnIndex || 0];
  const newCurIndex = Math.max(0, newOrder.findIndex(u => u.id === cur?.id && u.type === cur?.type));

  await combatRef.update({
    turnOrder: newOrder,
    currentTurnIndex: newCurIndex,
    lastUpdated: Date.now()
  });
}

// เรียกจาก listener playersRef.on('value') เพื่อให้ dropdown ไม่ว่าง
function onPlayersDataUpdatedForAfk() {
  refreshAfkUi();
  autoSyncAfkFromPresence(); // ถ้าเพิ่งมี players เข้ามา แล้ว presence เป็น offline จะย้ายได้ทันที
}

// ==========================================
// ระบบจัดการเควสกิลด์ฝั่ง DM
// ==========================================

// 1. ฟังก์ชันสร้างเควสลงบอร์ดกิลด์
async function createGuildQuest() {
    const roomId = sessionStorage.getItem('roomId');
    const title = document.getElementById("questTitle").value.trim();
    const targetMonster = document.getElementById("questTarget").value.trim();
    const reqCount = parseInt(document.getElementById("questCount").value) || 1;
    const rewardClass = document.getElementById("questRewardClass").value;

    if (!roomId) return showCustomAlert('ไม่พบรหัสห้อง', 'error');
    if (!title || !targetMonster || !rewardClass) {
        return showCustomAlert('กรุณากรอกข้อมูลเควสให้ครบถ้วน!', 'warning');
    }

    try {
        await db.ref(`rooms/${roomId}/guildQuests`).push({
            title: title,
            targetMonster: targetMonster,
            requiredCount: reqCount,
            rewardClass: rewardClass,
            createdAt: Date.now()
        });

        showCustomAlert('📌 แปะภารกิจลงกระดานกิลด์เรียบร้อย!', 'success');
        
        // เคลียร์ช่องกรอกข้อมูล
        document.getElementById("questTitle").value = '';
        document.getElementById("questTarget").value = '';
        document.getElementById("questCount").value = '1';
        document.getElementById("questRewardClass").value = '';

    } catch (error) {
        console.error("Create Quest Error:", error);
        showCustomAlert('เกิดข้อผิดพลาดในการสร้างเควส', 'error');
    }

    return createGuildBoardQuest();
}

// 2. ฟังก์ชันดึงเควสมาแสดงให้ DM ดู และสามารถลบได้
function monitorDMGuildQuests() {
    const roomId = sessionStorage.getItem('roomId');
    if (!roomId) return;

    db.ref(`rooms/${roomId}/guildQuests`).on('value', snap => {
        const listDiv = document.getElementById('currentGuildQuestsList');
        const countSpan = document.getElementById('guildQuestCount');
        if (!listDiv) return;

        const quests = snap.val() || {};
        let html = '';
        let count = 0;

        for (let questId in quests) {
            let q = quests[questId];
            html += `
            <div style="background:#222; border: 1px solid #444; padding:8px; margin-bottom:5px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <b style="color:#1cb5e0;">${q.title}</b><br>
                    <small style="color:#aaa;">🎯 ล่า <b>${q.targetMonster}</b> (${q.requiredCount} ตัว) ➡ อาชีพ: <span style="color:#28a745;">${q.rewardClass}</span></small>
                </div>
                <button onclick="deleteGuildQuest('${questId}')" style="background:#dc3545; padding:5px 10px; width:auto;">ลบทิ้ง</button>
            </div>`;
            count++;
        }

        if (count === 0) {
            html = '<p style="color:#aaa; text-align:center; margin:0;">ไม่มีเควสค้างอยู่บนกระดาน</p>';
        }
        
        listDiv.innerHTML = html;
        if (countSpan) countSpan.textContent = count;
    });
}

function monitorDMGuildBoardQuests() {
    const roomId = sessionStorage.getItem('roomId');
    const listDiv = document.getElementById('guild-quest-list');

    db.ref(`rooms/${roomId}/guildBoardQuests`).on('value', (snapshot) => {
        const quests = snapshot.val() || {};
        listDiv.innerHTML = '';

        const keys = Object.keys(quests);
        if (keys.length === 0) {
            listDiv.innerHTML = '<p style="color:#aaa; text-align:center;">- ไม่มีเควสบอร์ด -</p>';
            return;
        }

        keys.forEach((qid) => {
            const q = quests[qid];
            listDiv.innerHTML += `
              <div style="border:1px solid #333; padding:10px; margin:8px 0; border-radius:10px; background:#1f1f1f;">
                <div style="font-weight:bold; color:#fff;">${q.title || '(ไม่มีชื่อ)'}</div>
                <div style="color:#bbb; font-size:13px; margin-top:4px;">
                  เป้าหมาย: ${q.targetMonster} x ${q.requiredCount}<br>
                  รางวัลคลาส: ${q.rewardClass} | EXP: ${q.rewardExp}
                </div>
                <button onclick="deleteGuildBoardQuest('${qid}')" style="margin-top:8px; width:100%; padding:8px; background:#b71c1c; color:#fff; border:none; border-radius:8px;">
                  ลบเควสนี้
                </button>
              </div>
            `;
        });
    });
}

// 3. ฟังก์ชันลบเควสออกจากบอร์ด
function deleteGuildQuest(questId, questTitle) {
    const roomId = sessionStorage.getItem('roomId');

    Swal.fire({
        title: 'ยืนยันการลบ',
        text: `ต้องการลบ "${questTitle}" ใช่ไหม?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ลบ',
        cancelButtonText: 'ยกเลิก'
    }).then((result) => {
        if (!result.isConfirmed) return;

        db.ref(`rooms/${roomId}/guildQuests/${questId}`).remove()
            .then(() => Swal.fire('ลบแล้ว', 'ลบเควสเลื่อนขั้นเรียบร้อย', 'success'))
            .catch(err => Swal.fire('ผิดพลาด', err.message, 'error'));
    });
}
function deleteGuildBoardQuest(questId) {
    const roomId = sessionStorage.getItem('roomId');

    db.ref(`rooms/${roomId}/guildBoardQuests/${questId}`).remove()
        .then(() => Swal.fire('ลบแล้ว', 'ลบเควสบอร์ดเรียบร้อย', 'success'))
        .catch(err => Swal.fire('ผิดพลาด', err.message, 'error'));
}

// สั่งให้เริ่มดึงข้อมูลทันทีเมื่อเปิดหน้า DM
// (ใส่ไว้ใน setTimeout เพื่อรอให้ Firebase พร้อมก่อน)
setTimeout(monitorDMGuildQuests, 1500);


















