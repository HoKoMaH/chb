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
 * ترجمة سطر واحد مع ضمان العودة السريعة للموقع
 */
async function translateSingleLine(text) {
    if (!text || text.trim() === "" || /^\d+$/.test(text) || text.includes('-->')) return text;

    const cleanText = text.replace(/\{.*?\}/g, '').trim();
    if (!cleanText) return text;

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

        // طلب ترجمة فائق السرعة
        const result = await model.generateContent(cleanText);
        const translated = (await result.response).text().trim();
        return translated || text;
    } catch (e) {
        return text; // العودة للأصل فوراً عند أي تأخير أو خطأ
    }
}

/**
 * المحرك اللحظي: يحدّث النص ويرجعه للموقع فوراً
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [];

    console.log(`[LIVE MODE] 🟢 جاري الترجمة والإرسال المباشر...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (line.includes('-->') || /^\d+$/.test(line.trim()) || line.trim() === "") {
            translatedLines.push(line);
        } else {
            // ترجمة وحقن فوري في المصفوفة
            const translated = await translateSingleLine(line);
            translatedLines.push(translated);
            
            // لإعطاء شعور بالسرعة في الموقع، يمكننا طباعة التقدم في السجلات
            if (i % 20 === 0) console.log(`[PROGRESS] Translated ${i} lines...`);
        }
    }

    return translatedLines.join('\n');
}

/**
 * دالة الجلب الرئيسية
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // محاولة جلب العربية أولاً (لتظهر فوراً للمستخدم)
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original Arabic" }];
        }

        // إذا لم تتوفر، نبدأ بالتعريب اللحظي
        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                // هنا تبدأ العملية: بمجرد انتهاء translateToArabic، سيرجع الملف كاملاً للموقع
                const translated = await translateToArabic(content);
                return [{ content: translated, releaseName: s.release_name, source: `AI Translated` }];
            }
        }
    } catch (e) {
        console.error(`[ERROR]: ${e.message}`);
    }
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
