const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

// دالة ذكية لترجمة نص الـ SRT مع الحفاظ على التوقيت
async function translateSrt(englishSrt) {
    console.log("[TRANSLATOR] 🛠️ بدء الترجمة الفورية عبر محرك Google...");
    try {
        // نقوم بتقسيم الملف لأسطر
        const lines = englishSrt.split('\n');
        let translatedLines = [];

        // لضمان السرعة وعدم الحظر، سنترجم النصوص فقط ونتخطى أسطر التوقيت والأرقام
        for (let line of lines) {
            // إذا كان السطر يحتوي على نص (ليس توقيتاً وليس رقماً مجرداً)
            if (line.trim() && !line.includes('-->') && isNaN(line.trim())) {
                try {
                    const res = await translate(line, { to: 'ar' });
                    translatedLines.push(res.text);
                } catch (e) {
                    translatedLines.push(line); // في حال فشل سطر، نتركه كما هو
                }
            } else {
                translatedLines.push(line); // أسطر التوقيت والأرقام تبقى كما هي
            }
        }

        console.log("[TRANSLATOR] ✅ اكتملت الترجمة بنجاح.");
        return translatedLines.join('\n');
    } catch (err) {
        console.error("[TRANSLATOR-ERROR] فشل المحرك:", err.message);
        return null;
    }
}

async function fetchAllPossibleSubs(imdbId) {
    const API_KEY = process.env.SUBDL_API_KEY;
    let results = [];

    try {
        // 1. محاولة جلب العربية أولاً (كما هو معتاد)
        const arResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=ar&api_key=${API_KEY}`);
        
        if (arResponse.data && arResponse.data.subtitles.length > 0) {
            console.log(`[SCRAPER] وجدنا ترجمة عربية جاهزة.`);
            results = await processSubDLResults(arResponse.data.subtitles.slice(0, 3));
        } else {
            // 2. إذا لم توجد، نجلب الإنجليزية ونترجمها فوراً
            console.log(`[SCRAPER] لا يوجد عربي، جاري جلب الإنجليزية للترجمة...`);
            const enResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=en&api_key=${API_KEY}`);

            if (enResponse.data && enResponse.data.subtitles.length > 0) {
                const enSub = enResponse.data.subtitles[0];
                const enSrt = await downloadAndUnzip(enSub.url);
                
                if (enSrt) {
                    const translatedAr = await translateSrt(enSrt);
                    if (translatedAr) {
                        results.push({
                            content: translatedAr,
                            releaseName: `${enSub.release_name} (Auto-Translated)`,
                            source: "Google Translate"
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] ${e.message}`);
    }
    return results;
}

// دالة المساعدة للتحميل وفك الضغط
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch { return null; }
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
