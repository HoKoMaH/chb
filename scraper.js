const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * دالة التعريب مع إظهار نسبة الإنجاز في اللوق
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    
    const lines = sourceSrt.split('\n');
    let batchTexts = [];
    let batchIndices = [];
    const totalLines = lines.length;
    let processedLines = 0;

    console.log(`[TRANSLATOR] 🤖 بدء التعريب.. إجمالي الأسطر: ${totalLines}`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // نجمع النصوص فقط للترجمة
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // معالجة كل 15 سطر
        if (batchTexts.length === 15 || (i === lines.length - 1 && batchTexts.length > 0)) {
            try {
                const res = await translate(batchTexts.join(' | '), { to: 'ar' });
                
                if (res && res.text) {
                    const translatedParts = res.text.split(' | ');
                    for (let j = 0; j < batchIndices.length; j++) {
                        lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                    }
                }
                
                // تحديث العداد والنسبة المئوية
                processedLines = i;
                const percentage = ((processedLines / totalLines) * 100).toFixed(1);
                console.log(`[PROGRESS] ⏳ تم تحويل: ${percentage}% (${processedLines}/${totalLines})`);

                // تأخير بسيط لضمان عدم الحظر من جوجل
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
                console.error(`[TRANSLATOR-ERROR] خطأ في الدفعة عند السطر ${i}: ${e.message}`);
            }
            batchTexts = [];
            batchIndices = [];
        }
    }
    
    console.log(`[TRANSLATOR] ✅ اكتمل التحويل بنجاح 100%`);
    return lines.join('\n');
}

async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة 1: العربي الأصلي (بدون ترجمة AI)
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا ${arRes.data.subtitles.length} ملف عربي أصلي.`);
            results = await processSubs(arRes.data.subtitles, "Original");
        } 

        // المرحلة 2: التعريب العالمي (إذا لم يوجد عربي)
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 لا يوجد عربي. البحث عن أفضل نسخة عالمية...`);
            const allRes = await axios.get(`${baseUrl}`).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0];
                console.log(`[SCRAPER-AI] 🎯 جاري سحب نسخة (${bestSub.lang}) للتعريب: ${bestSub.release_name}`);

                const sourceSrt = await downloadAndUnzip(bestSub.url);
                
                // هُنا التأكد من انتظار الترجمة (Await) قبل الإرجاع
                const translatedContent = await translateToArabic(sourceSrt);
                
                if (translatedContent) {
                    results.push({ 
                        content: translatedContent, 
                        releaseName: bestSub.releaseName || bestSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ خطأ: ${e.message}`); }
    return results;
}

// الدوال المساعدة للتحميل
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
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
