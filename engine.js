const scraper = require('./scraper');
const mongoose = require('mongoose');

const Subtitle = mongoose.models.Subtitle;

async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`[ENGINE] 🧐 فحص المزامنة لملف: ${videoFileName}`);
    try {
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        if (!allSubs || allSubs.length === 0) return [];

        let results = [];
        for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId}_v${i + 1}_smart`;

            // خوارزمية مطابقة بسيطة: هل كلمات اسم النسخة موجودة في اسم ملف الفيديو؟
            const releaseKeywords = sub.releaseName.toLowerCase().split(/[\s.]+/);
            const isMatch = videoFileName && releaseKeywords.some(kw => 
                kw.length > 2 && videoFileName.toLowerCase().includes(kw)
            );

            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName 
                },
                { upsert: true }
            );
            
            results.push({ 
                fileId: fileId, 
                label: sub.releaseName, 
                isMatch: isMatch // إرسال نتيجة المطابقة للـ Addon
            });
        }
        
        // ترتيب النتائج بحيث تظهر النسخة المطابقة (⭐) في الأعلى
        return results.sort((a, b) => b.isMatch - a.isMatch);

    } catch (e) {
        console.error(`[ENGINE-ERROR] ${e.message}`);
    }
    return [];
}

module.exports = { getSyncedSubtitles };
