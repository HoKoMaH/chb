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
 * دالة ذكية لترجمة الدفعة مع التحقق من سلامة الأسطر
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

            // Prompt صارم جداً لمنع Gemini من التأليف أو دمج الأسطر
            const prompt = `Act as a professional movie translator. Translate the following lines to Arabic. 
            Rules: 
            - Keep the exact same number of lines.
            - Do not add any notes, numbers, or explanations.
            - Return ONLY the translated text.
            
            Lines:
            ${batchTexts.join('\n')}`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim();

            if (text) {
                // تقسيم النص مع تنظيف الأسطر الفارغة الناتجة عن الخطأ
                let parts = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);

                // إذا كان عدد الأسطر المترجمة مطابقاً أو قريباً، نقوم بالحقن
                if (parts.length >= batchTexts.length * 0.8) {
                    for (let j = 0; j < batchIndices.length; j++) {
                        translatedLines[batchIndices[j]] = parts[j] || batchTexts[j];
                    }
                    success = true;
                } else {
                    console.log(`[Mismatch] Batch size mismatch. Expected ${batchTexts.length}, got ${parts.length}. Retrying...`);
                    attempts++;
                }
            }
        } catch (e) {
            attempts++;
            console.error(`[Key Error] ${e.message.substring(0, 50)}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Fallback: إذا فشل كل شيء، نضع النص الأصلي لكي لا يظهر الملف فارغاً
    if (!success) {
        batchIndices.forEach((idx, i) => {
            if (!translatedLines[idx] || translatedLines[idx] === "") {
                translatedLines[idx] = batchTexts[i];
            }
        });
    }
}

/**
 * المحرك الرئيسي مع تقليل الضغط لضمان الجودة
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines]; // تهيئة كاملة بالقيم الأصلية

    let allBatches = [];
    const BATCH_SIZE = 30; // تقليل الحجم لزيادة الدقة ومنع دمج الأسطر
    const PARALLEL_LIMIT = 2; // تقليل التوازي لمنع اختناق الـ API

    let currentBatchTexts = [];
    let currentBatchIndices = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        // التفرقة الدقيقة بين الحوار والبيانات الوصفية
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

    console.log(`[REPAIR MODE] 🛠️ ترجمة ${allBatches.length} دفعة بحذر...`);

    for (let i = 0; i < allBatches.length; i += PARALLEL_LIMIT) {
        const group = allBatches.slice(i, i + PARALLEL_LIMIT);
        await Promise.all(group.map(batch => translateBatch(batch.texts, batch.indices, translatedLines)));
        
        if (onProgress) onProgress(Math.floor((i / allBatches.length) * 100));
        // انتظار كافٍ لضمان استقرار الاستجابة
        await new Promise(r => setTimeout(r, 800));
    }

    return translatedLines.join('\n');
}

// باقي الدوال (fetchAllPossibleSubs, downloadAndUnzip) تبقى كما هي
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
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
