const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. إعداد تدوير المفاتيح (Key Rotation)
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.trim() !== "");

let currentKeyIndex = 0;

/**
 * محرك التعريب الذكي - إصدار Oregon المستقر
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt) return null;
    if (API_KEYS.length === 0) {
        console.error("❌ لم يتم العثور على مفاتيح GEMINI_KEY في إعدادات البيئة.");
        return sourceSrt;
    }

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines];
    let batchTexts = [];
    let batchIndices = [];
    
    // حجم دفعة متوازن لضمان عدم تجاوز حدود الـ Token
    const BATCH_SIZE = 30; 

    console.log(`[OREGON-NODE] 🌐 بدء التعريب باستخدام ${API_KEYS.length} مفاتيح في منطقة Oregon...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // تصفية أسطر الحوار فقط
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
                currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length; // التدوير للمفتاح التالي

                try {
                    const genAI = new GoogleGenerativeAI(activeKey);
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-1.5-flash",
                        generationConfig: { temperature: 0.2 } 
                    });

                    const prompt = `Translate these movie subtitle lines to Arabic. Return ONLY the translated text, one line per input. Maintain the same order:\n\n${batchTexts.join('\n')}`;

                    // محاولة الترجمة مع مهلة زمنية (Timeout)
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
                    const errorMsg = e.message.toLowerCase();
                    
                    console.error(`[⚠️ KEY #${currentKeyIndex + 1} FAILED] Reason: ${e.message.substring(0, 80)}...`);

                    // إذا كان الخطأ بسبب ضغط الطلبات (429)، ننتظر قليلاً
                    if (errorMsg.includes("429") || errorMsg.includes("quota")) {
                        await new Promise(r => setTimeout(r, 3000));
                    } 
                    // إذا كان الخطأ بسبب الموقع الجغرافي (رغم أن Oregon مدعومة)
                    else if (errorMsg.includes("location not supported")) {
                        console.error("🚨 الخطأ لا يزال يشير للموقع الجغرافي! تأكد من تغيير المنطقة في Render.");
                        break; 
                    }
                    
                    await new Promise(r => setTimeout(r, 1000));
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

    console.log(`[OREGON-NODE] ✅ اكتمل التعريب.`);
    return translatedLines.join('\n');
}

/**
 * وظائف جلب وفك ضغط الترجمة
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // محاولة جلب ترجمة عربية جاهزة
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original" }];
        }

        // تعريب النسخة الإنجليزية بـ Gemini
        const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);
        if (enRes?.data?.subtitles?.length > 0) {
            const s = enRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) {
                console.log(`[AUTO-AI] 🤖 بدء تعريب نسخة: ${s.release_name}`);
                const translated = await translateToArabic(content, null);
                if (translated) return [{ content: translated, releaseName: s.release_name, source: "AI (Gemini)" }];
            }
        }
    } catch (e) { console.error(`[SCRAPER] Error: ${e.message}`); }
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
