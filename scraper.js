const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// 1. تنظيف وجلب مفاتيح API من البيئة
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
 * دالة ترجمة النص مع توجيه صارم (Strict Persona)
 */
async function translateLineContent(text) {
    if (!text || text.trim() === "") return text;
    
    // حماية الأسطر التقنية (توقيت أو أرقام) من الإرسال للـ API
    if (text.includes('-->') || /^\d+$/.test(text.trim())) return text;

    const key = getNextKey();
    if (!key) return text;

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

        // البرومبت الصارم لضمان فهم المهمة وتحويلها للعربية
        const prompt = `Act as a professional movie translator. 
        Target Language: Arabic.
        Task: Translate the text below into natural Arabic. 
        Rule: Return ONLY the translation. No notes.
        Text: ${text}`;

        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim();
        
        // إزالة أي علامات تنصيص زائدة قد يضيفها الموديل
        return responseText.replace(/^["']|["']$/g, '') || text;
    } catch (e) {
        console.error(`[Translation Skip] Error on line: ${e.message.substring(0, 40)}`);
        return text; // العودة للأصل عند أي خطأ
    }
}

/**
 * معالج ملف SRT بالكامل (سطر بسطر بالترتيب)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let finalSrtArray = [];

    console.log(`[START] 🎬 ترجمة ${lines.length} سطر بالترتيب...`);

    for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i];

        // منطق الحفاظ على هيكل SRT:
        // إذا كان السطر توقيت، أو رقم، أو فارغ -> نضعه كما هو فوراً
        if (currentLine.includes('-->') || /^\d+$/.test(currentLine.trim()) || currentLine.trim() === "") {
            finalSrtArray.push(currentLine);
        } 
        // إذا كان نص حوار -> نرسله للمترجم
        else {
            const translated = await translateLineContent(currentLine);
            finalSrtArray.push(translated);
        }

        // إظهار التقدم كل 100 سطر
        if (i % 100 === 0) console.log(`[PROGRESS] Line ${i}/${lines.length} done.`);
    }

    const finalResult = finalSrtArray.join('\n');
    return finalResult.length > 50 ? finalResult : sourceSrt;
}

/**
 * جلب الملفات من SubDL والتعامل مع النتائج
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // 1. محاولة جلب العربية الأصلية أولاً
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original Arabic" }];
        }

        // 2. إذا لم تتوفر، نجلب الإنجليزية ونترجمها
        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                const translated = await translateToArabic(content);
                return [{ content: translated, releaseName: s.release_name, source: `AI Arabic` }];
            }
        }
    } catch (e) { 
        console.error(`[Fetcher Error]: ${e.message}`);
    }
    return [];
}

/**
 * فك ضغط الملف المستلم من SubDL
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { 
            responseType: 'arraybuffer', 
            timeout: 15000 
        });
        const zip = new AdmZip(Buffer.from(res.data));
        // البحث عن ملف SRT فقط وتجاهل مخلفات النظام
        const srtEntry = zip.getEntries().find(e => 
            e.entryName.toLowerCase().endsWith('.srt') && 
            !e.entryName.startsWith('__MACOSX')
        );
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { 
        console.error("[Unzip Error]");
        return null; 
    }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
