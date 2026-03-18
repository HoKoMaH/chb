const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. محرك التعريب الذكي (نظام التبريد لتجنب الحظر)
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    const lines = sourceSrt.split('\n');
    let batchTexts = [], batchIndices = [];
    const totalLines = lines.length;

    console.log(`[TRANSLATOR] 🤖 تعريب آلي لـ ${totalLines} سطر...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

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
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
            if (i % 100 === 0) console.log(`[PROGRESS] ⏳ ${((i/totalLines)*100).toFixed(1)}%`);
            await new Promise(r => setTimeout(r, 500)); 
        }
    }
    return lines.join('\n');
}

/**
 * 2. المحرك الرئيسي (جلب كــــل المصادر بلا استثناء)
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|YTS|PSA|AMZN|H264|H265)/g) || [];

    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة الأولى: جلب جـمـيـع الترجمات العربية المتوفرة
        console.log(`[SCRAPER] 🔍 جاري سحب كـل الترجمات العربية لـ ${fullId}...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ تم العثور على ${arRes.data.subtitles.length} ملف عربي.`);
            
            // حلقة تكرار تمر على كل الملفات العربية وتجلبها كلها
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
            // إذا وجدنا عربي أصلي، نكتفي به ونعرض الكل
            return results;
        }

        // المرحلة الثانية: التعريب (إذا لم يوجد أي ملف عربي نهائياً)
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 لا يوجد عربي أصلي. جاري البحث عن نسخة عالمية متوافقة...`);
            const allRes = await axios.get(baseUrl).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0]; 
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
        console.error(`[SCRAPER-ERROR] ❌ فشل الجلب: ${e.message}`);
    }
    return results;
}

/**
 * 3. دالة فك الضغط
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        return null;
    }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
