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
 * دالة لتنظيف أي زوائد يضيفها Gemini (مثل العلامات البرمجية)
 */
function cleanGeminiResponse(text) {
    return text
        .replace(/```srt/gi, '')
        .replace(/```/g, '')
        .replace(/Here is the translation:/gi, '')
        .trim();
}

async function translateChunk(chunk) {
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

        // برومبت مباشر وصريح لا يقبل التأويل
        const prompt = `Translate the following subtitle text to Arabic. 
        Keep all timestamps (00:00...) and numbers exactly as they are. 
        Return ONLY the translated SRT text:
        
        ${chunk}`;

        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text();
        const cleaned = cleanGeminiResponse(responseText);

        return cleaned || chunk; // إذا كانت الاستجابة فارغة، يرجع الأصل ولا يتركها فارغة
    } catch (e) {
        console.error("AI Error:", e.message);
        return chunk;
    }
}

async function translateToArabic(sourceSrt) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    // تقسيم الملف إلى قطع كبيرة (كل قطعة حوالي 3000 حرف)
    // هذا أفضل من تقسيم الأسطر لأنها تحافظ على "سياق" الفيلم
    const maxChunkLength = 3000;
    let chunks = [];
    let currentChunk = "";

    const srtLines = sourceSrt.replace(/\r/g, '').split('\n');

    for (let line of srtLines) {
        if ((currentChunk.length + line.length) > maxChunkLength && line.trim() === "") {
            chunks.push(currentChunk);
            currentChunk = "";
        }
        currentChunk += line + "\n";
    }
    if (currentChunk) chunks.push(currentChunk);

    console.log(`[ROBUST MODE] 🛠️ معالجة ${chunks.length} جزء ضخم...`);

    let finalSrt = "";
    for (let i = 0; i < chunks.length; i++) {
        console.log(`[PROGRESS] Translating chunk ${i + 1}/${chunks.length}...`);
        const translated = await translateChunk(chunks[i]);
        finalSrt += translated + "\n\n";
    }

    // التأكد من أن الملف النهائي ليس فارغاً تماماً
    return finalSrt.trim().length > 10 ? finalSrt : sourceSrt;
}

// دالة fetchAllPossibleSubs المحدثة لضمان رجوع بيانات دائماً
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
                // إذا فشلت الترجمة لأي سبب، نرجع الأصل الإنجليزي ولا نتركها فارغة
                return [{ content: translated, releaseName: s.release_name, source: `AI Arabic` }];
            }
        }
    } catch (e) { console.error("Fetcher Error:", e); }
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
