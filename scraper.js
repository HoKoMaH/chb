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

// دالة ترجمة مجموعة أسطر (Batch) لضمان السرعة وعدم الانقطاع
async function translateBatch(batchLines) {
    if (batchLines.length === 0) return [];
    const key = getNextKey();
    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // نطلب الترجمة مع فاصل مميز لضمان الترتيب
        const prompt = `Translate these movie subtitles to Arabic. Keep order. Return ONLY translations separated by " | ":\n${batchLines.join('\n')}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        
        // تقسيم الاستجابة وإعادة النصوص المترجمة
        let translated = text.split('|').map(t => t.trim());
        
        // تأمين: إذا نقص سطر نرجعه من الأصل
        while (translated.length < batchLines.length) {
            translated.push(batchLines[translated.length]);
        }
        return translated;
    } catch (e) {
        console.error("Batch Error:", e.message);
        return batchLines; // العودة للأصل عند الخطأ
    }
}

async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";
    
    console.log("[SYSTEM] بدء المعالجة الشاملة للملف...");
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    // تصفية النصوص التي تحتاج ترجمة فقط
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    // تقسيم العمل لمجموعات (كل مجموعة 20 سطر) لسرعة خرافية
    const BATCH_SIZE = 20;
    let finalResults = [];
    
    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        console.log(`[PROGRESS] Translating chunk ${i} to ${i + BATCH_SIZE}...`);
        const translatedBatch = await translateBatch(batch);
        finalResults.push(...translatedBatch);
    }

    // إعادة دمج الأسطر المترجمة في هيكل الـ SRT الأصلي
    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }

    return lines.join('\n');
}

async function fetchAllPossibleSubs(fullId) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && season !== 'undefined') url += `&season=${season}&episode=${episode}`;

        const res = await axios.get(url);
        if (!res.data.subtitles) return [];

        // نختار الترجمة الإنجليزية أو أول نتيجة متاحة
        const sub = res.data.subtitles.find(s => s.lang === 'english') || res.data.subtitles[0];
        const content = await downloadAndUnzip(sub.url);
        
        if (content) {
            const translatedContent = await translateToArabic(content);
            return [{
                content: translatedContent,
                releaseName: sub.release_name,
                source: "AI Arabic (Sequential)"
            }];
        }
    } catch (e) { console.error("Fetcher Error:", e.message); }
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

module.exports = { fetchAllPossibleSubs, translateToArabic };
