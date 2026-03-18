const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

const API_KEYS = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].map(k => k ? k.trim() : null).filter(k => k);

let currentKeyIndex = 0;

function getNextKey() {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

/**
 * دالة ترجمة سطر واحد أو مجموعة صغيرة جداً لضمان الصفر أخطاء
 */
async function translateWithRetry(text) {
    if (!text || text.trim() === "" || /^\d+$/.test(text) || text.includes('-->')) return text;

    let attempts = 0;
    // تنظيف النص من الأكواد التقنية لضمان قبول Gemini له
    const cleanText = text.replace(/\{.*?\}/g, '').trim();
    if (!cleanText) return text;

    while (attempts < 2) {
        const key = getNextKey();
        try {
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ]
            });

            const result = await model.generateContent(`Translate this movie line to Arabic, return ONLY the translation: "${cleanText}"`);
            const translated = (await result.response).text().trim();
            
            if (translated && translated.length > 0) return translated;
        } catch (e) {
            attempts++;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return text; // إذا فشل تماماً يعيد النص الأصلي
}

async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [];

    console.log(`[ULTRA STABILITY] 🛡️ بدء الترجمة بنظام السطر الآمن...`);

    // معالجة الأسطر واحداً تلو الآخر لضمان عدم حدوث أي إزاحة (Offset)
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // فحص: هل السطر هو نص حوار؟
        const isTimestamp = line.includes('-->');
        const isNumber = /^\d+$/.test(line.trim());
        const isEmpty = line.trim() === "";

        if (!isTimestamp && !isNumber && !isEmpty) {
            // ترجمة الحوار فقط
            const translated = await translateWithRetry(line);
            translatedLines.push(translated);
        } else {
            // الاحتفاظ بالتوقيت والأرقام كما هي
            translatedLines.push(line);
        }

        if (onProgress && i % 50 === 0) {
            onProgress(Math.floor((i / lines.length) * 100));
        }
    }

    return translatedLines.join('\n');
}

// الدوال fetchAllPossibleSubs و downloadAndUnzip تبقى كما هي
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

        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                const translated = await translateToArabic(content, null);
                return [{ content: translated, releaseName: s.release_name, source: `AI Translated` }];
            }
        }
    } catch (e) { console.error(e); }
    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer', timeout: 15000 });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.startsWith('__MACOSX'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
