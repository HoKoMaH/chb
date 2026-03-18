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
    if (API_KEYS.length === 0) return null;
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

/**
 * 1. دالة الترجمة الفردية مع LOGS
 */
async function translateLineContent(text, index) {
    if (!text || text.trim() === "" || text.includes('-->') || /^\d+$/.test(text.trim())) return text;

    const key = getNextKey();
    if (!key) {
        console.error(`[LOG-ERR] لا يوجد مفتاح API للسطر ${index}`);
        return text;
    }

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

        const prompt = `Translate to Arabic: ${text}`;
        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim();

        if (!responseText) {
            console.warn(`[LOG-WARN] استجابة فارغة من Gemini للسطر ${index}`);
            return text;
        }

        return responseText.replace(/^["']|["']$/g, '');
    } catch (e) {
        console.error(`[LOG-API-ERR] سطر ${index}: ${e.message.substring(0, 50)}`);
        return text;
    }
}

/**
 * 2. الدالة الرئيسية للمعالجة (التي ظهر فيها الخطأ)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) {
        console.error("[LOG-ERR] النص المصدر (sourceSrt) فارغ!");
        return "";
    }

    console.log("[LOG-INFO] بدأت دالة translateToArabic العمل...");
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let finalSrtArray = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (line.includes('-->') || /^\d+$/.test(line.trim()) || line.trim() === "") {
            finalSrtArray.push(line);
        } else {
            const translated = await translateLineContent(line, i);
            finalSrtArray.push(translated);
        }

        // لوق للتأكد من أن المصفوفة تمتلئ
        if (i < 3 || i % 100 === 0) {
            console.log(`[LOG-PROGRESS] معالجة السطر ${i}/${lines.length}... المصفوفة الآن: ${finalSrtArray.length}`);
        }
    }

    const result = finalSrtArray.join('\n');
    console.log(`[LOG-DONE] انتهت المعالجة. طول النص النهائي: ${result.length}`);
    return result;
}

/**
 * 3. دالة جلب الملفات
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                // استدعاء الدالة داخل نفس الملف
                const translated = await translateToArabic(content);
                return [{ content: translated, releaseName: s.release_name, source: `AI Arabic` }];
            }
        }
    } catch (e) { console.error(`[LOG-FETCHER-ERR] ${e.message}`); }
    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.startsWith('__MACOSX'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

// هــــــــام جــــــــداً: التصدير الصحيح لكي لا يظهر خطأ "not a function"
module.exports = { 
    fetchAllPossibleSubs, 
    translateToArabic 
};
