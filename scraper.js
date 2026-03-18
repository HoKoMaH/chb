const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// 1. تنظيف وتجهيز المفاتيح من البيئة
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].map(k => k ? k.trim() : null).filter(k => k);

let currentKeyIndex = 0;

/**
 * محرك التعريب الذكي - إصدار تخطي القيود (No Safety Filters)
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt) return null;
    if (API_KEYS.length === 0) {
        console.error("❌ لم يتم العثور على مفاتيح GEMINI_KEY.");
        return sourceSrt;
    }

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines];
    let batchTexts = [];
    let batchIndices = [];
    
    // حجم الدفعة (يفضل 30 لضمان استقرار السرعة)
    const BATCH_SIZE = 30; 

    console.log(`[GEMINI] 🚀 بدء تعريب ${lines.length} سطر باستخدام ${API_KEYS.length} مفاتيح...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        if (batchTexts.length === BATCH_SIZE || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retryCount = 0;
            const maxRetries = API_KEYS.length * 2;

            while (!success && retryCount < maxRetries) {
                const activeKey = API_KEYS[currentKeyIndex];
                currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;

                try {
                    const genAI = new GoogleGenerativeAI(activeKey);
                    
                    // إعدادات الأمان لتعطيل حظر الكلمات الحساسة في الأفلام
                    const safetySettings = [
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    ];

                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-1.5-flash",
                        safetySettings
                    });

                    const prompt = `Translate these movie subtitle lines to Arabic. Return ONLY the translation, line by line. Keep the cinematic style:\n\n${batchTexts.join('\n')}`;

                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const translatedText = response.text().trim();

                    if (translatedText) {
                        const translatedParts = translatedText.split('\n');
                        for (let j = 0; j < batchIndices.length; j++) {
                            translatedLines[batchIndices[j]] = translatedParts[j]?.trim() || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retryCount++;
                    console.error(`[⚠️ ERROR] Key #${currentKeyIndex + 1}: ${e.message.substring(0, 100)}`);
                    // إذا كان الخطأ بسبب الضغط 429 ننتظر أكثر
                    const wait = e.message.includes("429") ? 5000 : 1500;
                    await new Promise(r => setTimeout(r, wait));
                }
            }

            batchTexts = [];
            batchIndices = [];

            if (onProgress) {
                let percent = Math.floor((i / lines.length) * 100);
                onProgress(percent);
            }
        }
    }
    return translatedLines.join('\n');
}

/**
 * جلب الترجمات من SubDL
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original" }];
        }

        const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);
        if (enRes?.data?.subtitles?.length > 0) {
            const s = enRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) {
                console.log(`[AI] التعريب التلقائي قيد التنفيذ...`);
                const translated = await translateToArabic(content, null);
                if (translated) return [{ content: translated, releaseName: s.release_name, source: "AI (Gemini)" }];
            }
        }
    } catch (e) { console.error(e); }
    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { 
            responseType: 'arraybuffer',
            timeout: 10000 
        });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
