const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

// دالة لترجمة النصوص مع الحفاظ على التوقيت (Batching)
async function translateSrt(englishSrt) {
    if (!englishSrt) return null;
    console.log("[TRANSLATOR] 🤖 بدء ترجمة نسخة مطابقة للتوقيت...");
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

    // استخراج الوسوم الفنية من اسم الملف (مثلاً: BluRay, WEB-DL, NF, YTS, PSA)
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBrip|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];
    console.log(`[SYNC-LOG] 🎯 الوسوم المكتشفة في فيلمك: ${technicalTags.join(', ')}`);

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season) baseUrl += `&season=${season}&episode=${episode}`;

        // 1. البحث عن العربية أولاً
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            results = await processSubs(arRes.data.subtitles.slice(0, 2), "Original");
        } 

        // 2. إذا لم نجد عربي، نبحث عن الإنجليزي "الأكثر مطابقة فنية"
        if (results.length === 0) {
            console.log(`[SYNC-SEARCH] 🔍 البحث عن ترجمة إنجليزية مطابقة للتوقيت...`);
            const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);

            if (enRes?.data?.subtitles?.length > 0) {
                // ترتيب الترجمات الإنجليزية بناءً على عدد الوسوم المشتركة مع ملف الفيديو
                const sortedEnSubs = enRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestEnSub = sortedEnSubs[0];
                console.log(`[SYNC-SUCCESS] 🏆 تم اختيار النسخة الأقرب للمزامنة: ${bestEnSub.release_name}`);

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
    } catch (e) { console.error(`[SCRAPER-ERROR] ❌ ${e.message}`); }
    return results;
}

// الدوال المساعدة للتحميل
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
