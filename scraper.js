const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. دالة التعريب الذكية (تجاوز الحظر + نظام التبريد)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    const lines = sourceSrt.split('\n');
    let batchTexts = [], batchIndices = [];
    const totalLines = lines.length;

    console.log(`[TRANSLATOR] 🤖 بدء تعريب ملف ضخم (${totalLines} سطر).. جاري العمل بهدوء.`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // معالجة دفعات صغيرة (10 أسطر) لضمان عدم الحظر
        if (batchTexts.length === 10 || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false, retries = 5;
            while (!success && retries > 0) {
                try {
                    const res = await translate(batchTexts.join(' | '), { to: 'ar' });
                    if (res && res.text) {
                        const parts = res.text.split(' | ');
                        for (let j = 0; j < batchIndices.length; j++) {
                            lines[batchIndices[j]] = parts[j] || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    console.log(`[WAIT] ⚠️ ضغط مؤقت.. انتظار 5 ثوانٍ (المحاولات: ${retries})`);
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
            if (i % 100 === 0) console.log(`[PROGRESS] ⏳ ${((i/totalLines)*100).toFixed(1)}%`);
            await new Promise(r => setTimeout(r, 500)); // تأخير ثابت لمنع اكتشاف الروبوت
        }
    }
    return lines.join('\n');
}

/**
 * 2. المحرك الرئيسي للبحث الخارجي (SubDL)
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const parts = fullId.split(':');
    const imdbId = parts[0];
    const season = parts[1];
    const episode = parts[2];
    
    // استخراج الكلمات الدلالية من اسم الفيلم للمزامنة (BluRay, YTS, etc)
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|YTS|PSA|AMZN|H264|H265)/g) || [];

    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة الأولى: جلب كـــــل الترجمات العربية الأصلية المتوفرة
        console.log(`[SCRAPER] 🔍 البحث عن ترجمات عربية أصلية لـ ${fullId}...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا ${arRes.data.subtitles.length} ترجمة عربية أصلية.`);
            for (let s of arRes.data.subtitles) {
                const content = await downloadAndUnzip(s.url);
                if (content) {
                    results.push({
                        content: content,
                        releaseName: s.release_name,
                        source: "Original"
                    });
                }
            }
            // إذا وجدنا عربي أصلي، نكتفي به ونخرج
            return results;
        }

        // المرحلة الثانية: إذا لم نجد أي عربي (الخطة ب - تعريب AI)
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 لا يوجد عربي أصلي. جاري البحث عن نسخة عالمية لتعريبها...`);
            const allRes = await axios.get(baseUrl).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                // ترتيب النسخ الأجنبية لاختيار الأكثر توافقاً مع اسم ملف الفيديو
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0]; // اختيار النسخة الأنسب (BluRay مثلاً)
                console.log(`[SCRAPER-AI] 🎯 تعريب نسخة (${bestSub.lang}): ${bestSub.release_name}`);

                const sourceContent = await downloadAndUnzip(bestSub.url);
                const translatedContent = await translateToArabic(sourceContent);
                
                if (translatedContent) {
                    results.push({ 
                        content: translatedContent, 
                        releaseName: bestSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] ❌ خطأ في البحث: ${e.message}`);
    }
    return results;
}

/**
 * 3. دالة تحميل وفك ضغط ملف الـ Zip
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        console.error(`[UNZIP-ERROR] فشل تحميل/فك ضغط الملف: ${subUrl}`);
        return null;
    }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
