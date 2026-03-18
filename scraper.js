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

            // طلب الترجمة مع تأكيد صارم على التنسيق المرقوم
            const prompt = `Translate to Arabic. Keep cinematic style. Return ONLY the format "Index: TranslatedText".\n\n` + 
                           batchTexts.map((t, idx) => `${idx + 1}: ${t}`).join('\n');

            const result = await model.generateContent(prompt);
            const text = (await result.response).text().trim();

            if (text) {
                const lines = text.split('\n');
                lines.forEach(line => {
                    // Regex محسن لاستخراج الرقم حتى لو وجد مسافات أو رموز
                    const match = line.match(/^(\d+)\s*[:.-]\s*(.*)/);
                    if (match) {
                        const localIdx = parseInt(match[1]) - 1;
                        const translatedText = match[2].trim();
                        if (localIdx >= 0 && localIdx < batchIndices.length && translatedText) {
                            translatedLines[batchIndices[localIdx]] = translatedText;
                        }
                    }
                });
                success = true;
            }
        } catch (e) {
            attempts++;
            await new Promise(r => setTimeout(r, 1200));
        }
    }

    // ضمان عدم وجود سطر فارغ نهائياً
    batchIndices.forEach((globalIdx, localIdx) => {
        if (!translatedLines[globalIdx] || translatedLines[globalIdx].trim() === "") {
            translatedLines[globalIdx] = batchTexts[localIdx];
        }
    });
}

async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt || API_KEYS.length === 0) return sourceSrt;

    // تنظيف الملف من الرموز الغريبة التي قد تربك التقسيم
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines]; 

    let allBatches = [];
    const BATCH_SIZE = 20; // تقليل الحجم لضمان الدقة المطلقة
    const PARALLEL_LIMIT = 2;

    let currentBatchTexts = [];
    let currentBatchIndices = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // تحسين الفلترة: تجاهل التوقيت، الأرقام التسلسلية، والأسطر الفارغة
        const isTimestamp = line.includes('-->');
        const isNumber = /^\d+$/.test(line);
        const isEmpty = line === "";

        if (!isTimestamp && !isNumber && !isEmpty) {
            currentBatchTexts.push(line);
            currentBatchIndices.push(i);
        }

        if (currentBatchTexts.length === BATCH_SIZE || (i === lines.length - 1 && currentBatchTexts.length > 0)) {
            allBatches.push({ texts: [...currentBatchTexts], indices: [...currentBatchIndices] });
            currentBatchTexts = [];
            currentBatchIndices = [];
        }
    }

    for (let i = 0; i < allBatches.length; i += PARALLEL_LIMIT) {
        const group = allBatches.slice(i, i + PARALLEL_LIMIT);
        await Promise.all(group.map(batch => translateBatch(batch.texts, batch.indices, translatedLines)));
        if (onProgress) onProgress(Math.floor((i / allBatches.length) * 100));
        await new Promise(r => setTimeout(r, 1000));
    }

    return translatedLines.join('\n');
}

// الدوال الأخرى تبقى كما هي مع تحسين بسيط في downloadAndUnzip
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
        // البحث عن ملف srt وتجاهل ملفات النص الأخرى
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.startsWith('__MACOSX'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
