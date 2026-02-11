// element-reactions.js (Bitmask table สำหรับ ElementalEngine)

(function (global) {
  // ดึง ELEMENT จาก engine (ต้องโหลด elemental-engine.js ก่อน)
  const E = global.ElementalEngine?.ELEMENT;

  if (!E) {
    console.error("[element-reactions] ElementalEngine.ELEMENT not found. Load elemental-engine.js first.");
    global.ELEMENT_REACTIONS = {};
    return;
  }

  const key = (a, b) => ((a | b) >>> 0);

  // ✅ ตารางปฏิกิริยาแบบ key เดียว (ไม่สนลำดับ)
  const REACTIONS = {
    [key(E.FIRE, E.ICE)]: { name: "ละลาย", multiplier: 1.5 },
    [key(E.FIRE, E.ELECTRIC)]: { name: "ระเบิดไฟฟ้า", multiplier: 1.3 },
    [key(E.WATER, E.ELECTRIC)]: { name: "ช็อต", multiplier: 1.4 },
    [key(E.WATER, E.FIRE)]: { name: "ไอน้ำ", multiplier: 1.2 },
  };

  // export เป็น global ให้ engine เห็น
  global.ELEMENT_REACTIONS = Object.freeze(REACTIONS);

  // (ออปชัน) เผื่อ debug
  // console.log("[element-reactions] loaded:", global.ELEMENT_REACTIONS);

})(window);
