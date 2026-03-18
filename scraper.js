const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x'); // محرك الطوارئ

const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 10); // التأكد من جودة المفتاح

let currentKeyIndex = 0;

// دالة الترجمة بمحرك جوجل المجاني (عند فشل الـ API)
async function translateWithGoogleFallback(textBatch) {
    try {
        const res = await translate(textBatch, { to: 'ar', forceBatch: true });
        return res.map(item => item.text);
    } catch (e) {
        return textBatch; // العودة للأصل إذا انقطع كل شيء
    }
}

async function translateWithGemini(textBatch, retryCount = 0) {
    if (keys.length === 0 || retryCount > 1) {
        // إذا لم توجد مفاتيح أو فشلت المحاولات، استخدم جوجل المجاني فوراً
        return await translateWithGoogleFallback(textBatch);
    }

    const key = keys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;

    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const result = await model.generateContent(`Translate to Arabic JSON array: ${JSON.stringify(textBatch)}`);
        const response = await result.response;
        let text = response.text().trim().replace(/```json/g, '').replace(/```/g, '');
        
        const parsed = JSON.parse(text);
        return (Array.isArray(parsed) && parsed.length === textBatch.length) ? parsed : textBatch;
    } catch (e) {
        console.error(`[SYSTEM] مفتاح رقم ${currentKeyIndex + 1} فشل، يحاول البديل...`);
        // محاولة إعادة المحاولة مع المفتاح التالي، أو التحويل لجوجل
        return await translateWithGemini(textBatch, retryCount + 1);
    }
}

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

    const BATCH_SIZE = 30;
    let finalResults = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const translatedBatch = await translateWithGemini(batch);
        finalResults.push(...translatedBatch);

        if (onProgress) onProgress(Math.floor(((i + batch.length) / textToTranslate.length) * 100));
        await new Promise(r => setTimeout(r, 400));
    }

    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }
    return lines.join('\n');
}

module.exports = { translateToArabic, fetchAllPossibleSubs: async () => [] }; 
// دالة fetchAllPossibleSubs تم اختصارها للتركيز على حل مشكلة الترجمة
