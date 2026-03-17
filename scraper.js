const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

async function translateSrt(englishSrt) {
    console.log("[TRANSLATOR] 🚀 بدء معالجة الملف وترجمته...");
    try {
        if (!englishSrt) return null;
        const lines = englishSrt.split('\n');
        let batchTexts = [];
        let batchIndices = [];
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line && !line.includes('-->') && isNaN(line)) {
                batchTexts.push(line);
                batchIndices.push(i);
            }

            if (batchTexts.length === 20 || (i === lines.length - 1 && batchTexts.length > 0)) {
                try {
                    const combinedText = batchTexts.join(' \n ');
                    const res = await translate(combinedText, { to: 'ar' });
                    const translatedParts = res.text.split(' \n ');

                    for (let j = 0; j < batchIndices.length; j++) {
                        lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                    }
                } catch (e) { console.error("[TRANSLATOR-LOG] دفعة فشلت."); }
                batchTexts = [];
                batchIndices = [];
            }
        }
        return lines.join('\n');
    } catch (err) {
        return null;
    }
}

async function fetchAllPossibleSubs(fullId) {
    const API_KEY = process.env.SUBDL_API_KEY;
    console.log("-----------------------------------------");
    console.log(`[SCRAPER] 🔍 فحص المعرف: ${fullId}`);
    
    // تقسيم المعرف إذا كان مسلسلاً (imdbId:season:episode)
    const idParts = fullId.split(':');
    const imdbId = idParts[0];
    const season = idParts[1];
    const episode = idParts[2];

    let results = [];

    try {
        // بناء رابط البحث - دعم المسلسلات والأفلام
        let searchUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) {
            searchUrl += `&season=${season}&episode=${episode}`;
        }

        // 1. البحث عن العربية
        console.log("[SCRAPER-LOG] 1️⃣ محاولة جلب ترجمة عربية...");
        const arRes = await axios.get(`${searchUrl}&languages=ar`).catch(() => null);
        
        // الحماية من الـ undefined
        if (arRes && arRes.data && arRes.data.subtitles && Array.isArray(arRes.data.subtitles) && arRes.data.subtitles.length > 0) {
            console.log(`[SCRAPER-SUCCESS] ✨ وجدنا ترجمة عربية أصلية.`);
            results = await processSubDLResults(arRes.data.subtitles.slice(0, 2));
        } 
        
        // 2. إذا لم نجد، نبحث عن إنجليزية لنترجمها
        if (results.length === 0) {
            console.log(`[SCRAPER-LOG] 2️⃣ جاري البحث عن نسخة إنجليزية للترجمة...`);
            const enRes = await axios.get(`${searchUrl}&languages=en`).catch(() => null);

            if (enRes && enRes.data && enRes.data.subtitles && Array.isArray(enRes.data.subtitles) && enRes.data.subtitles.length > 0) {
                const enSub = enRes.data.subtitles[0];
                const enSrt = await downloadAndUnzip(enSub.url);
                if (enSrt) {
                    const translatedAr = await translateSrt(enSrt);
                    if (translatedAr) {
                        results.push({
                            content: translatedAr,
                            releaseName: `${enSub.release_name} (Auto-AI)`,
                            source: "Google AI"
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] ❌ خطأ في المعالجة: ${e.message}`);
    }

    console.log(`[SCRAPER] 🏁 النتائج: ${results.length}`);
    return results;
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

async function processSubDLResults(subs) {
    let processed = [];
    for (let sub of subs) {
        const content = await downloadAndUnzip(sub.url);
        if (content) {
            processed.push({ content, releaseName: sub.release_name, source: "SubDL" });
        }
    }
    return processed;
}

module.exports = { fetchAllPossibleSubs };
