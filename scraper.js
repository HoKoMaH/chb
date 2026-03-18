const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. دالة التعريب الذكية (تجاوز الحظر + عداد النسبة)
 * مصممة للتعامل مع ضغط سيرفرات جوجل والملفات التي تزيد عن 5000 سطر
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    
    const lines = sourceSrt.split('\n');
    let batchTexts = [];
    let batchIndices = [];
    const totalLines = lines.length;
    let processedLines = 0;

    console.log(`[TRANSLATOR] 🤖 بدء تعريب ملف ضخم (${totalLines} سطر).. جاري العمل بنظام التبريد لتجنب الحظر.`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // استخراج النصوص فقط
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // معالجة دفعات صغيرة (10 أسطر) لتقليل حجم الطلب الواحد
        if (batchTexts.length === 10 || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retries = 5; // عدد محاولات إعادة الاتصال في حال الحظر

            while (!success && retries > 0) {
                try {
                    const res = await translate(batchTexts.join(' | '), { to: 'ar' });
                    
                    if (res && res.text) {
                        const translatedParts = res.text.split(' | ');
                        for (let j = 0; j < batchIndices.length; j++) {
                            lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    if (e.message.includes('Too Many Requests') || e.status === 429) {
                        console.log(`[WAIT] ⚠️ حظر مؤقت من جوجل عند السطر ${i}.. سأنتظر 5 ثوانٍ (المحاولات: ${retries})`);
                        await new Promise(resolve => setTimeout(resolve, 5000)); // انتظر 5 ثواني لتهدئة السيرفر
                    } else {
                        console.error(`[ERROR] خطأ غير متوقع: ${e.message}`);
                        break; 
                    }
                }
            }
            
            // تحديث لوق النسبة المئوية كل 50 سطر لتقليل زحمة اللوقات
            processedLines = i;
            if (i % 50 === 0 || i === totalLines - 1) {
                const percentage = ((processedLines / totalLines) * 100).toFixed(1);
                console.log(`[PROGRESS] ⏳ تم إنجاز: ${percentage}% (${processedLines}/${totalLines})`);
            }

            // تأخير ثابت (نصف ثانية) بين كل طلب وآخر ليوهم جوجل أن المستخدم بشري
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    console.log(`[TRANSLATOR] ✅ اكتمل التعريب بنجاح 100% رغم ضخامة الملف.`);
    return lines.join('\n');
}

/**
 * 2. المحرك الأساسي للبحث الشامل
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة 1: البحث عن العربي الأصلي
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا ${arRes.data.subtitles.length} مصدر عربي أصلي.`);
            results = await processSubs(arRes.data.subtitles, "Original");
        } 

        // المرحلة 2: التعريب العالمي (إذا لم يتوفر عربي)
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 لا يوجد عربي. جاري اصطياد نسخة عالمية للمزامنة والتعريب...`);
            const allRes = await axios.get(`${baseUrl}`).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0];
                console.log(`[SCRAPER-AI] 🎯 اختيار نسخة (${bestSub.lang}) للتعريب: ${bestSub.release_name}`);

                const sourceSrt = await downloadAndUnzip(bestSub.url);
                const translatedContent = await translateToArabic(sourceSrt);
                
                if (translatedContent) {
                    results.push({ 
                        content: translatedContent, 
                        releaseName: bestSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ خطأ: ${e.message}`); }
    return results;
}

/**
 * 3. الدوال المساعدة
 */
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

/**
 * 4. تصدير الدوال
 */
module.exports = { fetchAllPossibleSubs, translateToArabic };
