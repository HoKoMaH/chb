const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x');

// 1. استخراج المفاتيح الصالحة فقط
const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * دالة ترجمة الدفعة الواحدة (محاولة Gemini ثم Google كخيار احتياطي)
 */
async function translateBatch(batch, keyIndex) {
    const key = keys[keyIndex % keys.length];
    
    // إذا لم توجد مفاتيح، نتوجه لجوجل فوراً
    if (!key) return await translateWithGoogle(batch);

    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // برومبت مكثف لسرعة الاستجابة
        const prompt = `Translate to Arabic JSON array: ${JSON.stringify(batch)}`;
        const result = await model.generateContent(prompt);
        const text = (await result.response).text().trim().replace(/```json/g, '').replace(/```/g, '');
        
        const parsed = JSON.parse(text);
        return (Array.isArray(parsed) && parsed.length === batch.length) ? parsed : batch;
    } catch (e) {
        console.error(`⚠️ فشل المفتاح ${keyIndex + 1}، استخدام المحرك البديل...`);
        return await translateWithGoogle(batch);
    }
}

async function translateWithGoogle(batch) {
    try {
        const res = await translate(batch, { to: 'ar', forceBatch: true });
        return res.map(item => item.text);
    } catch { return batch; }
}

/**
 * المحرك النفاث (المعالجة المتوازية)
 */
async function translateToArabic(sourceSrt, onProgress = () => {}) {
    if (!sourceSrt) return "";
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const BATCH_SIZE = 40;
    const totalBatches = Math.ceil(textToTranslate.length / BATCH_SIZE);
    let allPromises = [];

    // إرسال جميع الدفعات في وقت واحد (Parallel)
    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const keyIndex = i / BATCH_SIZE;
        
        // إضافة المهمة للمصفوفة لتعمل في الخلفية
        allPromises.push(translateBatch(batch, keyIndex));
    }

    // انتظار انتهاء جميع المهام وتحديث النسبة (وهمي سريع لراحة المستخدم)
    onProgress(50); 
    const results = await Promise.all(allPromises);
    onProgress(100);

    // دمج النتائج
    const finalResults = [].concat(...results);
    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }

    return lines.join('\n');
}

module.exports = { translateToArabic };
