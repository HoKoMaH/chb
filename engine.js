const scraper = require('./scraper');
const mongoose = require('mongoose');

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle');

async function getSyncedSubtitles(imdbId) {
    try {
        console.log(`[ENGINE] جاري البحث عن خيارات متعددة لـ: ${imdbId}`);

        // طلب قائمة بكل الترجمات المتاحة من السكرابر
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);

        if (allSubs && allSubs.length > 0) {
            let results = [];
            
            // نأخذ أول 5 نتائج (الأكثر دقة عادة)
            for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
                const sub = allSubs[i];
                const fileId = `${imdbId}_v${i + 1}`; // توليد ID فريد لكل نسخة

                // حفظ في القاعدة إذا لم تكن موجودة
                const exists = await Subtitle.findOne({ fileId });
                if (!exists) {
                    await new Subtitle({
                        fileId: fileId,
                        imdbId: imdbId,
                        arabicText: sub.content,
                        label: sub.releaseName || `نسخة مزمّنة ${i + 1}`
                    }).save();
                }

                results.push({
                    fileId: fileId,
                    label: sub.releaseName || `Option ${i + 1}`
                });
            }
            return results;
        }
    } catch (e) {
        console.error(`[ENGINE-ERROR] ${e.message}`);
    }
    return [];
}

module.exports = { getSyncedSubtitles };
