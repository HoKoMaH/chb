const scraper = require('./scraper');
const mongoose = require('mongoose');

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle');

async function getSyncedSubtitles(imdbId, videoFileName) {
    try {
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        if (!allSubs || allSubs.length === 0) return [];

        let results = [];
        for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId}_v${i + 1}_smart`;

            // مطابقة اسم النسخة مع اسم ملف الفيديو
            const videoLower = videoFileName.toLowerCase();
            const releaseKeywords = sub.releaseName.toLowerCase().split(/[\s.-]+/);
            const isMatch = videoLower && releaseKeywords.some(kw => 
                kw.length > 3 && videoLower.includes(kw)
            );

            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName 
                },
                { upsert: true, new: true }
            );
            
            results.push({ fileId, label: sub.releaseName, isMatch });
        }
        
        // جلب النسخة المطابقة للأعلى
        return results.sort((a, b) => b.isMatch - a.isMatch);
    } catch (e) {
        console.error(`[ENGINE-ERROR] ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
