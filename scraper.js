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
 * محرك الترجمة الفردية: يضمن معالجة النص بدوره الصحيح
 */
async function translateLineByLine(text) {
    // تجاهل الأسطر الفارغة أو أرقام التسلسل أو التوقيت
    if (!text || text.trim() === "" || /^\d+$/.test(text.trim()) || text.includes('-->')) {
        return text;
    }

    // تنظيف الأكواد التقنية مثل {\an8} لعدم إرباك الذكاء الاصطناعي
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

        const result = await model.generateContent(cleanText);
        const translated = (await result.response).text().trim();
        
        // إذا نجحت الترجمة نرجعها، وإلا نرجع النص الأصلي فوراً لضمان عدم التوقف
        return translated || text;
    } catch (e) {
        console.error(`[AI Error] Skipping line: ${e.message.substring(0, 30)}`);
        return text; 
    }
}

/**
 * المعالج المتسلسل: يبدأ من السطر 1 إلى نهاية الملف بالترتيب
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    // تقسيم الملف لأسطر
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [];

    console.log(`[SEQUENTIAL MODE] 🎞️ بدء المعالجة من السطر الأول...`);

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i];

        // هل السطر يحتاج ترجمة؟ (ليس توقيت وليس رقماً)
        if (currentLine.includes('-->') || /^\d+$/.test(currentLine.trim()) || currentLine.trim() === "") {
            translatedLines.push(currentLine);
        } else {
            // الترجمة "بالدور" - السطر الحالي ينتظر استجابة الـ API قبل الانتقال للي بعده
            const translated = await translateLineByLine(currentLine);
            translatedLines.push(translated);
            
            // تحديث السجلات كل 10 أسطر لمتابعة التقدم بالترتيب
            if (i % 10 === 0) {
                console.log(`[LIVE] Processing line ${i}/${lines.length}...`);
            }
        }
    }

    console.log(`[DONE] ✅ اكتملت الترجمة التسلسلية.`);
    return translatedLines.join('\n');
}

/**
 * دالة الجلب والتشغيل
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // البحث عن نسخة عربية جاهزة أولاً
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original" }];
        }

        // إذا لم تتوفر، نبدأ بالترجمة التسلسلية الفورية
        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                // استدعاء محرك الترجمة المتسلسل
                const translated = await translateToArabic(content);
                return [{ content: translated, releaseName: s.release_name, source: `AI Sequential Translation` }];
            }
        }
    } catch (e) {
        console.error(`[CRITICAL ERROR]: ${e.message}`);
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
