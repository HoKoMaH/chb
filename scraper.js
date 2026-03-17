const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

async function translateSrt(englishSrt) {
    console.log("[TRANSLATOR] 🚀 بدء الترجمة الفورية...");
    try {
        const lines = englishSrt.split('\n');
        let batchTexts = [];
        let batchIndices = [];
        let totalTranslated = 0;
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line && !line.includes('-->') && isNaN(line)) {
                batchTexts.push(line);
                batchIndices.push(i);
            }

            if (batchTexts.length === 25 || (i === lines.length - 1 && batchTexts.length > 0)) {
                const res = await translate(batchTexts.join(' \n '), { to: 'ar' }).catch(() => null);
                if (res) {
                    const parts = res.text.split(' \n ');
                    for (let j = 0; j < batchIndices.length; j++) {
                        lines[batchIndices[j]] = parts[j] || batchTexts[j];
                    }
                    totalTranslated += batchTexts.length;
                    if (totalTranslated % 100 === 0) console.log(`   - تم ترجمة ${totalTranslated} سطر...`);
                }
                batchTexts = [];
                batchIndices = [];
            }
        }
        console.log(`[TRANSLATOR] ✅ اكتملت ترجمة ${totalTranslated} سطر.`);
        return lines.join('\n');
    } catch (err) {
        console.error(`[TRANSLATOR-ERROR] ❌ فشل المحرك: ${err.message}`);
        return null;
    }
}

async function fetchAllPossibleSubs(fullId) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    
    console.log(`[SCRAPER] 🛰️ فحص المصادر الخارجية لـ: ${imdbId} ${season ? '(S'+season+' E'+episode+')' : ''}`);
    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season) baseUrl += `&season=${season}&episode=${episode}`;

        // فحص العربية
        console.log(`[SCRAPER-FETCH] 🔍 طلب الترجمة العربية من SubDL...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER-FOUND] ✨ وجدنا ترجمة عربية جاهزة.`);
            results = await processSubs(arRes.data.subtitles.slice(0, 2), "Original");
        } 
        
        // فحص الإنجليزية إذا لم يوجد عربي
        if (results.length === 0) {
            console.log(`[SCRAPER-FETCH] 🔍 لا يوجد عربي. طلب النسخة الإنجليزية...`);
            const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);

            if (enRes?.data?.subtitles?.length > 0) {
                const enSub = enRes.data.subtitles[0];
                console.log(`[SCRAPER-AI] 🤖 بدء تحويل النسخة: ${enSub.release_name}`);
                const enSrt = await downloadAndUnzip(enSub.url);
                const translatedAr = await translateSrt(enSrt);
                if (translatedAr) results.push({ content: translatedAr, releaseName: enSub.release_name, source: "AI" });
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ ${e.message}`); }
    return results;
}

async function downloadAndUnzip(subUrl) {
    console.log(`[DOWNLOADER] 📥 جاري تحميل الملف من SubDL...`);
    const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
    const zip = new AdmZip(Buffer.from(res.data));
    const srt = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
    return srt ? srt.getData().toString('utf8') : null;
}

async function processSubs(subs, type) {
    let list = [];
    for (let s of subs) {
        const content = await downloadAndUnzip(s.url);
        if (content) list.push({ content, releaseName: s.release_name, source: type });
    }
    return list;
}

module.exports = { fetchAllPossibleSubs };
