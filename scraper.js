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
 * محرك ترجمة الكتل النصية الضخمة
 */
async function translateBlock(blockText) {
    const key = getNextKey();
    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", // الفلاش ممتاز للكتل الطويلة
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });

        const prompt = `You are a professional subtitle translator. Translate the following SRT block to Arabic. 
        IMPORTANT: 
        1. Keep the exact same SRT format (numbers and timestamps).
        2. Do not change any timestamps.
        3. Translate ONLY the text to natural Arabic.
        
        SRT BLOCK:
        ${blockText}`;

        const result = await model.generateContent(prompt);
        const translatedBlock = (await result.response).text().trim();
        
        // تنظيف الاستجابة من أي كلام إضافي قد يضعه Gemini (مثل ```srt)
        return translatedBlock.replace(/```srt/g, '').replace(/```/g, '').trim();
    } catch (e) {
        console.error("Block Translation Error:", e.message);
        return blockText; // العودة للأصل عند الفشل لضمان عدم اختفاء النص
    }
}

/**
 * تقسيم الفيلم لكتل ضخمة (كل كتلة 50 سطر SRT كامل بتوقيته)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let blocks = [];
    let currentBlock = [];
    let srtCounter = 0;

    // تقسيم الملف إلى كتل (كل كتلة تحتوي على 50 حوار كامل)
    for (let line of lines) {
        currentBlock.push(line);
        if (line.includes('-->')) srtCounter++;
        
        if (srtCounter >= 50) {
            blocks.push(currentBlock.join('\n'));
            currentBlock = [];
            srtCounter = 0;
        }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock.join('\n'));

    console.log(`[BLOCK SYSTEM] 📦 تقسيم الفيلم إلى ${blocks.length} كتلة ضخمة...`);

    let translatedFullSrt = [];
    
    // ترجمة الكتل بالتسلسل من البداية للنهاية
    for (let i = 0; i < blocks.length; i++) {
        console.log(`[PROGRESS] Translating Block ${i+1}/${blocks.length}...`);
        const translated = await translateBlock(blocks[i]);
        translatedFullSrt.push(translated);
    }

    return translatedFullSrt.join('\n\n');
}

/**
 * دوال الجلب (SubDL)
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

        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                const translated = await translateToArabic(content);
                return [{ content: translated, releaseName: s.release_name, source: `AI Block Translation` }];
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
