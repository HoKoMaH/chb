const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. إعداد وتدوير المفاتيح (API Keys Rotation)
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.trim() !== ""); // تصفية المفاتيح الفارغة

let currentKeyIndex = 0;

/**
 * دالة لاختيار المفتاح التالي تلقائياً
 */
function getNextApiKey() {
    if (API_KEYS.length === 0) return null;
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

/**
 * 2. المحرك الرئيسي للترجمة باستخدام Gemini AI
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt) return null;
    if (API_KEYS.length === 0) {
        console.error("❌ خطأ: لم يتم ضبط أي مفاتيح GEMINI_KEY في إعدادات البيئة (Environment Variables).");
        return sourceSrt;
    }

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines];
    let batchTexts = [];
    let batchIndices = [];
    
    // حجم الدفعة (Batch Size) - Gemini Flash مستقر جداً مع 30-40 سطر
    const BATCH_SIZE = 35; 

    console.log(`[GEMINI] 🚀 بدء تعريب ${lines.length} سطر باستخدام ${API_KEYS.length} مفاتيح...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // تصفية أسطر الحوار فقط (تجنب التوقيت والأرقام)
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        if (batchTexts.length === BATCH_SIZE || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retryCount = 0;
            const maxRetries = API_KEYS.length * 2; // محاولة استهلاك المفاتيح مرتين قبل اليأس

            while (!success && retryCount < maxRetries) {
                const activeKey = getNextApiKey();
                try {
                    const genAI = new GoogleGenerativeAI(activeKey);
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-1.5-flash",
                        generationConfig: { temperature: 0.3 } // درجة حرارة منخفضة لترجمة أكثر دقة
                    });

                    const prompt = `Translate these movie subtitle lines to Arabic. 
                    Rules:
                    1. Return ONLY the translated text.
                    2. One line of translation per one line of input.
                    3. Maintain the same order.
                    4. Keep it cinematic and natural Arabic.
                    
                    Text to translate:
                    ${batchTexts.join('\n')}`;

                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const translatedText = response.text().trim();

                    if (translatedText) {
                        const translatedParts = translatedText.split('\n');
                        for (let j = 0; j < batchIndices.length; j++) {
                            // دمج الترجمة أو العودة للنص الأصلي في حال فشل سطر معين
                            translatedLines[batchIndices[j]] = translatedParts[j]?.trim() || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retryCount++;
                    console.error(`[⚠️ KEY ERROR] Key #${currentKeyIndex + 1} failed. Reason: ${e.message.substring(0, 60)}...`);
                    // انتظار قصير قبل التبديل للمفتاح التالي
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            batchTexts = [];
            batchIndices = [];

            // تحديث شريط التقدم في الواجهة
            if (onProgress) {
                let percent = Math.floor((i / lines.length) * 100);
                onProgress(percent);
            }
        }
    }

    console.log(`[GEMINI] ✅ تمت عملية التعريب بنجاح.`);
    return translatedLines.join('\n');
}

/**
 * 3. جلب الترجمات من مصدر خارجي (SubDL)
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    if (!SUBDL_API_KEY) {
        console.error("❌ خطأ: SUBDL_API_KEY مفقود.");
        return [];
    }

    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // محاولة جلب ترجمة عربية جاهزة أولاً
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original" }];
        }

        // إذا لم توجد، نجلب الإنجليزية ونترجمها بـ Gemini
        const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);
        if (enRes?.data?.subtitles?.length > 0) {
            const s = enRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) {
                console.log(`[AUTO-AI] 🤖 لا يوجد ترجمة عربية.. بدء تعريب نسخة: ${s.release_name}`);
                const translated = await translateToArabic(content, null);
                if (translated) return [{ content: translated, releaseName: s.release_name, source: "AI (Gemini)" }];
            }
        }
    } catch (e) { 
        console.error(`[SCRAPER] Error fetching subs: ${e.message}`); 
    }
    return [];
}

/**
 * 4. تحميل وفك ضغط الملفات
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { 
            responseType: 'arraybuffer',
            timeout: 10000 
        });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { 
        return null; 
    }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
