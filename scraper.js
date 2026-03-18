const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('google-translate-api-x');

/**
 * دالة الترجمة باستخدام محرك Google المجاني
 */
async function translateWithGoogle(textBatch) {
    try {
        // نرسل المصفوفة كاملة لجوجل، وهو سيعيدها مصفوفة مترجمة بنفس الترتيب
        const res = await translate(textBatch, { to: 'ar', forceBatch: true });
        return res.map(item => item.text);
    } catch (e) {
        console.error("Google Translate Error:", e.message);
        return textBatch; // العودة للأصل عند الخطأ
    }
}

async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return "";

    console.log("[GOOGLE-ENGINE] 🚀 بدء الترجمة السريعة عبر محرك جوجل...");
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let textToTranslate = [];
    let mapIndices = [];

    // تصفية الأسطر (نصوص الحوار فقط)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.includes('-->') && !/^\d+$/.test(line)) {
            textToTranslate.push(line);
            mapIndices.push(i);
        }
    }

    // جوجل سريع جداً، يمكننا إرسال 50 سطر في المرة الواحدة
    const BATCH_SIZE = 50;
    let finalResults = [];

    for (let i = 0; i < textToTranslate.length; i += BATCH_SIZE) {
        const batch = textToTranslate.slice(i, i + BATCH_SIZE);
        console.log(`[PROGRESS] Translating lines ${i} to ${i + BATCH_SIZE}...`);
        
        const translatedBatch = await translateWithGoogle(batch);
        finalResults.push(...translatedBatch);
    }

    // إعادة الحشو في ملف الـ SRT
    for (let i = 0; i < mapIndices.length; i++) {
        lines[mapIndices[i]] = finalResults[i] || lines[mapIndices[i]];
    }

    return lines.join('\n');
}

// دالة fetchAllPossibleSubs تبقى كما هي لكنها ستستخدم المحرك الجديد تلقائياً
async function fetchAllPossibleSubs(fullId) {
    const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${SUBDL_API_KEY}`;
        if (season && season !== 'undefined') url += `&season=${season}&episode=${episode}`;

        const res = await axios.get(url);
        const sub = res.data.subtitles?.find(s => s.lang === 'english') || res.data.subtitles?.[0];
        
        if (!sub) return [];

        const content = await downloadAndUnzip(sub.url);
        if (content) {
            const translatedContent = await translateToArabic(content);
            return [{
                content: translatedContent,
                releaseName: sub.release_name,
                source: "Google Translated (Fast)"
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
