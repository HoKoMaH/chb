const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// مصفوفة المفاتيح (سيتم ملؤها من خلالك أو عبر البيئة)
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
];

let currentKeyIndex = 0;

/**
 * وظيفة الحصول على التوكن التالي (التدوير)
 */
function getNextApiKey() {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

/**
 * محرك التعريب باستخدام Gemini AI
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt) return null;

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines];
    let batchTexts = [];
    let batchIndices = [];

    // Gemini يمكنه معالجة دفعات أكبر بذكاء (30-50 سطر)
    const BATCH_SIZE = 40; 

    console.log(`[GEMINI AI] 🤖 بدء التعريب الذكي لـ (${lines.length} سطر) باستخدام 7 توكنز...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        if (batchTexts.length === BATCH_SIZE || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retries = 3;

            while (!success && retries > 0) {
                try {
                    // اختيار المفتاح الحالي من الدورة
                    const genAI = new GoogleGenerativeAI(getNextApiKey());
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

                    const prompt = `Translate the following subtitle lines to Arabic. Keep the translation natural and cinematic. Return ONLY the translated lines, one per line, in the same order. Do not add any explanations or notes:\n\n${batchTexts.join('\n')}`;

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
                    retries--;
                    console.log(`[⚠️ GEMINI ERROR] Key failed, trying next key... (${retries} retries left)`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            batchTexts = [];
            batchIndices = [];

            if (onProgress) {
                let percent = Math.floor((i / lines.length) * 100);
                onProgress(percent);
            }

            // مع Gemini و 7 مفاتيح، يمكننا تقليل الانتظار جداً (0.5 ثانية فقط)
            await new Promise(r => setTimeout(r, 500));
        }
    }

    console.log(`[GEMINI AI] ✅ اكتمل التعريب بجودة احترافية.`);
    return translatedLines.join('\n');
}

/**
 * جلب وتحميل الترجمات (نفس الوظائف السابقة)
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
                const translated = await translateToArabic(content, null);
                if (translated) return [{ content: translated, releaseName: s.release_name, source: "AI (Gemini)" }];
            }
        }
    } catch (e) { console.error(e); }
    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
