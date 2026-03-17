const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

// دالة الترجمة (نفس المنطق السابق مع تحسين السرعة)
async function translateSrt(englishSrt) {
    if (!englishSrt) return null;
    console.log("[TRANSLATOR] 🤖 بدء ترجمة الملف الإنجليزي المطابق...");
    const lines = englishSrt.split('\n');
    let batchTexts = [];
    let batchIndices = [];
    
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
            }
            batchTexts = [];
            batchIndices = [];
        }
    }
    return lines.join('\n');
}

async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    console.log(`[SCRAPER] 🎯 هدف البحث: ${videoFileName}`);

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season) baseUrl += `&season=${season}&episode=${episode}`;

        // 1. فحص العربية أولاً (كما طلبنا دائماً)
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا ترجمة عربية جاهزة.`);
            results = await processSubs(arRes.data.subtitles.slice(0, 2), "Original");
        } 

        // 2. إذا لم نجد عربي، نبحث عن "إنجليزي مطابق تماماً" لاسم الملف
        if (results.length === 0) {
            console.log(`[SCRAPER] 🔍 لم نجد عربي. جاري البحث عن نسخة إنجليزية مطابقة لـ: ${videoFileName}`);
            const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);

            if (enRes?.data?.subtitles?.length > 0) {
                // فلترة النتائج للبحث عن الاسم المطابق
                const videoLower = videoFileName.toLowerCase();
                let bestEnSub = enRes.data.subtitles.find(sub => {
                    const subLabel = sub.release_name.toLowerCase();
                    // نتحقق من وجود الكلمات الأساسية (مثل PSA أو YTS) في اسم الترجمة
                    return videoLower.includes(subLabel) || subLabel.includes(videoLower.split('.')[0]);
                });

                // إذا لم نجد مطابقاً تماماً، نأخذ أول نتيجة إنجليزية كحل أخير
                if (!bestEnSub) {
                    console.log("[SCRAPER] ⚠️ لم نجد نسخة مطابقة 100%، سنستخدم أفضل نسخة متوفرة.");
                    bestEnSub = enRes.data.subtitles[0];
                }

                console.log(`[SCRAPER-AI] 🤖 البدء بترجمة النسخة الإنجليزية: ${bestEnSub.release_name}`);
                const enSrt = await downloadAndUnzip(bestEnSub.url);
                const translatedAr = await translateSrt(enSrt);
                
                if (translatedAr) {
                    results.push({ 
                        content: translatedAr, 
                        releaseName: bestEnSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ ${e.message}`); }
    return results;
}

// الدوال المساعدة للتحميل والمعالجة (تبقى كما هي)
async function downloadAndUnzip(subUrl) {
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
