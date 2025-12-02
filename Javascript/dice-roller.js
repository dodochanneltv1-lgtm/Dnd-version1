/**
 * ฟังก์ชันแสดงอนิเมชันการทอยเต๋า
 * @param {number} diceCount - จำนวนลูกเต๋า
 * @param {number} diceType - ชนิดของเต๋า (d20 คือ 20)
 * @param {string} animationContainerId - ID ของ div ที่จะแสดงอนิเมชัน
 * @param {string} resultContainerId - ID ของ div ที่จะแสดงผลรวม
 * @param {HTMLElement} rollButton - Element ของปุ่มที่กดทอย
 * @returns {Promise<{results: number[], total: number}>} - คืนค่าผลลัพธ์และผลรวม
 */
function showDiceRollAnimation(diceCount, diceType, animationContainerId, resultContainerId, rollButton) {
    return new Promise(resolve => {
        const animationArea = document.getElementById(animationContainerId);
        const resultArea = document.getElementById(resultContainerId);

        // ปิดการใช้งานปุ่มชั่วคราว
        if (rollButton) rollButton.disabled = true;

        animationArea.innerHTML = '';
        resultArea.innerHTML = '<span style="color:#aaa; font-size:0.8em;">...กำลังลุ้น...</span>';

        const diceElements = [];
        // สร้างลูกเต๋า
        for (let i = 0; i < diceCount; i++) {
            const die = document.createElement('div');
            die.className = 'dice rolling'; // เริ่มด้วยคลาส rolling
            die.textContent = '?';
            animationArea.appendChild(die);
            diceElements.push(die);
        }

        // --- Logic การสุ่มแบบค่อยๆ ช้าลง (Easing) ---
        let speed = 50; // ความเร็วเริ่มต้น (ms)
        let maxSpeed = 400; // ความเร็วสุดท้ายก่อนหยุด (ms)
        let steps = 0; // นับจำนวนครั้งที่เปลี่ยนตัวเลข
        const minSteps = 15; // หมุนอย่างน้อยกี่ครั้ง

        const rollLoop = () => {
            // สุ่มตัวเลขโชว์ระหว่างหมุน
            diceElements.forEach(die => {
                die.textContent = Math.floor(Math.random() * diceType) + 1;
            });

            // เพิ่มความหน่วงเวลาขึ้นเรื่อยๆ (ทำให้ช้าลง)
            speed += (steps * 5); 

            if (steps < minSteps || speed < maxSpeed) {
                steps++;
                setTimeout(rollLoop, speed); // เรียกตัวเองซ้ำด้วยเวลาที่นานขึ้น
            } else {
                // --- จบการทอย (แสดงผลจริง) ---
                finishRoll();
            }
        };

        const finishRoll = () => {
            const finalResults = [];
            let total = 0;

            diceElements.forEach((die) => {
                // คำนวณค่าจริง
                const roll = Math.floor(Math.random() * diceType) + 1;
                finalResults.push(roll);
                total += roll;

                // เปลี่ยน Class CSS เพื่อแสดงเอฟเฟกต์ "หยุด"
                die.classList.remove('rolling');
                die.classList.add('landed'); // เพิ่ม class ใหม่สำหรับอนิเมชันตอนจบ
                die.textContent = roll;
                
                // (Optional) ถ้าทอยได้หน้า 20 หรือ 1 ให้เปลี่ยนสีเป็นพิเศษ
                if (diceType === 20) {
                    if (roll === 20) die.style.color = '#00ff00'; // Critical Hit
                    else if (roll === 1) die.style.color = '#ff4d4d'; // Critical Miss
                    else die.style.color = ''; // Reset
                }
            });

            // แสดงผลรวม
            if (diceCount > 1) {
                resultArea.innerHTML = `<span style="font-size:1.2em; font-weight:bold; color:#fff;">ผลรวม: ${total}</span>`;
            } else {
                resultArea.innerHTML = `<span style="font-size:1.2em; font-weight:bold; color:#fff;">ได้แต้ม: ${total}</span>`;
            }

            // เปิดใช้งานปุ่มอีกครั้ง
            if (rollButton) rollButton.disabled = false;

            // ส่งค่ากลับไป
            resolve({ results: finalResults, total: total });
        };

        // เริ่มหมุน
        rollLoop();
    });
}