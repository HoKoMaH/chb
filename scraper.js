const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x'); // الحل الاحتياطي الأفضل

const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * 1. دالة التحميل وفك الضغط (محسنة لتدعم المسارات المتداخلة)
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer', timeout: 15000 });
        const zip = new AdmZip(Buffer.from(res.data));
        const entries = zip.getEntries();
        // البحث عن أول ملف ينتهي بـ .srt ولا يخص ماك
        const srtEntry = entries.find(e => 
            e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('MACOSX')
        );
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        console.error(`[ZIP-ERROR] ❌ فشل فك الضغط: ${err.message}`);
        return null;
    }
}

/**
 * 2. محرك الترجمة النفاث (Gemini + Progress Support)
 */
async function translateToArabic(sourceSrt, onProgress = null) {
    if (!sourceSrt) return "";
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [], mapIndices = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const BATCH_SIZE = 45; 
    let completedBatches = 0;
    const totalBatches = Math.ceil(textToTranslate.length / BATCH_SIZE);
    let allPromises = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const key = keys[Math.floor(i / BATCH_SIZE) % keys.length];
        
        allPromises.push((async () => {
            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const prompt = `Translate these movie subtitles to Arabic. Return ONLY the JSON array: ${JSON.stringify(batch)}`;
                const result = await model.generateContent(prompt);
                let text = (await result.response).text().trim().replace(/```json/g, '').replace(/```/g, '');
                
                const parsed = JSON.parse(text);
                completedBatches++;
                if (onProgress) onProgress(Math.round((completedBatches / totalBatches) * 100));
                return Array.isArray(parsed) ? parsed : batch;
            } catch (err) {
                // الحل الاحتياطي في حال فشل Gemini
                try {
                    const res = await translate(batch, { to: 'ar' });
                    completedBatches++;
                    if (onProgress) onProgress(Math.round((completedBatches / totalBatches) * 100));
                    return res.map(item => item.text);
                } catch {
                    completedBatches++;
                    if (onProgress) onProgress(Math.round((completedBatches / totalBatches) * 100));
                    return batch;
                }
            }
        })());
    }

    const results = await Promise.all(allPromises);
    const finalResults = [].concat(...results);
    for (let i = 0; i < mapIndices.length; i++) lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    return lines.join('\n');
}

/**
 * 3. المحرك الرئيسي: جلب كل المصادر (دمج المنطق القديم والجديد)
 */
async function getSmartSubtitles(fullId, SubtitleModel) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة الأولى: سحب كل الترجمات العربية الأصلية من SUBDL
        console.log(`[SCRAPER] 🔍 جاري البحث عن ترجمات عربية أصلية...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            for (let s of arRes.data.subtitles.slice(0, 5)) { // جلب أفضل 5 نسخ عربية
                const content = await downloadAndUnzip(s.url);
                if (content) {
                    results.push({
                        arabicText: content,
                        label: s.release_name,
                        isAI: false,
                        fileId: `${fullId.replace(/:/g,'_')}_original_${Math.random().toString(36).substr(2, 5)}`
                    });
                }
            }
            if (results.length > 0) return results;
        }

        // المرحلة الثانية: إذا لم يوجد عربي، نبحث في قاعدة البيانات عن تعريب سابق
        const localSubs = await SubtitleModel.find({ imdbId: fullId });
        if (localSubs.length > 0) return localSubs;

        // المرحلة الثالثة: جلب أفضل نسخة إنجليزية وتعريبها بـ Gemini
        console.log(`[SCRAPER] 🌍 لا يوجد عربي أصلي. جاري سحب نسخة إنجليزية لتعريبها...`);
        const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);
        
        if (enRes?.data?.subtitles?.length > 0) {
            const bestEn = enRes.data.subtitles[0]; // نأخذ أول نسخة (غالباً الأفضل)
            const sourceContent = await downloadAndUnzip(bestEn.url);
            
            if (sourceContent) {
                const translated = await translateToArabic(sourceContent);
                const fileId = `${fullId.replace(/:/g, '_')}_ai_${Date.now()}`;
                
                const newSub = await SubtitleModel.create({
                    fileId: fileId,
                    imdbId: fullId,
                    arabicText: translated,
                    label: bestEn.release_name,
                    isAI: true
                });
                return [newSub];
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] ❌ فشل الجلب: ${e.message}`);
    }
    return results;
}

module.exports = { getSmartSubtitles, translateToArabic };
