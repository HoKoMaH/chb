const axios = require('axios');
const AdmZip = require('adm-zip');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { translate } = require('google-translate-api-x');

// إعداد المفاتيح السبعة
const keys = [
    process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7
].filter(k => k && k.length > 20);

/**
 * جلب الملف من SUBDL
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
            const content = await downloadAndUnzip(subs[0].url);
            return content ? { content, releaseName: subs[0].release_name } : null;
        }
    } catch (e) { console.error(`[SUBDL ERR] ${lang}:`, e.message); }
    return null;
}

/**
 * محرك الترجمة النفاث (7 مفاتيح بالتوازي)
 */
async function translateToArabic(sourceSrt) {
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

    const BATCH_SIZE = 40;
    let allPromises = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        const key = keys[Math.floor(i / BATCH_SIZE) % keys.length];
        
        allPromises.push((async () => {
            try {
                if (!key) throw new Error();
                const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(`Return ONLY a JSON array of Arabic translations for: ${JSON.stringify(batch)}`);
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
    for (let i = 0; i < mapIndices.length; i++) lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    return lines.join('\n');
}

/**
 * الدالة الرئيسية الذكية
 */
async function getSmartSubtitles(fullId, SubtitleModel) {
    // 1. بحث SUBDL عربي
    const onlineAr = await fetchFromSubdl(fullId, 'arabic');
    if (onlineAr) return [{ arabicText: onlineAr.content, label: onlineAr.releaseName, isAI: false }];

    // 2. بحث قاعدة البيانات
    const local = await SubtitleModel.find({ imdbId: fullId });
    if (local.length > 0) return local;

    // 3. تعريب إنجليزي من SUBDL
    const onlineEn = await fetchFromSubdl(fullId, 'english');
    if (onlineEn) {
        const translated = await translateToArabic(onlineEn.content);
        const fileId = `${fullId.replace(/:/g, '_')}_ai_${Date.now()}`;
        const newDoc = await SubtitleModel.create({
            fileId, imdbId: fullId, arabicText: translated, label: onlineEn.releaseName, isAI: true
        });
        return [newDoc];
    }
    return [];
}

async function downloadAndUnzip(url) {
    try {
        const res = await axios.get(`https://dl.subdl.com${url}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const entry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('MACOSX'));
        return entry ? entry.getData().toString('utf8') : null;
    } catch { return null; }
}

module.exports = { getSmartSubtitles };
