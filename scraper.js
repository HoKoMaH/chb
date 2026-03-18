const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// 1. إعداد وتدوير المفاتيح
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
 * محرك الترجمة - يدعم التحويل من أي لغة للعربية
 */
async function translateBatch(batchTexts, batchIndices, translatedLines) {
    let success = false;
    let attempts = 0;

    while (!success && attempts < 2) {
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

            // تحديث الـ Prompt ليقبل أي لغة مدخلة
            const prompt = `Translate the following subtitle lines from their original language into natural, cinematic Arabic. Return ONLY the translated lines, one per line, keeping the exact same order:\n\n${batchTexts.join('\n')}`;
            
            const result = await model.generateContent(prompt);
            const text = (await result.response).text().trim();

            if (text) {
                const parts = text.split('\n');
                for (let j = 0; j < batchIndices.length; j++) {
                    translatedLines[batchIndices[j]] = parts[j]?.trim() || batchTexts[j];
                }
                success = true;
            }
        } catch (e) {
            attempts++;
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

/**
 * المحرك النفاث للتعريب المتوازي
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines];
    let allBatches = [];
    
    const BATCH_SIZE = 50; 
    const PARALLEL_LIMIT = 5; 

    let currentBatchTexts = [];
    let currentBatchIndices = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line && !line.includes('-->') && isNaN(line)) {
            currentBatchTexts.push(line);
            currentBatchIndices.push(i);
        }

        if (currentBatchTexts.length === BATCH_SIZE || (i === lines.length - 1 && currentBatchTexts.length > 0)) {
            allBatches.push({ texts: [...currentBatchTexts], indices: [...currentBatchIndices] });
            currentBatchTexts = [];
            currentBatchIndices = [];
        }
    }

    console.log(`[ULTRA SPEED] 🌍 تعريب شامل من أي لغة.. معالجة ${allBatches.length} دفعة...`);

    for (let i = 0; i < allBatches.length; i += PARALLEL_LIMIT) {
        const group = allBatches.slice(i, i + PARALLEL_LIMIT);
        await Promise.all(group.map(batch => translateBatch(batch.texts, batch.indices, translatedLines)));
        if (onProgress) onProgress(Math.floor((i / allBatches.length) * 100));
        await new Promise(r => setTimeout(r, 300));
    }

    if (onProgress) onProgress(100);
    return translatedLines.join('\n');
}

/**
 * جلب الترجمات - الآن يبحث عن أي لغة متوفرة إذا لم يجد العربية
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // 1. محاولة جلب العربية الجاهزة (الأولوية دائماً للعربية لتوفير الوقت)
        console.log(`[SCRAPER] 🔍 البحث عن ترجمة عربية جاهزة...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            const s = arRes.data.subtitles[0];
            const content = await downloadAndUnzip(s.url);
            if (content) return [{ content, releaseName: s.release_name, source: "Original" }];
        }

        // 2. إذا لم يجد، يجلب أي لغة أخرى متوفرة (الإنجليزية، الفرنسية، إلخ) لتعريبها
        console.log(`[SCRAPER] 🌍 لم يتم العثور على عربية، جاري البحث عن بدائل لتعريبها...`);
        const allRes = await axios.get(baseUrl).catch(() => null);
        
        if (allRes?.data?.subtitles?.length > 0) {
            // نختار أول ترجمة متوفرة (غالباً ما تكون إنجليزية أو لغة الفيلم الأصلية)
            const s = allRes.data.subtitles[0]; 
            const content = await downloadAndUnzip(s.url);
            if (content) {
                console.log(`[AI] 🤖 بدء تعريب النسخة المتاحة: (${s.release_name})`);
                const translated = await translateToArabic(content, null);
                if (translated) return [{ content: translated, releaseName: s.release_name, source: `AI (Translated from Original)` }];
            }
        }
    } catch (e) { console.error(`[ERROR] fetchAllPossibleSubs: ${e.message}`); }
    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer', timeout: 15000 });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
