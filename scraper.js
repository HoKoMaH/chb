const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x');

// إعداد المفاتيح (7 مفاتيح)
const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * دالة البحث والجلب الشاملة (Subdl)
 * @param {string} fullId - IMDb ID (tt...)
 * @param {string} lang - اللغة المطلوبة (arabic أو english)
 */
async function fetchFromSubdl(fullId, lang = 'arabic') {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}&languages=${lang}`;
        if (season && episode) url += `&season=${season}&episode=${episode}`;

        const res = await axios.get(url);
        const subs = res.data.subtitles || [];
        
        if (subs.length > 0) {
            // نأخذ أول نتيجة (الأكثر توافقاً عادة)
            const sub = subs[0];
            const content = await downloadAndUnzip(sub.url);
            return content ? { content, releaseName: sub.release_name } : null;
        }
    } catch (e) { console.error(`[SUBDL-ERR] Error fetching ${lang}:`, e.message); }
    return null;
}

/**
 * المحرك النفاث للترجمة (المتوازي)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    const BATCH_SIZE = 40;
    let allPromises = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const key = keys[Math.floor(i / BATCH_SIZE) % keys.length];
        
        allPromises.push((async () => {
            try {
                if (!key) throw new Error("No Key");
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(`Translate to Arabic JSON array: ${JSON.stringify(batch)}`);
                const text = (await result.response).text().trim().replace(/```json/g, '').replace(/```/g, '');
                return JSON.parse(text);
            } catch {
                const res = await translate(batch, { to: 'ar', forceBatch: true });
                return res.map(item => item.text);
            }
        })());
    }

    const results = await Promise.all(allPromises);
    const finalResults = [].concat(...results);

    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }
    return lines.join('\n');
}

/**
 * الدالة المركزية المطلوبة في الـ Addon
 */
async function getSmartSubtitles(fullId, SubtitleModel) {
    // 1. محاولة جلب ترجمة عربية جاهزة من الموقع
    const onlineArabic = await fetchFromSubdl(fullId, 'arabic');
    if (onlineArabic) {
        return [{ content: onlineArabic.content, label: onlineArabic.releaseName, isAI: false }];
    }

    // 2. محاولة البحث في القاعدة (إذا لم نجد عربي في الموقع)
    const localSubs = await SubtitleModel.find({ imdbId: fullId });
    if (localSubs.length > 0) {
        return localSubs.map(s => ({ content: s.arabicText, label: s.label, isAI: s.isAI }));
    }

    // 3. المرحلة الأخيرة: تعريب ترجمة إنجليزية (أو غيرها)
    const onlineEnglish = await fetchFromSubdl(fullId, 'english');
    if (onlineEnglish) {
        const translated = await translateToArabic(onlineEnglish.content);
        
        // حفظها في القاعدة فوراً للمستقبل
        const newFileId = `${fullId.replace(/:/g, '_')}_ai_${Date.now()}`;
        await SubtitleModel.create({
            fileId: newFileId,
            imdbId: fullId,
            arabicText: translated,
            label: onlineEnglish.releaseName,
            isAI: true
        });

        return [{ content: translated, label: onlineEnglish.releaseName, isAI: true }];
    }

    return [];
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('MACOSX'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch { return null; }
}

module.exports = { getSmartSubtitles, translateToArabic };
