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
 * دالة ترجمة النص فقط مع الحفاظ على الكلمات التقنية
 */
async function translateTextOnly(text) {
    if (!text || text.trim() === "") return text;
    
    // إذا كان السطر يحتوي على توقيت أو أرقام فقط، نرجعه كما هو فوراً
    if (text.includes('-->') || /^\d+$/.test(text.trim())) return text;

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

        // طلب ترجمة مباشر جداً للسطر
        const result = await model.generateContent(`Translate this movie dialogue to Arabic, return ONLY the translation: ${text}`);
        const responseText = (await result.response).text().trim();
        
        return responseText || text;
    } catch (e) {
        return text; // في حال الخطأ نرجع النص الأصلي لضمان عدم ضياع السطر
    }
}

async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";

    // تقسيم الملف إلى أسطر حقيقية وتنظيفها من الفراغات الزائدة في الأطراف
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let finalTranslatedSrt = [];

    console.log(`[LINE-BY-LINE] 🛡️ معالجة ${lines.length} سطر بالترتيب...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // 1. إذا كان السطر عبارة عن رقم تسلسلي أو توقيت (00:00...) نضعه كما هو
        if (/^\d+$/.test(line.trim()) || line.includes('-->')) {
            finalTranslatedSrt.push(line);
        } 
        // 2. إذا كان السطر فارغاً نضعه كما هو
        else if (line.trim() === "") {
            finalTranslatedSrt.push("");
        }
        // 3. إذا كان نص حوار، نقوم بترجمته
        else {
            const translated = await translateTextOnly(line);
            finalTranslatedSrt.push(translated);
            
            // تسجيل التقدم كل 50 سطر للتأكد أن السيرفر يعمل
            if (i % 50 === 0) console.log(`[LIVE] Translated line ${i} of ${lines.length}`);
        }
    }

    // تجميع الملف النهائي والتأكد من عدم وجود فراغات قاتلة
    const result = finalTranslatedSrt.join('\n');
    return result.length > 10 ? result : sourceSrt;
}

// دالة fetchAllPossibleSubs و downloadAndUnzip تبقى ثابتة
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
                const translated = await translateToArabic(content);
                return [{ content: translated, releaseName: s.release_name, source: `AI Arabic` }];
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
