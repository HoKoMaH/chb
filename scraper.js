const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. مصفوفة المفاتيح (أضف مفاتيحك هنا أو في Env Variables)
const keys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k); // تصفية المفاتيح الموجودة فقط

let currentKeyIndex = 0;

/**
 * دالة الحصول على موديل نشط بمفتاح مختلف في كل مرة
 */
function getNextModel() {
    const key = keys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length; // التبديل للمفتاح التالي
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

async function translateWithGemini(textBatch) {
    if (!textBatch || textBatch.length === 0) return [];
    
    const model = getNextModel(); // استخدام مفتاح مختلف لكل دفعة
    const prompt = `Translate to Arabic. Return ONLY a JSON array of strings. No intro. Lines: ${JSON.stringify(textBatch)}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();
        
        // تنظيف الاستجابة
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const parsed = JSON.parse(text);
        return (Array.isArray(parsed) && parsed.length === textBatch.length) ? parsed : textBatch;
    } catch (e) {
        console.error(`[KEY-${currentKeyIndex}] Error:`, e.message);
        return textBatch; 
    }
}

/**
 * المحرك الرئيسي المتوافق مع index.js
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

    const totalLines = textToTranslate.length;
    if (totalLines === 0) return sourceSrt;

    // رفع حجم الدفعة قليلاً لأننا نستخدم مفاتيح متعددة
    const BATCH_SIZE = 40; 
    let finalResults = [];

    for (let i = 0; i < totalLines; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        
        const translatedBatch = await translateWithGemini(batch);
        finalResults.push(...translatedBatch);

        const percent = Math.floor(((i + batch.length) / totalLines) * 100);
        if (onProgress) onProgress(percent);
        
        // تأخير بسيط جداً (نصف ثانية) لأننا نوزع الضغط على 7 مفاتيح
        await new Promise(r => setTimeout(r, 500)); 
    }

    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }

    return lines.join('\n');
}

// ... بقية الدوال تبقى كما هي
module.exports = { fetchAllPossibleSubs, translateToArabic };
