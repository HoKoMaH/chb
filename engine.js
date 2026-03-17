const scraper = require('./scraper');
const mongoose = require('mongoose');

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle');

async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`[ENGINE] 🧐 فحص المخزون لـ: ${imdbId}`);
    
    try {
        const cachedSubs = await Subtitle.find({ imdbId: imdbId });
        
        if (cachedSubs.length > 0) {
            console.log(`[ENGINE-CACHE] 📦 وجدنا ${cachedSubs.length} ملفات مخزنة مسبقاً. تخطي البحث الخارجي.`);
            return cachedSubs.map(sub => ({
                fileId: sub.fileId,
                label: sub.label,
                isAI: sub.isAI,
                isMatch: (videoFileName || "").toLowerCase().includes((sub.label || "").toLowerCase())
            }));
        }

        console.log(`[ENGINE] 🌐 لم يتم العثور على كاش. تحويل الطلب إلى السكرابر...`);
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        
        if (!allSubs || allSubs.length === 0) return [];

        let results = [];
        for (let i = 0; i < allSubs.length; i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId.replace(/:/g, '_')}_v${i + 1}_smart`;

            const videoLower = (videoFileName || "").toLowerCase();
            const releaseKeywords = (sub.releaseName || "").toLowerCase().split(/[\s.-]+/);
            const isMatch = videoLower && releaseKeywords.some(kw => kw.length > 3 && videoLower.includes(kw));

            console.log(`[ENGINE-SAVE] 💾 حفظ النسخة: ${sub.releaseName} (AI: ${sub.source.includes("AI")})`);
            
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName,
                    isAI: sub.source.includes("AI")
                },
                { upsert: true, new: true }
            );
            
            results.push({ fileId, label: sub.releaseName, isMatch, isAI: sub.source.includes("AI") });
        }
        
        return results.sort((a, b) => b.isMatch - a.isMatch);
    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ خطأ فادح: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
